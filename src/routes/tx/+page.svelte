<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check } from '@lucide/svelte';
	import { xact, xactSpan } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import { SettingKeys, settings } from '$lib/settings';
	import appService from '$lib/services/appService';
	import ledgerService from '$lib/services/ledgerService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { xactToBeancountText } from '$lib/utils/xactUtils';
	import { base } from '$app/paths';
	import TransactionEditor from '$lib/components/XactEditor.svelte';

	Notifier.init();

	let previousPage: string = base;

	onMount(async () => {
		if (!get(xact)) {
			await goto('/');
			return;
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
		const clonedXact = JSON.parse(JSON.stringify($xact));
		const beancountText = xactToBeancountText(clonedXact);
		const span = get(xactSpan);

		if (span) {
			await ledgerService.editTransaction(span, beancountText);
		} else {
			await ledgerService.appendTransaction(beancountText);
		}
		xactSpan.set(undefined);
		await fullLedgerService.invalidate();

		// Remember Last Transaction?
		const remember = await settings.get(SettingKeys.rememberLastTransaction);
		if (remember) {
			await appService.saveLastTransaction(clonedXact);
		}

		history.back();
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Journal Entry">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Save" />
			<ToolbarMenuItem text="Reset" />
		{/snippet}
	</Toolbar>

	<section class="container mx-auto flex-1 overflow-y-auto lg:max-w-screen-sm">
		<Fab Icon={Check} onclick={onFab} />

		<!-- tx editor -->
		<TransactionEditor />

		<!-- dialog for confirming reset -->
	</section>
</article>
