/*
	Regression test for the "Data fidelity" open issue in
	doc/projects/2026-09-25_better-sync.md.

	Root cause found here: `PostingJson` in `@rustledger/wasm` has no
	`comment` field, and standalone `; text` lines between postings have no
	representation in the directive JSON at all. Comments are dropped by the
	WASM parser itself, before `directiveToXact` or `xactToBeancountText` ever
	see the transaction — this is not something the Cashier app layer can fix.
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { ensureInitialized, parseSource } from '$lib/services/rustledger';
import { directiveToXact } from '$lib/utils/transactionParser';
import { xactToBeancountText } from '$lib/utils/xactUtils';

const SOURCE = `2026-09-28 * "Employer" "salary"
  Income:Salary:Gross     -10000 EUR ; Gross Salary
  ; deductions
  Expenses:Tax:Staff   2500 EUR ; Staff Tax
  Assets:Bank-Accounts:Checking  7500 EUR
`;

describe('Data fidelity: posting comments are lost by the WASM parser, not the app', () => {
	beforeAll(async () => {
		await ensureInitialized();
	});

	it('does not expose posting-trailing or standalone comments on the parsed directive', () => {
		const result = parseSource(SOURCE);
		const directive = (result.ledger as any)?.directives?.find(
			(d: any) => d.type === 'transaction'
		);

		expect(directive).toBeDefined();
		for (const posting of directive.postings) {
			expect(posting.comment).toBeUndefined();
		}
		// The standalone "; deductions" line has no directive-level trace either:
		// it doesn't appear as extra postings, meta, or a comments array.
		expect(directive.postings).toHaveLength(3);
		expect(Object.keys(directive)).not.toContain('comments');
	});

	it('so Xact conversion and the beancount rebuild cannot recover them either', () => {
		const result = parseSource(SOURCE);
		const directive = (result.ledger as any)?.directives?.find(
			(d: any) => d.type === 'transaction'
		);

		const xact = directiveToXact(directive, SOURCE);
		expect(xact.postings.every((p) => (p as any).comment == null)).toBe(true);

		const rebuilt = xactToBeancountText(xact);
		expect(rebuilt).not.toContain(';');
	});
});
