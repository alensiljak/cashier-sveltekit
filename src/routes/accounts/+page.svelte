<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import type { Account } from '$lib/data/model';
	import { onMount } from 'svelte';

	let accounts: Array<Account> = [];

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		const dal = new CashierDAL();
		accounts = await dal.loadAccounts().toArray()
		// .sortBy('name');
		// accounts = x.toArray();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Accounts" />
	<!-- search toolbar -->
	<div class={`h-screen overflow-auto`}>
		{#each accounts as account}
			<div>
				{account.name}
			</div>
		{/each}
	</div>
</main>
