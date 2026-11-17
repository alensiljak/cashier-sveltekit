<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import CataloguePicker from '#lib/components/CataloguePicker.svelte';
	import AwareCatalogue from '#lib/components/AwareCatalogue.svelte';
	import { hasCatalogue } from '#lib/services/prices/priceCatalogueService';
	import { listPriceProviders } from '#lib/services/prices/priceProviderRegistry';
	import {
		DEFAULT_NICKNAMES,
		fetchBookSources,
		getDisabledProviders,
		getNicknames,
		saveNicknames,
		setProviderEnabled,
		type BookSource,
		type PriceNicknames
	} from '#lib/services/prices/priceNicknames';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	const providers = listPriceProviders();
	const providerId = $derived(page.params.id ?? '');
	const provider = $derived(providers.find((p) => p.id === providerId));
	const names = new Map(providers.map((p) => [p.id, p.name]));

	let nicknames = $state<PriceNicknames>({});
	let bookSources = $state<BookSource[]>([]);
	let disabled = $state<Set<string>>(new Set());
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let newNickname = $state('');

	/** Nicknames mapped to this provider. */
	const mine = $derived(
		Object.entries(nicknames)
			.filter(([, id]) => id === providerId)
			.map(([nick]) => nick)
			.sort()
	);

	/** Sources the book uses, with who they map to now. */
	const sourceRows = $derived(
		bookSources.map((s) => ({
			...s,
			mappedTo: nicknames[s.source] as string | undefined
		}))
	);

	const trimmedNew = $derived(newNickname.trim());
	const newInvalid = $derived(
		trimmedNew === '' || /[\s/:,]/.test(trimmedNew) || trimmedNew in nicknames
	);

	/** Shipped nicknames for this provider that are not mapped to it right now. */
	const missingDefaults = $derived(
		Object.entries(DEFAULT_NICKNAMES).filter(
			([nick, id]) => id === providerId && nicknames[nick] !== providerId
		)
	);

	onMount(async () => {
		try {
			const [nicks, sources, off] = await Promise.all([
				getNicknames(),
				fetchBookSources(),
				getDisabledProviders()
			]);
			nicknames = nicks;
			bookSources = sources;
			disabled = new Set(off);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		loaded = true;
	});

	async function persist(next: PriceNicknames) {
		const previous = nicknames;
		nicknames = next;
		try {
			await saveNicknames(next);
			error = null;
		} catch (e) {
			nicknames = previous;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function mapSource(source: string, use: boolean) {
		const next = { ...nicknames };
		if (use) next[source] = providerId;
		else delete next[source];
		return persist(next);
	}

	async function setEnabled(enabled: boolean) {
		const previous = disabled;
		const next = new Set(disabled);
		if (enabled) next.delete(providerId);
		else next.add(providerId);
		disabled = next;
		try {
			await setProviderEnabled(providerId, enabled);
			error = null;
		} catch (e) {
			disabled = previous;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function addNickname() {
		if (newInvalid) return;
		const nick = trimmedNew;
		newNickname = '';
		return persist({ ...nicknames, [nick]: providerId });
	}

	function restoreDefaults() {
		return persist({ ...nicknames, ...Object.fromEntries(missingDefaults) });
	}
</script>

<Toolbar title={provider?.name ?? 'Price Provider'} />

<main class="flex flex-col flex-1">
	<div class="flex flex-col gap-4 p-4 mx-auto max-w-2xl w-full">
		{#if !provider}
			<div class="alert alert-error text-sm"><span>Unknown provider “{providerId}”.</span></div>
		{:else}
			{#if error}
				<div class="alert alert-error text-sm"><span>{error}</span></div>
			{/if}

			<!-- Enabled -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body p-4">
					<label class="flex cursor-pointer items-center gap-3">
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-medium">Enabled</span>
							<span class="block text-xs opacity-60">
								Off keeps the nicknames but takes the provider out of the price download.
							</span>
						</span>
						<input
							type="checkbox"
							class="toggle toggle-success bg-transparent bg-none"
							aria-label="Enable {provider.name}"
							checked={!disabled.has(providerId)}
							onchange={(e) => void setEnabled(e.currentTarget.checked)}
						/>
					</label>
				</div>
			</section>

			<!-- Nicknames -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-3 p-4">
					<h2 class="card-title text-base">Nicknames</h2>
					<p class="text-xs opacity-60">
						The <em>source</em> names in a commodity's <code>price</code> tag
						(<code>QUOTE:source/SYMBOL</code>) that this provider serves.
					</p>
					{#if mine.length > 0}
						<ul class="flex flex-wrap gap-1">
							{#each mine as nick (nick)}
								<li class="badge badge-outline gap-1 h-auto py-1">
									<code>{nick}</code>
									<button
										type="button"
										class="opacity-60 hover:opacity-100"
										aria-label="Remove nickname {nick}"
										onclick={() => void mapSource(nick, false)}>✕</button
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-warning">
							No nickname — this provider takes no part in the book-driven download.
						</p>
					{/if}

					<div class="flex gap-2">
						<input
							class="input input-bordered input-sm flex-1"
							placeholder="add a nickname, e.g. ecbrates"
							aria-label="New nickname"
							bind:value={newNickname}
							onkeydown={(e) => e.key === 'Enter' && void addNickname()}
						/>
						<button
							class="btn btn-primary btn-sm rounded"
							type="button"
							disabled={newInvalid}
							onclick={() => void addNickname()}>Add</button
						>
					</div>
					<p class="text-xs opacity-60">No spaces, <code>/</code>, <code>:</code> or <code>,</code>.</p>
					{#if missingDefaults.length > 0}
						<button
							class="btn btn-ghost btn-xs rounded self-start"
							type="button"
							onclick={() => void restoreDefaults()}
						>
							Restore default ({missingDefaults.map(([n]) => n).join(', ')})
						</button>
					{/if}
				</div>
			</section>

			<!-- Mapping -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-3 p-4">
					<h2 class="card-title text-base">Sources in your book</h2>
					{#if !loaded}
						<span class="loading loading-spinner loading-sm"></span>
					{:else if sourceRows.length === 0}
						<p class="text-sm opacity-60">No commodity has a <code>price</code> tag yet.</p>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each sourceRows as row (row.source)}
								<li>
									<label class="flex cursor-pointer items-start gap-2">
										<input
											type="checkbox"
											class="checkbox checkbox-sm mt-0.5"
											checked={row.mappedTo === providerId}
											onchange={(e) => void mapSource(row.source, e.currentTarget.checked)}
										/>
										<span class="min-w-0 flex-1">
											<code class="text-sm font-medium break-all">{row.source}</code>
											<span class="block text-xs opacity-60">
												{row.commodities.length} commodit{row.commodities.length === 1 ? 'y' : 'ies'}:
												{row.commodities.join(', ')}
											</span>
											{#if row.mappedTo && row.mappedTo !== providerId}
												<span class="block text-xs text-warning">
													Currently mapped to {names.get(row.mappedTo) ?? row.mappedTo}; ticking moves it
													here.
												</span>
											{:else if !row.mappedTo}
												<span class="block text-xs text-warning">Unmapped</span>
											{/if}
										</span>
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>

			<!-- Securities -->
			{#if provider.id === 'aware'}
				<section class="card bg-base-100 shadow-sm">
					<div class="card-body gap-3 p-4">
						<h2 class="card-title text-base">Investment options</h2>
						<AwareCatalogue />
					</div>
				</section>
			{:else if hasCatalogue(provider.id)}
				<section class="card bg-base-100 shadow-sm">
					<div class="card-body gap-3 p-4">
						<h2 class="card-title text-base">Securities</h2>
						<p class="text-xs opacity-60">
							Only the products selected here are priced. Routine downloads request just these — the
							catalogue is fetched only when you press the button.
						</p>
						<CataloguePicker providerId={provider.id} />
					</div>
				</section>
			{/if}
		{/if}
	</div>
</main>
