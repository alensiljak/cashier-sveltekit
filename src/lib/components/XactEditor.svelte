<script lang="ts">
	import { selectionMetadata, xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import PostingEditor from './PostingEditor.svelte';
	import { goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { getAccountBalance, loadAccount } from '$lib/services/accountsService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { getEmptyPostingIndex } from '$lib/utils/xactUtils';
	import { Posting } from '$lib/data/model';
	import {
		ArrowUpDownIcon,
		SigmaIcon,
		TrashIcon,
		UserIcon,
		CalendarIcon,
		FileTextIcon,
		CirclePlusIcon
	} from '@lucide/svelte';
	import { Big } from 'big.js';

	Notifier.init();

	let sum = $derived.by(() => {
		if (!$xact?.postings?.length) return new Big(0);
		return $xact.postings.reduce(
			(acc, posting) => (posting.amount ? acc.plus(new Big(posting.amount)) : acc),
			new Big(0)
		);
	});
	if (!$xact) {
		goto('/');
	}

	onMount(() => {
		if ($selectionMetadata) {
			handleEntitySelection();
		}
	});

	async function handleEntitySelection() {
		if (!$selectionMetadata) {
			return;
		}

		// handle selection

		const id = $selectionMetadata.selectedId as string;
		if (id == undefined) {
			console.warn('No item selected');
			Notifier.info('Selection canceled');
			return;
		}

		const defaultCurrency = await appService.getDefaultCurrency();

		switch ($selectionMetadata.selectionType) {
			case 'payee':
				if ($selectionMetadata.selectedId) {
					$xact.payee = id as string;

					await loadLastTransaction(id);
				}
				break;

			case 'account': {
				// get the posting
				let index = null;
				if (typeof $selectionMetadata.postingIndex === 'number') {
					index = $selectionMetadata.postingIndex;
				} else {
					// redirected from account register, find an appropriate posting
					index = getEmptyPostingIndex($xact);
				}

				// load the account
				const account = await loadAccount(id);
				// get the first currency
				const acctBalance = getAccountBalance(account, defaultCurrency);

				$xact.postings[index].account = account.name;
				$xact.postings[index].currency = acctBalance.currency;

				// todo: validateCurrencies();
				break;
			}

			case 'amount':
				// Handle amount selection from calculator
				if (
					$selectionMetadata.selectedId !== undefined &&
					typeof $selectionMetadata.selectedId === 'number'
				) {
					const amount = $selectionMetadata.selectedId as number;
					const index = $selectionMetadata.postingIndex;

					if (index !== undefined && $xact?.postings[index]) {
						$xact.postings[index].amount = amount;
					}
				}

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

		// Do this only if enabled
		const enabled = await settings.get(SettingKeys.rememberLastTransaction);
		if (!enabled) return;
		// and we are not on an existing transaction,
		if ($xact.id) return;
		// and no accounts have been selected in Postings.
		if (!$xact.postings.every((posting) => posting.account === '')) return;

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

	const onAccountClicked = async (index: number) => {
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'account';
		selectionMetadata.set(meta);

		await goto('/accounts');
	};

	const onPayeeClicked = async () => {
		// select a payee
		const meta = new SelectionModeMetadata();
		meta.selectionType = 'payee';
		selectionMetadata.set(meta);

		await goto('/payees');
	};

	function onPostingAccountClicked(index: number) {
		if (onAccountClicked) {
			onAccountClicked(index);
		}
	}

</script>

<div class="flex h-full flex-col space-y-3 py-2">
	<div class="flex items-center">
		<CalendarIcon class="h-5 w-5 mr-2 opacity-70" />
		<input
			title="Date"
			placeholder="Date"
			type="date"
			class="input rounded"
			bind:value={$xact.date}
		/>
	</div>
	<div class="flex items-center">
		<UserIcon class="h-5 w-5 mr-2 opacity-70" />
		<input
			title="Payee"
			placeholder="Payee"
			type="text"
			class="input w-full rounded"
			readonly
			bind:value={$xact.payee}
			onclick={onPayeeClicked}
		/>
	</div>
	<div class="flex items-center">
		<FileTextIcon class="h-5 w-5 mr-2 opacity-70" />
		<input
			title="Note"
			placeholder="Note"
			type="text"
			class="input w-full rounded"
			bind:value={$xact.note}
		/>
	</div>

	<!-- Postings -->
	<!-- actions and sum -->
	<div class="bg-primary/25 space-y-2 rounded-lg p-3">
		<div class="flex flex-row">
			<span class="grow text-center">Postings</span>
			<div><SigmaIcon /></div>
			<data class="pl-2">{sum}</data>
		</div>
		<div class="flex flex-row justify-center space-x-10">
			<button
				type="button"
				class="btn btn-outline btn-accent btn-icon rounded"
				onclick={onAddPostingClicked}
			>
				<CirclePlusIcon />
			</button>
			<a class="btn btn-outline btn-accent btn-icon rounded" href="/postings-reorder">
				<ArrowUpDownIcon />
			</a>
			<a class="btn btn-outline btn-accent btn-icon rounded" href="/postings-delete">
				<TrashIcon />
			</a>
		</div>
	</div>
	<!-- posting list -->
	<div class="flex-1 overflow-y-auto">
		{#each $xact?.postings as posting, index (posting)}
			<PostingEditor
				{index}
				onAccountClicked={(event) => onPostingAccountClicked(index)}
			/>
		{/each}
	</div>
</div>
