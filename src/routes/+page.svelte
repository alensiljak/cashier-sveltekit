<script lang="ts">
	import JournalCard from '#lib/components/JournalCard.svelte';
	import {
		CircleAlert,
		FilePlusIcon,
		FileTextIcon,
		PlusIcon,
		RefreshCwIcon,
		ScanSearchIcon,
		SettingsIcon,
		ZapIcon
	} from '@lucide/svelte';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '#lib/data/mainStore';
	import { Xact } from '#lib/data/model';
	import FavouritesCard from '#lib/components/FavouritesCard.svelte';
	import SyncCard from '#lib/components/SyncCard.svelte';
	import ForecastCard from '#lib/components/ForecastCard.svelte';
	import ScheduledXactsCard from '#lib/components/ScheduledXactsCard.svelte';
	import ExpensesCard from '#lib/components/ExpensesCard.svelte';
	import BudgetCard from '#lib/components/BudgetCard.svelte';
	import NetWorthCard from '#lib/components/NetWorthCard.svelte';
	import { onMount, type Component } from 'svelte';
	import HomeSpeedDialFab from '#lib/components/HomeSpeedDialFab.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { HomeCardNames } from '#lib/enums';
	import appService from '#lib/services/appService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { recheckOpfsStale } from '#lib/services/opfsMetaCheck';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
	import LedgerStatusIndicator from '#lib/components/LedgerStatusIndicator.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';

	let cards: Array<Component> = $state([]);
	let hasErrors = $state(false);
	let isValidated = $state(false);
	let isStale = $state(false);
	let showStaleDialog = $state(false);
	let isReloading = $state(false);

	onMount(async () => {
		// display the cards ordered.
		await loadCardList();
	});

	async function loadCardList() {
		let cardsOrder = await appService.getVisibleCards();

		cardsOrder.forEach((name: string) => {
			let card;
			switch (name) {
				case HomeCardNames.FAVOURITES:
					card = FavouritesCard;
					break;
				case HomeCardNames.FORECAST:
					card = ForecastCard;
					break;
				case HomeCardNames.JOURNAL:
					card = JournalCard;
					break;
				case HomeCardNames.SCHEDULED:
					card = ScheduledXactsCard;
					break;
				case HomeCardNames.EXPENSES:
					card = ExpensesCard;
					break;
			case HomeCardNames.BUDGET:
				card = BudgetCard;
				break;
			case HomeCardNames.NET_WORTH:
				card = NetWorthCard;
				break;
			case HomeCardNames.SYNC:
				card = SyncCard;
				break;
			}
			if (card) {
				cards.push(card);
			}
		});
	}

	// When the ledger becomes loaded, check for validation errors.
	$effect(() => {
		const unsubscribe = fullLedgerService.loaded.subscribe(async (isLoaded) => {
			if (!isLoaded) {
				isValidated = false;
				return;
			}
			try {
				const allErrors = (await fullLedgerService.getErrors()) as Array<{ severity: string }>;
				hasErrors = allErrors.some((e) => e.severity === 'error');
				isValidated = true;
			} catch {
				// Ledger not ready yet; ignore.
			}
		});
		return unsubscribe;
	});

	async function onNewBlank() {
		xact.set(Xact.create());
		await goto('/tx');
	}

	async function onQuickEntry() {
		xact.set(Xact.create());
		await goto('/tx/quick-entry');
	}

	async function onNote() {
		await goto('/note');
	}

	async function handleManualCheck() {
		isStale = false;
		recheckOpfsStale().then((stale) => {
			isStale = stale;
		});
	}

	async function handleReload() {
		isReloading = true;
		try {
			await reloadLedgerFromOpfs();
			isStale = false;
			showStaleDialog = false;
		} finally {
			isReloading = false;
		}
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar>
		{#snippet actions()}
			<LedgerStatusIndicator validated={isValidated} {hasErrors} />
			{#if isStale}
				<button
					class="btn btn-ghost btn-circle hover-transparent h-12 w-12"
					title="Ledger files have changed — tap to reload"
					onclick={() => (showStaleDialog = true)}
				>
					<RefreshCwIcon size={22} class="text-warning" />
				</button>
			{/if}
			{#if hasErrors}
				<button
					class="btn btn-ghost btn-circle hover-transparent h-12 w-12"
					title="Validation errors found"
					onclick={() => goto('/util/validation')}
				>
					<CircleAlert size={22} class="text-error" />
				</button>
			{/if}
			<HelpButton topic="home" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Home Settings" Icon={SettingsIcon} targetNav="/home-settings" />
			<ToolbarMenuItem text="Check files" Icon={ScanSearchIcon} onclick={handleManualCheck} />
			<ToolbarMenuItem text="Reload ledger" Icon={RefreshCwIcon} onclick={handleReload} />
		{/snippet}
	</Toolbar>

	<!-- Main -->
	<section class="mx-auto max-w-2xl w-full space-y-2 px-1 py-1">
		<!-- Cards are displayed dynamically, in the selected order. -->
		{#each cards as Card (Card)}
			<Card></Card>
		{/each}

		<!-- FAB -->
		<HomeSpeedDialFab
			ariaLabel="Add"
			Icon={PlusIcon}
			actions={[
				{ icon: FileTextIcon, label: 'Note', onclick: onNote },
				{ icon: FilePlusIcon, label: 'Blank transaction', onclick: onNewBlank },
				{ icon: ZapIcon, label: 'Quick entry', onclick: onQuickEntry }
			]}
		/>
	</section>

	{#if showStaleDialog}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Ledger files updated</h3>
				<p class="py-3 text-sm">
					One or more ledger files have changed since the last load. Reload now to update the ledger
					and rebuild the cache?
				</p>
				<div class="modal-action">
					<button class="btn" onclick={() => (showStaleDialog = false)} disabled={isReloading}>
						Not now
					</button>
					<button class="btn btn-primary" onclick={handleReload} disabled={isReloading}>
						{#if isReloading}
							Reloading…
							<span class="loading loading-spinner loading-sm"></span>
						{:else}
							Reload
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</main>
