import type { Xact } from '#lib/data/model';

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
	/** Whether the config holds a `rules` list (see rules.ts), so the review screen can offer rule editing. */
	readonly usesRules?: boolean;
	/** Template shown when the importer is configured for the first time. */
	readonly defaultConfig: TConfig;
	/** The account the imported file belongs to; used to find already-recorded transactions. */
	account(config: TConfig): string;
	/** Whether this importer can handle the file, judged by its content (file names are arbitrary). */
	identify(text: string): boolean;
	/** Parse the file into transactions. Unknown counter-accounts are left on the placeholder account. */
	extract(text: string, config: TConfig, ctx?: ImportContext): ImportedXact[];
}

/**
 * A transaction exactly as it will be saved, plus what the review screen shows
 * about where it came from. `details` is never written to the transaction.
 */
export interface ImportedXact {
	xact: Xact;
	/** Label/value pairs for the Details pane: original names, value date, applied rules, etc. */
	details: [string, string][];
	/** Source strings that rules are matched against (e.g. payee, payment reference). */
	matchText: string[];
	/** Positions in the rule list of the rules that changed this row, for editing them from the review. */
	appliedRules?: number[];
}

/** Facts about the books, and switches, that importers may use; supplied by the caller so importers stay pure. */
export interface ImportContext {
	/** ISIN -> commodity symbol, from the book's commodity directives. */
	isinToSymbol?: Record<string, string>;
	/** Set to false to see the raw records: payee and account rules are skipped. Default true. */
	applyRules?: boolean;
}

/** A candidate transaction and, if one was found, the existing transaction it duplicates. */
export interface DedupResult {
	xact: Xact;
	duplicateOf?: Xact;
}
