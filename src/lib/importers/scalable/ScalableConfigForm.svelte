<script lang="ts">
	import { onMount } from 'svelte';
	import type { ScalableConfig } from './config';
	import { clearAuth, loadAuth, savePastedTokens, ScalableAuth } from './auth';
	import { McpClient, McpError } from './mcp';
	import { SCALABLE_TOKEN_SCRIPT, SCALABLE_TOKEN_SCRIPT_NAME } from './tokenScript';
	import {
		getAccountProfile,
		listAccessiblePortfolios,
		ping,
		type ScPortfolio,
		type ScProfile
	} from './api';
	import Notifier from '#lib/utils/notifier';

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
	let tokenJson = $state('');
	let expiresAt = $state<number | null>(null);
	let showScript = $state(false);
	let scriptArea = $state<HTMLTextAreaElement>();

	onMount(async () => {
		// Tokens already pasted on this device: verify the session and load the portfolios.
		const auth = await loadAuth();
		if (auth) {
			expiresAt = auth.expiresAt;
			await verify();
		}
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

	/** Save the JSON printed by the token script, then verify the connection. */
	async function saveTokens() {
		checking = true;
		error = '';
		try {
			const auth = await savePastedTokens(tokenJson);
			expiresAt = auth.expiresAt;
			tokenJson = '';
			await verify();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			checking = false;
		}
	}

	async function disconnect() {
		await clearAuth();
		connected = false;
		profile = null;
		portfolios = [];
		expiresAt = null;
		error = '';
	}

	async function copyScript() {
		try {
			await navigator.clipboard.writeText(SCALABLE_TOKEN_SCRIPT);
			Notifier.success(`Copied — save it as ${SCALABLE_TOKEN_SCRIPT_NAME} on your computer`);
		} catch {
			// Clipboard API unavailable (e.g. insecure context): select the code for Ctrl+C.
			scriptArea?.focus();
			scriptArea?.select();
			Notifier.info('Clipboard blocked — the script is selected, press Ctrl+C');
		}
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
				a PWA cannot complete Scalable's OAuth login by itself — run the Python script on your
				computer (localhost) and paste the JSON it prints below; tokens are stored on this device
				only. They are never synced, and a backup holds them only encrypted
			</span>
		</span>
		{#if !connected}
			<div class="flex flex-col gap-2">
				<div class="flex gap-2 flex-wrap items-center">
					<button class="btn btn-outline btn-sm" onclick={() => (showScript = !showScript)}>
						{showScript ? 'Hide' : 'Show'} the Python script
					</button>
					{#if showScript}
						<button class="btn btn-primary btn-sm" onclick={copyScript}>Copy script</button>
					{/if}
				</div>
				{#if showScript}
					<textarea
						class="textarea textarea-bordered w-full font-mono text-xs h-48"
						readonly
						bind:this={scriptArea}
						value={SCALABLE_TOKEN_SCRIPT}></textarea>
					<p class="text-xs opacity-70">
						Save it as <code class="font-mono">{SCALABLE_TOKEN_SCRIPT_NAME}</code> and run it on
						your computer: <code class="font-mono">python3 {SCALABLE_TOKEN_SCRIPT_NAME}</code> (or
						<code class="font-mono">uv run {SCALABLE_TOKEN_SCRIPT_NAME}</code>). It opens Scalable's
						login in your browser and prints the tokens as JSON.
					</p>
				{/if}
				<textarea
					class="textarea textarea-bordered w-full font-mono text-xs h-28"
					placeholder={'{\n  "client_id": "…",\n  "access_token": "…",\n  "refresh_token": "…",\n  "expires_in": 3600\n}'}
					spellcheck="false"
					bind:value={tokenJson}></textarea>
				<div class="flex gap-2 flex-wrap">
					<button
						class="btn btn-primary btn-sm"
						disabled={checking || !tokenJson.trim()}
						onclick={saveTokens}
					>
						{checking ? 'Saving…' : 'Save tokens'}
					</button>
				</div>
			</div>
		{:else}
			<div class="flex gap-2 flex-wrap">
				<button class="btn btn-ghost btn-sm text-error" onclick={disconnect}> Disconnect </button>
				<button class="btn btn-sm" disabled={checking} onclick={verify}>
					{checking ? 'Checking…' : 'Re-check'}
				</button>
			</div>
		{/if}
	</div>

	{#if connected && profile}
		<div class="alert alert-success py-2 text-sm">
			<span>
				Connected as {profile.profile?.displayName ??
					[profile.profile?.firstName, profile.profile?.lastName].filter(Boolean).join(' ') ??
					'the account holder'}
				({portfolios.length}
				{portfolios.length === 1 ? 'portfolio' : 'portfolios'}).
				{#if expiresAt}
					Access token expires {new Date(expiresAt).toLocaleString('en-GB')} — refreshed automatically
					while the refresh token is valid.
				{/if}
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
