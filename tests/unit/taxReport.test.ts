import { describe, expect, it } from 'vitest';
import {
	buildTaxReport,
	currentFinancialYearStart,
	financialYearRange,
	validateTaxReportConfig
} from '#lib/taxReport/engine';
import { detectCurrencies, findUnconvertedCurrencies } from '#lib/taxReport/currencies';
import { auIndividual } from '#lib/taxReport/templates/auIndividual';
import type { TaxReportConfig } from '#lib/taxReport/types';

const config: TaxReportConfig = {
	version: 1,
	name: 'Test',
	yearStart: { month: 7, day: 1 },
	categories: [
		{ name: 'Salary', accounts: ['^Income:Salary'], kind: 'income' },
		{ name: 'Work', accounts: ['^Expenses:Work'], kind: 'deduction' }
	]
};

describe('financialYearRange', () => {
	it('spans 1 Jul to 30 Jun for Australia', () => {
		expect(financialYearRange({ month: 7, day: 1 }, 2024)).toEqual({
			from: '2024-07-01',
			to: '2025-06-30'
		});
	});
	it('spans the calendar year when starting 1 Jan', () => {
		expect(financialYearRange({ month: 1, day: 1 }, 2024)).toEqual({
			from: '2024-01-01',
			to: '2024-12-31'
		});
	});
});

describe('currentFinancialYearStart', () => {
	it('is the previous year before 1 July', () => {
		expect(currentFinancialYearStart({ month: 7, day: 1 }, new Date(2025, 2, 10))).toBe(2024);
	});
	it('is the same year from 1 July', () => {
		expect(currentFinancialYearStart({ month: 7, day: 1 }, new Date(2025, 6, 1))).toBe(2025);
	});
});

describe('buildTaxReport', () => {
	it('groups postings, flips income sign, and collects unmapped accounts', () => {
		const result = buildTaxReport(config, [
			{ date: '2024-08-01', account: 'Income:Salary:Acme', amount: -1000 },
			{ date: '2024-09-01', account: 'Income:Salary:Acme', amount: -500 },
			{ date: '2024-09-02', account: 'Expenses:Work:Tools', amount: 80 },
			{ date: '2024-09-03', account: 'Expenses:Food', amount: 20 }
		]);
		expect(result.categories[0].total).toBe(1500);
		expect(result.categories[1].total).toBe(80);
		expect(result.unmapped.total).toBe(20);
		expect(result.unmapped.accounts).toEqual([{ account: 'Expenses:Food', total: 20 }]);
	});

	it('assigns a posting to the first matching category only', () => {
		const dup: TaxReportConfig = {
			...config,
			categories: [
				{ name: 'A', accounts: ['^Expenses'], kind: 'deduction' },
				{ name: 'B', accounts: ['^Expenses:Work'], kind: 'deduction' }
			]
		};
		const result = buildTaxReport(dup, [
			{ date: '2024-08-01', account: 'Expenses:Work', amount: 5 }
		]);
		expect(result.categories.map((c) => c.total)).toEqual([5, 0]);
	});

	it('sets excluded accounts aside, out of categories and unmapped', () => {
		const result = buildTaxReport({ ...config, excludeAccounts: ['^Expenses:Vacation'] }, [
			{ date: '2024-08-01', account: 'Expenses:Vacation:Days', amount: 3 },
			{ date: '2024-08-02', account: 'Expenses:Work:Tools', amount: 80 }
		]);
		expect(result.excluded.accounts).toEqual([{ account: 'Expenses:Vacation:Days', total: 3 }]);
		expect(result.unmapped.accounts).toEqual([]);
		expect(result.categories[1].total).toBe(80);
	});
});

describe('validateTaxReportConfig', () => {
	it('accepts the built-in AU template', () => {
		expect(validateTaxReportConfig(auIndividual)).toBeNull();
	});
	it('rejects invalid patterns and wrong versions', () => {
		expect(validateTaxReportConfig({ ...config, version: 2 })).toMatch(/version/);
		expect(
			validateTaxReportConfig({
				...config,
				categories: [{ name: 'X', accounts: ['('], kind: 'income' }]
			})
		).toMatch(/invalid pattern/);
		expect(validateTaxReportConfig({ ...config, excludeAccounts: ['('] })).toMatch(
			/excludeAccounts/
		);
		expect(
			validateTaxReportConfig({ ...config, excludeAccounts: ['^Expenses:Vacation'] })
		).toBeNull();
	});
});

describe('detectCurrencies', () => {
	it('excludes securities held at cost but keeps their cost currencies', () => {
		const result = detectCurrencies(
			[
				{ currency: 'EUR' },
				{ currency: 'AUD', costCurrency: null },
				{ currency: 'VTI', costCurrency: 'USD' },
				{ currency: 'RING', costCurrency: 'AUD' },
				{ currency: 'VTI' }
			],
			['EUR']
		);
		expect(result).toEqual(['AUD', 'EUR', 'USD']);
	});
});

describe('findUnconvertedCurrencies', () => {
	it('flags foreign currencies whose converted amount equals their units', () => {
		const rows = [
			{ currency: 'AUD', units: 100, converted: 100 },
			{ currency: 'EUR', units: 50, converted: 82.5 },
			{ currency: 'USD', units: 10, converted: 10 },
			{ currency: 'USD', units: 0, converted: 0 }
		];
		expect(findUnconvertedCurrencies(rows, 'AUD')).toEqual(['USD']);
	});
});
