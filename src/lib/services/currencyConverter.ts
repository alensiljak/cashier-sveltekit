/**
 * Currency conversion service.
 *
 * Two implementations behind a common interface:
 *   SyntheticLedgerConverter — builds an ephemeral beancount book in the WASM
 *     worker and uses BQL CONVERT(), handling multi-hop chains automatically.
 *   PriceGraphConverter — fetches prices via BQL and walks a rate graph in JS,
 *     useful as a fallback or for testing without a loaded ledger.
 *
 * Change `activeConverter` to swap between them.
 */

import fullLedgerService from './ledgerWorkerClient';

export interface ConversionResult {
	amount: number;
	currency: string;
}

export interface CurrencyConverter {
	getCurrencies(): Promise<string[]>;
	convert(amount: number, from: string, to: string): Promise<ConversionResult>;
}

// ---------------------------------------------------------------------------
// Implementation A: synthetic ephemeral ledger via WASM worker
// ---------------------------------------------------------------------------

class SyntheticLedgerConverter implements CurrencyConverter {
	async getCurrencies(): Promise<string[]> {
		await fullLedgerService.ensureLoaded();
		return fullLedgerService.getCurrencies();
	}

	async convert(amount: number, from: string, to: string): Promise<ConversionResult> {
		await fullLedgerService.ensureLoaded();
		const result = await fullLedgerService.convertCurrency(amount, from, to);
		return { amount: parseFloat(result.number), currency: result.currency };
	}
}

// ---------------------------------------------------------------------------
// Implementation B: client-side BFS over the price graph
// ---------------------------------------------------------------------------

class PriceGraphConverter implements CurrencyConverter {
	async getCurrencies(): Promise<string[]> {
		await fullLedgerService.ensureLoaded();
		const { rows, columns } = await fullLedgerService.query('SELECT currency, amount FROM prices');
		const colCurrency = columns.indexOf('currency');
		const colAmount = columns.indexOf('amount');
		const set = new Set<string>();
		for (const row of rows as any[][]) {
			const base = row[colCurrency] as string;
			if (base) set.add(base);
			const amt = row[colAmount] as { currency?: string } | null;
			if (amt?.currency) set.add(amt.currency);
		}
		return Array.from(set).sort();
	}

	async convert(amount: number, from: string, to: string): Promise<ConversionResult> {
		if (from === to) return { amount, currency: to };

		await fullLedgerService.ensureLoaded();
		const { rows, columns } = await fullLedgerService.query(
			'SELECT currency, amount FROM prices ORDER BY date DESC'
		);
		const colCurrency = columns.indexOf('currency');
		const colAmount = columns.indexOf('amount');

		// Build bidirectional rate graph, keeping only the latest price per pair
		const graph = new Map<string, Map<string, number>>();
		const seen = new Set<string>();

		const addEdge = (a: string, b: string, rate: number) => {
			if (!graph.has(a)) graph.set(a, new Map());
			graph.get(a)!.set(b, rate);
		};

		for (const row of rows as any[][]) {
			const base = row[colCurrency] as string;
			const amt = row[colAmount] as { number: string; currency: string } | null;
			if (!base || !amt?.number || !amt?.currency) continue;
			const key = `${base}/${amt.currency}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const rate = parseFloat(amt.number);
			if (isNaN(rate) || rate === 0) continue;
			addEdge(base, amt.currency, rate);
			addEdge(amt.currency, base, 1 / rate);
		}

		// BFS from `from` to `to`
		const queue: Array<{ currency: string; rate: number }> = [{ currency: from, rate: 1 }];
		const visited = new Set<string>([from]);

		while (queue.length > 0) {
			const { currency, rate } = queue.shift()!;
			const neighbours = graph.get(currency);
			if (!neighbours) continue;
			for (const [next, edgeRate] of neighbours) {
				if (visited.has(next)) continue;
				visited.add(next);
				const combined = rate * edgeRate;
				if (next === to) return { amount: amount * combined, currency: to };
				queue.push({ currency: next, rate: combined });
			}
		}

		throw new Error(`No conversion path from ${from} to ${to}`);
	}
}

// ---------------------------------------------------------------------------
// Exported instances — swap `activeConverter` to change implementation
// ---------------------------------------------------------------------------

export const syntheticLedgerConverter: CurrencyConverter = new SyntheticLedgerConverter();
export const priceGraphConverter: CurrencyConverter = new PriceGraphConverter();

export type ConverterMode = 'synthetic-ledger' | 'price-graph';

let _mode: ConverterMode = 'synthetic-ledger';

export function getConverterMode(): ConverterMode {
	return _mode;
}

export function setConverterMode(mode: ConverterMode): void {
	_mode = mode;
}

export function getCurrencyConverter(): CurrencyConverter {
	return _mode === 'synthetic-ledger' ? syntheticLedgerConverter : priceGraphConverter;
}
