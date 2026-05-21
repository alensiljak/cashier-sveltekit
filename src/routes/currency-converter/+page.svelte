<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import {
		getCurrencyConverter,
		getConverterMode,
		setConverterMode,
		type ConverterMode,
		type ConversionResult
	} from '$lib/services/currencyConverter';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { ArrowUpDownIcon } from '@lucide/svelte';

	let currencies: string[] = $state([]);
	let fromCurrency = $state('');
	let toCurrency = $state('');
	let inputAmount = $state('');
	let result: ConversionResult | null = $state(null);
	let isLoadingCurrencies = $state(true);
	let isConverting = $state(false);
	let error: string | null = $state(null);
	let mode: ConverterMode = $state(getConverterMode());

	$effect(() => {
		loadCurrencies();
	});

	async function loadCurrencies() {
		isLoadingCurrencies = true;
		error = null;
		try {
			await fullLedgerService.ensureLoaded();
			currencies = await getCurrencyConverter().getCurrencies();
			if (currencies.length > 0 && !fromCurrency) fromCurrency = currencies[0];
			if (currencies.length > 1 && !toCurrency) toCurrency = currencies[1];
		} catch (e) {
			error = String(e);
		} finally {
			isLoadingCurrencies = false;
		}
	}

	async function convert() {
		const amount = parseFloat(inputAmount);
		if (!inputAmount || isNaN(amount) || !fromCurrency || !toCurrency) return;

		isConverting = true;
		error = null;
		result = null;
		try {
			result = await getCurrencyConverter().convert(amount, fromCurrency, toCurrency);
		} catch (e) {
			error = String(e);
		} finally {
			isConverting = false;
		}
	}

	function swap() {
		[fromCurrency, toCurrency] = [toCurrency, fromCurrency];
		result = null;
	}

	function onModeChange(newMode: ConverterMode) {
		mode = newMode;
		setConverterMode(newMode);
		result = null;
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
				<input
					type="number"
					class="input input-bordered w-full"
					placeholder="0.00"
					bind:value={inputAmount}
					onkeydown={(e) => e.key === 'Enter' && convert()}
				/>
			</label>

			<!-- From / swap / To row -->
			<div class="flex items-end gap-2">
				<label class="form-control flex-1">
					<div class="label"><span class="label-text">From</span></div>
					<select class="select select-bordered w-full" bind:value={fromCurrency} onchange={() => (result = null)}>
						{#each currencies as c}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>

				<button class="btn btn-circle btn-outline mb-0.5" onclick={swap} title="Swap currencies">
					<ArrowUpDownIcon size={18} />
				</button>

				<label class="form-control flex-1">
					<div class="label"><span class="label-text">To</span></div>
					<select class="select select-bordered w-full" bind:value={toCurrency} onchange={() => (result = null)}>
						{#each currencies as c}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>
			</div>

			<!-- Convert button -->
			<button
				class="btn btn-primary w-full"
				onclick={convert}
				disabled={isConverting || !inputAmount}
			>
				{#if isConverting}
					<span class="loading loading-spinner loading-sm"></span>
					Converting...
				{:else}
					Convert
				{/if}
			</button>

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

			<!-- Implementation selector -->
			<div class="divider text-xs text-base-content/40">Engine</div>
			<div class="flex gap-2 justify-center">
				<button
					class="btn btn-sm {mode === 'synthetic-ledger' ? 'btn-primary' : 'btn-outline'}"
					onclick={() => onModeChange('synthetic-ledger')}
				>
					Synthetic Ledger
				</button>
				<button
					class="btn btn-sm {mode === 'price-graph' ? 'btn-primary' : 'btn-outline'}"
					onclick={() => onModeChange('price-graph')}
				>
					Price Graph
				</button>
			</div>
		{/if}
	</div>
</main>
