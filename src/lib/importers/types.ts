import type { Xact } from '$lib/data/model';

/**
 * A bank-statement importer: turns the text of an exported file into
 * transactions. Pure and synchronous, so it can run on the main thread or in a worker.
 *
 * Config must be JSON-serializable (regexes are stored as strings) so it can be
 * kept in Settings or as JSON in OPFS.
 */
export interface Importer<TConfig = unknown> {
	/** Stable key, used to look up saved config. */
	readonly id: string;
	/** Display name. */
	readonly name: string;
	/** Template shown when the importer is configured for the first time. */
	readonly defaultConfig: TConfig;
	/** The account the imported file belongs to; used to find already-recorded transactions. */
	account(config: TConfig): string;
	/** Whether this importer can handle the file, judged by its content (file names are arbitrary). */
	identify(text: string): boolean;
	/** Parse the file into transactions. Unknown counter-accounts are left as `Expenses:FIXME` / `Income:FIXME`. */
	extract(text: string, config: TConfig, ctx?: ImportContext): Xact[];
}

/** Facts about the books that importers may use; supplied by the caller so importers stay pure. */
export interface ImportContext {
	/** ISIN -> commodity symbol, from the book's commodity directives. */
	isinToSymbol?: Record<string, string>;
}

/** A candidate transaction and, if one was found, the existing transaction it duplicates. */
export interface DedupResult {
	xact: Xact;
	duplicateOf?: Xact;
}
