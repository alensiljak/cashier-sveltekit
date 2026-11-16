<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { listPriceProviders } from '#lib/services/prices/priceProviderRegistry';
	import {
		getDisabledProviders,
		getNicknames,
		setProviderEnabled,
		type PriceNicknames
	} from '#lib/services/prices/priceNicknames';
	import { goto } from '$app/navigation';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { onMount } from 'svelte';

	const providers = listPriceProviders();

	let disabled = $state<Set<string>>(new Set());
	let nicknames = $state<PriceNicknames>({});
	let loaded = $state(false);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const [off, nicks] = await Promise.all([getDisabledProviders(), getNicknames()]);
			disabled = new Set(off);
			nicknames = nicks;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		loaded = true;
	});

	function nicknamesFor(providerId: string): string[] {
		return Object.entries(nicknames)
			.filter(([, id]) => id === providerId)
			.map(([nick]) => nick);
	}

	async function toggle(providerId: string, enabled: boolean) {
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
</script>

<Toolbar title="Price Providers" />

<main class="flex flex-col flex-1">
	<div class="flex flex-col gap-4 p-4 mx-auto max-w-2xl w-full">
		<p class="text-sm opacity-70">
			Turn providers on or off for the book-driven price download. Open a provider's settings for its
			nicknames, source mapping and securities.
		</p>

		{#if error}
			<div class="alert alert-error text-sm"><span>{error}</span></div>
		{/if}

		{#if !loaded}
			<span class="loading loading-spinner loading-sm"></span>
		{:else}
			<ul class="card bg-base-100 shadow-sm divide-y divide-base-200">
				{#each providers as p (p.id)}
					{@const nicks = nicknamesFor(p.id)}
					<li class="flex items-center gap-3 p-3">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">{p.name}</p>
							<p class="truncate text-xs opacity-60">
								{p.kind}
								{#if nicks.length > 0}· {nicks.join(', ')}{:else}· no nickname{/if}
							</p>
						</div>
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-circle"
							aria-label="Settings for {p.name}"
							onclick={() => goto(`/prices/providers/${p.id}`)}
						>
							<SettingsIcon size={18} />
						</button>
						<input
							type="checkbox"
							class="toggle toggle-success bg-transparent bg-none"
							aria-label="Enable {p.name}"
							checked={!disabled.has(p.id)}
							onchange={(e) => void toggle(p.id, e.currentTarget.checked)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
