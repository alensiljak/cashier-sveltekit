/*
    Pure helper functions for the RLedger page.
*/

import type { Directive } from '@rustledger/wasm';

/**
 * Human-readable one-line summary for a directive, used in the directives table.
 */
export function formatDirectiveSummary(directive: Directive): string {
	switch (directive.type) {
		case 'transaction':
			return `${directive.narration || '(no narration)'} | ${directive.postings.length} posting(s)`;
		case 'balance':
			return `${directive.account} = ${directive.amount.number} ${directive.amount.currency}`;
		case 'open':
			return `${directive.account}${directive.currencies.length ? ` | ${directive.currencies.join(', ')}` : ''}`;
		case 'close':
			return directive.account;
		case 'commodity':
			return directive.currency;
		case 'pad':
			return `${directive.account} <= ${directive.source_account}`;
		case 'event':
			return `${directive.event_type}: ${directive.value}`;
		case 'note':
			return `${directive.account}: ${directive.comment}`;
		case 'document':
			return `${directive.account}: ${directive.path}`;
		case 'price':
			return `${directive.currency} ${directive.amount.number} ${directive.amount.currency}`;
		case 'query':
			return `${directive.name}: ${directive.query_string}`;
		case 'custom':
			return directive.custom_type;
		default:
			return '';
	}
}

/**
 * Find the last transaction directive in an array.
 */
export function findLastTransactionDirective(directives: Directive[]): Directive | null {
	for (let i = directives.length - 1; i >= 0; i -= 1) {
		if (directives[i].type === 'transaction') {
			return directives[i];
		}
	}
	return null;
}

/**
 * Extract unique payees with their descriptions from transaction directives.
 */
export function extractPayees(
	directives: Directive[]
): Array<{ payee: string; descriptions: string[] }> {
	const payeeMap = new Map<string, Set<string>>();
	for (const directive of directives) {
		if (directive.type === 'transaction') {
			const payee = directive.payee || '(no payee)';
			const descriptions = payeeMap.get(payee) || new Set<string>();
			if (directive.narration) {
				descriptions.add(directive.narration);
			}
			payeeMap.set(payee, descriptions);
		}
	}
	return Array.from(payeeMap.entries())
		.map(([payee, descriptions]) => ({
			payee,
			descriptions: Array.from(descriptions).sort()
		}))
		.sort((a, b) => a.payee.localeCompare(b.payee));
}

/**
 * Return demo Beancount transactions for testing.
 */
export function createDemoSource(): string {
	return `2024-01-01 * "Opening Balance" "Initial balances"
    Assets:Bank:Checking   1000.00 EUR
    Assets:Bank:Savings    500.00 EUR
    Liabilities:CreditCard -200.00 EUR

2024-01-02 * "Transfer" "Moving money"
    Assets:Bank:Checking   -100.00 EUR
    Assets:Bank:Savings     100.00 EUR`;
}
