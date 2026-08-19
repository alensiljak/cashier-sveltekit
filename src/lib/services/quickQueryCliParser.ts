import type { Command, CommonOptions, LotsOptions } from './quickQueryBuilder';

export interface ParseResult {
	command: Command | null;
	commonOpts: CommonOptions;
	lotsOpts: LotsOptions;
	errors: string[];
}

const COMMAND_ALIASES: Record<string, Command> = {
	balance: 'balance',
	b: 'balance',
	bal: 'balance',
	register: 'register',
	r: 'register',
	reg: 'register',
	lots: 'lots',
	l: 'lots',
	lot: 'lots',
	assert: 'assert',
	a: 'assert',
	price: 'price',
	p: 'price'
};

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	const n = input.length;
	while (i < n) {
		while (i < n && /\s/.test(input[i])) i++;
		if (i >= n) break;
		let token = '';
		if (input[i] === '"' || input[i] === "'") {
			const quote = input[i];
			i++;
			while (i < n && input[i] !== quote) {
				token += input[i];
				i++;
			}
			i++; // skip closing quote (if missing, just ends token)
		} else {
			while (i < n && !/\s/.test(input[i])) {
				token += input[i];
				i++;
			}
		}
		tokens.push(token);
	}
	return tokens;
}

function splitEquals(token: string): [string, string | undefined] {
	if (token.startsWith('--')) {
		const idx = token.indexOf('=');
		if (idx !== -1) return [token.slice(0, idx), token.slice(idx + 1)];
	}
	return [token, undefined];
}

function newCommonOptions(): CommonOptions {
	return {
		account: [],
		currency: [],
		total: false,
		hierarchy: false,
		zero: false,
		closedAccounts: false
	};
}

function newLotsOptions(): LotsOptions {
	return {
		account: [],
		currency: [],
		average: false,
		active: true,
		showAll: false,
		closed: false
	};
}

function parseCommonArgs(tokens: string[]): { opts: CommonOptions; errors: string[] } {
	const opts = newCommonOptions();
	const errors: string[] = [];
	const currencyParts: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		const [flag, inlineVal] = splitEquals(tokens[i]);
		switch (flag) {
			case '-b':
			case '--begin':
				opts.begin = inlineVal ?? tokens[++i];
				break;
			case '-e':
			case '--end':
				opts.end = inlineVal ?? tokens[++i];
				break;
			case '-d':
			case '--date-range':
				opts.dateRange = inlineVal ?? tokens[++i];
				break;
			case '-a':
			case '--amount':
				errors.push(`Amount filter '${inlineVal ?? tokens[++i]}' is not supported in this UI yet`);
				break;
			case '-c':
			case '--currency':
				currencyParts.push(inlineVal ?? tokens[++i]);
				break;
			case '-X':
			case '--exchange':
				opts.exchange = inlineVal ?? tokens[++i];
				break;
			case '-S':
			case '--sort':
				opts.sort = inlineVal ?? tokens[++i];
				break;
			case '-l':
			case '--limit': {
				const v = inlineVal ?? tokens[++i];
				const n = parseInt(v, 10);
				if (!isNaN(n)) opts.limit = n;
				else errors.push(`Invalid limit '${v}'`);
				break;
			}
			case '-T':
			case '--total':
				opts.total = true;
				break;
			case '--no-pager':
				break;
			case '-H':
			case '--hierarchy':
				opts.hierarchy = true;
				break;
			case '--empty':
				break;
			case '--list':
				errors.push('The --list option applies to the query command, which is not supported here');
				break;
			case '-D':
			case '--depth': {
				const v = inlineVal ?? tokens[++i];
				const n = parseInt(v, 10);
				if (!isNaN(n)) opts.depth = n;
				else errors.push(`Invalid depth '${v}'`);
				break;
			}
			case '-Z':
			case '--zero':
				opts.zero = true;
				break;
			case '-C':
			case '--closed':
				opts.closedAccounts = true;
				break;
			case '--ledger':
				inlineVal ?? tokens[++i];
				break;
			default:
				if (tokens[i].startsWith('-') && tokens[i] !== '-') {
					errors.push(`Unknown option '${tokens[i]}'`);
				} else {
					opts.account.push(tokens[i]);
				}
		}
		i++;
	}

	opts.currency = currencyParts;
	return { opts, errors };
}

function parseLotsArgs(tokens: string[]): { opts: LotsOptions; errors: string[] } {
	const opts = newLotsOptions();
	const errors: string[] = [];
	const currencyParts: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		const [flag, inlineVal] = splitEquals(tokens[i]);
		switch (flag) {
			case '-b':
			case '--begin':
				opts.begin = inlineVal ?? tokens[++i];
				break;
			case '-e':
			case '--end':
				opts.end = inlineVal ?? tokens[++i];
				break;
			case '-d':
			case '--date-range':
				opts.dateRange = inlineVal ?? tokens[++i];
				break;
			case '-a':
			case '--amount':
				errors.push(`Amount filter '${inlineVal ?? tokens[++i]}' is not supported in this UI yet`);
				break;
			case '-c':
			case '--currency':
				currencyParts.push(inlineVal ?? tokens[++i]);
				break;
			case '-X':
			case '--exchange':
				opts.exchange = inlineVal ?? tokens[++i];
				break;
			case '-S':
			case '--sort':
				opts.sort = inlineVal ?? tokens[++i];
				break;
			case '-l':
			case '--limit': {
				const v = inlineVal ?? tokens[++i];
				const n = parseInt(v, 10);
				if (!isNaN(n)) opts.limit = n;
				else errors.push(`Invalid limit '${v}'`);
				break;
			}
			case '--no-pager':
				break;
			case '-s':
			case '--sort-by': {
				const v = inlineVal ?? tokens[++i];
				if (v === 'date' || v === 'price' || v === 'symbol') opts.sortBy = v;
				else errors.push(`Invalid sort-by '${v}' (expected date, price, or symbol)`);
				break;
			}
			case '-A':
			case '--average':
				opts.average = true;
				break;
			case '--active':
				opts.active = true;
				opts.showAll = false;
				opts.closed = false;
				break;
			case '--all':
				opts.showAll = true;
				opts.active = false;
				opts.closed = false;
				break;
			case '--closed':
				opts.closed = true;
				opts.active = false;
				opts.showAll = false;
				break;
			case '--ledger':
				inlineVal ?? tokens[++i];
				break;
			default:
				if (tokens[i].startsWith('-') && tokens[i] !== '-') {
					errors.push(`Unknown option '${tokens[i]}'`);
				} else {
					opts.account.push(tokens[i]);
				}
		}
		i++;
	}

	opts.currency = currencyParts;
	return { opts, errors };
}

/** Parses a qqrl-style command line (without the leading `qqrl`) into query builder options. */
export function parseQqrlCommand(input: string): ParseResult {
	const tokens = tokenize(input);
	const commonOpts = newCommonOptions();
	const lotsOpts = newLotsOptions();

	if (tokens.length === 0) {
		return { command: null, commonOpts, lotsOpts, errors: [] };
	}

	const cmdToken = tokens[0].toLowerCase();
	const rest = tokens.slice(1);

	if (cmdToken === 'query' || cmdToken === 'q') {
		return {
			command: null,
			commonOpts,
			lotsOpts,
			errors: ['The query command is not supported in this UI']
		};
	}

	const command = COMMAND_ALIASES[cmdToken];
	if (!command) {
		return { command: null, commonOpts, lotsOpts, errors: [`Unknown command '${tokens[0]}'`] };
	}

	if (command === 'lots') {
		const { opts, errors } = parseLotsArgs(rest);
		return { command, commonOpts, lotsOpts: opts, errors };
	}

	const { opts, errors } = parseCommonArgs(rest);
	return { command, commonOpts: opts, lotsOpts, errors };
}
