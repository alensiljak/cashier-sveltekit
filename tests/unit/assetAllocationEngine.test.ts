/*
    AssetAllocationEngine tests: parsing the TOML target, the indices, summing
    holdings up the tree, offsets against target, text export and validation.
    The ledger and app services are mocked; the demo target (asset-allocation.toml)
    is the realistic input.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '$lib/data/model';

const mocks = vi.hoisted(() => ({
	getDefaultCurrency: vi.fn(async () => 'EUR'),
	ensureLoaded: vi.fn(async () => {}),
	query: vi.fn(),
	loadInvestmentAccounts: vi.fn(async (): Promise<unknown[]> => [])
}));
vi.mock('$lib/services/appService', () => ({
	default: { getDefaultCurrency: mocks.getDefaultCurrency }
}));
vi.mock('$lib/services/ledgerWorkerClient', () => ({
	default: { ensureLoaded: mocks.ensureLoaded, query: mocks.query }
}));
vi.mock('$lib/services/accountsService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/accountsService')>()),
	loadInvestmentAccounts: mocks.loadInvestmentAccounts
}));
vi.mock('$lib/utils/notifier', () => ({ default: { warning: vi.fn(), error: vi.fn() } }));

import Notifier from '$lib/utils/notifier';
import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
import { serializeToToml } from '$lib/assetAllocation/assetAllocationSerializer';
import { validate } from '$lib/assetAllocation/assetAllocationValidation';
import { UserError, ValidationError } from '$lib/utils/errors';
import { demoFixtures } from '../helpers/demoFixtures';

const demoToml = demoFixtures['asset-allocation.toml'];

/** An investment account as loadInvestmentAccounts returns it. */
function holding(name: string, currency: string, quantity: number, currentValue?: number) {
	const account = new Account(name);
	account.balances = { [currency]: quantity };
	if (currentValue !== undefined) account.currentValue = currentValue;
	return account;
}

let engine: AssetAllocationEngine;
beforeEach(() => {
	engine = new AssetAllocationEngine();
	mocks.loadInvestmentAccounts.mockReset().mockResolvedValue([]);
	vi.mocked(Notifier.warning).mockClear();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('parseDefinition', () => {
	it('linearizes the demo target into a flat, depth-first list', () => {
		const classes = engine.parseDefinition(demoToml);

		expect(classes.map((c) => [c.fullname, c.allocation])).toEqual([
			['Allocation', 100],
			['Allocation:Equity', 60],
			['Allocation:Bonds', 27],
			['Allocation:Cash', 3],
			['Allocation:Real', 10],
			['Allocation:Real:Gold', 10]
		]);
		expect(classes.find((c) => c.name === 'Gold')?.symbols).toEqual(['RING', 'UBUD.DE']);
		expect(classes.find((c) => c.name === 'Equity')?.symbols).toEqual(['VTI']);
	});

	it('rejects an empty definition with a ValidationError', () => {
		expect(() => engine.parseDefinition('')).toThrow(ValidationError);
	});

	it('propagates TOML syntax errors', () => {
		expect(() => engine.parseDefinition('[Allocation\nallocation = ')).toThrow();
	});

	it('round-trips through the serializer', () => {
		const original = engine.parseDefinition(demoToml);

		const restored = engine.parseDefinition(serializeToToml(original));

		const summary = (list: typeof original) =>
			list.map((c) => [c.fullname, c.allocation, c.symbols]);
		expect(summary(restored)).toEqual(summary(original));
	});

	// TODO: groups without `symbols` get `symbols = undefined` (linearizeObject assigns
	// child.symbols directly), overriding the class's `[]` default and its `string[]` type.
	// Every consumer guards with `?.`; consider defaulting to [] here.
});

describe('indices', () => {
	beforeEach(() => engine.parseForValidation(demoToml));

	it('indexes classes by full name', () => {
		expect(Object.keys(engine.assetClassIndex)).toEqual([
			'Allocation',
			'Allocation:Equity',
			'Allocation:Bonds',
			'Allocation:Cash',
			'Allocation:Real',
			'Allocation:Real:Gold'
		]);
	});

	it('maps each symbol to its asset class', () => {
		expect(engine.stockIndex).toEqual({
			VTI: 'Allocation:Equity',
			BND: 'Allocation:Bonds',
			EUR: 'Allocation:Cash',
			RING: 'Allocation:Real:Gold',
			'UBUD.DE': 'Allocation:Real:Gold'
		});
	});

	it('maps each parent to its children', () => {
		expect(engine.childrenIndex.get('Allocation')?.map((c) => c.name)).toEqual([
			'Equity',
			'Bonds',
			'Cash',
			'Real'
		]);
		expect(engine.childrenIndex.get('Allocation:Real')?.map((c) => c.name)).toEqual(['Gold']);
	});
});

describe('loadCurrentValues', () => {
	beforeEach(() => engine.parseForValidation(demoToml));

	it('adds each holding to the asset class of its commodity', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([
			holding('Assets:Investments:Brokerage:VTI', 'VTI', 10, 6000),
			holding('Assets:Investments:Brokerage:Cash-EUR', 'EUR', 300, 300),
			holding('Assets:Investments:Broker2:VTI', 'VTI', 5, 1000)
		]);

		const warnings = await engine.loadCurrentValues();

		expect(warnings).toEqual([]);
		expect(engine.assetClassIndex['Allocation:Equity'].currentValue.toNumber()).toBe(7000);
		expect(engine.assetClassIndex['Allocation:Cash'].currentValue.toNumber()).toBe(300);
		expect(mocks.ensureLoaded).toHaveBeenCalled();
	});

	it('warns about a commodity that is not mapped to any class', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([holding('Assets:X:GLD', 'GLD', 1, 200)]);

		const warnings = await engine.loadCurrentValues();

		expect(warnings).toEqual([expect.stringContaining('Commodity "GLD" is not mapped')]);
		expect(engine.assetClassIndex['Allocation'].currentValue.toNumber()).toBe(0);
	});

	it('warns when the mapped class is missing from the index', async () => {
		engine.stockIndex['GLD'] = 'Allocation:Nowhere';
		mocks.loadInvestmentAccounts.mockResolvedValue([holding('Assets:X:GLD', 'GLD', 1, 200)]);

		const warnings = await engine.loadCurrentValues();

		expect(warnings).toEqual([expect.stringContaining('Asset class "Allocation:Nowhere"')]);
	});

	it('skips accounts without a current value or with a zero balance', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([
			holding('Assets:X:VTI', 'VTI', 10),
			holding('Assets:Y:VTI', 'VTI', 0, 500)
		]);

		expect(await engine.loadCurrentValues()).toEqual([]);
		expect(engine.assetClassIndex['Allocation:Equity'].currentValue.toNumber()).toBe(0);
	});

	it('resets warnings on every load', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([holding('Assets:X:GLD', 'GLD', 1, 200)]);
		await engine.loadCurrentValues();
		mocks.loadInvestmentAccounts.mockResolvedValue([]);

		expect(await engine.loadCurrentValues()).toEqual([]);
	});
});

describe('loadFullAssetAllocation', () => {
	const holdings = () => [
		holding('Assets:Brokerage:VTI', 'VTI', 10, 6000),
		holding('Assets:Brokerage:BND', 'BND', 20, 2700),
		holding('Assets:Brokerage:Cash-EUR', 'EUR', 300, 300),
		holding('Assets:Brokerage:RING', 'RING', 4, 1000)
	];
	const byName = (rows: Awaited<ReturnType<typeof engine.loadFullAssetAllocation>>) =>
		Object.fromEntries(rows.map((r) => [r.fullname, r]));

	it('sums holdings up the tree and computes offsets against the target', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue(holdings());

		const rows = byName(await engine.loadFullAssetAllocation(demoToml));

		expect(rows['Allocation'].currentValue.toNumber()).toBe(10000);
		expect(rows['Allocation:Real'].currentValue.toNumber()).toBe(1000);
		expect(rows['Allocation:Real:Gold'].currentValue.toNumber()).toBe(1000);

		// Exactly on target for Equity (60%), Bonds (27%), Cash (3%), Real (10%).
		for (const [name, target] of [
			['Allocation:Equity', 60],
			['Allocation:Bonds', 27],
			['Allocation:Cash', 3],
			['Allocation:Real', 10]
		] as const) {
			expect(rows[name].currentAllocation).toBeCloseTo(target);
			expect(rows[name].diff).toBeCloseTo(0);
			expect(rows[name].diffAmount).toBeCloseTo(0);
		}
		expect(rows['Allocation:Equity'].allocatedValue.toNumber()).toBeCloseTo(6000);
	});

	it('reports over- and under-weight classes', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([
			holding('Assets:Brokerage:VTI', 'VTI', 10, 8000), // 80% vs 60% target
			holding('Assets:Brokerage:BND', 'BND', 20, 2000) // 20% vs 27% target
		]);

		const rows = byName(await engine.loadFullAssetAllocation(demoToml));

		expect(rows['Allocation:Equity'].diff).toBeCloseTo(20);
		expect(rows['Allocation:Equity'].diffPerc).toBeCloseTo(33.33, 1);
		expect(rows['Allocation:Equity'].diffAmount).toBeCloseTo(2000);
		expect(rows['Allocation:Bonds'].diff).toBeCloseTo(-7);
		expect(rows['Allocation:Bonds'].diffAmount).toBeCloseTo(-700);
	});

	it('leaves offsets at zero when nothing is held', async () => {
		const rows = byName(await engine.loadFullAssetAllocation(demoToml));

		expect(rows['Allocation'].currentValue.toNumber()).toBe(0);
		expect(rows['Allocation:Equity'].currentAllocation).toBe(0);
		expect(rows['Allocation:Equity'].diff).toBe(0);
	});

	it('does not lose precision summing decimal values', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([
			holding('Assets:B:VTI', 'VTI', 1, 0.1),
			holding('Assets:C:VTI', 'VTI', 1, 0.2)
		]);

		const rows = byName(await engine.loadFullAssetAllocation(demoToml));

		expect(rows['Allocation:Equity'].currentValue.toString()).toBe('0.3');
	});

	it('returns nothing for a definition with no classes', async () => {
		expect(await engine.loadFullAssetAllocation('# nothing here')).toEqual([]);
	});

	it('demands an Allocation root', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([]);

		await expect(engine.loadFullAssetAllocation('[Portfolio]\nallocation = 100\n')).rejects.toThrow(
			UserError
		);
	});

	// TODO: a class with `allocation = 0` makes diffPerc Infinity/NaN (division by the target),
	// which the text export then prints as 0.00. Decide what a zero target should show.
});

describe('formatAllocationRowsForTxtExport', () => {
	it('prints a header plus one indented, padded row per class', async () => {
		mocks.loadInvestmentAccounts.mockResolvedValue([
			holding('Assets:B:VTI', 'VTI', 10, 8000),
			holding('Assets:B:BND', 'BND', 20, 2000)
		]);
		const rows = await engine.loadFullAssetAllocation(demoToml);

		const lines = engine.formatAllocationRowsForTxtExport(rows).split('\n');

		expect(lines).toHaveLength(1 + rows.length);
		expect(lines[0]).toContain('Asset Class');
		expect(lines[1]).toMatch(/^Allocation\s+100\.00\s+100\.00\s+0\.00/);
		expect(lines[2]).toMatch(
			/^ {2}Equity\s+60\.00\s+80\.00\s+20\.00\s+33\.33\s+6,000\.00\s+8,000\.00\s+2,000\.00$/
		);
		expect(lines[6]).toMatch(/^ {4}Gold\s+10\.00/);
	});
});

describe('validate', () => {
	it('accepts the demo target', () => {
		engine.parseForValidation(demoToml);

		expect(validate(engine)).toEqual([]);
		expect(Notifier.warning).not.toHaveBeenCalled();
	});

	it('reports a group whose allocation differs from the sum of its children', () => {
		engine.parseForValidation(
			'[Allocation]\nallocation = 100\n[Allocation.A]\nallocation = 60\n[Allocation.B]\nallocation = 30\n'
		);

		const errors = validate(engine);

		expect(errors).toEqual(["- 'Allocation' does not match the sum of child classes!\n"]);
		expect(Notifier.warning).toHaveBeenCalledOnce();
	});

	it('ignores leaf classes', () => {
		engine.parseForValidation('[Allocation]\nallocation = 100\n');

		expect(validate(engine)).toEqual([]);
	});

	it('tolerates floating-point rounding in the sum', () => {
		engine.parseForValidation(
			'[Allocation]\nallocation = 0.3\n[Allocation.A]\nallocation = 0.1\n[Allocation.B]\nallocation = 0.2\n'
		);

		expect(validate(engine)).toEqual([]);
	});
});
