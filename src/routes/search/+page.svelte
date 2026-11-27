<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import SearchToolbar from '#lib/components/SearchToolbar.svelte';
	import PillToggle from '#lib/components/PillToggle.svelte';
	import JournalXactRow from '#lib/components/JournalXactRow.svelte';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { goto } from '$app/navigation';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import {
		EntitySearchTermStore,
		EntitySearchScopeStore,
		xact as xactStore,
		xactId,
		type EntitySearchScope
	} from '#lib/data/mainStore';
	import {
		parseEntitySearchTerms,
		resolveTermCategories,
		matchingMeta,
		searchDeclaredCommodities,
		symbolsMatchingMeta,
		txSearchParams,
		type EntityCategory,
		type EntitySearchTerm,
		type SearchableCommodity
	} from '#lib/utils/entitySearch';
	import { escapeRegExp } from '#lib/utils/bql';
	import {
		buildConditions,
		searchPayees,
		searchAccounts,
		searchCommodities,
		searchTransactions,
		type TransactionResult
	} from '#lib/services/entitySearchService';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import UserIcon from '@lucide/svelte/icons/user';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import FileSearchIcon from '@lucide/svelte/icons/file-search';

	const SCOPE_OPTIONS: { value: EntitySearchScope; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'payees', label: 'Payees' },
		{ value: 'accounts', label: 'Accounts' },
		{ value: 'narration', label: 'Narration' },
		{ value: 'commodities', label: 'Commodities' }
	];

	/** Maps a radio scope to the single entity category it searches ('all' searches every category). */
	const SCOPE_TO_CATEGORY: Record<
		Exclude<EntitySearchScope, 'all'>,
		Exclude<EntityCategory, 'any'>
	> = {
		payees: 'payee',
		accounts: 'account',
		narration: 'narration',
		commodities: 'commodity'
	};

	let ledgerLoaded = $state(false);
	let loading = $state(false);
	let highlightTerms: string[] = $state([]);

	let payeeResults: string[] = $state([]);
	let accountResults: string[] = $state([]);
	let commodityResults: string[] = $state([]);
	/** `commodity` directives, for metadata search. Reloaded when the ledger reloads. */
	let commodityDirectives: SearchableCommodity[] = [];
	const commodityBySymbol = new Map<string, SearchableCommodity>();
	let transactionResults: TransactionResult[] = $state([]);
	/** Terms/categories behind the current transactionResults, kept to build the Transaction Search link. */
	let transactionTerms: { term: EntitySearchTerm; category: EntityCategory }[] = $state([]);

	/** Transactions section is capped in-page; "Show All" links to Transaction Search for the rest. */
	const TX_DISPLAY_CAP = 30;
	const visibleTransactionResults = $derived(transactionResults.slice(0, TX_DISPLAY_CAP));

	const hasResults = $derived(
		payeeResults.length > 0 ||
			accountResults.length > 0 ||
			commodityResults.length > 0 ||
			transactionResults.length > 0
	);

	onMount(() => {
		void init();
	});

	const ledgerVersion = fullLedgerService.version;
	/** Ledger version the commodity directives were loaded for. */
	let directivesVersion = -1;

	/**
	 * (Re)loads the `commodity` directives and the symbol lookup map for `version`.
	 * Returns false if a newer ledger load superseded this one before it finished.
	 */
	async function reloadCommodityDirectives(version: number): Promise<boolean> {
		const directives = await fullLedgerService.getCommodityDirectives();
		if (version !== get(ledgerVersion)) return false;
		commodityDirectives = directives;
		commodityBySymbol.clear();
		for (const commodity of directives) {
			commodityBySymbol.set(commodity.currency, commodity);
		}
		return true;
	}

	async function init() {
		await fullLedgerService.ensureLoaded();
		directivesVersion = get(ledgerVersion);
		await reloadCommodityDirectives(directivesVersion);
		ledgerLoaded = true;
		void runSearch();
	}

	// Re-run whenever the search term or scope changes (typing, or switching the pill toggle),
	// and reload the commodity metadata when the ledger itself is reloaded.
	$effect(() => {
		void $EntitySearchTermStore;
		void $EntitySearchScopeStore;
		const version = $ledgerVersion;
		if (!ledgerLoaded) return;
		if (version !== directivesVersion) {
			directivesVersion = version;
			void reloadCommodityDirectives(version).then((ok) => {
				if (ok) void runSearch();
			});
		} else {
			void runSearch();
		}
	});

	let requestId = 0;

	async function runSearch() {
		const terms = parseEntitySearchTerms($EntitySearchTermStore);
		if (terms.length === 0) {
			payeeResults = [];
			accountResults = [];
			commodityResults = [];
			transactionResults = [];
			transactionTerms = [];
			highlightTerms = [];
			return;
		}

		const categories = resolveTermCategories(terms, $EntitySearchScopeStore);
		highlightTerms = terms.map((term) => term.value);
		transactionTerms = terms.map((term, i) => ({ term, category: categories[i] }));

		const scope = $EntitySearchScopeStore;
		const activeEntities: Exclude<EntityCategory, 'any'>[] =
			scope === 'all' ? ['payee', 'account', 'narration', 'commodity'] : [SCOPE_TO_CATEGORY[scope]];

		// Metadata-matched symbols per term value, computed once for all entity targets.
		const symbolsByTerm = new Map(
			terms.map((term) => [term.value, symbolsMatchingMeta(commodityDirectives, term.value)])
		);
		const conditionsFor = (target: Exclude<EntityCategory, 'any'>) =>
			buildConditions(terms, categories, target, symbolsByTerm);
		// Declared but unused commodities can only be listed if no term needs a posting to match.
		const declaredMatches =
			activeEntities.includes('commodity') &&
			categories.every((category) => category === 'any' || category === 'commodity')
				? searchDeclaredCommodities(
						commodityDirectives,
						terms.map((term) => term.value)
					)
				: [];

		const id = ++requestId;
		loading = true;
		try {
			const [payees, accounts, commodities, transactions] = await Promise.all([
				activeEntities.includes('payee')
					? searchPayees(conditionsFor('payee'))
					: Promise.resolve([]),
				activeEntities.includes('account')
					? searchAccounts(conditionsFor('account'))
					: Promise.resolve([]),
				activeEntities.includes('commodity')
					? searchCommodities(conditionsFor('commodity'))
					: Promise.resolve([]),
				activeEntities.includes('narration')
					? searchTransactions(
							conditionsFor('narration'),
							terms.map((term, i) => ({
								value: term.value,
								// Only explicit $ terms filter on currency in transaction search.
								commoditySymbols:
									categories[i] === 'commodity' ? symbolsByTerm.get(term.value) : undefined
							}))
						)
					: Promise.resolve([])
			]);
			if (id !== requestId) return; // a newer search superseded this one

			payeeResults = payees;
			accountResults = accounts;
			commodityResults = [...new Set([...commodities, ...declaredMatches])].sort();
			transactionResults = transactions;
		} finally {
			if (id === requestId) loading = false;
		}
	}

	function onSearch(value: string) {
		$EntitySearchTermStore = value;
	}

	function onScopeChange(value: string) {
		$EntitySearchScopeStore = value as EntitySearchScope;
	}

	function onPayeeClick(payee: string) {
		goto('/payees/payee-xacts/' + encodeURIComponent(payee));
	}

	function onAccountClick(account: string) {
		goto('/accounts/account-xacts/' + encodeURIComponent(account));
	}

	function onCommodityClick(symbol: string) {
		goto('/commodities/detail?symbol=' + encodeURIComponent(symbol));
	}

	/** The /reports/tx-search URL for the current transaction query. */
	function txSearchUrl(): string {
		const terms = transactionTerms.map(({ term, category }) => ({ value: term.value, category }));
		return `/reports/tx-search?${txSearchParams(terms, commodityDirectives)}`;
	}

	// Same destination as tapping a transaction on the Payee Transactions page.
	async function onTransactionClick(result: TransactionResult) {
		xactStore.set(result.xact);
		xactId.set(result.id);
		await goto('/xact-actions');
	}

	interface TextSegment {
		text: string;
		hit: boolean;
	}

	/** Splits text into plain/highlighted segments for every matched term. */
	function highlight(text: string, terms: string[]): TextSegment[] {
		if (terms.length === 0) return [{ text, hit: false }];
		const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
		return text.split(pattern).map((part, i) => ({ text: part, hit: i % 2 === 1 }));
	}

	/** The commodity's name, followed by any other metadata that matched the search. */
	function commodityDetails(symbol: string, terms: string[]): string[] {
		const commodity = commodityBySymbol.get(symbol);
		if (!commodity) return [];
		const name = commodity.meta?.['name'];
		const matches = matchingMeta(commodity, terms)
			.filter(({ key }) => key !== 'name')
			.map(({ key, value }) => `${key}: ${value}`);
		return typeof name === 'string' ? [name, ...matches] : matches;
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Search">
		{#snippet actions()}
			<HelpButton topic="search" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Full-Text Search"
				targetNav="/search/full-text"
				Icon={FileSearchIcon}
			/>
			<ToolbarMenuItem
				text="Transaction Search"
				targetNav="/reports/tx-search"
				Icon={ReceiptIcon}
			/>
		{/snippet}
	</Toolbar>
	<SearchToolbar focus {onSearch} delay={200} value={$EntitySearchTermStore} />
	<div class="flex justify-center py-2">
		<PillToggle options={SCOPE_OPTIONS} value={$EntitySearchScopeStore} onchange={onScopeChange} />
	</div>
	<p class="px-2 pb-2 text-center text-xs opacity-50">
		<span class="font-mono">@</span>payee &middot; <span class="font-mono">#</span>account &middot;
		<span class="font-mono">~</span>narration &middot; <span class="font-mono">$</span>commodity
	</p>

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		{#if !ledgerLoaded}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if $EntitySearchTermStore.trim().length === 0}
			<div class="flex h-32 items-center justify-center opacity-50">
				<p class="text-sm">
					Search <span class="font-mono">@payees #accounts ~narration $commodities</span>.
				</p>
			</div>
		{:else if loading}
			<div class="flex h-32 items-center justify-center">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if !hasResults}
			<div class="flex h-32 items-center justify-center opacity-50">
				<p class="text-sm">No matches found.</p>
			</div>
		{:else}
			{#if payeeResults.length > 0}
				<h2 class="pt-2 pb-1 text-xs font-semibold uppercase opacity-50">
					Payees ({payeeResults.length})
				</h2>
				{#each payeeResults as payee (payee)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="border-base-content/15 flex items-center gap-2 border-b py-2 px-1 cursor-pointer transition-colors hover:bg-base-content/5"
						onclick={() => onPayeeClick(payee)}
						role="listitem"
					>
						<UserIcon class="size-4 shrink-0 opacity-60" />
						<span class="flex-1 truncate">
							{#each highlight(payee, highlightTerms) as segment, i (i)}
								{#if segment.hit}<mark class="bg-primary/40 text-inherit rounded-none"
										>{segment.text}</mark
									>{:else}{segment.text}{/if}
							{/each}
						</span>
						<span class="text-xs opacity-50 shrink-0">Payee</span>
					</div>
				{/each}
			{/if}

			{#if accountResults.length > 0}
				<h2 class="pt-2 pb-1 text-xs font-semibold uppercase opacity-50">
					Accounts ({accountResults.length})
				</h2>
				{#each accountResults as account (account)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="border-base-content/15 flex items-center gap-2 border-b py-2 px-1 cursor-pointer transition-colors hover:bg-base-content/5"
						onclick={() => onAccountClick(account)}
						role="listitem"
					>
						<LandmarkIcon class="size-4 shrink-0 opacity-60" />
						<span class="flex-1 truncate font-mono">
							{#each highlight(account, highlightTerms) as segment, i (i)}
								{#if segment.hit}<mark class="bg-primary/40 text-inherit rounded-none"
										>{segment.text}</mark
									>{:else}{segment.text}{/if}
							{/each}
						</span>
						<span class="text-xs opacity-50 shrink-0">Account</span>
					</div>
				{/each}
			{/if}

			{#if commodityResults.length > 0}
				<h2 class="pt-2 pb-1 text-xs font-semibold uppercase opacity-50">
					Commodities ({commodityResults.length})
				</h2>
				{#each commodityResults as commodity (commodity)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="border-base-content/15 flex items-center gap-2 border-b py-2 px-1 cursor-pointer transition-colors hover:bg-base-content/5"
						onclick={() => onCommodityClick(commodity)}
						role="listitem"
					>
						<CoinsIcon class="size-4 shrink-0 opacity-60" />
						<div class="min-w-0 flex-1">
							<div class="truncate font-mono">
								{#each highlight(commodity, highlightTerms) as segment, i (i)}
									{#if segment.hit}<mark class="bg-primary/40 text-inherit rounded-none"
											>{segment.text}</mark
										>{:else}{segment.text}{/if}
								{/each}
							</div>
							{#each commodityDetails(commodity, highlightTerms) as detail (detail)}
								<div class="truncate text-xs opacity-60">
									{#each highlight(detail, highlightTerms) as segment, i (i)}
										{#if segment.hit}<mark class="bg-primary/40 text-inherit rounded-none"
												>{segment.text}</mark
											>{:else}{segment.text}{/if}
									{/each}
								</div>
							{/each}
						</div>
						<span class="text-xs opacity-50 shrink-0">Commodity</span>
					</div>
				{/each}
			{/if}

			{#if transactionResults.length > 0}
				<h2 class="pt-2 pb-1 flex items-center gap-2 text-xs font-semibold uppercase opacity-50">
					<span
						><ReceiptIcon class="inline size-3 -translate-y-px" /> Transactions ({transactionResults.length})</span
					>
					{#if transactionResults.length > TX_DISPLAY_CAP}
						<a href={txSearchUrl()} class="link link-primary text-xs font-normal normal-case"
							>Show All</a
						>
					{/if}
				</h2>
				{#each visibleTransactionResults as result, i (result.xact.date + '\0' + (result.xact.payee ?? '') + '\0' + (result.xact.note ?? '') + '\0' + i)}
					<div class="py-2 px-1 {i % 2 === 1 ? 'bg-base-200' : ''}">
						<JournalXactRow xact={result.xact} onclick={() => onTransactionClick(result)} />
					</div>
				{/each}
				{#if transactionResults.length > TX_DISPLAY_CAP}
					<div class="py-3 text-center">
						<a href={txSearchUrl()} class="link link-primary text-sm">Show All</a>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
</main>
