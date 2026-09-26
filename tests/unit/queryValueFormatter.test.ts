/*
    Tests for the display formatting of ledger query result values.
*/
import { describe, expect, it } from 'vitest';
import {
	formatCellValue,
	formatFinancialValue,
	formatNumber
} from '$lib/utils/queryValueFormatter';

describe('formatNumber', () => {
	it('formats like the rest of the app', () => {
		expect(formatNumber('1234.5')).toBe('1,234.50');
		expect(formatNumber('-14400')).toBe('-14,400.00');
		expect(formatNumber('12.3456')).toBe('12.3456');
	});

	it('leaves non-numeric text unchanged', () => {
		expect(formatNumber('n/a')).toBe('n/a');
	});
});

describe('formatFinancialValue', () => {
	it('formats a single amount', () => {
		expect(formatFinancialValue({ number: '1860.25', currency: 'EUR' })).toBe('1,860.25 EUR');
	});

	it('formats a position by its units', () => {
		expect(formatFinancialValue({ units: { number: '10', currency: 'VTI' } })).toBe('10.00 VTI');
	});

	it('formats an inventory with one line per position', () => {
		expect(
			formatFinancialValue({
				positions: [
					{ units: { number: '684.10', currency: 'EUR' } },
					{ units: { number: '107.50', currency: 'USD' } },
					{ number: '3', currency: 'AUD' }
				]
			})
		).toBe('684.10 EUR\n107.50 USD\n3.00 AUD');
	});

	it('skips malformed positions but keeps the good ones', () => {
		expect(
			formatFinancialValue({
				positions: [
					null,
					'x',
					{ units: { number: 5 } },
					{ units: { number: '5', currency: 'EUR' } }
				]
			})
		).toBe('5.00 EUR');
	});

	it.each([
		['null', null],
		['a string', 'text'],
		['an unrelated object', { foo: 1 }],
		['an empty inventory', { positions: [] }],
		['an inventory of junk', { positions: [{ x: 1 }] }]
	])('returns null for %s', (_name, value) => {
		expect(formatFinancialValue(value)).toBeNull();
	});
});

describe('formatCellValue', () => {
	it('shows plain values as they are', () => {
		expect(formatCellValue('Expenses:Food')).toBe('Expenses:Food');
		expect(formatCellValue(42)).toBe('42');
		expect(formatCellValue(true)).toBe('true');
	});

	it('shows null and undefined as empty', () => {
		expect(formatCellValue(null)).toBe('');
		expect(formatCellValue(undefined)).toBe('');
	});

	it('shows amounts and inventories as readable text, not JSON', () => {
		const text = formatCellValue({
			positions: [{ units: { number: '14400.00', currency: 'EUR' } }]
		});

		expect(text).toBe('14,400.00 EUR');
		expect(text).not.toContain('{');
	});

	it('falls back to indented JSON for other objects', () => {
		expect(formatCellValue({ a: 1 })).toBe('{\n "a": 1\n}');
	});

	it('does not throw on values JSON cannot serialize', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		expect(formatCellValue(circular)).toBe('[object Object]');
	});
});
