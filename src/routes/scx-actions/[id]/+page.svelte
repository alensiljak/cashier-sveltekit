<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL, { saveScheduledTransaction } from '$lib/data/dal';
	import { ScheduledXact, xact } from '$lib/data/mainStore';
	import type { ScheduledTransaction, Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { calculateNextIteration } from '$lib/scheduledTransactions';
	import {
		CheckIcon,
		ChevronsRightIcon,
		PenSquareIcon,
		ScrollIcon,
		TrashIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import { Modal } from '@skeletonlabs/skeleton-svelte';
	Notifier.init();
	// dialog modals
	let isEnterConfirmationOpen = $state(false);
	let isSkipConfirmationOpen = $state(false);
	let isDeleteConfirmationOpen = $state(false);

	const id = page.params.id;

	onMount(() => {
		if (!id) {
			goto('/');
		}
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isEnterConfirmationOpen = false;
		isSkipConfirmationOpen = false;
		isDeleteConfirmationOpen = false;
	}

	async function deleteXact(id: number) {
		await db.scheduled.delete(id);

		Notifier.success('Scheduled transaction deleted');

		history.back();
	}

	async function onEnterClicked() {
		isEnterConfirmationOpen = true;
	}

	async function enterXact() {
		// Create the journal transaction.
		let newTx: Xact = JSON.parse(JSON.stringify($xact));
		// clear the id field, if any, to get a new one on save.
		newTx.id = undefined;
		const dal = new CashierDAL();
		const id = await dal.saveXact(newTx);

		// update the iteration date
		await skip();

		Notifier.success('Transaction created');

		// load transaction into store
		const tx = await appService.loadTransaction(id);
		xact.set(tx);

		// open the transaction. Maintain page navigation history.
		await goto('/tx', { replaceState: true });
	}

	async function onEnterConfirmed() {
		closeModal();

		try {
			await enterXact();
		} catch (error) {
			Notifier.error((error as Error).message);
		}
	}

	async function onDeleteClick() {
		isDeleteConfirmationOpen = true;
	}

	async function onDeleteConfirmed() {
		closeModal();

		const id = $ScheduledXact.id as number;
		await deleteXact(id);
	}

	async function onEditClicked(id: any) {
		await goto(`/scx-editor/${id}`);
	}

	async function onSkipClicked() {
		// confirm dialog
		isSkipConfirmationOpen = true;
	}

	async function onSkipConfirmed() {
		closeModal();

		await skip();
		Notifier.success('Transaction skipped to next iteration');
		history.back();
	}

	/**
	 * Saves the Scheduled Transaction record.
	 */
	async function saveData() {
		let raw: ScheduledTransaction = JSON.parse(JSON.stringify($ScheduledXact));
		const result = await saveScheduledTransaction(raw);
		return result;
	}

	/**
	 * Skips the next iteration.
	 */
	async function skip() {
		let stx: ScheduledTransaction = $ScheduledXact;
		if (!stx) {
			throw new Error('The scheduled transaction reference is invalid!');
		}

		const startDate = stx.nextDate;
		const count = stx.count as number;
		const period = stx.period;
		const endDate = stx.endDate;

		validateSchedule(stx);

		// todo: handle the one-off occurrence (no count and no period)

		// calculate the next iteration.
		let newDate = calculateNextIteration(startDate, count, period, endDate);
		if (!newDate) {
			// throw new Error(`invalid date calculated: ${newDate}`)
			// Passed the End Date.
			newDate = '0000-00-00';
		}

		// update the date on the transaction
		let templateTx: Xact = JSON.parse(JSON.stringify($xact));
		templateTx.date = newDate;
		stx.transaction = templateTx;
		//tx.value = templateTx
		stx.nextDate = newDate;

		$ScheduledXact = stx;

		const result = await saveData();
		if (!result) {
			Notifier.error('transaction not saved!');
		}
	}

	function validateSchedule(schTx: ScheduledTransaction) {
		// A schedule can't have no repetitions and no end. Skipping the date would result
		// in an invalid situation.
		if (!schTx.endDate && !(schTx.count || schTx.period)) {
			throw new Error('A schedule must have either an end date or a repetition pattern.');
		}
	}
</script>

<article>
	<Toolbar title="Scheduled Transaction Actions"></Toolbar>

	<section class="p-1">
		<JournalXactRow xact={$xact} />

		<!-- recurrence details -->
		<div class="mt-4">
			{#if $ScheduledXact.count}
				<span>Repeats every {$ScheduledXact.count} {$ScheduledXact.period}.</span>
			{/if}
			{#if $ScheduledXact.endDate}
				<p>until {$ScheduledXact.endDate}.</p>
			{/if}
		</div>

		<!-- remarks -->
		<div>
			<p>Remarks:</p>
			<textarea class="textarea" rows="5" readonly>{$ScheduledXact.remarks}</textarea>
		</div>

		<!-- actions -->
		<div class="grid grid-cols-3 pt-3 lg:px-20">
			<SquareButton
				Icon={ScrollIcon}
				classes="bg-tertiary-500 text-secondary-500"
				onclick={onEnterClicked}
			>
				Enter
			</SquareButton>
			<SquareButton
				Icon={ChevronsRightIcon}
				classes="bg-primary-500 text-tertiary-500"
				onclick={onSkipClicked}
			>
				Skip
			</SquareButton>
			<SquareButton
				Icon={PenSquareIcon}
				classes="bg-tertiary-500 text-secondary-500"
				onclick={() => onEditClicked($ScheduledXact.id)}
			>
				Edit
			</SquareButton>
			<SquareButton
				Icon={TrashIcon}
				classes="bg-secondary-500 text-tertiary-500"
				onclick={onDeleteClick}
			>
				Delete
			</SquareButton>
		</div>
	</section>
</article>

<!-- "Enter" dialog -->
<Modal
	open={isEnterConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Creation</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to enter this transaction into the journal?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onEnterConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
<!-- "Skip" dialog -->
<Modal
	open={isSkipConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Skip</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to skip the next iteration?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onSkipConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
<!-- "Delete" dialog -->
<Modal
	open={isDeleteConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Delete</h2>
		</header>
		<article>
			<p class="opacity-60">
				Do you want to delete the scheduled transaction {$ScheduledXact.transaction?.payee}?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
