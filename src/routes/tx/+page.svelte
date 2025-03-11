<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check } from 'lucide-svelte';
	import { selectionMetadata, xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import CashierDAL from '$lib/data/dal';
	import type { Xact } from '$lib/data/model';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import appService from '$lib/services/appService';
	import { base } from '$app/paths';
	import TransactionEditor from '$lib/components/XactEditor.svelte';

	let previousPage: string = base;

	onMount(async () => {
		if (!get(xact)) {
			await goto('/');1
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
		// create a deep copy
		const clonedXact = JSON.parse(JSON.stringify($xact));
		const dal = new CashierDAL();

		await dal.saveXact(clonedXact);

		// Remember Last Transaction?
		const remember = await settings.get(SettingKeys.rememberLastTransaction);
		if (remember) {
			await appService.saveLastTransaction(clonedXact);
		}

		history.back();
	}
</script>

<Toolbar title="Journal Entry">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Save" />
		<ToolbarMenuItem text="Reset" />
	{/snippet}
</Toolbar>

<main class="container mx-auto lg:max-w-(--breakpoint-sm)">
	<Fab Icon={Check} onclick={onFab} />

	<!-- tx editor -->
	<TransactionEditor />

	<!-- dialog for confirming reset -->
</main>
