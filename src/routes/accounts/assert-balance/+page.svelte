<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import { xact as xactStore, xactId } from '#lib/data/mainStore';
	import { Xact } from '#lib/data/model';
	import appService from '#lib/services/appService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import Notifier from '#lib/utils/notifier';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const accountName = $derived(page.url.searchParams.get('account') ?? '');

	let date = $state(new Date().toISOString().substring(0, 10));
	let amount = $state('');
	let currency = $state('');

	const isEdit = $derived(page.url.searchParams.get('edit') === '1');
	/** The record being edited, if any. */
	let editing: { id: string; xact: Xact } | undefined;

	onMount(async () => {
		const existing = $xactStore?.balanceAssertion;
		if (isEdit && existing && $xactId !== undefined) {
			editing = { id: $xactId, xact: $xactStore };
			date = $xactStore.date ?? date;
			amount = String(existing.amount);
			currency = existing.currency;
			return;
		}
		currency = await appService.getDefaultCurrency();
		if (!accountName) return;
		await fullLedgerService.ensureLoaded();
		const account = await fullLedgerService.getAccountWithBalances(accountName);
		const keys = Object.keys(account?.balances ?? {});
		if (keys.length) currency = keys[0];
	});

	async function onFab() {
		const value = parseFloat(amount);
		if (isNaN(value)) {
			Notifier.error('Enter the balance amount');
			return;
		}
		if (!currency.trim()) {
			Notifier.error('Enter a currency');
			return;
		}
		const tx = editing ? editing.xact : new Xact();
		tx.date = date;
		tx.payee = 'Balance assertion';
		tx.note = `${accountName} = ${value} ${currency.trim().toUpperCase()}`;
		tx.postings = [];
		tx.balanceAssertion = {
			account: accountName,
			amount: value,
			currency: currency.trim().toUpperCase()
		};
		const store = await getXactStore();
		if (editing) await store.updateXact(editing.id, tx);
		else await store.appendMany([tx]);
		Notifier.success('Balance assertion saved');
		if (editing) {
			xactStore.set(tx);
			history.back();
			return;
		}
		await goto(`/accounts/account-xacts/${encodeURIComponent(accountName)}`);
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title={isEdit ? 'Edit Balance Assertion' : 'Balance Assertion'} />

	<section class="container mx-auto flex-1 space-y-4 overflow-y-auto p-4 lg:max-w-screen-sm">
		<Fab Icon={CheckIcon} onclick={onFab} />

		<div class="form-control">
			<label class="label" for="account"><span class="label-text">Account</span></label>
			<input id="account" type="text" class="input input-bordered w-full" value={accountName} readonly />
		</div>

		<div class="form-control">
			<label class="label" for="date"><span class="label-text">Date</span></label>
			<input id="date" type="date" class="input bg-primary/20 w-full" bind:value={date} />
		</div>

		<div class="form-control">
			<label class="label" for="amount">
				<span class="label-text font-semibold">Balance</span>
			</label>
			<div class="flex items-center gap-1">
				<input
					id="amount"
					type="number"
					step="0.01"
					class="input bg-primary/20 flex-1"
					bind:value={amount}
					placeholder="0.00"
				/>
				<input
					type="text"
					class="input bg-primary/20 w-20 text-center uppercase"
					bind:value={currency}
					placeholder="EUR"
				/>
			</div>
		</div>

		<div class="alert alert-info alert-soft text-sm">
			<span>
				<strong>How it works:</strong> this adds a Beancount <code>balance</code> assertion. It does
				not change any balance; it only checks it. The assertion is evaluated at the
				<em>start</em> of the chosen date, i.e. against all transactions dated <em>before</em> that
				day (transactions on the same day are not counted). If the account's balance in that
				currency differs, validation reports a failed assertion.
			</span>
		</div>
	</section>
</main>
