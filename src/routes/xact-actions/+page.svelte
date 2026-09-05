<script lang="ts">
	import { goto } from '$app/navigation';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ScheduledXact, xact, xactSpan } from '$lib/data/mainStore';
	import { Posting, ScheduledTransaction, Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import ledgerService from '$lib/services/ledgerService';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import { xactToBeancountText } from '$lib/utils/xactUtils';
	import { buildHighlightParams } from '$lib/utils/unifiedXacts';
	import Notifier from '$lib/utils/notifier';
	import {
		CalendarClockIcon,
		CopyIcon,
		ClipboardIcon,
		SquarePenIcon,
		TrashIcon,
		ListIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';

	Notifier.init();

	let isDeleteConfirmationOpen = $state(false);

	if (!$xact) {
		goto('/');
	}

	onMount(async () => {
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	async function onCopyClicked() {
		const defaultCurrency = await appService.getDefaultCurrency();
		const text = xactToBeancountText($xact, defaultCurrency);
		await navigator.clipboard.writeText(text);
		Notifier.success('Transaction copied to clipboard');
	}

	async function onDeleteClicked() {
		// check xact
		if (!$xact) {
			Notifier.info('Transaction is empty! Please select a transaction first.');
			return;
		}

		// confirm dialog
		isDeleteConfirmationOpen = true;
	}

	async function onDeleteConfirmed() {
		closeModal();

		const span = $xactSpan;
		if (!span) {
			Notifier.error('Cannot delete: transaction location unknown');
			return;
		}

		try {
			await ledgerService.deleteTransaction(span);
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : 'Failed to delete transaction');
			return;
		}

		xactSpan.set(undefined);
		xact.set(Xact.create());

		Notifier.success('Transaction deleted');
		history.back();

		// Re-parse the full book in the background — cards show a loading indicator.
		void reloadLedgerFromOpfs();
	}

	async function onDuplicateClick() {
		if (!$xact) {
			Notifier.info('There is no active transaction!');
			return;
		}

		const newXact = appService.createXactFrom($xact);
		const defaultCurrency = await appService.getDefaultCurrency();
		const beancountText = xactToBeancountText(newXact, defaultCurrency);
		await ledgerService.appendTransaction(beancountText);

		// Re-parse the full book in the background.
		void reloadLedgerFromOpfs();

		Notifier.success('Transaction copied');

		// load the new tx for editing (no span — it's a new transaction)
		xact.set(newXact);
		xactSpan.set(undefined);

		goto('/tx', { replaceState: true });
	}

	async function onEditClicked() {
		await goto('/tx');
	}

	async function onScheduleClick() {
		ScheduledXact.set(new ScheduledTransaction());

		// clear the Xact id
		if ($xact) {
			$xact.id = undefined;
		}

		goto('/scx-editor');
	}

	function onPayeeTransactionsClick() {
		if (!$xact?.payee) return;
		goto('/payees/payee-xacts/' + encodeURIComponent($xact.payee));
	}

	function onAccountTransactionsClick(posting: Posting) {
		if (!$xact) return;
		const params = buildHighlightParams($xact, posting);
		goto(`/accounts/account-xacts/${encodeURIComponent(posting.account)}?${params}`);
	}
</script>

<Toolbar title="Transaction Actions">
	{#snippet actions()}
		<HelpButton topic="xact-actions" />
	{/snippet}
</Toolbar>

<main class="mx-auto max-w-2xl w-full p-1">
	<JournalXactRow xact={$xact} />

	<!-- button grid -->
	<div class="mx-auto mt-4 grid w-550 max-w-[550px] grid-cols-3">
		{#if $xactSpan}
			<SquareButton Icon={SquarePenIcon} classes="bg-accent text-secondary" onclick={onEditClicked}>
				Edit
			</SquareButton>
		{/if}
		<SquareButton Icon={ClipboardIcon} classes="bg-primary text-accent" onclick={onDuplicateClick}>
			Duplicate
		</SquareButton>
		<SquareButton
			Icon={CalendarClockIcon}
			classes="bg-accent text-secondary"
			onclick={onScheduleClick}
		>
			Schedule
		</SquareButton>
		<SquareButton Icon={CopyIcon} classes="bg-primary text-accent" onclick={onCopyClicked}>
			Copy
		</SquareButton>
		{#if $xactSpan}
			<SquareButton Icon={TrashIcon} classes="bg-secondary text-accent" onclick={onDeleteClicked}>
				Delete
			</SquareButton>
		{/if}
	</div>

	<!-- related transactions -->
	{#if $xact}
		<div class="mt-6 space-y-2">
			{#if $xact.payee}
				<div class="flex items-center justify-between gap-2 border-base-content/10 border-b py-1">
					<span class="min-w-0 truncate">Payee: {$xact.payee}</span>
					<button
						type="button"
						class="btn btn-sm btn-outline shrink-0 gap-1"
						onclick={onPayeeTransactionsClick}
					>
						<ListIcon class="size-4" />
						Transactions
					</button>
				</div>
			{/if}
			{#if $xact.postings && $xact.postings.length > 0}
				<div class="py-1">Accounts:</div>
				{#each $xact.postings as posting (posting)}
					<div
						class="flex items-center justify-between gap-2 border-base-content/10 border-b py-1 pl-4"
					>
						<span class="min-w-0 truncate">{posting.account}</span>
						<button
							type="button"
							class="btn btn-sm btn-outline shrink-0 gap-1"
							onclick={() => onAccountTransactionsClick(posting)}
						>
							<ListIcon class="size-4" />
							Transactions
						</button>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</main>
<!-- "Delete" dialog -->
<input
	type="checkbox"
	id="delete-confirmation-modal"
	class="modal-toggle"
	bind:checked={isDeleteConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete the transaction?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button type="button" class="btn btn-primary text-primary-content" onclick={onDeleteConfirmed}
				>OK</button
			>
		</footer>
	</div>
</dialog>
