<script lang="ts">
	import { onMount } from 'svelte';
	import type { EnableBankingConfig } from './config';
	import {
		loadCredentials,
		saveCredentialsInput,
		EbAuthError,
		type StoredCredentials
	} from './auth';
	import { loadSessions, savePendingAuth, sessionStatus, type StoredSession } from './sessions';
	import {
		describeFailures,
		disconnectEnableBanking,
		forgetSession,
		revokeSession,
		syncSession
	} from './connection';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import {
		EnableBankingClient,
		EbError,
		ebCallbackUrl,
		type EbApplication,
		type EbAspsp
	} from './api';
	import Notifier from '#lib/utils/notifier';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';

	interface Props {
		value: EnableBankingConfig;
		onchange: (config: EnableBankingConfig) => void;
	}
	let { value, onchange }: Props = $props();

	let credentials = $state<StoredCredentials | null>(null);
	let app = $state<EbApplication | null>(null);
	let checking = $state(false);
	let error = $state('');

	let appId = $state('');
	let privateKeyPem = $state('');
	let callbackUrl = $state('');

	let sessions = $state<StoredSession[]>([]);
	/** The error of the last status check, per session. */
	let checkErrors = $state<Record<string, string>>({});
	let removingSession = $state<string | null>(null);
	/** Sessions whose revocation failed; these may be forgotten locally. */
	let revokeFailed = $state<Record<string, boolean>>({});
	let confirmDisconnect = $state(false);
	/** Bumped by every bank list load; older responses are discarded. */
	let aspspGeneration = 0;

	let aspsps = $state<EbAspsp[]>([]);
	let loadingAspsps = $state(false);
	let country = $state('');
	let aspspLabel = $state('');
	let validityDays = $state(90);
	let connecting = $state(false);

	const aspspLabelOf = (a: EbAspsp) => `${a.name} (${a.country})`;
	const countries = $derived(
		[...new Set(aspsps.map((a) => a.country))].sort((a, b) => a.localeCompare(b))
	);
	const visibleAspsps = $derived(country ? aspsps.filter((a) => a.country === country) : aspsps);
	const aspspOptions = $derived(visibleAspsps.map(aspspLabelOf));
	const selectedAspsp = $derived(visibleAspsps.find((a) => aspspLabelOf(a) === aspspLabel));
	const maxValidityDays = $derived(
		selectedAspsp?.maximum_consent_validity
			? Math.floor(selectedAspsp.maximum_consent_validity / 86_400)
			: null
	);

	function client(): EnableBankingClient {
		if (!credentials) throw new EbAuthError('Save the application credentials first');
		return new EnableBankingClient({ credentials });
	}

	onMount(async () => {
		callbackUrl = ebCallbackUrl(window.location.origin);
		credentials = await loadCredentials();
		sessions = await loadSessions();
		if (credentials) {
			appId = credentials.appId;
			await verify();
			if (app) await loadAspsps();
		}
	});

	/** GET /application — proves the credentials (ID + key) are accepted. */
	async function verify() {
		if (!credentials) return;
		checking = true;
		error = '';
		try {
			app = await client().getApplication();
		} catch (e) {
			app = null;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			checking = false;
		}
	}

	async function saveCredentials() {
		checking = true;
		error = '';
		try {
			credentials = await saveCredentialsInput(appId, privateKeyPem);
			privateKeyPem = '';
			await verify();
			if (app) await loadAspsps();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			checking = false;
		}
	}

	async function disconnect() {
		checking = true;
		error = '';
		try {
			const failures = await disconnectEnableBanking(client());
			sessions = await loadSessions();
			if (failures.length) {
				for (const { session } of failures) revokeFailed[session.sessionId] = true;
				error = describeFailures(failures);
				return;
			}
			credentials = null;
			app = null;
			aspsps = [];
			appId = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			checking = false;
		}
	}

	async function loadAspsps(psuType: 'personal' | 'business' = value.psuType ?? 'personal') {
		const generation = ++aspspGeneration;
		loadingAspsps = true;
		error = '';
		try {
			const response = await client().listAspsps({ psuType });
			if (generation === aspspGeneration) aspsps = response.aspsps ?? [];
		} catch (e) {
			if (generation === aspspGeneration) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (generation === aspspGeneration) loadingAspsps = false;
		}
	}

	async function connect() {
		const aspsp = selectedAspsp;
		if (!aspsp || !credentials) return;
		connecting = true;
		error = '';
		try {
			const days = maxValidityDays ? Math.min(validityDays, maxValidityDays) : validityDays;
			const validUntil = new Date(Date.now() + days * 86_400_000).toISOString();
			const state = crypto.randomUUID();
			const response = await client().startAuthorization({
				access: { balances: true, transactions: true, valid_until: validUntil },
				aspsp: { name: aspsp.name, country: aspsp.country },
				state,
				redirect_url: callbackUrl,
				psu_type: value.psuType ?? 'personal'
			});
			// The browser leaves for the bank/Enable Banking page; the callback
			// route picks up the stored pending authorization.
			await savePendingAuth({
				state,
				aspsp: { name: aspsp.name, country: aspsp.country },
				validUntil,
				requiredPsuHeaders: aspsp.required_psu_headers && [...aspsp.required_psu_headers],
				createdAt: new Date().toISOString()
			});
			window.location.href = response.url;
		} catch (e) {
			connecting = false;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function checkSession(session: StoredSession) {
		error = '';
		try {
			sessions = await syncSession(client(), session.sessionId);
			delete checkErrors[session.sessionId];
		} catch (e) {
			checkErrors[session.sessionId] =
				e instanceof EbError && e.code ? e.code : e instanceof Error ? e.message : String(e);
		}
	}

	async function remove(session: StoredSession) {
		removingSession = session.sessionId;
		error = '';
		try {
			sessions = await revokeSession(client(), session.sessionId);
		} catch (e) {
			revokeFailed[session.sessionId] = true;
			error = `Could not revoke the consent, so the session was kept: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			removingSession = null;
		}
	}

	async function forget(session: StoredSession) {
		error = '';
		try {
			sessions = await forgetSession(session.sessionId);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function copyCallbackUrl() {
		try {
			await navigator.clipboard.writeText(callbackUrl);
			Notifier.success('Copied — whitelist this exact URL in the Enable Banking Control Panel');
		} catch {
			Notifier.info('Clipboard blocked — select the URL and press Ctrl+C');
		}
	}

	function setPsuType(psuType: 'personal' | 'business') {
		onchange({ ...value, psuType });
		// The bank list depends on the user type.
		aspsps = [];
		aspspLabel = '';
		country = '';
		if (credentials) loadAspsps(psuType);
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-2">
		<span class="text-sm">
			Application credentials
			<span class="opacity-50 text-xs">
				from Enable Banking Control Panel → API applications (sandbox or production — the app ID
				decides). The private key signs every API request in this browser and is stored on this
				device. It is never synced, and a backup holds it only encrypted. Enable Banking advises
				keeping keys out of client apps; for your own app on your own device this is the same trust
				level as the other credentials stored here.
			</span>
		</span>
		{#if !credentials}
			<input
				class="input input-bordered input-sm w-full font-mono text-xs"
				placeholder="Application ID (UUID), e.g. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
				spellcheck="false"
				bind:value={appId}
			/>
			<textarea
				class="textarea textarea-bordered w-full font-mono text-xs h-28"
				placeholder="-----BEGIN PRIVATE KEY-----
…
-----END PRIVATE KEY-----"
				spellcheck="false"
				bind:value={privateKeyPem}></textarea>
			<div class="flex gap-2 flex-wrap">
				<button
					class="btn btn-primary btn-sm"
					disabled={checking || !appId.trim() || !privateKeyPem.trim()}
					onclick={saveCredentials}
				>
					{checking ? 'Saving…' : 'Save credentials'}
				</button>
			</div>
		{:else}
			<div class="flex gap-2 flex-wrap items-center">
				<span class="font-mono text-xs opacity-70">{credentials.appId}</span>
				<button class="btn btn-sm" disabled={checking} onclick={verify}>
					{checking ? 'Checking…' : 'Re-check'}
				</button>
				<button
					class="btn btn-ghost btn-sm text-error"
					disabled={checking}
					onclick={() => (confirmDisconnect = true)}
				>
					Disconnect
				</button>
			</div>
		{/if}
	</div>

	{#if app}
		<div class="alert alert-success py-2 text-sm">
			<span>
				Connected to Enable Banking as “{app.name ?? app.id ?? 'the app'}” ({app.environment ??
					'unknown environment'}).
			</span>
		</div>
	{:else if checking}
		<div class="flex items-center gap-2 text-sm opacity-70">
			<span class="loading loading-spinner loading-sm"></span>
			<span>Verifying the credentials against api.enablebanking.com…</span>
		</div>
	{/if}
	{#if error && !checking}<div class="alert alert-error py-2 text-sm">{error}</div>{/if}

	<div class="flex flex-col gap-1">
		<span class="text-sm">Redirect URL</span>
		<div class="flex gap-2 items-center">
			<code class="font-mono text-xs opacity-80 break-all">{callbackUrl}</code>
			<button class="btn btn-outline btn-xs shrink-0" onclick={copyCallbackUrl}>Copy</button>
		</div>
		<span class="text-xs opacity-50">
			Whitelist this exact URL for the app in the Enable Banking Control Panel — the consent
			redirect must match it.
		</span>
	</div>

	{#if credentials}
		<div class="flex flex-col gap-2">
			<span class="text-sm">Connect a bank</span>
			<div class="flex gap-2 flex-wrap items-end">
				<label class="form-control">
					<span class="text-xs opacity-70">User type</span>
					<select
						class="select select-bordered select-sm"
						value={value.psuType ?? 'personal'}
						onchange={(e) => setPsuType(e.currentTarget.value as 'personal' | 'business')}
					>
						<option value="personal">Personal</option>
						<option value="business">Business</option>
					</select>
				</label>
				<label class="form-control">
					<span class="text-xs opacity-70">Country</span>
					<select
						class="select select-bordered select-sm"
						bind:value={country}
						onchange={() => (aspspLabel = '')}
					>
						<option value="">All</option>
						{#each countries as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>
				<label class="form-control w-64 max-w-full">
					<span class="text-xs opacity-70">Bank (ASPSP)</span>
					<SearchableSelect
						options={aspspOptions}
						bind:value={aspspLabel}
						placeholder="Select a bank..."
					/>
				</label>
				<label class="form-control">
					<span class="text-xs opacity-70">
						Consent days{#if maxValidityDays !== null}
							(max {maxValidityDays}){/if}
					</span>
					<input
						type="number"
						class="input input-bordered input-sm w-24"
						min="1"
						max={maxValidityDays ?? undefined}
						bind:value={validityDays}
					/>
				</label>
			</div>
			{#if loadingAspsps}
				<div class="flex items-center gap-2 text-sm opacity-70">
					<span class="loading loading-spinner loading-sm"></span>
					<span>Loading the bank list…</span>
				</div>
			{:else if !aspsps.length}
				<button class="btn btn-outline btn-sm self-start" onclick={() => loadAspsps()}>
					Load bank list
				</button>
			{/if}
			<div class="flex gap-2 flex-wrap">
				<button
					class="btn btn-primary btn-sm"
					disabled={connecting || !selectedAspsp}
					onclick={connect}
				>
					{connecting ? 'Starting…' : `Connect ${selectedAspsp?.name ?? 'bank'}`}
				</button>
			</div>
			<span class="text-xs opacity-50">
				You will be redirected to Enable Banking and your bank to grant access; afterwards you
				return here automatically.
			</span>
		</div>

		{#if sessions.length}
			<div class="flex flex-col gap-2">
				<span class="text-sm">Connected banks ({sessions.length})</span>
				{#each sessions as session (session.sessionId)}
					<div class="card bg-base-100 border border-base-300">
						<div class="card-body p-3 gap-1">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-medium text-sm">
									{session.aspsp.name} ({session.aspsp.country})
								</span>
								<span class="badge badge-sm badge-outline">
									{session.accounts.length}
									{session.accounts.length === 1 ? 'account' : 'accounts'}
								</span>
								{#if checkErrors[session.sessionId] ?? sessionStatus(session)}
									<span class="badge badge-sm badge-outline">
										{checkErrors[session.sessionId] ?? sessionStatus(session)}
									</span>
								{/if}
								<span class="flex-1"></span>
								<button class="btn btn-ghost btn-xs" onclick={() => checkSession(session)}>
									Check status
								</button>
								<button
									class="btn btn-ghost btn-xs text-error"
									disabled={removingSession === session.sessionId}
									onclick={() => remove(session)}
								>
									Remove
								</button>
								{#if revokeFailed[session.sessionId]}
									<button
										class="btn btn-ghost btn-xs"
										title="Delete from this device without revoking the consent"
										onclick={() => forget(session)}
									>
										Forget locally
									</button>
								{/if}
							</div>
							<span class="text-xs opacity-60">
								connected {new Date(session.createdAt).toLocaleDateString('en-GB')}
								{#if session.validUntil}
									· consent until {new Date(session.validUntil).toLocaleDateString('en-GB')}
								{/if}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmDisconnect}
	title="Disconnect Enable Banking"
	message="Revoke all connected bank consents and delete the application credentials from this device?"
	onconfirm={disconnect}
/>
