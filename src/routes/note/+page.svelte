<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import DateField from '#lib/components/DateField.svelte';
	import { CheckIcon } from '@lucide/svelte';
	import { Xact, Posting } from '#lib/data/model';
	import appService from '#lib/services/appService';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import { xactToBeancountText } from '#lib/utils/xactUtils';
	import Notifier from '#lib/utils/notifier';

	Notifier.init();

	function focusOnMount(el: HTMLElement) {
		el.focus();
	}

	let noteDate = $state(new Date().toISOString().substring(0, 10));
	let noteText = $state('');
	let isSaving = $state(false);

	async function saveNote() {
		const text = noteText.trim();
		if (isSaving) return;
		if (!text) {
			Notifier.warning('Type a few words first');
			return;
		}
		isSaving = true;
		try {
			const tx = new Xact();
			tx.date = noteDate;
			tx.flag = '!';
			tx.note = text;
			const currency = await appService.getDefaultCurrency();
			tx.postings = ['Expenses:Unknown', 'Assets:Unknown'].map((account) => {
				const p = new Posting();
				p.account = account;
				p.amount = 0;
				p.currency = currency;
				return p;
			});
			const store = await getXactStore();
			const stored = await store.append(xactToBeancountText(tx, currency));
			Notifier.success(
				'Note saved',
				{
					label: 'Undo',
					onclick: async () => {
						try {
							await store.remove(stored.id);
						} catch (e) {
							Notifier.error(e instanceof Error ? e.message : String(e));
						}
					}
				},
				6000
			);
			history.back();
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : String(e));
			isSaving = false;
		}
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Note" />
	<section class="flex flex-1 flex-col gap-3 p-3">
		<DateField bind:value={noteDate} />
		<textarea
			class="textarea textarea-bordered w-full flex-1"
			placeholder="Type a note…"
			bind:value={noteText}
			use:focusOnMount
		></textarea>
	</section>
	<Fab Icon={CheckIcon} ariaLabel="Save note" onclick={saveNote} disabled={isSaving} />
</main>
