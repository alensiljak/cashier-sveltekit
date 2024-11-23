<script lang="ts">
	import { selectionMetadata, xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import PostingEditor from './PostingEditor.svelte';
	import type { EventHandler } from 'svelte/elements';
	import { goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { AccountService } from '$lib/services/accountsService';
	import { SettingKeys, settings } from '$lib/settings';
	import { getEmptyPostingIndex } from '$lib/utils/xactUtils';

	type Props = {
		onPayeeClicked?: EventHandler;
		onAccountClicked?: (index: number) => void;
	};
	let { onPayeeClicked, onAccountClicked }: Props = $props();

	if (!$xact) {
		goto('/');
	}

	onMount(() => {
		//
		handleEntitySelection();
	});

	async function handleEntitySelection() {
		if (!$selectionMetadata) {
			console.info('not selection mode');
			return;
		}

		// todo: handle selection
		const id = $selectionMetadata.selectedId;
		if (id == undefined) {
			console.warn('No item selected');
			Notifier.neutral('Selection canceled');
			return;
		}

		const defaultCurrency = await settings.get(SettingKeys.currency);

		switch ($selectionMetadata.selectionType) {
			case 'payee':
				break;

			case 'account':
				// get the posting
				var index = null;
				if (typeof $selectionMetadata.postingIndex === 'number') {
					index = $selectionMetadata.postingIndex;
				} else {
					// redirected from account register, find an appropriate posting
					index = getEmptyPostingIndex($xact);
				}
				let posting = $xact.postings[index];

				// load the account
				const account = await appService.db.accounts.get(id);
				const acctSvc = new AccountService();
				const acctBalance = await acctSvc.getAccountBalance(account, defaultCurrency);
				posting.account = account.name;
				posting.currency = acctBalance.currency;

				// todo: recalculateSum();
				// todo: validateCurrencies();
				break;
		}

		// reset the selection mode
		selectionMetadata.set(null);
	}

	function onPostingAccountClicked(index: number) {
		if (onAccountClicked) {
			onAccountClicked(index);
		}
	}

	function onPostingAmountChanged() {
		// todo recalculate sum
		console.log('recalculate sum');
		$xact.postings.forEach((posting) => {
			console.log('amount:', posting.amount);
		});
	}
</script>

<input title="Date" placeholder="Date" type="date" class="input" bind:value={$xact.date} />
<input
	title="Payee"
	placeholder="Payee"
	type="text"
	class="input"
	bind:value={$xact.payee}
	onclick={onPayeeClicked}
/>
<input title="Note" placeholder="Note" type="text" class="input" bind:value={$xact.note} />

<!-- Postings -->
<!-- actions and sum -->
<div>Posting actions</div>
{#each $xact?.postings as posting, index}
	<PostingEditor
		{index}
		onAccountClicked={(event) => onPostingAccountClicked(index)}
		onAmountChanged={onPostingAmountChanged}
	/>
{/each}
