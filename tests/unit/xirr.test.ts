import { xirr, XirrNoSolutionError, type CashFlow } from '$lib/utils/xirr';
import { describe, expect, it } from 'vitest';

/** Present value of `flows` at `rate`, used to assert the solver actually zeroes the NPV. */
function npvAt(flows: CashFlow[], rate: number): number {
	const t0 = flows[0].date.getTime();
	return flows.reduce((sum, { date, amount }) => {
		const years = (date.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
		return sum + amount / (1 + rate) ** years;
	}, 0);
}

describe('xirr', () => {
	it('solves a simple single-period investment (known closed-form rate)', () => {
		// Invest 1000 on day 0, worth 1100 exactly 365 days later (non-leap year) => 10% IRR.
		const flows: CashFlow[] = [
			{ date: new Date('2023-01-01'), amount: -1000 },
			{ date: new Date('2024-01-01'), amount: 1100 }
		];
		expect(xirr(flows)).toBeCloseTo(0.1, 4);
	});

	it('solves a multi-flow series with an interim contribution', () => {
		// Classic XIRR textbook example: -1000 on day 0, -500 after 6mo, 1500 after 1yr.
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: -1000 },
			{ date: new Date('2024-07-01'), amount: -500 },
			{ date: new Date('2025-01-01'), amount: 1500 }
		];
		const rate = xirr(flows);
		expect(Math.abs(npvAt(flows, rate))).toBeLessThan(1e-4);
	});

	it('finds the same root regardless of input ordering', () => {
		const flows: CashFlow[] = [
			{ date: new Date('2025-01-01'), amount: 1500 },
			{ date: new Date('2024-01-01'), amount: -1000 },
			{ date: new Date('2024-07-01'), amount: -500 }
		];
		const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
		expect(xirr(flows)).toBeCloseTo(xirr(sorted), 6);
	});

	it('handles a loss (negative IRR)', () => {
		// Invest 1000, worth only 800 a year later => -20% IRR.
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: -1000 },
			{ date: new Date('2025-01-01'), amount: 800 }
		];
		expect(xirr(flows)).toBeCloseTo(-0.2, 3);
	});

	it('handles an extreme gain requiring the bisection fallback range', () => {
		// 3x return in a month is a rate far enough from Newton's default 10% guess that it
		// forces the bisection fallback.
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: -100 },
			{ date: new Date('2024-02-01'), amount: 300 }
		];
		const rate = xirr(flows);
		expect(rate).toBeGreaterThan(0);
		expect(Math.abs(npvAt(flows, rate))).toBeLessThan(1e-3);
	});

	it('throws when fewer than two flows are given', () => {
		expect(() => xirr([{ date: new Date('2024-01-01'), amount: -1000 }])).toThrow(
			XirrNoSolutionError
		);
	});

	it('throws when all flows share the same date', () => {
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: -1000 },
			{ date: new Date('2024-01-01'), amount: 1000 }
		];
		expect(() => xirr(flows)).toThrow(XirrNoSolutionError);
	});

	it('throws when flows are all outflows (no money ever returned)', () => {
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: -1000 },
			{ date: new Date('2024-06-01'), amount: -200 }
		];
		expect(() => xirr(flows)).toThrow(XirrNoSolutionError);
	});

	it('throws when flows are all inflows (no investment ever made)', () => {
		const flows: CashFlow[] = [
			{ date: new Date('2024-01-01'), amount: 1000 },
			{ date: new Date('2024-06-01'), amount: 200 }
		];
		expect(() => xirr(flows)).toThrow(XirrNoSolutionError);
	});

	it('matches a manually-verified realistic beangrow-style series', () => {
		// Deposit, dividend reinvestment shows up only in ending value (no separate flow),
		// a mid-year top-up, then a partial withdrawal, ending with a synthetic closing value.
		const flows: CashFlow[] = [
			{ date: new Date('2023-01-01'), amount: -10000 }, // opening buy
			{ date: new Date('2023-07-01'), amount: -2000 }, // top-up
			{ date: new Date('2024-01-01'), amount: 3000 }, // partial withdrawal
			{ date: new Date('2024-07-01'), amount: 11500 } // closing market value
		];
		const rate = xirr(flows);
		expect(Math.abs(npvAt(flows, rate))).toBeLessThan(1e-4);
		// Sanity bound: this series returns roughly 20-40%/year given the flow sizes/timing.
		expect(rate).toBeGreaterThan(0.1);
		expect(rate).toBeLessThan(0.6);
	});
});
