<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { listPriceProviders } from '#lib/services/prices/priceProviderRegistry';
	import {
		DEFAULT_NICKNAMES,
		fetchBookSources,
		getNicknames,
		saveNicknames,
		type BookSource,
		type PriceNicknames
	} from '#lib/services/prices/priceNicknames';
	import { onMount } from 'svelte';

	const providers = listPriceProviders();

	let nicknames = $state<PriceNicknames>({});
	let bookSources = $state<BookSource[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let newNickname = $state('');
	let newProviderId = $state(providers[0]?.id ?? '');

	/** Sources the book uses, plus any nickname mapped by hand that the book does not use. */
	const rows = $derived.by(() => {
		const fromBook = new Map(bookSources.map((s) => [s.source, s.commodities]));
		const names = new Set([...fromBook.keys(), ...Object.keys(nicknames)]);
		return [...names].sort().map((source) => ({
			source,
			commodities: fromBook.get(source) ?? [],
			inBook: fromBook.has(source),
			providerId: nicknames[source] ?? ''
		}));
	});

	const trimmedNew = $derived(newNickname.trim());
	const newInvalid = $derived(
		trimmedNew === '' || /[\s/:,]/.test(trimmedNew) || trimmedNew in nicknames
	);

	onMount(async () => {
		try {
			[nicknames, bookSources] = await Promise.all([getNicknames(), fetchBookSources()]);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		loaded = true;
	});

	async function persist(next: PriceNicknames) {
		nicknames = next;
		try {
			await saveNicknames(next);
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function setProvider(source: string, providerId: string) {
		const next = { ...nicknames };
		if (providerId === '') delete next[source];
		else next[source] = providerId;
		return persist(next);
	}

	function addNickname() {
		if (newInvalid || newProviderId === '') return;
		const nick = trimmedNew;
		newNickname = '';
		return persist({ ...nicknames, [nick]: newProviderId });
	}

	function resetDefaults() {
		return persist({ ...DEFAULT_NICKNAMES });
	}

	function nicknamesFor(providerId: string): string[] {
		return Object.entries(nicknames)
			.filter(([, id]) => id === providerId)
			.map(([nick]) => nick);
	}
</script>

<Toolbar title="Price Providers" />

<main class="flex flex-col flex-1">
	<div class="flex flex-col gap-4 p-4 mx-auto max-w-2xl w-full">
		<p class="text-sm opacity-70">
			A commodity's Beancount <code>price</code> tag (<code>QUOTE:source/SYMBOL</code>) names a
			downloader by its <em>source</em>. Map each source to one of this app's providers so the book
			can drive price downloads.
		</p>

		{#if error}
			<div class="alert alert-error text-sm"><span>{error}</span></div>
		{/if}

		<section class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-base">Sources in your book</h2>
				{#if !loaded}
					<span class="loading loading-spinner loading-sm"></span>
				{:else if rows.length === 0}
					<p class="text-sm opacity-60">No commodity has a <code>price</code> tag yet.</p>
				{:else}
					<ul class="flex flex-col gap-3">
						{#each rows as row (row.source)}
							<li class="flex flex-col gap-1">
								<div class="flex items-center gap-2">
									<code class="text-sm font-medium break-all flex-1">{row.source}</code>
									{#if !row.providerId}
										<span class="badge badge-warning badge-sm">unmapped</span>
									{/if}
								</div>
								<p class="text-xs opacity-60">
									{#if row.inBook}
										{row.commodities.length} commodit{row.commodities.length === 1 ? 'y' : 'ies'}:
										{row.commodities.join(', ')}
									{:else}
										Not used by any commodity in the book.
									{/if}
								</p>
								<select
									class="select select-bordered select-sm w-full"
									aria-label="Provider for {row.source}"
									value={row.providerId}
									onchange={(e) => setProvider(row.source, e.currentTarget.value)}
								>
									<option value="">— not mapped —</option>
									{#each providers as p (p.id)}
										<option value={p.id}>{p.name}</option>
									{/each}
								</select>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<section class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-base">Add a nickname</h2>
				<p class="text-xs opacity-60">
					For a source that no commodity uses yet. No spaces, <code>/</code>, <code>:</code> or
					<code>,</code>.
				</p>
				<input
					class="input input-bordered input-sm w-full"
					placeholder="source, e.g. ecbrates"
					bind:value={newNickname}
				/>
				<select class="select select-bordered select-sm w-full" bind:value={newProviderId}>
					{#each providers as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
				<button
					class="btn btn-primary btn-sm rounded self-start"
					type="button"
					disabled={newInvalid || newProviderId === ''}
					onclick={addNickname}
				>
					Add
				</button>
			</div>
		</section>

		<section class="card bg-base-100 shadow-sm">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-base">Available providers</h2>
				<ul class="flex flex-col gap-3">
					{#each providers as p (p.id)}
						{@const nicks = nicknamesFor(p.id)}
						<li class="flex flex-col gap-1">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium flex-1">{p.name}</span>
								<span class="badge badge-ghost badge-sm">{p.kind}</span>
							</div>
							<p class="text-xs opacity-60"><code>{p.id}</code></p>
							{#if nicks.length > 0}
								<p class="text-xs">
									Nicknames:
									{#each nicks as n, i (n)}<code>{n}</code>{i < nicks.length - 1 ? ', ' : ''}{/each}
								</p>
							{:else}
								<p class="text-xs text-warning">No nickname — not part of the book-driven download.</p>
							{/if}
						</li>
					{/each}
				</ul>
				<button class="btn btn-ghost btn-xs rounded self-start" type="button" onclick={resetDefaults}>
					Reset to defaults
				</button>
			</div>
		</section>
	</div>
</main>
