<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Fab from '$lib/components/FAB.svelte';
	import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import XactEditor from '$lib/components/XactEditor.svelte';
	import CashierDAL, { saveScheduledTransaction } from '$lib/data/dal';
	import db from '$lib/data/db';
	import { ScheduledXact, xact } from '$lib/data/mainStore';
	import type { ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { onMount } from 'svelte';

	const id = $page.params.id;

    Notifier.init()

	onMount(async () => {
		if (!id) {
			goto('/');
		}
        if(!ScheduledXact) {
            console.debug('load scx')
        }
	});

    async function onFabClicked() {
        await saveData()
    }

    async function saveData() {
        if(!$ScheduledXact) {
            Notifier.warn('Scheduled Transaction does not exist!')
            return
        }
        if(!$ScheduledXact.transaction) {
            throw new Error('Transaction not found in app state!')
        }

        // Use the current Xact.
		const clonedXact = JSON.parse(JSON.stringify($xact));
        $ScheduledXact.transaction = clonedXact
        // use transaction date.
        $ScheduledXact.nextDate = $xact.date as string

		let raw: ScheduledTransaction = JSON.parse(JSON.stringify($ScheduledXact));
		const result = await saveScheduledTransaction(raw);

        Notifier.success('Scheduled transaction saved')
        history.back()
    }
</script>

<article>
	<Toolbar title="Scheduled Transaction Edit" />
	<section class="p-1">
		<XactEditor />

		<hr class="my-3 !border-t-4 !border-tertiary-500/25" />

		<ScheduleEditor />

		<Fab onclick={onFabClicked} />
	</section>
</article>
