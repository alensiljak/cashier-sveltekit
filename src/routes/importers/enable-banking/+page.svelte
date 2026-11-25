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
		type EbSessionAccount,
		type EbTransaction
	} from '#lib/importers/enablebanking/api';
	import { addSession, loadSessions, type StoredSession } from '#lib/importers/enablebanking/sessions';
	import { formatAmount } from '#lib/utils/formatter';
	import { formatDate } from '#lib/utils/dates';

	let credentials = $state<StoredCredentials | null>(null);
	let client: EnableBankingClient | null = null;
	let config = $state<EnableBankingConfig>({});

	let sessions = $state<StoredSession[]>([]);
	let sessionStatus = $state<Record<string, string>>({});
	let balances = $state<Record<string, EbBalance[]>>({});

	let selectedUid = $state<string | null>(null);
	let transactions = $state<EbTransaction[]>([]);
	let continuationKey = $state<string | null>(null);
	let txsLoading = $state(false);
	let loadingMore = $state(false);
	let dateFrom = $state('');
	let dateTo = $state('');
	let search = $state('');
	let openTxKey = $state<string | null>(null);

	let loading = $state(false);
	let error = $state('');

	interface AccountRow {
		uid: string;
		session: StoredSession;
		account: EbSessionAccount;
	}

	const accounts = $derived(
		sessions.flatMap((session) =>
			(session.accounts ?? []).map((account) => ({ uid: account.uid, session, account }))
		)
	);

	const filteredTxs = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return transactions;
		return transactions.filter((t) =>
			[txPayee(t), txNarration(t), t.transaction_id ?? '', t.entry_reference ?? '']
				.join(' ')
				.toLowerCase()
				.includes(q)
		);
	});

	function toDateInput(d: Date): string {
		return formatDate(d);
	}

	function defaultRange() {
		const days = config.daysBack ?? 90;
		dateTo = toDateInput(new Date());
		dateFrom = toDateInput(new Date(Date.now() - days * 86_400_000));
	}

	onMount(async () => {
		credentials = await loadCredentials();
		if (!credentials) return; // The template below points at the Importers page.
		client = new EnableBankingClient({ credentials });
		config = (await loadImporterConfig<EnableBankingConfig>('enablebanking')) ?? {};
		defaultRange();
		await refresh();
	});

	async function refresh() {
		if (!client) return;
		loading = true;
		error = '';
		try {
			sessions = await loadSessions();
			// Live status per session; also picks up the account list when the API returns it.
			for (const session of sessions) {
				try {
					const live = await client.getSession(session.sessionId);
					sessionStatus[session.sessionId] = live.status ?? 'unknown';
					if (live.accounts) {
						sessions = await addSession({ ...session, accounts: live.accounts });
					}
				} catch (e) {
					sessionStatus[session.sessionId] =
						e instanceof Error ? e.message : String(e);
				}
			}
			await loadBalances();
			const wanted = config.accounts?.[0];
			selectedUid = wanted && accounts.some((a) => a.uid === wanted) ? wanted : (accounts[0]?.uid ?? null);
			await loadTransactions();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function loadBalances() {
		if (!client) return;
		for (const { uid } of accounts) {
			try {
				const response = await client.getBalances(uid);
				balances[uid] = response.balances ?? [];
			} catch {
				// A single account failing (e.g. consent revoked) must not hide the rest.
				balances[uid] = [];
			}
		}
	}

	async function selectAccount(uid: string) {
		selectedUid = uid;
		config = { ...config, accounts: [uid] };
		await saveImporterConfig('enablebanking', config);
		await loadTransactions();
	}

	async function loadTransactions() {
		if (!client || !selectedUid) {
			transactions = [];
			continuationKey = null;
			return;
		}
		txsLoading = true;
		error = '';
		try {
			const response = await client.getTransactions(selectedUid, {
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined
			});
			transactions = response.transactions ?? [];
			continuationKey = response.continuation_key ?? null;
			openTxKey = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			txsLoading = false;
		}
	}

	async function loadMore() {
		if (!client || !selectedUid || !continuationKey) return;
		loadingMore = true;
		try {
			const response = await client.getTransactions(selectedUid, {
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				continuationKey
			});
			transactions = [...transactions, ...(response.transactions ?? [])];
			continuationKey = response.continuation_key ?? null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingMore = false;
		}
	}

	async function applyDaysBack(days: number) {
		config = { ...config, daysBack: days };
		await saveImporterConfig('enablebanking', config);
		defaultRange();
		await loadTransactions();
	}

	function accountIban(account: EbSessionAccount): string {
		return (
			account.account_id?.iban ??
			account.account_id?.other?.identification ??
			''
		);
	}

	function accountLabel(row: AccountRow): string {
		return row.account.name || row.account.details || accountIban(row.account) || row.uid;
	}

	/** The balance to display: closing booked, else interim booked/available, else the first. */
	function displayBalance(uid: string): EbBalance | null {
		const list = balances[uid] ?? [];
		if (!list.length) return null;
		const rank = ['closingBooked', 'interimBooked', 'interimAvailable', 'expected', 'authorised'];
		return list.find((b) => b.balance_type && rank.includes(b.balance_type)) ?? list[0];
	}

	function txAmount(t: EbTransaction): number | null {
		const raw = t.transaction_amount?.amount ?? t.amount;
		if (raw === undefined || raw === null) return null;
		const n = parseFloat(raw);
		if (!Number.isFinite(n)) return null;
		return t.credit_debit_indicator === 'DBIT' ? -n : n;
	}

	function txCurrency(t: EbTransaction): string {
		return t.transaction_amount?.currency ?? t.currency ?? '';
	}

	function txPayee(t: EbTransaction): string {
		return t.creditor?.name ?? t.debtor?.name ?? '';
	}

	function txNarration(t: EbTransaction): string {
		const info = t.remittance_information;
		if (Array.isArray(info)) return info.join(' ');
		return info ?? '';
	}

	function txDate(t: EbTransaction): string {
		return t.booking_date ?? t.value_date ?? t.transaction_date ?? '';
	}

	function txKey(t: EbTransaction, index: number): string {
		return t.transaction_id ?? t.entry_reference ?? String(index);
	}

	function fmtBalance(b: EbBalance | null): string {
		if (!b?.balance_amount) return '';
		const n = parseFloat(b.balance_amount.amount ?? '');
		if (!Number.isFinite(n)) return '';
		return `${formatAmount(n)} ${b.balance_amount.currency ?? ''}`.trim();
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Enable Banking">
		{#snippet actions()}
			{#if credentials}
				<button
					type="button"
					class="btn btn-ghost btn-circle hover-transparent h-12 w-12"
					title="Refresh"
					disabled={loading}
					onclick={refresh}
				>
					<RefreshCwIcon size={22} class={loading ? 'animate-spin' : ''} />
				</button>
			{/if}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if !credentials}
			<div class="card bg-base-200">
				<div class="card-body p-4 gap-3">
					<p class="text-sm">
						Not connected to Enable Banking on this device yet. Open the importer's card on the
						Importers page, paste the application ID and private key from the Enable Banking
						Control Panel, and connect a bank.
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
						<div class="flex items-center gap-2 flex-wrap text-sm">
							<span class="font-medium">{session.aspsp.name} ({session.aspsp.country})</span>
							{#if sessionStatus[session.sessionId]}
								<span
									class="badge badge-sm {sessionStatus[session.sessionId] === 'AUTHORIZED'
										? 'badge-success'
										: 'badge-warning'}"
								>
									{sessionStatus[session.sessionId]}
								</span>
							{/if}
							<span class="text-xs opacity-60">
								{session.accounts.length}
								{session.accounts.length === 1 ? 'account' : 'accounts'}
								{#if session.validUntil}
									· consent until {new Date(session.validUntil).toLocaleDateString('en-GB')}
								{/if}
							</span>
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
									{#each accounts as row (row.uid)}
										{@const balance = displayBalance(row.uid)}
										<tr
											class="cursor-pointer hover:bg-base-300"
											class:bg-base-300={selectedUid === row.uid}
											onclick={() => selectAccount(row.uid)}
										>
											<td>
												<input
													type="radio"
													class="radio radio-xs"
													checked={selectedUid === row.uid}
													onchange={() => selectAccount(row.uid)}
												/>
											</td>
											<td class="max-w-56 truncate" title={accountLabel(row)}>{accountLabel(row)}</td>
											<td class="font-mono text-xs">{accountIban(row.account)}</td>
											<td class="text-xs opacity-70">{row.session.aspsp.name}</td>
											<td class="text-right whitespace-nowrap">
												{fmtBalance(balance)}
												{#if balance?.balance_type}
													<span class="text-xs opacity-50"> {balance.balance_type}</span>
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

			{#if selectedUid}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">Transactions</span>
							<span class="text-xs opacity-60">{filteredTxs.length} of {transactions.length} loaded</span>
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
							{#each filteredTxs as t, i (txKey(t, i))}
								{@const amount = txAmount(t)}
								{@const key = txKey(t, i)}
								<div>
									<button
										class="flex w-full items-center gap-2 py-2 text-left hover:bg-base-300 rounded px-1"
										onclick={() => (openTxKey = openTxKey === key ? null : key)}
									>
										<span class="text-xs opacity-60 w-24 shrink-0">{txDate(t)}</span>
										<span class="flex-1 min-w-0 truncate text-sm">
											{txPayee(t)}
											{#if txNarration(t)}
												<span class="opacity-50 text-xs"> · {txNarration(t)}</span>
											{/if}
										</span>
										{#if t.status && t.status !== 'BOOKED' && t.status !== 'BOOK'}
											<span class="badge badge-sm badge-outline">{t.status}</span>
										{/if}
										<span class="text-sm shrink-0 {amount !== null && amount < 0 ? 'text-error' : 'text-success'}">
											{amount === null ? '' : `${amount >= 0 ? '+' : ''}${formatAmount(amount)} ${txCurrency(t)}`}
										</span>
									</button>
									{#if openTxKey === key}
										<pre class="text-xs overflow-x-auto bg-base-300 rounded p-2 max-h-72 overflow-y-auto">{JSON.stringify(t, null, 2)}</pre>
									{/if}
								</div>
							{/each}
							{#if txsLoading}
								<div class="flex items-center gap-2 text-sm opacity-70 py-2">
									<span class="loading loading-spinner loading-sm"></span>
									<span>Loading transactions…</span>
								</div>
							{:else if !filteredTxs.length}
								<p class="text-sm opacity-60 py-2">No transactions in this range.</p>
							{/if}
						</div>
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
