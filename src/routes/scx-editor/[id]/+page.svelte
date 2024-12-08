<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Fab from '$lib/components/FAB.svelte';
	import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import XactEditor from '$lib/components/XactEditor.svelte';
	import db from '$lib/data/db';
	import { ScheduledXact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';

	const id = $page.params.id;

	onMount(async () => {
		if (!id) {
			goto('/');
		}
        if(!ScheduledXact) {
            console.debug('load scx')
        }
	});
</script>

<article>
	<Toolbar title="Scheduled Transaction Edit" />
	<section class="p-1">
		<XactEditor />

		<hr class="my-3 !border-t-4 !border-tertiary-500/25" />

		<ScheduleEditor />

		<Fab />
	</section>
</article>
