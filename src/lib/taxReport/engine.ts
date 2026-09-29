import type { CategoryResult, TaxPosting, TaxReportConfig, TaxReportResult } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Date range of the financial year that *starts* in `startYear`.
 * E.g. yearStart 1 Jul, startYear 2024 → 2024-07-01 … 2025-06-30.
 */
export function financialYearRange(
	yearStart: { month: number; day: number },
	startYear: number
): { from: string; to: string } {
	const from = new Date(Date.UTC(startYear, yearStart.month - 1, yearStart.day));
	const end = new Date(Date.UTC(startYear + 1, yearStart.month - 1, yearStart.day - 1));
	const fmt = (d: Date) =>
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	return { from: fmt(from), to: fmt(end) };
}

/** The start year of the financial year containing `today`. */
export function currentFinancialYearStart(
	yearStart: { month: number; day: number },
	today: Date = new Date()
): number {
	const y = today.getFullYear();
	const startThisYear = new Date(y, yearStart.month - 1, yearStart.day);
	return today >= startThisYear ? y : y - 1;
}

export function financialYearLabel(
	yearStart: { month: number; day: number },
	startYear: number
): string {
	return yearStart.month === 1 && yearStart.day === 1
		? String(startYear)
		: `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Returns a predicate telling whether an account is matched by the config's `excludeAccounts`. */
export function accountExcluder(config: TaxReportConfig): (account: string) => boolean {
	const matchers = (config.excludeAccounts ?? []).map((p) => new RegExp(p));
	return (account) => matchers.some((m) => m.test(account));
}

/**
 * Groups postings into the config's categories; the first matching category wins.
 * Postings on excluded accounts are set aside in `excluded`.
 */
export function buildTaxReport(config: TaxReportConfig, postings: TaxPosting[]): TaxReportResult {
	const matchers = config.categories.map((c) => c.accounts.map((p) => new RegExp(p)));
	const perCategory = config.categories.map(() => new Map<string, number>());
	const unmappedAccounts = new Map<string, number>();
	const excludedAccounts = new Map<string, number>();
	const isExcluded = accountExcluder(config);

	for (const p of postings) {
		if (isExcluded(p.account)) {
			excludedAccounts.set(p.account, (excludedAccounts.get(p.account) ?? 0) + p.amount);
			continue;
		}
		const idx = matchers.findIndex((ms) => ms.some((m) => m.test(p.account)));
		const target = idx === -1 ? unmappedAccounts : perCategory[idx];
		const sign = idx !== -1 && config.categories[idx].kind === 'income' ? -1 : 1;
		target.set(p.account, (target.get(p.account) ?? 0) + sign * p.amount);
	}

	const toResult = (
		name: string,
		kind: CategoryResult['kind'],
		accounts: Map<string, number>
	): CategoryResult => {
		const list = [...accounts.entries()]
			.map(([account, total]) => ({ account, total }))
			.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
		return { name, kind, total: list.reduce((s, a) => s + a.total, 0), accounts: list };
	};

	return {
		categories: config.categories.map((c, i) => toResult(c.name, c.kind, perCategory[i])),
		// Unmapped keeps the ledger sign, so income shows negative and expenses positive.
		unmapped: toResult('Unmapped', 'unmapped', unmappedAccounts),
		excluded: toResult('Excluded', 'excluded', excludedAccounts)
	};
}

/** Validates an imported config; returns an error message, or null if valid. */
export function validateTaxReportConfig(value: unknown): string | null {
	const c = value as Partial<TaxReportConfig> | null;
	if (!c || typeof c !== 'object') return 'Config must be a JSON object.';
	if (c.version !== 1) return 'Unsupported config version.';
	if (typeof c.name !== 'string' || !c.name) return 'Config needs a name.';
	const ys = c.yearStart;
	if (
		!ys ||
		!Number.isInteger(ys.month) ||
		!Number.isInteger(ys.day) ||
		ys.month < 1 ||
		ys.month > 12 ||
		ys.day < 1 ||
		ys.day > 31
	)
		return 'yearStart must have a valid month (1-12) and day (1-31).';
	if (c.currency !== undefined && (typeof c.currency !== 'string' || !c.currency))
		return 'currency must be a currency code, e.g. "AUD".';
	if (!Array.isArray(c.categories)) return 'categories must be a list.';
	for (const cat of c.categories) {
		if (!cat || typeof cat.name !== 'string' || !cat.name) return 'Every category needs a name.';
		if (cat.kind !== 'income' && cat.kind !== 'deduction')
			return `Category "${cat.name}": kind must be "income" or "deduction".`;
		if (!Array.isArray(cat.accounts) || cat.accounts.some((a) => typeof a !== 'string'))
			return `Category "${cat.name}": accounts must be a list of patterns.`;
		for (const pattern of cat.accounts) {
			try {
				new RegExp(pattern);
			} catch {
				return `Category "${cat.name}": invalid pattern "${pattern}".`;
			}
		}
	}
	if (c.excludeAccounts !== undefined) {
		if (!Array.isArray(c.excludeAccounts) || c.excludeAccounts.some((a) => typeof a !== 'string'))
			return 'excludeAccounts must be a list of patterns.';
		for (const pattern of c.excludeAccounts) {
			try {
				new RegExp(pattern);
			} catch {
				return `excludeAccounts: invalid pattern "${pattern}".`;
			}
		}
	}
	return null;
}
