<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import db from '$lib/data/db';
	import { xact } from '$lib/data/mainStore';
	import { Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import type { ModalSettings } from '@skeletonlabs/skeleton';
	import { getModalStore } from '@skeletonlabs/skeleton';
	import { CalendarClockIcon, CopyIcon, PenSquareIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();
	Notifier.init();

	onMount(async () => {});

	async function onCopyClicked() {
		// get a journal version
		const text = await appService.translateToLedger($xact);

		// copy to clipboard
		await navigator.clipboard.writeText(text);

		Notifier.success('Transaction copied to clipboard');
	}

	async function onDeleteClicked() {
		// check xact
		if (!$xact) {
			Notifier.warn('Transaction is empty! Please select a transaction first.');
			return;
		}

		// confirm dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Delete',
			body: 'Do you want to delete the transaction?',
			response: async (r: boolean) => {
				if (r) await onDeleteConfirmed();
			}
		};
		modalStore.trigger(modal);
	}

	async function onDeleteConfirmed() {
		await db.xacts.delete($xact.id);

		xact.set(Xact.create());

		Notifier.success('Transaction deleted');

		history.back();
	}

	async function onDuplicateClick() {
		if (!$xact) {
			Notifier.warn('There is no active transaction!');
			return;
		}

		// create the transaction
		const newXact = appService.createXactFrom($xact);
		// save
		const dal = new CashierDAL();
		const id = await dal.saveXact(newXact);

		Notifier.success('Transaction copied');

		// load the new tx for editing
		xact.set(newXact);

		// navigate to the editor for the new transaction, resetting the navigation?
		goto('/tx', { replaceState: true })
	}

	async function onEditClicked() {
		await goto('/tx');
	}
</script>

<Toolbar title="Transaction Actions" />

<main class="p-1">
	<JournalXactRow xact={$xact} />

	<!-- button grid -->
	<div class="mt-4 inline-grid w-full grid-cols-3 gap-4 justify-self-center">
		<SquareButton
			Icon={PenSquareIcon}
			classes="bg-tertiary-500 text-secondary-500"
			onclick={onEditClicked}
		>
			Edit
		</SquareButton>
		<SquareButton
			Icon={CopyIcon}
			classes="bg-primary-500 text-tertiary-500"
			onclick={onDuplicateClick}
		>
			Duplicate
		</SquareButton>
		<SquareButton Icon={CalendarClockIcon} classes="bg-tertiary-500 text-secondary-500">
			Schedule
		</SquareButton>
		<SquareButton
			Icon={CopyIcon}
			classes="bg-primary-500 text-tertiary-500"
			onclick={onCopyClicked}
		>
			Copy Ledger
		</SquareButton>
		<SquareButton
			Icon={TrashIcon}
			classes="bg-secondary-500 text-tertiary-500"
			onclick={onDeleteClicked}
		>
			Delete
		</SquareButton>
	</div>
</main>
