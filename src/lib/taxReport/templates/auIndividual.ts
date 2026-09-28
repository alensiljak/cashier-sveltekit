import type { TaxReportConfig } from '../types';

/**
 * Starter template for an Australian individual. The account patterns assume common
 * Beancount naming; the "Unmapped" bucket shows what a book needs added.
 */
export const auIndividual: TaxReportConfig = {
	version: 1,
	templateId: 'au-individual',
	name: 'Australia – Individual',
	yearStart: { month: 7, day: 1 },
	categories: [
		{ name: 'Salary and wages', accounts: ['^Income:(Salary|Wages|Employment)'], kind: 'income' },
		{ name: 'Bank interest', accounts: ['^Income:.*Interest'], kind: 'income' },
		{ name: 'Dividends', accounts: ['^Income:.*Dividend'], kind: 'income' },
		{ name: 'Rental income', accounts: ['^Income:.*Rent'], kind: 'income' },
		{
			name: 'Work-related expenses',
			accounts: ['^Expenses:Work', '^Expenses:.*Work-?Related'],
			kind: 'deduction'
		},
		{
			name: 'Gifts and donations',
			accounts: ['^Expenses:.*(Donation|Charity|Gift)'],
			kind: 'deduction'
		},
		{
			name: 'Cost of managing tax affairs',
			accounts: ['^Expenses:.*(Tax-?Agent|Accountant|TaxAffairs)'],
			kind: 'deduction'
		}
	]
};
