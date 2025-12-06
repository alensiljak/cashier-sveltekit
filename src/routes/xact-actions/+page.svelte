<script lang="ts">
	import { goto } from '$app/navigation';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import db from '$lib/data/db';
	import { ScheduledXact, xact } from '$lib/data/mainStore';
	import { ScheduledTransaction, Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import {
		CalendarClockIcon,
		CopyIcon,
		ClipboardIcon,
		PenSquareIcon,
		TrashIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';

	Notifier.init();

	let isDeleteConfirmationOpen = $state(false);
	let ptaSystem = $state('');

	onMount(async () => {
		ptaSystem = await settings.get(SettingKeys.ptaSystem);
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	async function onCopyClicked() {
		// get a journal version
		let text = '';
		if (ptaSystem == 'ledger') {
			text = appService.translateToLedger($xact);
		} else {
			text = appService.translateToBeancount($xact);
		}

		// copy to clipboard
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

		await db.xacts.delete($xact.id);

		xact.set(Xact.create());

		Notifier.success('Transaction deleted');

		history.back();
	}

	async function onDuplicateClick() {
		if (!$xact) {
			Notifier.info('There is no active transaction!');
			return;
		}

		// create the transaction
		const newXact = appService.createXactFrom($xact);
		// save
		const dal = new CashierDAL();
		await dal.saveXact(newXact);

		Notifier.success('Transaction copied');

		// load the new tx for editing
		xact.set(newXact);

		// navigate to the editor for the new transaction, resetting the navigation?
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
</script>

<Toolbar title="Transaction Actions" />

<main class="p-1">
	<JournalXactRow xact={$xact} />

	<!-- button grid -->
	<div class="mt-4 inline-grid w-full grid-cols-3 gap-4 justify-self-center">
		<SquareButton
			Icon={PenSquareIcon}
			classes="bg-neutral text-neutral-content"
			onclick={onEditClicked}
		>
			Edit
		</SquareButton>
		<SquareButton
			Icon={ClipboardIcon}
			classes="bg-primary text-primary-content"
			onclick={onDuplicateClick}
		>
			Duplicate
		</SquareButton>
		<SquareButton
			Icon={CalendarClockIcon}
			classes="bg-neutral text-neutral-content"
			onclick={onScheduleClick}
		>
			Schedule
		</SquareButton>
		<SquareButton
			Icon={CopyIcon}
			classes="bg-primary text-primary-content"
			onclick={onCopyClicked}
		>
			Copy
		</SquareButton>
		<SquareButton
			Icon={TrashIcon}
			classes="bg-secondary text-secondary-content"
			onclick={onDeleteClicked}
		>
			Delete
		</SquareButton>
	</div>
</main>
<!-- "Delete" dialog -->
<input type="checkbox" id="delete-confirmation-modal" class="modal-toggle" bind:checked={isDeleteConfirmationOpen} />
<div class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete the transaction?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	</div>
</div>
