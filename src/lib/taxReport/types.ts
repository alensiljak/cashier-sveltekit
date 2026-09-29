/** A group of accounts reported together, e.g. "Salary" or "Work-related deductions". */
export interface TaxCategory {
	name: string;
	/** Regular expressions matched against the full account name. First matching category wins. */
	accounts: string[];
	/** Income is reported with its sign flipped (Beancount stores income as negative). */
	kind: 'income' | 'deduction';
}

/** A user-editable report definition. Built-in templates are copied into this shape. */
export interface TaxReportConfig {
	version: 1;
	/** Id of the template this config was copied from, if any. */
	templateId?: string;
	name: string;
	/** First day of the financial year. Australia: July 1st. */
	yearStart: { month: number; day: number };
	/** Currency the report is converted to. Falls back to the main currency if unset. */
	currency?: string;
	categories: TaxCategory[];
	/**
	 * Regular expressions matched against the full account name. Matching accounts are left
	 * out of the categories, the unmapped bucket and the missing-exchange-rate warning.
	 */
	excludeAccounts?: string[];
}

export interface TaxPosting {
	date: string;
	account: string;
	/** Amount as stored in the ledger (income negative, expenses positive). */
	amount: number;
}

export interface CategoryResult {
	name: string;
	kind: TaxCategory['kind'] | 'unmapped' | 'excluded';
	total: number;
	/** Totals per account, largest first. */
	accounts: { account: string; total: number }[];
}

export interface TaxReportResult {
	categories: CategoryResult[];
	unmapped: CategoryResult;
	/** Postings on accounts matched by `excludeAccounts`, kept for preview. Ledger sign. */
	excluded: CategoryResult;
}
