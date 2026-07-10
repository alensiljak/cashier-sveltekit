<script lang="ts">
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { SearchTermStore } from '$lib/data/mainStore';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { locateXactsInSource, findXactAtLine, type XactLocation } from '$lib/utils/xactLocator';
	import {
		loadSearchableFiles,
		searchInFiles,
		parseSearchTerms,
		type SearchFile,
		type SearchMatch
	} from '$lib/utils/fullTextSearch';

	/** Caps the result list so a broad one-letter query stays fast to render. */
	const MAX_RESULTS = 300;

	type DeepLink =
		| { type: 'account'; value: string }
		| { type: 'commodity'; value: string }
		| { type: 'xact'; path: string; line: number; location: XactLocation };

	let files: SearchFile[] = $state([]);
	let filesLoaded = $state(false);
	let indexProgress: { count: number; path: string } | undefined = $state(undefined);

	// Longest-first so a substring match prefers the more specific account,
	// e.g. "Assets:Bank:Checking" over its parent "Assets:Bank".
	let accountNames: string[] = $state([]);
	let commodityCodes: string[] = $state([]);
	// Transaction directives per .bean file, with their source spans — lets a
	// matched line resolve to the exact transaction it belongs to, in any file.
	let xactLocationsByPath: Map<string, XactLocation[]> = $state(new Map());

	onMount(() => {
		void loadFiles();
		void loadLedgerRefs();
	});

	async function loadFiles() {
		files = await loadSearchableFiles((info) => (indexProgress = info));
		filesLoaded = true;
		indexProgress = undefined;
		void loadXactLocations(files);
	}

	/** Parses every Beancount file once to map matched lines to their transaction. */
	async function loadXactLocations(loadedFiles: SearchFile[]) {
		const entries = await Promise.all(
			loadedFiles
				.filter((file) => /\.bean(count)?$/i.test(file.path))
				.map(async (file): Promise<[string, XactLocation[]]> => {
					try {
						return [file.path, await locateXactsInSource(file.lines.join('\n'))];
					} catch (error) {
						console.error(`Failed to locate transactions in ${file.path}`, error);
						return [file.path, []];
					}
				})
		);
		xactLocationsByPath = new Map(entries);
	}

	function extractCommodityCode(directive: unknown): string | undefined {
		if (
			directive &&
			typeof directive === 'object' &&
			'type' in directive &&
			'currency' in directive
		) {
			const record = directive as { type: unknown; currency: unknown };
			if (record.type === 'commodity' && typeof record.currency === 'string') {
				return record.currency;
			}
		}
		return undefined;
	}

	async function loadLedgerRefs() {
		try {
			await fullLedgerService.ensureLoaded();

			const accounts = await fullLedgerService.getAllAccounts();
			accountNames = accounts
				.map((account) => account.name)
				.filter((name): name is string => Boolean(name))
				.sort((a, b) => b.length - a.length);

			const directives = await fullLedgerService.getDirectives();
			const codes = new Set<string>();
			for (const directive of directives) {
				const code = extractCommodityCode(directive);
				if (code) codes.add(code);
			}
			commodityCodes = Array.from(codes).sort((a, b) => b.length - a.length);
		} catch (error) {
			// Deep-linking is a bonus; the plain-text results still work without it.
			console.error('Failed to load ledger references for search deep-linking', error);
		}
	}

	const searchTerms = $derived.by(() => parseSearchTerms($SearchTermStore));
	const highlightValues = $derived.by(() => searchTerms.map((term) => term.value));

	const results: SearchMatch[] = $derived.by(() => {
		if (searchTerms.length === 0 || !filesLoaded) return [];
		return searchInFiles(files, searchTerms, MAX_RESULTS);
	});

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function deepLinkFor(match: SearchMatch): DeepLink | undefined {
		const location = findXactAtLine(xactLocationsByPath.get(match.path) ?? [], match.line);
		if (location) return { type: 'xact', path: match.path, line: match.line, location };

		for (const name of accountNames) {
			if (match.text.includes(name)) return { type: 'account', value: name };
		}
		for (const code of commodityCodes) {
			const boundary = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(code)}(?:$|[^A-Za-z0-9])`);
			if (boundary.test(match.text)) return { type: 'commodity', value: code };
		}
		return undefined;
	}

	function onResultClick(match: SearchMatch) {
		const link = deepLinkFor(match);
		if (!link) return;
		if (link.type === 'account') {
			goto('/accounts/account-xacts/' + encodeURIComponent(link.value));
		} else if (link.type === 'commodity') {
			goto('/commodities/detail?symbol=' + encodeURIComponent(link.value));
		} else {
			goto(`/tx/detail?path=${encodeURIComponent(link.path)}&line=${link.line}`);
		}
	}

	interface TextSegment {
		text: string;
		hit: boolean;
	}

	/** Splits a line into plain/highlighted segments for every matched term. */
	function highlight(text: string, terms: string[]): TextSegment[] {
		if (terms.length === 0) return [{ text, hit: false }];
		const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
		return text.split(pattern).map((part, i) => ({ text: part, hit: i % 2 === 1 }));
	}

	function linkLabel(link: DeepLink): string {
		if (link.type === 'account') return `Account: ${link.value}`;
		if (link.type === 'commodity') return `Commodity: ${link.value}`;
		const { xact } = link.location;
		const desc = [xact.payee, xact.note].filter(Boolean).join(' · ');
		return `Transaction: ${xact.date}${desc ? ' ' + desc : ''}`;
	}

	function onSearch(value: string) {
		$SearchTermStore = value;
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Full-Text Search">
		{#snippet actions()}
		<HelpButton topic="full-text-search" />
		{/snippet}
	</Toolbar>
	<!-- search toolbar: short debounce so fast typing feels responsive since -->
	<!-- filtering runs against an in-memory file cache, not disk -->
	<SearchToolbar focus {onSearch} delay={200} value={$SearchTermStore} />

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		{#if !filesLoaded}
			<div class="flex h-full flex-col items-center justify-center gap-2">
				<span class="loading loading-spinner loading-lg"></span>
				<p class="text-xs opacity-60">
					{#if indexProgress}
						Indexing files… ({indexProgress.count}) {indexProgress.path}
					{:else}
						Indexing files…
					{/if}
				</p>
			</div>
		{:else if searchTerms.length === 0}
			<div class="flex h-32 items-center justify-center opacity-50">
				<p class="text-sm">Type to search across your ledger and config files.</p>
			</div>
		{:else if results.length === 0}
			<div class="flex h-32 items-center justify-center opacity-50">
				<p class="text-sm">No matches found.</p>
			</div>
		{:else}
			{#each results as match (match.path + ':' + match.line + ':' + match.col)}
				{@const link = deepLinkFor(match)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="border-base-content/15 flex flex-col gap-0.5 border-b py-2 px-1 {link
						? 'cursor-pointer transition-colors hover:bg-base-content/5'
						: ''}"
					onclick={() => onResultClick(match)}
					role="listitem"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm font-medium truncate">
							{#each highlight(match.path, highlightValues) as segment, i (i)}
								{#if segment.hit}
									<mark class="bg-primary/40 text-inherit rounded-none">{segment.text}</mark>
								{:else}
									{segment.text}
								{/if}
							{/each}
						</span>
						<span class="text-xs opacity-50 whitespace-nowrap">{match.line}:{match.col}</span>
					</div>
					<div class="font-mono text-xs opacity-80 truncate">
						{#each highlight(match.text, highlightValues) as segment, i (i)}
							{#if segment.hit}
								<mark class="bg-primary/40 text-inherit rounded-none">{segment.text}</mark>
							{:else}
								{segment.text}
							{/if}
						{/each}
					</div>
					{#if link}
						<span class="text-xs opacity-50">&rarr; {linkLabel(link)}</span>
					{/if}
				</div>
			{/each}
			{#if results.length >= MAX_RESULTS}
				<div class="flex h-16 items-center justify-center opacity-50">
					<p class="text-xs">Showing the first {MAX_RESULTS} matches. Refine your search.</p>
				</div>
			{/if}
		{/if}
	</div>
</main>
