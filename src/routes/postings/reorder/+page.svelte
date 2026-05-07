<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let postings = $state<typeof $xact.postings>([]);

	onMount(() => {
		if (!$xact) {
			goto('/');
			return;
		}
		postings = [...$xact.postings];
	});

	function onFabClicked() {
		xact.update((current) => ({ ...current, postings }));
		history.back();
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Reorder Postings" />
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<DragReorderList
		bind:items={postings}
		getLabel={(p) => p.account}
		class="grow overflow-y-auto pb-24 p-1"
	/>
</article>
