<script lang="ts">
	import { page } from '$app/state';
	import Fab from '$lib/components/FAB.svelte';
	import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import XactEditor from '$lib/components/XactEditor.svelte';
	import { saveScheduledTransaction } from '$lib/data/dal';
	import { ScheduledXact, xact } from '$lib/data/mainStore';
	import type { ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';

	const id = page.params.id;

	Notifier.init();

	async function onFabClicked() {
		try {
			await saveData();
		} catch (err: any) {
			Notifier.error(err.message as string);
			console.error(err);
		}
	}

	async function saveData() {
		if (!$ScheduledXact) {
			Notifier.info('Scheduled Transaction does not exist!');
			return;
		}
		if (!$xact) {
			throw new Error('Transaction not found in app state!');
		}

		// Use the current Xact.
		const clonedXact = JSON.parse(JSON.stringify($xact));
		$ScheduledXact.transaction = clonedXact;
		// use transaction date.
		$ScheduledXact.nextDate = $xact.date as string;

		let raw: ScheduledTransaction = JSON.parse(JSON.stringify($ScheduledXact));
		const result = await saveScheduledTransaction(raw);

		Notifier.success('Scheduled transaction saved');
		history.back();
	}
</script>

<article>
	<Toolbar title="Scheduled Transaction Edit" />
	<section class="p-1">
		<XactEditor />

		<hr class="border-neutral/25 my-3 border-t-4!" />

		<ScheduleEditor />

		<Fab onclick={onFabClicked} />
	</section>
</article>
