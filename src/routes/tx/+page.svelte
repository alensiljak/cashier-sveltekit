<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check } from 'lucide-svelte';
	import { xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import CashierDAL from '$lib/data/dal';
	import type { Transaction } from '$lib/data/model';
	import { SettingKeys, settings } from '$lib/settings';
	import appService from '$lib/services/appService';
	import { base } from '$app/paths';

	let previousPage: string = base;

	onMount(() => {
		// Get the Xact from the store?
		// No, it is available already.
		if (!get(xact)) {
			goto('/');
		}
	});

	afterNavigate(({ from }) => {
		previousPage = from?.url.pathname || previousPage;
	});

	async function onFab() {
		// console.log('fab clicked!');
		try {
			await saveXact();
		} catch (e: any) {
			Notifier.error(e.message);
		}
	}

	/**
	 * save transaction
	 */
	async function saveXact() {
		const tx = get(xact) as Transaction;
		const dal = new CashierDAL();

		await dal.saveTransaction(tx);

		// Remember Last Transaction?
		const remember = await settings.get(SettingKeys.rememberLastTransaction);
		if (remember) {
			await appService.saveLastTransaction(tx);
		}

		//goto(previousPage);
		history.back();
	}
</script>

<Toolbar title="Journal Entry">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Save" />
		<ToolbarMenuItem text="Reset" />
	{/snippet}
</Toolbar>
<Fab Icon={Check} onclick={onFab} />

<!-- tx editor -->

<!-- dialog for confirming reset -->
