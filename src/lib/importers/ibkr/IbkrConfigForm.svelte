<script lang="ts">
	import { untrack } from 'svelte';
	import type { IbkrConfig } from './config';
	import type { SymbolEntry } from './symbols';

	interface Props {
		value: IbkrConfig;
		onchange: (config: IbkrConfig) => void;
	}
	let { value, onchange }: Props = $props();

	/** Text fields: label, key, hint. */
	const FIELDS: [string, keyof IbkrConfig, string][] = [
		['Cash account', 'cashAccount', '{currency}'],
		['Stock account', 'stockAccount', '{symbol}'],
		['Distribution (dividend) account', 'distributionAccount', '{symbol}, {currency}'],
		[
			'Interest account (commodities tagged distribution: "interest")',
			'interestAccount',
			'{symbol}, {currency}'
		],
		['Distribution payee', 'distributionPayee', '{symbol}'],
		['Withholding tax account', 'withholdingTaxAccount', '{symbol}, {currency}'],
		['Capital gains account', 'capitalGainAccount', '{symbol}, {currency}'],
		['Broker interest account', 'brokerInterestAccount', '{currency}'],
		['Fees account', 'feesAccount', '{currency}']
	];

	// The rows are edited locally (a key being typed must not reorder or merge) and the
	// parent gets the config rebuilt from them. The form is remounted if the JSON is edited.
	let transfers = $state(
		untrack(() => Object.entries(value.transferAccounts ?? {}).map(([c, a]) => ({ c, a })))
	);
	let symbols = $state(
		untrack(() =>
			(value.symbols ?? []).map((e) =>
				e.length === 2
					? { ticker: e[0], book: '', isin: e[1] }
					: { ticker: e[0], book: e[1], isin: e[2] }
			)
		)
	);

	function setField(key: keyof IbkrConfig, text: string) {
		onchange({ ...value, [key]: text });
	}

	function emitRows() {
		const transferAccounts: Record<string, string> = {};
		for (const { c, a } of transfers) {
			if (c.trim()) transferAccounts[c.trim().toUpperCase()] = a.trim();
		}
		const entries: SymbolEntry[] = [];
		for (const s of symbols) {
			const ticker = s.ticker.trim();
			const isin = s.isin.trim();
			const book = s.book.trim();
			if (!ticker || !isin) continue;
			entries.push(book && book !== ticker ? [ticker, book, isin] : [ticker, isin]);
		}
		onchange({ ...value, transferAccounts, symbols: entries });
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-col gap-1">
		<span class="text-sm">Sections to import</span>
		<label class="flex items-center gap-2 text-sm cursor-pointer">
			<input
				type="checkbox"
				class="toggle toggle-primary toggle-sm bg-transparent bg-none"
				checked={value.sections?.assertions !== false}
				onchange={(e) =>
					onchange({
						...value,
						sections: { ...value.sections, assertions: e.currentTarget.checked }
					})}
			/>
			Balance assertions
		</label>
	</div>

	{#each FIELDS as [label, key, hint] (key)}
		<label class="form-control w-full">
			<span class="text-sm">{label} <span class="opacity-50 text-xs">{hint}</span></span>
			<input
				class="input input-bordered input-sm w-full font-mono"
				spellcheck="false"
				value={(value[key] as string | undefined) ?? ''}
				oninput={(e) => setField(key, e.currentTarget.value)}
			/>
		</label>
	{/each}

	<div class="flex flex-col gap-2">
		<span class="text-sm">
			Transfer accounts
			<span class="opacity-50 text-xs">where deposits come from / withdrawals go to, per currency</span>
		</span>
		{#each transfers as row, i (i)}
			<div class="flex gap-2">
				<input
					class="input input-bordered input-sm w-20 font-mono"
					placeholder="EUR"
					spellcheck="false"
					value={row.c}
					oninput={(e) => {
						row.c = e.currentTarget.value.toUpperCase();
						e.currentTarget.value = row.c;
						emitRows();
					}}
				/>
				<input
					class="input input-bordered input-sm flex-1 min-w-0 font-mono"
					placeholder="Assets:Bank:EUR"
					spellcheck="false"
					bind:value={row.a}
					oninput={emitRows}
				/>
				<button
					class="btn btn-ghost btn-sm"
					aria-label="Remove"
					onclick={() => {
						transfers.splice(i, 1);
						emitRows();
					}}>✕</button
				>
			</div>
		{/each}
		<button class="btn btn-sm self-start" onclick={() => transfers.push({ c: '', a: '' })}>
			Add currency
		</button>
	</div>

	<div class="flex flex-col gap-2">
		<span class="text-sm">
			Symbols
			<span class="opacity-50 text-xs"
				>overrides to the book's <code>isin</code> metadata: IBKR ticker, book symbol (if different), ISIN</span
			>
		</span>
		{#each symbols as row, i (i)}
			<div class="flex gap-2">
				<input
					class="input input-bordered input-sm w-24 font-mono"
					placeholder="Ticker"
					spellcheck="false"
					bind:value={row.ticker}
					oninput={emitRows}
				/>
				<input
					class="input input-bordered input-sm w-28 font-mono"
					placeholder="Book symbol"
					spellcheck="false"
					bind:value={row.book}
					oninput={emitRows}
				/>
				<input
					class="input input-bordered input-sm flex-1 min-w-0 font-mono"
					placeholder="ISIN"
					spellcheck="false"
					value={row.isin}
					oninput={(e) => {
						row.isin = e.currentTarget.value.toUpperCase();
						e.currentTarget.value = row.isin;
						emitRows();
					}}
				/>
				<button
					class="btn btn-ghost btn-sm"
					aria-label="Remove"
					onclick={() => {
						symbols.splice(i, 1);
						emitRows();
					}}>✕</button
				>
			</div>
		{/each}
		<button
			class="btn btn-sm self-start"
			onclick={() => symbols.push({ ticker: '', book: '', isin: '' })}
		>
			Add symbol
		</button>
	</div>
</div>
