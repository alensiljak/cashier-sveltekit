<script lang="ts">
	import { FileUpIcon, ScrollIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import type { Xact } from '$lib/data/model';

	let xacts: Xact[] = $state([]);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		xacts = await db.xacts.orderBy('date').reverse().limit(5).toArray();

		// Balances = new XactAugmenter().calculateXactAmounts(Xacts);
	}

	function onClick() {
		goto('/journal');
	}
</script>

<HomeCardTemplate onclick={onClick}>
	{#snippet icon()}
		<ScrollIcon />
	{/snippet}
	{#snippet title()}
		Device Journal
	{/snippet}
	{#snippet content()}
		{#if xacts.length == 0}
			<p>The device journal is empty</p>
		{:else}
			{#each xacts as xact}
				<snap>yo</snap>
			{/each}
		{/if}
	{/snippet}
	{#snippet footer()}
		<center>
			<a href="/export/journal" class="variant-outline-warning btn uppercase">
				<span><FileUpIcon /></span>
				<span>Export</span>
			</a>
		</center>
	{/snippet}
</HomeCardTemplate>
