/*
    Tests for AssetClass naming/depth and the small asset-allocation helpers
    (row/offset colours, children index, TOML serializer, ledger output parser).
*/
import { describe, expect, it } from 'vitest';
import { AssetClass } from '$lib/assetAllocation/AssetClass';
import {
	buildChildrenIndex,
	getOffsetColor,
	getRowColor
} from '$lib/assetAllocation/assetAllocationUtils';
import { serializeToToml } from '$lib/assetAllocation/assetAllocationSerializer';
import { LedgerOutputParser } from '$lib/assetAllocation/ledgerOutputParser';

function assetClass(fullname: string, allocation = 0, symbols?: string[]): AssetClass {
	const ac = new AssetClass();
	ac.fullname = fullname;
	ac.allocation = allocation;
	if (symbols) ac.symbols = symbols;
	return ac;
}

describe('AssetClass', () => {
	it('derives name, parent and depth from the full name', () => {
		const root = assetClass('Allocation');
		const gold = assetClass('Allocation:Real:Gold');

		expect([root.name, root.parentName, root.depth]).toEqual(['Allocation', '', 0]);
		expect([gold.name, gold.parentName, gold.depth]).toEqual(['Gold', 'Allocation:Real', 2]);
	});

	it('starts with zeroed values', () => {
		const ac = new AssetClass();

		expect(ac.currentValue.toNumber()).toBe(0);
		expect(ac.allocatedValue.toNumber()).toBe(0);
		expect(ac.symbols).toEqual([]);
	});
});

describe('getOffsetColor', () => {
	it.each([
		[-25, 'text-red-700'],
		[-20, 'text-red-700'],
		[-5, 'text-red-300'],
		[0, ''],
		[5, 'text-green-300'],
		[19.9, 'text-green-300'],
		[20, 'text-green-700'],
		[50, 'text-green-700']
	])('%s -> %s', (value, colour) => {
		expect(getOffsetColor(value)).toBe(colour);
	});
});

describe('getRowColor', () => {
	it('shades groups by depth and leaves symbol-bearing leaves plain', () => {
		expect(getRowColor(assetClass('Allocation'))).toBe('bg-gray-600');
		expect(getRowColor(assetClass('Allocation:Real'))).toBe('bg-gray-700');
		expect(getRowColor(assetClass('Allocation:Real:Gold'))).toBe('bg-gray-800');
		expect(getRowColor(assetClass('Allocation:A:B:C'))).toBe('');
		expect(getRowColor(assetClass('Allocation:Equity', 60, ['VTI']))).toBe('');
	});
});

describe('buildChildrenIndex', () => {
	it('groups classes under their parent name', () => {
		const classes = [
			assetClass('Allocation'),
			assetClass('Allocation:Equity'),
			assetClass('Allocation:Real'),
			assetClass('Allocation:Real:Gold')
		];

		const index = buildChildrenIndex(classes);

		expect(index.get('Allocation')?.map((c) => c.name)).toEqual(['Equity', 'Real']);
		expect(index.get('Allocation:Real')?.map((c) => c.name)).toEqual(['Gold']);
		expect(index.get('Allocation:Equity')).toBeUndefined();
	});
});

describe('serializeToToml', () => {
	it('writes depth-first tables with allocation and symbols', () => {
		const toml = serializeToToml([
			assetClass('Allocation', 100),
			assetClass('Allocation:Equity', 60, ['VTI', 'VWCE']),
			assetClass('Allocation:Real', 40),
			assetClass('Allocation:Real:Gold', 40, ['RING'])
		]);

		expect(toml).toBe(
			[
				'[Allocation]',
				'allocation = 100',
				'',
				'[Allocation.Equity]',
				'allocation = 60',
				'symbols = ["VTI", "VWCE"]',
				'',
				'[Allocation.Real]',
				'allocation = 40',
				'',
				'[Allocation.Real.Gold]',
				'allocation = 40',
				'symbols = ["RING"]',
				''
			].join('\n')
		);
	});

	it('produces just a newline for no classes', () => {
		expect(serializeToToml([])).toBe('\n');
	});
});

describe('LedgerOutputParser.getTotalLines', () => {
	const parser = new LedgerOutputParser();

	it('takes the line after the separator as the total', () => {
		expect(parser.getTotalLines(['10 EUR  A', '20 EUR  B', '--------', '30 EUR'])).toEqual([
			'30 EUR'
		]);
	});

	it('uses a single-line report as-is, and 0 for an empty one', () => {
		expect(parser.getTotalLines(['10 EUR  A'])).toEqual(['10 EUR  A']);
		expect(parser.getTotalLines([''])).toEqual(['0']);
	});

	it('returns nothing when there is no separator', () => {
		expect(parser.getTotalLines(['a', 'b'])).toEqual([]);
	});

	it('throws when the total line is blank', () => {
		expect(() => parser.getTotalLines(['a', '------', ''])).toThrow('No total received!');
	});
});
