<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { loadImporterConfig, saveImporterConfig } from '#lib/importers/config';
	import type { EnableBankingConfig } from '#lib/importers/enablebanking/config';
	import { loadCredentials, type StoredCredentials } from '#lib/importers/enablebanking/auth';
	import {
		EnableBankingClient,
		type EbBalance,
		type EbTransaction
	} from '#lib/importers/enablebanking/api';
	import {
		recallTransactions,
		rememberTransactions,
		type TxRequest
	} from '#lib/importers/enablebanking/transactionCache';
	import {
		loadSessions,
		sessionStatus,
		type StoredSession
	} from '#lib/importers/enablebanking/sessions';
	import { syncSession } from '#lib/importers/enablebanking/connection';
	import {
		loadBalanceCache,
		saveBalanceCache,
		type BalanceCache
	} from '#lib/importers/enablebanking/balances';
	import { forEachLimited } from '#lib/importers/enablebanking/concurrency';
	import {
		accountIban,
		accountIdentity,
		accountKey,
		accountLabel,
		balanceLabel,
		displayBalance,
		isBooked,
		txAmount,
		txCurrency,
		txDate,
		txNarration,
		txPayee
	} from '#lib/importers/enablebanking/records';
	import { formatAmount } from '#lib/utils/formatter';
	import { formatDate } from '#lib/utils/dates';

	/** Parallel API calls; low, because banks limit request rates. */
	const CONCURRENCY = 3;

	interface TxRow {
		/** Local key: the bank's transaction identifiers are not unique. */
		key: number;
		tx: EbTransaction;
	}

	let credentials = $state<StoredCredentials | null>(null);
	let client: EnableBankingClient | null = null;
	let config = $state<EnableBankingConfig>({});
	let ready = $state(false);

	let sessions = $state<StoredSession[]>([]);
	let statusErrors = $state<Record<string, string>>({});
	let balances = $state<BalanceCache>({});
	let balanceErrors = $state<Record<string, string>>({});

	let selectedKey = $state<string | null>(null);
	let txRows = $state<TxRow[]>([]);
	let continuationKey = $state<string | null>(null);
	let txFetchedAt = $state<string | null>(null);
	let txsLoading = $state(false);
	let loadingMore = $state(false);
	let txError = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let search = $state('');
	let openTxKey = $state<number | null>(null);

	let loading = $state(false);
	let error = $state('');

	let nextTxKey = 0;
	/** Bumped by every new transaction load; older responses are discarded. */
	let txGeneration = 0;
	let activeRequest: TxRequest | null = null;

	const accounts = $derived(
		sessions.flatMap((session) =>
			session.accounts.map((account) => ({
				key: accountKey(session.sessionId, account.uid),
				session,
				account
			}))
		)
	);

	const filteredTxs = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return txRows;
		return txRows.filter(({ tx }) =>
			[txPayee(tx), txNarration(tx), tx.transaction_id ?? '', tx.entry_reference ?? '']
				.join(' ')
				.toLowerCase()
				.includes(q)
		);
	});

	function defaultRange() {
		const days = config.daysBack ?? 90;
		dateTo = formatDate(new Date());
		dateFrom = formatDate(new Date(Date.now() - days * 86_400_000));
	}

	onMount(async () => {
		try {
			credentials = await loadCredentials();
			if (!credentials) return; // The template below points at the Importers page.
			client = new EnableBankingClient({ credentials });
			config = (await loadImporterConfig<EnableBankingConfig>('enablebanking')) ?? {};
			defaultRange();
			// Show what is stored on the device right away.
			sessions = await loadSessions();
			balances = await loadBalanceCache();
		} catch (e) {
			error = errorMessage(e);
			return;
		} finally {
			ready = true;
		}
		await update(false);
	});

	function errorMessage(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}

	/**
	 * Bring the page up to date. Banks limit how often account data may be
	 * read, so a visit fetches only what is not stored yet; Refresh (`all`)
	 * fetches every status, balance and the transactions again.
	 */
	async function update(all: boolean) {
		if (!client) return;
		loading = true;
		error = '';
		try {
			ensureSelection();
			// Transactions do not wait for statuses and balances.
			const initialKey = selectedKey;
			const firstLoad = !all && restoreTransactions() ? undefined : loadTransactions();
			await syncStatuses(sessions.filter((s) => all || !s.status));
			ensureSelection();
			await Promise.all([
				firstLoad,
				selectedKey !== initialKey ? loadTransactions() : undefined,
				loadBalances(all)
			]);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}

	/** Keep the selection if it still exists, else restore the saved account. */
	function ensureSelection() {
		if (accounts.some((a) => a.key === selectedKey)) return;
		const saved = accounts.filter((a) => accountIdentity(a.account) === config.selectedAccount);
		// A bank connected twice: prefer the consent that has not expired.
		const usable = saved.find((a) => sessionStatus(a.session) !== 'EXPIRED');
		selectedKey = (usable ?? saved[0] ?? accounts[0])?.key ?? null;
	}

	async function syncStatuses(targets: StoredSession[]) {
		await forEachLimited(targets, CONCURRENCY, async ({ sessionId }) => {
			if (!client) return;
			try {
				sessions = await syncSession(client, sessionId);
				delete statusErrors[sessionId];
			} catch (e) {
				statusErrors[sessionId] = errorMessage(e);
			}
		});
	}

	async function loadBalances(all: boolean) {
		const targets = accounts.filter(
			(a) => sessionStatus(a.session) !== 'EXPIRED' && (all || !balances[a.key])
		);
		const fetched: BalanceCache = {};
		await forEachLimited(targets, CONCURRENCY, async ({ key, account, session }) => {
			if (!client) return;
			try {
				const response = await client.getBalances(account.uid, {
					psuHeaders: session.requiredPsuHeaders && [...session.requiredPsuHeaders]
				});
				fetched[key] = {
					balances: response.balances ?? [],
					fetchedAt: new Date().toISOString()
				};
				balances[key] = fetched[key];
				delete balanceErrors[key];
			} catch (e) {
				// One account failing must not hide the rest; its cached balance stays.
				balanceErrors[key] = errorMessage(e);
			}
		});
		if (Object.keys(fetched).length) {
			await saveBalanceCache({ ...(await loadBalanceCache()), ...fetched });
		}
	}

	async function selectAccount(key: string) {
		const row = accounts.find((a) => a.key === key);
		if (!row || key === selectedKey) return;
		selectedKey = key;
		config = { ...config, selectedAccount: accountIdentity(row.account) };
		await Promise.all([saveConfig(), loadTransactions()]);
	}

	async function saveConfig() {
		try {
			await saveImporterConfig('enablebanking', $state.snapshot(config));
		} catch (e) {
			error = errorMessage(e);
		}
	}

	function toRows(transactions: EbTransaction[] | undefined): TxRow[] {
		return (transactions ?? []).map((tx) => ({ key: nextTxKey++, tx }));
	}

	/** Show the kept transactions if they are the selected account's. */
	function restoreTransactions(): boolean {
		const cached = recallTransactions();
		if (
			!cached ||
			cached.request.accountKey !== selectedKey ||
			cached.request.daysBack !== config.daysBack
		) {
			return false;
		}
		dateFrom = cached.request.query.dateFrom ?? '';
		dateTo = cached.request.query.dateTo ?? '';
		txRows = toRows(cached.transactions);
		continuationKey = cached.continuationKey;
		txFetchedAt = cached.fetchedAt;
		activeRequest = cached.request;
		return true;
	}

	function keepTransactions(request: TxRequest, fetchedAt: string) {
		rememberTransactions({
			request,
			transactions: txRows.map(({ tx }) => $state.snapshot(tx)),
			continuationKey,
			fetchedAt
		});
	}

	async function loadTransactions() {
		const generation = ++txGeneration;
		txRows = [];
		continuationKey = null;
		txFetchedAt = null;
		openTxKey = null;
		txError = '';
		loadingMore = false;
		activeRequest = null;
		const row = accounts.find((a) => a.key === selectedKey);
		if (!client || !row) {
			txsLoading = false;
			return;
		}
		const request: TxRequest = {
			accountKey: row.key,
			daysBack: config.daysBack,
			uid: row.account.uid,
			query: { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
			psuHeaders: row.session.requiredPsuHeaders && [...row.session.requiredPsuHeaders]
		};
		activeRequest = request;
		txsLoading = true;
		try {
			const response = await client.getTransactions(request.uid, request.query, {
				psuHeaders: request.psuHeaders
			});
			if (generation !== txGeneration) return;
			txRows = toRows(response.transactions);
			continuationKey = response.continuation_key ?? null;
			txFetchedAt = new Date().toISOString();
			keepTransactions(request, txFetchedAt);
		} catch (e) {
			if (generation === txGeneration) txError = errorMessage(e);
		} finally {
			if (generation === txGeneration) txsLoading = false;
		}
	}

	async function loadMore() {
		const request = activeRequest;
		if (!client || !request || !continuationKey || loadingMore) return;
		const generation = txGeneration;
		loadingMore = true;
		txError = '';
		try {
			const response = await client.getTransactions(
				request.uid,
				{ ...request.query, continuationKey },
				{ psuHeaders: request.psuHeaders }
			);
			if (generation !== txGeneration) return;
			txRows = [...txRows, ...toRows(response.transactions)];
			continuationKey = response.continuation_key ?? null;
			if (txFetchedAt) keepTransactions(request, txFetchedAt);
		} catch (e) {
			if (generation === txGeneration) txError = errorMessage(e);
		} finally {
			if (generation === txGeneration) loadingMore = false;
		}
	}

	async function applyDaysBack(days: number) {
		config = { ...config, daysBack: Math.max(1, Math.floor(days)) };
		defaultRange();
		await Promise.all([saveConfig(), loadTransactions()]);
	}

	function fmtBalance(b: EbBalance | null): string {
		if (!b?.balance_amount) return '';
		const n = parseFloat(b.balance_amount.amount ?? '');
		if (!Number.isFinite(n)) return '';
		return `${formatAmount(n)} ${b.balance_amount.currency ?? ''}`.trim();
	}

	function fmtTime(iso: string): string {
		return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Enable Banking">
		{#snippet actions()}
			{#if credentials}
				<button
					type="button"
					class="btn btn-ghost btn-circle hover-transparent h-12 w-12"
					title="Refresh statuses, balances and transactions"
					disabled={loading}
					onclick={() => update(true)}
				>
					<RefreshCwIcon size={22} class={loading ? 'animate-spin' : ''} />
				</button>
			{/if}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if !ready}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if !credentials}
			{#if error}<div class="alert alert-error text-sm">{error}</div>{/if}
			<div class="card bg-base-200">
				<div class="card-body p-4 gap-3">
					<p class="text-sm">
						Not connected to Enable Banking on this device yet. Open the importer's card on the
						Importers page, paste the application ID and private key from the Enable Banking Control
						Panel, and connect a bank.
					</p>
					<a class="btn btn-primary btn-sm self-start" href="/importers">Go to Importers</a>
				</div>
			</div>
		{:else if error && !sessions.length}
			<div class="alert alert-error text-sm">{error}</div>
			<a class="btn btn-sm self-start" href="/importers">Reconfigure</a>
		{:else}
			{#if error}<div class="alert alert-warning py-2 text-sm">{error}</div>{/if}

			{#if sessions.length}
				<div class="flex flex-col gap-2">
					{#each sessions as session (session.sessionId)}
						{@const status = sessionStatus(session)}
						<div class="flex items-center gap-2 flex-wrap text-sm">
							<span class="font-medium">{session.aspsp.name} ({session.aspsp.country})</span>
							{#if status}
								<span
									class="badge badge-sm {status === 'AUTHORIZED'
										? 'badge-success'
										: 'badge-warning'}"
								>
									{status}
								</span>
							{/if}
							<span class="text-xs opacity-60">
								{session.accounts.length}
								{session.accounts.length === 1 ? 'account' : 'accounts'}
								{#if session.validUntil}
									· consent until {new Date(session.validUntil).toLocaleDateString('en-GB')}
								{/if}
							</span>
							{#if statusErrors[session.sessionId]}
								<span class="text-xs text-warning w-full">{statusErrors[session.sessionId]}</span>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-3">
						<p class="text-sm">
							No bank connected on this device yet — connect one from the Importers page.
						</p>
						<a class="btn btn-primary btn-sm self-start" href="/importers">Go to Importers</a>
					</div>
				</div>
			{/if}

			{#if accounts.length}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-2">
						<span class="font-medium">Accounts ({accounts.length})</span>
						<div class="overflow-x-auto">
							<table class="table table-sm">
								<thead>
									<tr>
										<th></th>
										<th>Account</th>
										<th>IBAN</th>
										<th>Bank</th>
										<th class="text-right">Balance</th>
									</tr>
								</thead>
								<tbody>
									{#each accounts as row (row.key)}
										{@const cached = balances[row.key]}
										{@const balance = displayBalance(cached?.balances)}
										<tr
											class="cursor-pointer hover:bg-base-300"
											class:bg-base-300={selectedKey === row.key}
											onclick={() => selectAccount(row.key)}
										>
											<td>
												<!-- No handler of its own: its clicks reach the row. -->
												<input
													type="radio"
													name="eb-account"
													class="radio radio-xs"
													aria-label={accountLabel(row.account)}
													checked={selectedKey === row.key}
												/>
											</td>
											<td class="max-w-56 truncate" title={accountLabel(row.account)}>
												{accountLabel(row.account)}
											</td>
											<td class="font-mono text-xs">{accountIban(row.account)}</td>
											<td class="text-xs opacity-70">{row.session.aspsp.name}</td>
											<td class="text-right whitespace-nowrap">
												{fmtBalance(balance)}
												{#if balance?.balance_type}
													<span class="text-xs opacity-50">
														{balanceLabel(balance.balance_type)}
													</span>
												{/if}
												{#if cached}
													<div class="text-xs opacity-40">updated {fmtTime(cached.fetchedAt)}</div>
												{/if}
												{#if balanceErrors[row.key]}
													<div class="text-xs text-warning" title={balanceErrors[row.key]}>
														balance not updated
													</div>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			{/if}

			{#if selectedKey}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">Transactions</span>
							<span class="text-xs opacity-60">{filteredTxs.length} of {txRows.length} loaded</span>
							{#if txFetchedAt}
								<span class="text-xs opacity-40">updated {fmtTime(txFetchedAt)}</span>
							{/if}
							<span class="flex-1"></span>
							<label class="flex items-center gap-1 text-xs opacity-70">
								from
								<input
									type="date"
									class="input input-bordered input-xs"
									bind:value={dateFrom}
									onchange={loadTransactions}
								/>
							</label>
							<label class="flex items-center gap-1 text-xs opacity-70">
								to
								<input
									type="date"
									class="input input-bordered input-xs"
									bind:value={dateTo}
									onchange={loadTransactions}
								/>
							</label>
							<label class="flex items-center gap-1 text-xs opacity-70">
								days
								<input
									type="number"
									class="input input-bordered input-xs w-20"
									min="1"
									value={config.daysBack ?? 90}
									onchange={(e) => applyDaysBack(Number(e.currentTarget.value) || 90)}
								/>
							</label>
							<input
								class="input input-bordered input-xs w-40"
								placeholder="Search…"
								spellcheck="false"
								bind:value={search}
							/>
						</div>
						<div class="flex flex-col">
							{#each filteredTxs as { key, tx } (key)}
								{@const amount = txAmount(tx)}
								<div>
									<button
										class="flex w-full items-center gap-2 py-2 text-left hover:bg-base-300 rounded px-1"
										onclick={() => (openTxKey = openTxKey === key ? null : key)}
									>
										<span class="text-xs opacity-60 w-24 shrink-0">{txDate(tx)}</span>
										<span class="flex-1 min-w-0 truncate text-sm">
											{txPayee(tx)}
											{#if txNarration(tx)}
												<span class="opacity-50 text-xs"> · {txNarration(tx)}</span>
											{/if}
										</span>
										{#if tx.status && !isBooked(tx)}
											<span class="badge badge-sm badge-outline">{tx.status}</span>
										{/if}
										<span
											class="text-sm shrink-0 {amount !== null && amount < 0
												? 'text-error'
												: 'text-success'}"
										>
											{amount === null
												? ''
												: `${amount >= 0 ? '+' : ''}${formatAmount(amount)} ${txCurrency(tx)}`}
										</span>
									</button>
									{#if openTxKey === key}
										<pre
											class="text-xs overflow-x-auto bg-base-300 rounded p-2 max-h-72 overflow-y-auto">{JSON.stringify(
												tx,
												null,
												2
											)}</pre>
									{/if}
								</div>
							{/each}
							{#if txsLoading}
								<div class="flex items-center gap-2 text-sm opacity-70 py-2">
									<span class="loading loading-spinner loading-sm"></span>
									<span>Loading transactions…</span>
								</div>
							{:else if !filteredTxs.length && !txError}
								<p class="text-sm opacity-60 py-2">
									{continuationKey
										? 'Nothing to show yet — load more.'
										: 'No transactions in this range.'}
								</p>
							{/if}
						</div>
						{#if txError}
							<div class="alert alert-warning py-2 text-sm">{txError}</div>
						{/if}
						{#if continuationKey}
							<button class="btn btn-sm self-start" disabled={loadingMore} onclick={loadMore}>
								{loadingMore ? 'Loading…' : 'Load more'}
							</button>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</main>
