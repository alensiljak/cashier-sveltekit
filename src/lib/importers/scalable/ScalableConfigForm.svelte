<script lang="ts">
	import { onMount } from 'svelte';
	import type { ScalableConfig } from './config';
	import { clearAuth, loadAuth, startAuthorization, ScalableAuth } from './auth';
	import { McpClient, McpError } from './mcp';
	import {
		getAccountProfile,
		listAccessiblePortfolios,
		ping,
		type ScPortfolio,
		type ScProfile
	} from './api';

	interface Props {
		value: ScalableConfig;
		onchange: (config: ScalableConfig) => void;
	}
	let { value, onchange }: Props = $props();

	let connected = $state(false);
	let checking = $state(false);
	let error = $state('');
	let profile = $state<ScProfile | null>(null);
	let portfolios = $state<ScPortfolio[]>([]);

	onMount(async () => {
		// Already authenticated on this device: verify the session and load the portfolios.
		if (await loadAuth()) await verify();
	});

	async function verify() {
		checking = true;
		error = '';
		try {
			const client = new McpClient({ tokenSource: new ScalableAuth() });
			await client.initialize();
			await ping(client);
			const [p, ps] = await Promise.all([
				getAccountProfile(client),
				listAccessiblePortfolios(client)
			]);
			profile = p;
			portfolios = ps.portfolios ?? [];
			connected = true;
			// With a single portfolio there is nothing to choose.
			if (portfolios.length === 1 && value.portfolioId !== portfolios[0].portfolioId) {
				onchange({ ...value, portfolioId: portfolios[0].portfolioId });
			}
		} catch (e) {
			connected = false;
			error = e instanceof McpError || e instanceof Error ? e.message : String(e);
		} finally {
			checking = false;
		}
	}

	/** Send the user to Scalable's login/consent page in the browser. */
	async function connect() {
		checking = true;
		error = '';
		try {
			const url = await startAuthorization();
			window.location.assign(url);
		} catch (e) {
			checking = false;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function disconnect() {
		await clearAuth();
		connected = false;
		profile = null;
		portfolios = [];
		error = '';
	}

	function selectPortfolio(id: string) {
		onchange({ ...value, portfolioId: id || undefined });
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-col gap-1">
		<span class="text-sm">
			Authentication
			<span class="opacity-50 text-xs">
				opens Scalable Capital in your browser to log in and approve access; the token is stored
				on this device only — never synced or exported
			</span>
		</span>
		<div class="flex gap-2 flex-wrap">
			{#if connected}
				<button class="btn btn-ghost btn-sm text-error" onclick={disconnect}>
					Disconnect
				</button>
				<button class="btn btn-sm" disabled={checking} onclick={verify}>
					{checking ? 'Checking…' : 'Re-check'}
				</button>
			{:else}
				<button class="btn btn-primary btn-sm" disabled={checking} onclick={connect}>
					{checking ? 'Opening Scalable…' : 'Connect with Scalable Capital'}
				</button>
			{/if}
		</div>
	</div>

	{#if connected && profile}
		<div class="alert alert-success py-2 text-sm">
			<span>
				Connected as {profile.profile?.displayName ??
					[profile.profile?.firstName, profile.profile?.lastName].filter(Boolean).join(' ') ??
					'the account holder'}
				({portfolios.length}
				{portfolios.length === 1 ? 'portfolio' : 'portfolios'}).
			</span>
		</div>
	{:else if checking}
		<div class="flex items-center gap-2 text-sm opacity-70">
			<span class="loading loading-spinner loading-sm"></span>
			<span>Verifying the connection with mcp.scalable.capital…</span>
		</div>
	{:else if error}
		<div class="alert alert-error py-2 text-sm">{error}</div>
	{/if}

	{#if portfolios.length > 1}
		<label class="form-control w-full">
			<span class="text-sm">Portfolio to read</span>
			<select
				class="select select-bordered select-sm w-full"
				value={value.portfolioId ?? ''}
				onchange={(e) => selectPortfolio(e.currentTarget.value)}
			>
				{#if !value.portfolioId}<option value="">Auto (first portfolio)</option>{/if}
				{#each portfolios as p (p.portfolioId)}
					<option value={p.portfolioId}>{p.displayName} ({p.portfolioId})</option>
				{/each}
			</select>
		</label>
	{/if}
</div>
