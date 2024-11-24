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

	onMount(() => {
		if (!get(xact)) {
			goto('/');
		}
	});

	afterNavigate(({ from }) => {
		previousPage = from?.url.pathname || previousPage;
	});

	const onAccountClicked = (index: number) => {
		// console.log('Account clicked at index:', index);

		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'account';
		selectionMetadata.set(meta);

		goto('/accounts');
	};

	async function onFab() {
		// console.log('fab clicked!');
		try {
			await saveXact();
		} catch (e: any) {
			Notifier.error(e.message);
		}
	}

	const onPayeeClicked = () => {
		// select a payee
		// selection
		const meta = new SelectionModeMetadata();
		meta.selectionType = 'payee';
		selectionMetadata.set(meta);

		goto('/payees');
	};

	/**
	 * save transaction
	 */
	async function saveXact() {
		const tx = get(xact) as Xact;
		const dal = new CashierDAL();

		await dal.saveXact(tx);

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

<main class="container mx-auto lg:max-w-screen-sm">
	<Fab Icon={Check} onclick={onFab} />

	<!-- tx editor -->
	<TransactionEditor {onAccountClicked} {onPayeeClicked} />

	<!-- dialog for confirming reset -->
</main>
