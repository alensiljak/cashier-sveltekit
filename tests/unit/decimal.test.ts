import { describe, expect, it } from 'vitest';
import { Dec, sumDec } from '../../src/lib/utils/decimal';

const d = Dec.parse;

describe('Dec', () => {
	it('parses plain, signed and exponent notation', () => {
		expect(d('12.50').toString()).toBe('12.5');
		expect(d('-0.0100').toString()).toBe('-0.01');
		expect(d('.5').toString()).toBe('0.5');
		expect(d('5.').toString()).toBe('5');
		expect(d('1E-7').toString()).toBe('0.0000001');
		expect(d('1.5e3').toString()).toBe('1500');
		expect(d('0').toString()).toBe('0');
		expect(d('-0.00').toString()).toBe('0');
	});

	it('rejects text that is not a number', () => {
		for (const bad of ['', '-', '.', 'abc', '1,5', '1.2.3', 'NaN']) {
			expect(() => d(bad), bad).toThrow(SyntaxError);
		}
	});

	it('adds and subtracts without floating-point noise', () => {
		expect(d('0.1').add(d('0.2')).toNumber()).toBe(0.3);
		expect(0.1 + 0.2).not.toBe(0.3); // the problem being avoided
		expect(d('8534.193919696').sub(d('0.000000001')).toString()).toBe('8534.193919695');
		expect(sumDec([d('0.44'), d('0.08'), d('-0.52')]).isZero()).toBe(true);
		expect(sumDec([]).toString()).toBe('0');
	});

	it('negates, takes the absolute value and the sign', () => {
		expect(d('1.5').neg().toString()).toBe('-1.5');
		expect(d('-1.5').abs().toString()).toBe('1.5');
		expect([d('-2').sign, d('0').sign, d('3').sign]).toEqual([-1, 0, 1]);
	});

	it('multiplies', () => {
		expect(d('1.5').mul(d('-0.04')).toString()).toBe('-0.06');
	});

	it('compares values of different scales', () => {
		expect(d('1.50').cmp(d('1.5'))).toBe(0);
		expect(d('1.49').cmp(d('1.5'))).toBe(-1);
		expect(d('-1').cmp(d('-2.5'))).toBe(1);
	});

	it('quantizes half-even, like Python Decimal', () => {
		expect(d('0.125').quantize(2).toString()).toBe('0.12');
		expect(d('0.135').quantize(2).toString()).toBe('0.14');
		expect(d('-0.125').quantize(2).toString()).toBe('-0.12');
		expect(d('2.5').quantize(0).toString()).toBe('2');
		expect(d('3.5').quantize(0).toString()).toBe('4');
		expect(d('1.5').quantize(4).toString()).toBe('1.5');
	});

	it('divides with rounding, as for a forex rate', () => {
		// forex-combine fixture: 560.3775 USD for 492.0924 EUR
		expect(d('560.3775').div(d('492.0924'), 5).toString()).toBe('1.13876');
		expect(d('1').div(d('3'), 4).toString()).toBe('0.3333');
		expect(d('-1').div(d('3'), 4).toString()).toBe('-0.3333');
		expect(d('2').div(d('-3'), 4).toString()).toBe('-0.6667');
		expect(() => d('1').div(d('0'), 2)).toThrow(RangeError);
	});

	it('reports the precision without trailing zeros', () => {
		expect(d('7.50').precision).toBe(1);
		expect(d('100').precision).toBe(0);
		expect(d('0.0000001').precision).toBe(7);
	});

	it('converts to a number only at the end', () => {
		expect(d('5.531923234').toNumber()).toBe(5.531923234);
		expect(Dec.of(0.1).add(Dec.of(0.2)).toNumber()).toBe(0.3);
	});
});
