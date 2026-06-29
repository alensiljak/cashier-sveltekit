<script lang="ts">
	import JournalCard from '$lib/components/JournalCard.svelte';
	import { ArrowDownUpIcon, CircleAlert, PlusIcon, RefreshCwIcon, SettingsIcon } from '@lucide/svelte';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '$lib/data/mainStore';
	import { Xact } from '$lib/data/model';
	import FavouritesCard from '$lib/components/FavouritesCard.svelte';
	// import SyncCard from '$lib/components/SyncCard.svelte';
	import ForecastCard from '$lib/components/ForecastCard.svelte';
	import ScheduledXactsCard from '$lib/components/ScheduledXactsCard.svelte';
	import { onMount, type Component } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { CardNames } from '$lib/settings';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { checkOpfsStale, saveOpfsMetaSnapshot } from '$lib/services/opfsMetaCheck';

	let cards: Array<Component> = $state([]);
	let hasErrors = $state(false);
	let isStale = $state(false);
	let isChecking = $state(false);
	let showStaleDialog = $state(false);
	let isReloading = $state(false);

	onMount(async () => {
		// display the cards ordered.
		await loadCardList();
		// background staleness check — does not block render.
		// checkOpfsStale() caches per session, so only the first mount actually runs I/O.
		const p = checkOpfsStale();
		// Show spinner only if the promise hasn't resolved yet.
		let settled = false;
		p.then((stale) => {
			isStale = stale;
			settled = true;
			isChecking = false;
		});
		if (!settled) isChecking = true;
	});

	async function loadCardList() {
		let cardsOrder = await appService.getVisibleCards();

		cardsOrder.forEach((name: string) => {
			let card;
			switch (name) {
				case CardNames.FavouritesCard:
					card = FavouritesCard;
					break;
				case CardNames.ForecastCard:
					card = ForecastCard;
					break;
				case CardNames.JournalCard:
					card = JournalCard;
					break;
				case CardNames.ScheduledXactCard:
					card = ScheduledXactsCard;
					break;
				// case CardNames.SyncCard:
				// 	card = SyncCard;
				// 	break;
			}
			if (card) {
				cards.push(card);
			}
		});
	}

	// When the ledger becomes loaded, check for validation errors.
	$effect(() => {
		const unsubscribe = fullLedgerService.loaded.subscribe(async (isLoaded) => {
			if (!isLoaded) return;
			try {
				const allErrors = (await fullLedgerService.getErrors()) as Array<{ severity: string }>;
				hasErrors = allErrors.some((e) => e.severity === 'error');
			} catch {
				// Ledger not ready yet; ignore.
			}
		});
		return unsubscribe;
	});

	async function onFab() {
		// create a new transaction in the app store
		const tx = Xact.create();
		xact.set(tx);

		// await goto('/tx');
		await goto('/tx/search-new');
	}

	async function handleReload() {
		isReloading = true;
		try {
			await fullLedgerService.load();
			await fullLedgerService.serialize();
			await saveOpfsMetaSnapshot();
			isStale = false;
			showStaleDialog = false;
		} finally {
			isReloading = false;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar>
		{#snippet actions()}
			{#if isChecking}
				<span class="loading loading-spinner loading-xs opacity-50 mr-1"></span>
			{/if}
			{#if isStale}
				<button
					class="btn btn-ghost btn-circle hover-transparent"
					title="Ledger files have changed — tap to reload"
					onclick={() => (showStaleDialog = true)}
				>
					<RefreshCwIcon size={20} class="text-warning" />
				</button>
			{/if}
			{#if hasErrors}
				<button
					class="btn btn-ghost btn-circle hover-transparent"
					title="Validation errors found"
					onclick={() => goto('/util/validation')}
				>
					<CircleAlert size={20} class="text-error" />
				</button>
			{/if}
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Home Settings" Icon={SettingsIcon} targetNav="/home-settings" />
			<ToolbarMenuItem text="Reorder Cards" targetNav="/home-reorder" Icon={ArrowDownUpIcon} />
		{/snippet}
	</Toolbar>

	<!-- Main -->
	<section class="container mx-auto space-y-2 px-1 py-1 lg:max-w-screen-sm max-w-full">
		<!-- Cards are displayed dynamically, in the selected order. -->
		{#each cards as Card (Card)}
			<Card></Card>
		{/each}

		<!-- FAB -->
		<Fab onclick={onFab} Icon={PlusIcon} />
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
						{isReloading ? 'Reloading…' : 'Reload'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</article>
