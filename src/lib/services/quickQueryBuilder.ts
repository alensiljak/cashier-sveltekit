export type Command = 'balance' | 'register' | 'lots' | 'assert' | 'price';

export interface CommonOptions {
	account: string[];
	begin?: string;
	end?: string;
	dateRange?: string;
	currency: string[];
	exchange?: string;
	sort?: string;
	limit?: number;
	total: boolean;
	// balance-only
	hierarchy: boolean;
	depth?: number;
	zero: boolean;
	closedAccounts: boolean;
}

export interface LotsOptions {
	account: string[];
	begin?: string;
	end?: string;
	dateRange?: string;
	currency: string[];
	exchange?: string;
	sort?: string;
	limit?: number;
	sortBy?: 'date' | 'price' | 'symbol';
	average: boolean;
	active: boolean;
	showAll: boolean;
	closed: boolean;
}

// --- Date parsing ---

function parseDate(dateStr: string): string | null {
	const s = dateStr.trim();
	const parts = s.split('-');
	if (parts.length === 1) {
		const year = parseInt(parts[0]);
		if (isNaN(year)) return null;
		return `${String(year).padStart(4, '0')}-01-01`;
	} else if (parts.length === 2) {
		const year = parseInt(parts[0]);
		const month = parseInt(parts[1]);
		if (isNaN(year) || isNaN(month)) return null;
		return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
	} else if (parts.length === 3) {
		return s;
	}
	return null;
}

function parseDateRange(rangeStr: string): { begin?: string; end?: string } | null {
	if (rangeStr.includes('..')) {
		const idx = rangeStr.indexOf('..');
		const startPart = rangeStr.slice(0, idx);
		const endPart = rangeStr.slice(idx + 2);
		return {
			begin: startPart ? (parseDate(startPart) ?? undefined) : undefined,
			end: endPart ? (parseDate(endPart) ?? undefined) : undefined
		};
	}

	const start = parseDate(rangeStr);
	if (!start) return null;

	const parts = rangeStr.trim().split('-');
	let end: string;
	if (parts.length === 1) {
		end = `${parseInt(parts[0]) + 1}-01-01`;
	} else if (parts.length === 2) {
		const year = parseInt(parts[0]);
		const month = parseInt(parts[1]);
		const nextMonth = month >= 12 ? 1 : month + 1;
		const nextYear = month >= 12 ? year + 1 : year;
		end = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
	} else {
		const d = new Date(rangeStr.trim());
		if (isNaN(d.getTime())) return null;
		d.setDate(d.getDate() + 1);
		end = d.toISOString().slice(0, 10);
	}

	return { begin: start, end };
}

// --- Account pattern parsing ---

interface AccountParams {
	accountRegexes: string[];
	excludedAccountRegexes: string[];
	whereClauses: string[];
}

function parseAccountParams(tokens: string[]): AccountParams {
	const accountRegexes: string[] = [];
	const excludedAccountRegexes: string[] = [];
	const whereClauses: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		const current = tokens[i];
		if (current === 'not') {
			i++;
			while (i < tokens.length) {
				const next = tokens[i];
				if (next.startsWith('@') || next === 'not') {
					i--;
					break;
				}
				excludedAccountRegexes.push(next);
				i++;
			}
		} else if (current.startsWith('@')) {
			whereClauses.push(`description ~ '${current.slice(1)}'`);
		} else {
			accountRegexes.push(current);
		}
		i++;
	}

	return { accountRegexes, excludedAccountRegexes, whereClauses };
}

// --- Helpers ---

function normalizeCurrencies(currencies: string[]): string[] {
	return currencies
		.flatMap((c) => c.split(',').map((s) => s.trim().toUpperCase()))
		.filter((s) => s.length > 0);
}

function buildSortClause(sort: string): string {
	return sort
		.split(',')
		.map((field) => {
			const f = field.trim();
			return f.startsWith('-') ? `${f.slice(1)} DESC` : `${f} ASC`;
		})
		.join(', ');
}

function addDateClauses(
	opts: { begin?: string; end?: string; dateRange?: string },
	whereClauses: string[]
) {
	if (opts.begin) {
		const d = parseDate(opts.begin);
		if (d) whereClauses.push(`date >= ${d}`);
	}
	if (opts.end) {
		const d = parseDate(opts.end);
		if (d) whereClauses.push(`date < ${d}`);
	}
	if (opts.dateRange) {
		const range = parseDateRange(opts.dateRange);
		if (range) {
			if (range.begin) whereClauses.push(`date >= ${range.begin}`);
			if (range.end) whereClauses.push(`date < ${range.end}`);
		}
	}
}

function addAccountClauses(tokens: string[], whereClauses: string[]) {
	const params = parseAccountParams(tokens);
	for (const clause of params.whereClauses) whereClauses.push(clause);
	for (const pattern of params.accountRegexes) whereClauses.push(`account ~ '${pattern}'`);
	for (const pattern of params.excludedAccountRegexes)
		whereClauses.push(`NOT (account ~ '${pattern}')`);
}

function addCurrencyClauses(currencies: string[], whereClauses: string[]) {
	const normalized = normalizeCurrencies(currencies);
	if (normalized.length === 1) {
		whereClauses.push(`currency = '${normalized[0]}'`);
	} else if (normalized.length > 1) {
		whereClauses.push(`currency IN ('${normalized.join("', '")}')`);
	}
}

// --- Query builders ---

export function buildBalanceQuery(opts: CommonOptions): string {
	const whereClauses: string[] = [];

	addAccountClauses(opts.account, whereClauses);
	addDateClauses(opts, whereClauses);

	if (!opts.closedAccounts) {
		whereClauses.push('NOT close_date(account)');
	}

	addCurrencyClauses(opts.currency, whereClauses);

	const exchange = opts.exchange?.toUpperCase();
	const selectClause = exchange
		? `SELECT account, units(sum(position)) as Balance, convert(sum(position), '${exchange}') as Converted`
		: `SELECT account, units(sum(position)) as Balance`;

	let query =
		whereClauses.length > 0
			? `${selectClause} WHERE ${whereClauses.join(' AND ')} GROUP BY account`
			: `${selectClause} GROUP BY account`;

	query += ` ORDER BY ${buildSortClause(opts.sort ?? 'account')}`;

	if (opts.limit != null) query += ` LIMIT ${opts.limit}`;

	return query;
}

export function buildRegisterQuery(opts: CommonOptions): string {
	const whereClauses: string[] = [];

	addAccountClauses(opts.account, whereClauses);
	addDateClauses(opts, whereClauses);
	addCurrencyClauses(opts.currency, whereClauses);

	const exchange = opts.exchange?.toUpperCase();
	let query = exchange
		? `SELECT date, account, payee, narration, position, convert(position, '${exchange}') as Converted`
		: `SELECT date, account, payee, narration, position`;

	if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
	if (opts.sort) query += ` ORDER BY ${buildSortClause(opts.sort)}`;
	if (opts.limit != null) query += ` LIMIT ${opts.limit}`;

	return query;
}

export function buildLotsQuery(opts: LotsOptions): string {
	const whereClauses: string[] = [];

	addAccountClauses(opts.account, whereClauses);
	addDateClauses(opts, whereClauses);

	const normalizedCurrencies = normalizeCurrencies(opts.currency);
	if (normalizedCurrencies.length === 1) {
		whereClauses.push(`currency = '${normalizedCurrencies[0]}'`);
	} else if (normalizedCurrencies.length > 1) {
		whereClauses.push(`currency IN ('${normalizedCurrencies.join("', '")}')`);
	}

	whereClauses.push('cost_number IS NOT NULL');

	const exchange = opts.exchange?.toUpperCase();

	let selectClause: string;
	let groupBy: string[] | null;
	let havingClause: string | null;

	if (opts.average) {
		let sel = `SELECT MAX(date) as date, account, currency(units(position)) as symbol, SUM(units(position)) as quantity, SUM(cost_number * number(units(position))) as total_weighted_cost, SUM(number(units(position))) as total_quantity, cost(SUM(position)) as total_cost, value(SUM(position)) as value`;
		if (exchange) sel += `, convert(value(SUM(position)), '${exchange}') as converted_value`;
		selectClause = sel;
		groupBy = ['account', 'currency(units(position))'];
		havingClause = 'HAVING SUM(number(units(position))) > 0';
	} else if (opts.closed) {
		let sel = `SELECT MAX(date) as date, account, currency(units(position)) as symbol, SUM(units(position)) as quantity, cost_number as price, cost(SUM(position)) as cost, value(SUM(position)) as value`;
		if (exchange) sel += `, convert(value(SUM(position)), '${exchange}') as converted_value`;
		selectClause = sel;
		groupBy = ['account', 'currency(units(position))', 'cost_number', 'cost_currency'];
		havingClause = 'HAVING SUM(number(units(position))) <= 0';
	} else if (opts.showAll) {
		let sel = `SELECT date, account, currency(units(position)) as symbol, units(position) as quantity, cost_number as price, cost(position) as cost, value(position) as value`;
		if (exchange) sel += `, convert(value(position), '${exchange}') as converted_value`;
		selectClause = sel;
		groupBy = null;
		havingClause = null;
	} else {
		// active (default)
		let sel = `SELECT MAX(date) as date, account, currency(units(position)) as symbol, SUM(units(position)) as quantity, cost_number as price, cost(SUM(position)) as cost, value(SUM(position)) as value`;
		if (exchange) sel += `, convert(value(SUM(position)), '${exchange}') as converted_value`;
		selectClause = sel;
		groupBy = ['account', 'currency(units(position))', 'cost_number', 'cost_currency'];
		havingClause = 'HAVING SUM(number(units(position))) > 0';
	}

	let query = selectClause;
	if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
	if (groupBy) query += ` GROUP BY ${groupBy.join(', ')}`;
	if (havingClause) query += ` ${havingClause}`;

	if (opts.sort) {
		query += ` ORDER BY ${buildSortClause(opts.sort)}`;
	} else if (opts.sortBy) {
		const field = opts.average && opts.sortBy === 'price' ? 'avg_price' : opts.sortBy;
		query += ` ORDER BY ${field} ASC`;
	} else {
		query += ` ORDER BY date ASC`;
	}

	if (opts.limit != null) query += ` LIMIT ${opts.limit}`;

	return query;
}

export function buildAssertQuery(opts: CommonOptions): string {
	const whereClauses: string[] = [];

	addAccountClauses(opts.account, whereClauses);
	addDateClauses(opts, whereClauses);

	const normalized = normalizeCurrencies(opts.currency);
	if (normalized.length === 1) {
		whereClauses.push(`amount.currency = '${normalized[0]}'`);
	} else if (normalized.length > 1) {
		whereClauses.push(`amount.currency IN (${normalized.map((c) => `'${c}'`).join(', ')})`);
	}

	let query = `SELECT date, account, amount FROM #balances`;
	if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
	if (opts.sort) query += ` ORDER BY ${buildSortClause(opts.sort)}`;
	if (opts.limit != null) query += ` LIMIT ${opts.limit}`;

	return query;
}

export function buildPriceQuery(opts: CommonOptions): string {
	const whereClauses: string[] = [];

	// For price, account tokens are commodity filters (OR logic)
	const commodities = opts.account.map((a) => a.toUpperCase());
	if (commodities.length === 1) {
		whereClauses.push(`currency ~ '${commodities[0]}'`);
	} else if (commodities.length > 1) {
		whereClauses.push(`(${commodities.map((c) => `currency ~ '${c}'`).join(' OR ')})`);
	}

	addDateClauses(opts, whereClauses);

	let query = `SELECT date, currency, amount FROM #prices`;
	if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
	query += opts.sort
		? ` ORDER BY ${buildSortClause(opts.sort)}`
		: ` ORDER BY date ASC, currency ASC`;
	if (opts.limit != null) query += ` LIMIT ${opts.limit}`;

	return query;
}

export function buildQuery(
	command: Command,
	commonOpts: CommonOptions,
	lotsOpts: LotsOptions
): string {
	switch (command) {
		case 'balance':
			return buildBalanceQuery(commonOpts);
		case 'register':
			return buildRegisterQuery(commonOpts);
		case 'lots':
			return buildLotsQuery(lotsOpts);
		case 'assert':
			return buildAssertQuery(commonOpts);
		case 'price':
			return buildPriceQuery(commonOpts);
	}
}
