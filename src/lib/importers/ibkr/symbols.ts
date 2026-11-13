/**
 * Maps what IBKR reports (a ticker and an ISIN) to the commodity symbol used in the book.
 *
 * Two traps this handles, both seen in real statements:
 * - The same ISIN can be listed under several book symbols for different exchanges
 *   (DGSE.MI / WTED.DE). IBKR reports only the base ticker ("DGSE"), so the ISIN alone is
 *   ambiguous and the ticker has to pick one.
 * - IBKR can report the same ticker ("SDIV") for two different ISINs (a US and an Irish
 *   listing). A ticker match is therefore trusted only if its ISIN also matches.
 */

/** `[ticker, isin]`, or `[ticker, bookSymbol, isin]` when the book symbol differs from the ticker. */
export type SymbolEntry = [string, string] | [string, string, string];

export interface SymbolRow {
	symbol?: string;
	isin?: string;
}

export class SymbolMap {
	/** book symbol -> ISIN */
	private readonly isinOf = new Map<string, string>();
	/** ISIN -> book symbols, in the order registered */
	private readonly symbolsOf = new Map<string, string[]>();
	/** IBKR ticker -> book symbol */
	private readonly bookSymbolOf = new Map<string, string>();

	constructor(entries: readonly SymbolEntry[]) {
		for (const entry of entries) {
			const [ticker, bookSymbol, isin] =
				entry.length === 2 ? [entry[0], entry[0], entry[1]] : entry;
			this.isinOf.set(bookSymbol, isin);
			const list = this.symbolsOf.get(isin) ?? [];
			// The same pair can come from both the book and the config.
			if (!list.includes(bookSymbol)) list.push(bookSymbol);
			this.symbolsOf.set(isin, list);
			this.bookSymbolOf.set(ticker, bookSymbol);
		}
	}

	/** The book symbol for the row, or undefined when it is not (unambiguously) known. */
	resolve(row: SymbolRow): string | undefined {
		const ticker = row.symbol;
		if (ticker) {
			const candidate = this.bookSymbolOf.get(ticker);
			if (candidate !== undefined && this.isinOf.get(candidate) === row.isin) return candidate;
		}

		const candidates = (row.isin && this.symbolsOf.get(row.isin)) || [];
		if (candidates.length === 1) return candidates[0];
		if (ticker) return candidates.find((s) => s.includes(ticker));
		return undefined;
	}
}

/** A symbol as it appears in an account name: `.` and `_` become `-`, spaces are dropped. */
export function accountSymbol(symbol: string): string {
	return symbol.replace(/ /g, '').replace(/[._]/g, '-');
}
