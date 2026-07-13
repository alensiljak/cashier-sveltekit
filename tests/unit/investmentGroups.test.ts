import { AssetClass } from '$lib/assetAllocation/AssetClass';
import { Account, Money } from '$lib/data/model';
import { deriveInvestmentGroups } from '$lib/portfolioReturns/investmentGroups';
import { describe, expect, it } from 'vitest';

function assetClass(fullname: string, symbols: string[]): AssetClass {
	const ac = new AssetClass();
	ac.fullname = fullname;
	ac.symbols = symbols;
	return ac;
}

function account(name: string, currency: string): Account {
	const acct = new Account(name);
	const balance = new Money();
	balance.currency = currency;
	balance.quantity = 100;
	acct.balance = balance;
	return acct;
}

describe('deriveInvestmentGroups', () => {
	it('groups accounts by the leaf asset class holding their commodity', () => {
		const assetClasses = [
			assetClass('Allocation', []), // root, aggregates children, no symbols
			assetClass('Allocation:Equity:US', ['VTI']),
			assetClass('Allocation:Equity:Intl', ['VXUS'])
		];
		const accounts = [
			account('Assets:Investments:Broker:VTI', 'VTI'),
			account('Assets:Investments:Broker:VXUS', 'VXUS')
		];

		const groups = deriveInvestmentGroups(assetClasses, accounts);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ name: 'Allocation:Equity:US', symbols: ['VTI'] });
		expect(groups[0].accounts.map((a) => a.name)).toEqual(['Assets:Investments:Broker:VTI']);
		expect(groups[1]).toMatchObject({ name: 'Allocation:Equity:Intl', symbols: ['VXUS'] });
		expect(groups[1].accounts.map((a) => a.name)).toEqual(['Assets:Investments:Broker:VXUS']);
	});

	it('skips asset classes with no symbols (rollup-only nodes)', () => {
		const assetClasses = [assetClass('Allocation', []), assetClass('Allocation:Equity', [])];
		const accounts = [account('Assets:Investments:Broker:VTI', 'VTI')];

		expect(deriveInvestmentGroups(assetClasses, accounts)).toEqual([]);
	});

	it('skips asset classes whose symbols have no matching account', () => {
		const assetClasses = [assetClass('Allocation:Equity:US', ['VTI'])];
		const accounts = [account('Assets:Investments:Broker:BND', 'BND')];

		expect(deriveInvestmentGroups(assetClasses, accounts)).toEqual([]);
	});

	it('collects multiple accounts under the same symbol into one group', () => {
		const assetClasses = [assetClass('Allocation:Equity:US', ['VTI'])];
		const accounts = [
			account('Assets:Investments:BrokerA:VTI', 'VTI'),
			account('Assets:Investments:BrokerB:VTI', 'VTI')
		];

		const groups = deriveInvestmentGroups(assetClasses, accounts);

		expect(groups).toHaveLength(1);
		expect(groups[0].accounts.map((a) => a.name)).toEqual([
			'Assets:Investments:BrokerA:VTI',
			'Assets:Investments:BrokerB:VTI'
		]);
	});

	it('ignores accounts without a populated balance', () => {
		const assetClasses = [assetClass('Allocation:Equity:US', ['VTI'])];
		const accounts = [new Account('Assets:Investments:Broker:VTI')]; // balance never populated

		expect(deriveInvestmentGroups(assetClasses, accounts)).toEqual([]);
	});
});
