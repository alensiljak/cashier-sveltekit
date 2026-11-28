/*
    Importer configs are shared settings: backed up and synced as plain text. The types cannot tell
    that a field is a secret, so every field is listed here. A new one fails the type check until it
    is added, which is the moment to ask whether it is a secret. If it is, it does not belong in a
    config: make it a device setting with its own backup rule.
*/
import { describe, expect, it } from 'vitest';
import type { EnableBankingConfig } from '#lib/importers/enablebanking/config';
import type { IbkrConfig } from '#lib/importers/ibkr/config';
import type { N26Config } from '#lib/importers/n26';
import type { Rule } from '#lib/importers/rules';
import type { ScalableConfig } from '#lib/importers/scalable/config';
import { listImporters } from '#lib/importers';

/** Every field of `T`, none left out and none extra. */
type Fields<T> = Record<keyof T, true>;

const FIELDS: Record<string, Record<string, true>> = {
	ibkr: {
		cashAccount: true,
		stockAccount: true,
		distributionAccount: true,
		interestAccount: true,
		distributionPayee: true,
		capitalGainAccount: true,
		brokerInterestAccount: true,
		feesAccount: true,
		withholdingTaxAccount: true,
		transferAccounts: true,
		symbols: true,
		sections: true
	} satisfies Fields<IbkrConfig>,
	n26: {
		account: true,
		currency: true,
		defaultIncome: true,
		defaultExpense: true,
		dividendAccount: true,
		dividendPayee: true,
		isinToSymbol: true,
		rules: true,
		payeeRenames: true,
		categories: true
	} satisfies Fields<N26Config>,
	scalable: { portfolioId: true } satisfies Fields<ScalableConfig>,
	enablebanking: {
		selectedAccount: true,
		daysBack: true,
		psuType: true
	} satisfies Fields<EnableBankingConfig>
};

const RULE_FIELDS = {
	match: true,
	payee: true,
	account: true,
	disabled: true
} satisfies Fields<Rule>;

const SECRET_NAME = /secret|token|passw|passphrase|credential|key/i;

describe('importer configs', () => {
	it('are all listed here', () => {
		expect(
			listImporters()
				.map((i) => i.id)
				.sort()
		).toEqual(Object.keys(FIELDS).sort());
	});

	it('have no field named like a secret', () => {
		const names = [...Object.values(FIELDS), RULE_FIELDS].flatMap((f) => Object.keys(f));

		expect(names.filter((name) => SECRET_NAME.test(name))).toEqual([]);
	});

	it.each(listImporters())('$id has only listed fields in its default config', (importer) => {
		for (const field of Object.keys(importer.defaultConfig as object)) {
			expect(FIELDS[importer.id]).toHaveProperty(field);
		}
	});
});
