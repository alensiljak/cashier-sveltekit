<script lang="ts">
	import { selectionMetadata, xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import PostingEditor from './PostingEditor.svelte';
	import MetadataEditor from './MetadataEditor.svelte';
	import { goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { getAccountBalance, loadAccount } from '$lib/services/accountsService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { getEmptyPostingIndex } from '$lib/utils/xactUtils';
	import { Posting } from '$lib/data/model';
	import {
		SigmaIcon,
		UserIcon,
		CalendarIcon,
		FileTextIcon,
		CirclePlusIcon,
		TriangleAlertIcon,
		CircleCheckIcon,
		ChevronLeftIcon,
		ChevronRightIcon
	} from '@lucide/svelte';
	import { Big } from 'big.js';
	import moment from 'moment';

	Notifier.init();

	const DATE_FORMAT_DEFAULT = 'D MMM YYYY';
	let dateFormatValue = $state(DATE_FORMAT_DEFAULT);
	let dateInputEl: HTMLInputElement | undefined;
	let metadataExpanded = $state(false);

	let formattedDate = $derived.by(() => {
		if (!$xact?.date) return 'Date';
		return moment($xact.date).format(dateFormatValue);
	});

	let sum = $derived.by(() => {
		if (!$xact?.postings?.length) return new Big(0);
		return $xact.postings.reduce(
			(acc, posting) => (posting.amount ? acc.plus(new Big(posting.amount)) : acc),
			new Big(0)
		);
	});

	let hasPlaceholder = $derived(
		$xact?.postings?.some((p) => !p.account) ?? false
	);

	let isBalanced = $derived.by(() => {
		if (!$xact?.postings?.length) return true;
		const hasAutoBalance = $xact.postings.some((p) => p.account && p.amount == null);
		const byCurrency: Record<string, number> = {};
		for (const p of $xact.postings) {
			if (!p.account || p.amount == null || !p.currency) continue;
			byCurrency[p.currency] = (byCurrency[p.currency] ?? 0) + p.amount;
		}
		// Auto-balance only resolves within a single currency; cross-currency needs a price annotation.
		if (hasAutoBalance && Object.keys(byCurrency).length <= 1) return true;
		return Object.values(byCurrency).every((s) => Math.abs(s) <= 0.005);
	});

	$effect(() => {
		if (hasPlaceholder && $xact && $xact.flag !== '!') {
			$xact.flag = '!';
		}
	});
	if (!$xact) {
		goto('/');
	}

	onMount(async () => {
		const fmt = await settings.get<string>(SettingKeys.dateFormat);
		if (fmt) dateFormatValue = fmt;

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

	function onAddPostingClicked() {
		if (!$xact) {
			Notifier.error('The transaction is not initialized!');
			return;
		}

		xact.update((current) => ({ ...current, postings: [...current.postings, new Posting()] }));
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

	function shiftDate(days: number) {
		if (!$xact?.date) return;
		const d = new Date($xact.date);
		d.setDate(d.getDate() + days);
		$xact.date = d.toISOString().slice(0, 10);
	}

	function onMetaChange(meta: Record<string, string>) {
		if ($xact) $xact.meta = meta;
	}

</script>

<div class="flex h-full flex-col space-y-3 py-2">
	<div class="flex items-center">
		<CalendarIcon class="h-5 w-5 mr-2 opacity-70" />
		<button type="button" class="btn btn-ghost h-11 w-11 p-0" onclick={() => shiftDate(-1)}><ChevronLeftIcon class="h-4 w-4" /></button>
		<div class="relative flex-1">
			<button
				type="button"
				class="input rounded flex items-center cursor-pointer px-3 w-full text-left"
				onclick={() => dateInputEl?.showPicker?.()}
			>
				{formattedDate}
			</button>
			<input
				bind:this={dateInputEl}
				title="Date"
				type="date"
				class="sr-only"
				bind:value={$xact.date}
			/>
		</div>
		<button type="button" class="btn btn-ghost h-11 w-11 p-0" onclick={() => shiftDate(1)}><ChevronRightIcon class="h-4 w-4" /></button>
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

	<!-- Transaction flag -->
	<div class="flex flex-col items-center gap-1">
		<div class="flex w-full items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<div class="join">
					<button
						type="button"
						title="Mark as incomplete / needs review"
						class="join-item btn btn-sm"
						class:btn-warning={$xact.flag === '!'}
						class:btn-outline={$xact.flag !== '!'}
						onclick={() => ($xact.flag = '!')}
					>
						<TriangleAlertIcon class="h-4 w-4" />
						<span>!</span>
					</button>
					<button
						type="button"
						title="Mark as complete"
						class="join-item btn btn-sm"
						class:btn-success={$xact.flag === '*'}
						class:btn-outline={$xact.flag !== '*'}
						disabled={hasPlaceholder}
						onclick={() => ($xact.flag = '*')}
					>
						<CircleCheckIcon class="h-4 w-4" />
						<span>*</span>
					</button>
				</div>
				{#if !isBalanced}
					<span class="text-error text-xs flex items-center gap-1" title="Amounts don't balance — run Validate for details">
						<TriangleAlertIcon class="h-3 w-3" />
						unbalanced
					</span>
				{/if}
			</div>
			<button
				type="button"
				class="link text-sm whitespace-nowrap"
				onclick={() => (metadataExpanded = !metadataExpanded)}
			>
				Metadata{$xact?.meta && Object.keys($xact.meta).length > 0
					? ` (${Object.keys($xact.meta).length})`
					: ''} &gt;
			</button>
		</div>
		{#if hasPlaceholder}
			<span class="text-warning text-xs">Has uncategorized postings</span>
		{/if}
	</div>

	<!-- Postings -->
	<!-- sum -->
	<div class="bg-primary/25 flex flex-row items-center rounded-lg p-3">
		<span class="grow text-center">Postings</span>
		<div><SigmaIcon /></div>
		<data class="pl-2">{sum}</data>
	</div>
	<!-- posting list -->
	<div class="flex-1 overflow-y-auto">
		{#each $xact?.postings as posting, index (posting)}
			<PostingEditor
				{index}
				onAccountClicked={(event) => onPostingAccountClicked(index)}
			/>
		{/each}
		<div class="flex justify-center pt-1">
			<button
				type="button"
				class="btn btn-outline btn-accent btn-square rounded"
				onclick={onAddPostingClicked}
				title="Add posting"
			>
				<CirclePlusIcon />
			</button>
		</div>
	</div>
	{#if metadataExpanded}
		<div class="bg-base-200 space-y-2 rounded-lg p-3">
			<MetadataEditor meta={$xact?.meta} onChange={onMetaChange} />
		</div>
	{/if}
</div>
