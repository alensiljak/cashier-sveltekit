<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import type { Payee } from '$lib/data/model';
	import { onMount } from 'svelte';

	let payees: Array<Payee> = [];

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		const dal = new CashierDAL();
		payees = await dal.loadPayees().toArray();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Payees" />
	<!-- search toolbar -->
	<div class={`h-screen overflow-auto`}>
		{#each payees as payee}
			<div>
				{payee.name}
			</div>
		{/each}
	</div>
</main>
