<script lang="ts">
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import db from '$lib/data/db';
	import { xact } from '$lib/data/mainStore';
	import { Xact } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import type { ModalSettings } from '@skeletonlabs/skeleton';
	import { getModalStore } from '@skeletonlabs/skeleton';
	import { CalendarClockIcon, CopyIcon, PenSquareIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();
	Notifier.init();

	onMount(async () => {
		// console.log($xact.payee)
	});

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
</script>

<Toolbar title="Transaction Actions" />

<main class="p-1">
	<JournalXactRow xact={$xact} />

	<!-- button grid -->
	<div class="mt-4 inline-grid w-full grid-cols-3 gap-4 justify-self-center">
		<div class="">
			<SquareButton text="Edit" Icon={PenSquareIcon} colour="tertiary" />
		</div>
		<div class="">
			<SquareButton text="Duplicate" Icon={CopyIcon} colour="primary" />
		</div>
		<SquareButton text="Schedule" Icon={CalendarClockIcon} colour="tertiary" />
		<SquareButton text="Copy Ledger" Icon={CopyIcon} colour="primary" />
		<SquareButton text="Delete" Icon={TrashIcon} colour="secondary" onclick={onDeleteClicked} />
	</div>
</main>
