<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { getCurrencies, convert, type ConversionResult } from '$lib/services/currencyConverter';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { settings, SettingKeys } from '$lib/settings';
	import { ArrowUpDownIcon, XIcon } from '@lucide/svelte';

	let currencies: string[] = $state([]);
	let fromCurrency = $state('');
	let toCurrency = $state('');
	let inputAmount = $state('');
	let result: ConversionResult | null = $state(null);
	let isLoadingCurrencies = $state(true);
	let error: string | null = $state(null);

	$effect(() => {
		loadCurrencies();
	});

	$effect(() => {
		const amount = parseFloat(inputAmount);
		if (!inputAmount || isNaN(amount) || !fromCurrency || !toCurrency) return;

		const timeout = setTimeout(() => runConvert(), 400);
		return () => clearTimeout(timeout);
	});

	async function loadCurrencies() {
		isLoadingCurrencies = true;
		error = null;
		try {
			await fullLedgerService.ensureLoaded();
			currencies = await getCurrencies();
			const baseCurrency = await settings.get<string>(SettingKeys.currency);
			if (currencies.length > 0 && !fromCurrency) fromCurrency = currencies[0];
			if (!toCurrency) {
				toCurrency =
					baseCurrency && currencies.includes(baseCurrency)
						? baseCurrency
						: currencies[1] ?? '';
			}
		} catch (e) {
			error = String(e);
		} finally {
			isLoadingCurrencies = false;
		}
	}

	async function runConvert() {
		const amount = parseFloat(inputAmount);
		if (!inputAmount || isNaN(amount) || !fromCurrency || !toCurrency) return;

		error = null;
		result = null;
		try {
			result = await convert(amount, fromCurrency, toCurrency);
		} catch (e) {
			error = String(e);
		}
	}

	function swap() {
		[fromCurrency, toCurrency] = [toCurrency, fromCurrency];
	}
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="Currency Converter" />

	<div class="flex flex-col gap-4 p-4">
		{#if isLoadingCurrencies}
			<div class="flex justify-center py-8">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else}
			<!-- Amount input -->
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Amount</span></div>
				<div class="relative">
					<input
						type="number"
						class="input input-bordered w-full pr-10"
						placeholder="0.00"
						bind:value={inputAmount}
					/>
					{#if inputAmount}
						<button
							class="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
							onclick={() => { inputAmount = ''; result = null; }}
							title="Clear"
						>
							<XIcon size={14} />
						</button>
					{/if}
				</div>
			</label>

			<!-- From / swap / To row -->
			<div class="flex items-end gap-2">
				<label class="form-control flex-1">
					<div class="label"><span class="label-text">From</span></div>
					<SearchableSelect options={currencies} bind:value={fromCurrency} />
				</label>

				<button class="btn btn-circle btn-outline mb-0.5" onclick={swap} title="Swap currencies">
					<ArrowUpDownIcon size={18} />
				</button>

				<label class="form-control flex-1">
					<div class="label"><span class="label-text">To</span></div>
					<SearchableSelect options={currencies} bind:value={toCurrency} />
				</label>
			</div>

			<!-- Result -->
			{#if result}
				<div class="card bg-base-200">
					<div class="card-body items-center py-6">
						<p class="text-sm text-base-content/60">
							{inputAmount} {fromCurrency} =
						</p>
						<p class="text-3xl font-bold">
							{result.amount.toFixed(4)} {result.currency}
						</p>
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if error}
				<div class="alert alert-error">
					<span class="text-sm">{error}</span>
				</div>
			{/if}
		{/if}
	</div>
</main>
