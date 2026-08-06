<script lang="ts">
	import { selectionMetadata, xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import PostingEditor from './PostingEditor.svelte';
	import MetadataEditor from './MetadataEditor.svelte';
	import SectionTitle from './SectionTitle.svelte';
	import { goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { ensureInitialized, validateSource } from '$lib/services/rustledger';
	import { getAccountBalance, loadAccount } from '$lib/services/accountsService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { getEmptyPostingIndex, xactToBeancountText } from '$lib/utils/xactUtils';
	import { debounce } from '$lib/utils/debounce';
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
		ChevronRightIcon,
		TagsIcon
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

	let statusMessages = $state<string[]>([]);

	// Error codes that only make sense with full-ledger context (open/close directives,
	// commodity declarations, prior lots, balance assertions). Validating a single
	// transaction in isolation has none of that context, so these would always fire as
	// false positives — see https://github.com/rustledger/rustledger/blob/main/docs/reference/errors.md
	const LEDGER_CONTEXT_ERROR_CODES = new Set([
		'E1001', // Account Not Opened
		'E1002', // Account Already Open
		'E1003', // Account Used After Close
		'E1004', // Account Close With Non-Zero Balance
		'E2001', // Balance Assertion Failed
		'E2002', // Balance Exceeds Tolerance
		'E2003', // Pad Without Balance Assertion
		'E2004', // Multiple Pads for Same Balance
		'E4001', // No Matching Lot
		'E4002', // Insufficient Units
		'E4003', // Ambiguous Lot Match
		'E5001', // Currency Not Declared
		'E5002', // Currency Not Allowed in Account
		'E7003', // Duplicate Option
		'E8001', // Document/Plugin Not Found
		'E8002' // Plugin Execution Failed
	]);

	/**
	 * Parse+validate the current transaction via the Ledger WASM module and surface
	 * its native error messages, instead of re-implementing balance/placeholder checks in JS.
	 */
	async function validateXactSource(source: string) {
		if (!source) {
			statusMessages = [];
			return;
		}
		try {
			await ensureInitialized();
			const result = validateSource(source);
			statusMessages = result.errors
				.filter((err) => !LEDGER_CONTEXT_ERROR_CODES.has(err.code ?? ''))
				.map((err) => err.message);
		} catch {
			statusMessages = [];
		}
	}

	// Debounced so validation runs once a field settles (e.g. amount entry finished)
	// rather than on every keystroke.
	const debouncedValidate = debounce(validateXactSource, 500);

	$effect(() => {
		const source = $xact ? xactToBeancountText($xact) : '';
		debouncedValidate(source);
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
	{#if statusMessages.length > 0}
		<div class="alert alert-warning items-start py-2">
			<TriangleAlertIcon class="h-5 w-5 shrink-0" />
			<div class="flex flex-col gap-1 text-sm">
				{#each statusMessages as message}
					<span>{message}</span>
				{/each}
			</div>
		</div>
	{/if}
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
	<div class="flex items-center justify-between gap-2">
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
		<button
			type="button"
			class="btn btn-sm btn-outline"
			class:btn-active={metadataExpanded}
			onclick={() => (metadataExpanded = !metadataExpanded)}
		>
			<TagsIcon class="h-4 w-4" />
			<span
				>Meta{$xact?.meta && Object.keys($xact.meta).length > 0
					? ` (${Object.keys($xact.meta).length})`
					: ''}</span
			>
		</button>
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

	<!-- postings sum -->
	<div class="flex items-center justify-between px-1">
		<SectionTitle class="text-xs opacity-70">Postings:</SectionTitle>
		<span class="flex items-center gap-1 text-sm opacity-70">
			<SigmaIcon class="h-3.5 w-3.5" />
			<data>{sum}</data>
		</span>
	</div>
	<!-- posting list -->
	<div class="flex-1 overflow-y-auto">
		{#each $xact?.postings as posting, index (posting)}
			<PostingEditor
				{index}
				onAccountClicked={(event) => onPostingAccountClicked(index)}
			/>
		{/each}
		<div class="flex justify-center pt-3 pb-6">
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
