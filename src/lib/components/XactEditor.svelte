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
	import { Posting } from '$lib/data/model';
	import { ArrowUpDownIcon, PlusCircleIcon, SigmaIcon, TrashIcon } from 'lucide-svelte';

	type Props = {
		onPayeeClicked?: EventHandler;
		onAccountClicked?: (index: number) => void;
	};
	let { onPayeeClicked, onAccountClicked }: Props = $props();

	let sum = $state(0);
	let _emptyPostingCount = 0;

	if (!$xact) {
		goto('/');
	}

	onMount(() => {
		if ($selectionMetadata) {
			handleEntitySelection();
		}

		recalculateSum();
	});

	async function handleEntitySelection() {
		if (!$selectionMetadata) {
			console.info('not selection mode');
			return;
		}

		// handle selection

		const id = $selectionMetadata.selectedId as string;
		if (id == undefined) {
			console.warn('No item selected');
			Notifier.neutral('Selection canceled');
			return;
		}

		const defaultCurrency = await settings.get(SettingKeys.currency);

		switch ($selectionMetadata.selectionType) {
			case 'payee':
				if ($selectionMetadata.selectedId) {
					$xact.payee = id as string;

					await loadLastTransaction(id);
				}
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

				// load the account
				const account = await appService.db.accounts.get(id);
				const acctSvc = new AccountService();
				const acctBalance = await acctSvc.getAccountBalance(account, defaultCurrency);

				$xact.postings[index].account = account.name;
				$xact.postings[index].currency = acctBalance.currency;

				// todo: recalculateSum();
				// todo: validateCurrencies();
				break;
		}

		// reset the selection mode
		selectionMetadata.set(undefined);
	}

	/**
	 * Load the last transaction for the payee
	 */
	async function loadLastTransaction(payee: string) {
		if (!$xact) {
			throw new Error('No transaction loaded!');
		}

		// do this only if enabled
		const enabled = await settings.get(SettingKeys.rememberLastTransaction);
		if (!enabled) return;
		// and we are not on an existing transaction
		if ($xact.id) return;

		const lastTx = await appService.db.lastXact.get(payee);
		if (!lastTx) return;
		// use the current date
		lastTx.transaction.date = $xact.date;

		// Replace the current transaction.
		xact.set(lastTx.transaction);
	}

	function onAddPostingClicked() {
		if (!$xact) {
			Notifier.error('The transaction is not initialized!');
			return;
		}

		$xact.postings.push(new Posting());
		$xact.postings = $xact.postings;
	}

	function onPostingAccountClicked(index: number) {
		if (onAccountClicked) {
			onAccountClicked(index);
		}
	}

	function onPostingAmountChanged() {
		// recalculate sum
		recalculateSum();
	}

	function recalculateSum() {
		sum = 0;
		_emptyPostingCount = 0;

		if (!xact || !$xact.postings || $xact.postings.length === 0) return;

		$xact.postings.forEach((posting) => {
			if (posting.amount) {
				sum += posting.amount;
			} else {
				_emptyPostingCount += 1;
			}
		});
	}
</script>

<div class="space-y-3 py-2">
	<input
		title="Date"
		placeholder="Date"
		type="date"
		class="input variant-form-material"
		bind:value={$xact.date}
	/>
	<input
		title="Payee"
		placeholder="Payee"
		type="text"
		class="input"
		readonly
		bind:value={$xact.payee}
		onclick={onPayeeClicked}
	/>
	<input
		title="Note"
		placeholder="Note"
		type="text"
		class="input variant-form-material"
		bind:value={$xact.note}
	/>

	<!-- Postings -->
	<!-- actions and sum -->
	<div class="space-y-2 rounded-lg bg-primary-500/25 p-3">
		<div class="flex flex-row">
			<span class="grow text-center">Postings</span>
			<div><SigmaIcon /></div>
			<data class="pl-2">{sum}</data>
		</div>
		<div class="flex flex-row justify-center space-x-10">
			<button type="button" class="variant-ringed-primary btn-icon" onclick={onAddPostingClicked}>
				<PlusCircleIcon />
			</button>
			<a class="variant-ringed-primary btn-icon" href="/postings-reorder">
				<ArrowUpDownIcon />
			</a>
			<a class="variant-ringed-primary btn-icon" href="/postings-delete">
				<TrashIcon />
			</a>
		</div>
	</div>
	<!-- posting list -->
	{#each $xact?.postings as posting, index}
		<PostingEditor
			{index}
			onAccountClicked={(event) => onPostingAccountClicked(index)}
			onAmountChanged={onPostingAmountChanged}
		/>
	{/each}
</div>
