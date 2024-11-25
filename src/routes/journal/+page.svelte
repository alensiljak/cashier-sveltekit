<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import db from '$lib/data/db';
	import type { Xact } from '$lib/data/model';
	import { onMount } from 'svelte';

	let xacts: Xact[] = $state([]);

	onMount(async () => {
		// load data
		await loadData();
	});

	async function loadData() {
		xacts = await db.xacts.orderBy('date').reverse().toArray();
	}
</script>

<Toolbar title="Journal">
	<!-- Export -->
	<!-- Delete All -->
</Toolbar>

<main>
	{#if xacts.length == 0}
		<p>The device journal is empty</p>
	{:else}
		{#each xacts as xact}
			<span>{xact.payee}</span>
		{/each}
	{/if}
</main>
