/*
    Asset Allocation
*/
import appService from '$lib/services/appService';
import { AssetClass, type AssetClassDefinition } from './AssetClass';
import numeral from 'numeral';
import toml from 'toml';
import { getAccountBalance, loadInvestmentAccounts } from '$lib/services/accountsService';
import Big from 'big.js';
import type { Money } from '../data/model';
import { NUMBER_FORMAT } from '../constants';
import type { CurrentValuesDict } from '$lib/utils/beancountParser';

/**
 * loadDefinition = loads the pre-set definition
 */
export class AssetAllocationEngine {
	assetClasses: AssetClass[] = [];
	assetClassIndex: Record<string, AssetClass>;
	stockIndex: Record<string, string>;

	constructor() {
		this.assetClassIndex = {};
		this.stockIndex = {};
	}

	async loadFullAssetAllocation(definition: string): Promise<AssetClass[]> {
		// aa definition

		this.assetClasses = await this.parseDefinition(definition);
		if (!this.assetClasses.length) return [];

		this.assetClassIndex = this.buildAssetClassIndex(this.assetClasses);

		// build the stock index
		this.stockIndex = this.buildStockIndex(this.assetClasses);

		await this.loadCurrentValues();

		// Sum the balances for groups.
		this.sumGroupBalances(this.assetClassIndex);

		// validation, check the allocation for groups, compare to sum of children's
		// this.validate(this.assetClassIndex);

		// calculate offsets
		this.calculateOffsets(this.assetClassIndex);

		// Format numbers for output. Now done in the view.
		// this.formatNumbers(this.assetClassIndex)

		// convert to array for display in a table
		const result: AssetClass[] = Object.values(this.assetClassIndex);

		return result;
	}

	buildAssetClassIndex(assetClasses: AssetClass[]): Record<string, AssetClass> {
		const index: Record<string, AssetClass> = {};

		for (let i = 0; i < assetClasses.length; i++) {
			const ac = assetClasses[i];
			index[ac.fullname] = ac;
		}

		return index;
	}

	/**
	 * Build the index of stocks for easy retrieval.
	 * @param {Array} asetClasses
	 */
	buildStockIndex(asetClasses: AssetClass[]): Record<string, string> {
		const index: Record<string, string> = {};

		for (let i = 0; i < asetClasses.length; i++) {
			const assetClass = asetClasses[i];
			if (!assetClass.symbols) continue;

			const stocks = assetClass.symbols;
			for (let j = 0; j < stocks.length; j++) {
				const stock = stocks[j];

				index[stock] = assetClass.fullname;
			}
		}
		return index;
	}

	/**
	 * Calculate offsets of the current values from the set allocation values.
	 * @param dictionary Asset Class Index dictionary
	 * @returns
	 */
	calculateOffsets(dictionary: Record<string, AssetClass>) {
		const root = dictionary['Allocation'];
		const total = root.currentValue;
		if (total.eq(Big(0))) return;

		Object.values(dictionary).forEach((ac) => {
			// calculate current allocation
			ac.currentAllocation = ac.currentValue.times(100).div(total).toNumber();

			// diff
			ac.diff = ac.currentAllocation - ac.allocation;

			// diff %
			ac.diffPerc = (ac.diff * 100) / ac.allocation;

			ac.allocatedValue = Big((ac.allocation * total.toNumber()) / 100);

			ac.diffAmount = ac.currentValue.minus(ac.allocatedValue).toNumber();
		});
	}

	cleanBlankArrayItems(array: string[]) {
		let i = 0;
		while (i < array.length) {
			const part = array[i];
			if (part === '') {
				array.splice(i, 1);
			} else {
				i++;
			}
		}
		return array;
	}

	/**
	 * Formats the array of Asset Classes (the end result) for txt output.
	 * The output can be stored for historical purposes, compared, etc.
	 * @param {Array} rows
	 */
	formatAllocationRowsForTxtExport(rows: AssetClass[]) {
		const outputRows = [];
		outputRows.push(
			'Asset Class       Allocation Current  Diff.  Diff.%  Alloc.Val.  Curr. Val.  Difference'
		);

		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];

			/*
            {"name": "Asset Class", "width": 22},
            {"name": "alloc.", "width": 5},
            {"name": "cur.al.", "width": 6},
            {"name": "diff.", "width": 6},
            {"name": "al.val.", "width": 8},
            {"name": "value", "width": 8},
            {"name": "loc.cur.", "width": 13},
            {"name": "diff", "width": 8}
      */
			let space = '';
			for (let i = row.depth * 2; i > 0; i--) {
				space += ' ';
			}
			// let name = row.name.padStart(22, ' ')
			const firstCol = (space + row.name).padEnd(20, ' ');

			let display = numeral(row.allocation).format(NUMBER_FORMAT);
			const alloc = display.toString().padStart(6, ' ');

			display = numeral(row.currentAllocation).format(NUMBER_FORMAT);
			const curAl = display.toString().padStart(6, ' ');

			display = numeral(row.diff).format(NUMBER_FORMAT);
			const diff = display.toString().padStart(5, ' ');

			display = numeral(row.diffPerc).format(NUMBER_FORMAT);
			const diffPerc = display.toString().padStart(6, ' ');

			display = numeral(row.allocatedValue).format(NUMBER_FORMAT);
			const alVal = display.toString().padStart(10, ' ');

			display = numeral(row.currentValue).format(NUMBER_FORMAT);
			const value = display.toString().padStart(10, ' ');

			// let locCur =
			display = numeral(row.diffAmount).format(NUMBER_FORMAT);
			const diffAmt = display.toString().padStart(10, ' ');

			const output = `${firstCol}  ${alloc}  ${curAl}  ${diff}  ${diffPerc}  ${alVal}  ${value}  ${diffAmt}`;

			outputRows.push(output);
		}
		const text = outputRows.join('\n');
		return text;
	}

	/**
	 * Imports the account current values into the asset allocation.
	 * Executed during import of Current Values.
	 * Adapted to the Beancount report.
	 * @param {CurrentValuesDict} balancesDict Current values for all accounts
	 */
	async importCurrentValues(balancesDict: CurrentValuesDict) {
		const accounts = Object.keys(balancesDict);
		for (let i = 0; i < accounts.length; i++) {
			const key = accounts[i];
			const balance: Money = balancesDict[key];

			// Update existing account.
			const account = await appService.db.accounts.get(key);
			if (!account) {
				throw new Error('Invalid account ' + key);
			}
			account.currentValue = balance.quantity;
			account.currentCurrency = balance.currency;

			await appService.db.accounts.put(account);
		}
	}

	/**
	 * Convert a tree AA structure (object) into a list of Asset Classes.
	 * This converts the new structure into the old.
	 * @param {object} rootObject The Asset Allocation object
	 */
	linearizeObject(rootObject: AssetClassDefinition, namespace = ''): AssetClass[] {
		let result: AssetClass[] = [];

		// only use the children.

		for (const propertyName in rootObject) {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const child: AssetClassDefinition = rootObject[propertyName];

			// Only process the other definitions, not the properties (like allocation).
			// symbols is an array, which is also an object. Skip.
			if (!(typeof child == 'object') || child.constructor === Array) continue;

			// convert to Asset Class
			const item = new AssetClass();
			item.allocation = child.allocation;
			item.symbols = child.symbols;
			// get the name
			if (namespace) {
				item.fullname = namespace + ':' + propertyName;
			} else {
				item.fullname = propertyName;
			}

			result.push(item);

			// iterate
			let childNamespace = namespace;
			if (namespace) {
				childNamespace += ':';
			}
			childNamespace += propertyName;

			const children = this.linearizeObject(child, childNamespace);
			if (children.length) {
				result = result.concat(children);
			}
		}

		return result;
	}

	parseDefinition(definition: string): AssetClass[] {
		if (!definition) {
			throw new Error('The AA definition not set.');
		}

		// read from TOML file.
		const parsed = toml.parse(definition);
		const assetClasses = this.linearizeObject(parsed);

		return assetClasses;
	}

	/**
	 * Load current balances from accounts.
	 * Add the account balances to asset classes.
	 */
	async loadCurrentValues() {
		const defaultCurrency = await appService.getDefaultCurrency();
		const invAccounts = await loadInvestmentAccounts();

		invAccounts.forEach((account) => {
			// Current Value is populated from Ledger. Only the active accounts will have a value.
			if (!account.currentValue) return;

			const amount = Big(account.currentValue);

			// add the account balance.
			const acctBalance: Money = getAccountBalance(account, defaultCurrency);
			account.balance = acctBalance;

			if (acctBalance.quantity == 0) {
				// skip adding to the sum.
				return;
			}

			const commodity = account.balance.currency;
			// Now get the asset class for this commodity.
			const assetClassName = this.stockIndex[commodity];
			if (!assetClassName) {
				throw new Error(`Asset class name not found for commodity ${commodity}`);
			}
			const assetClass = this.assetClassIndex[assetClassName];
			if (!assetClass) {
				throw new Error(`Asset class not found: ${assetClassName}`);
			}

			// if (isNaN(assetClass.currentValue)) {
			//   // typeof assetClass.currentValue === 'undefined' ||
			//   assetClass.currentValue = 0
			// }
			assetClass.currentValue = assetClass.currentValue.plus(amount);
		});
	}

	sumGroupBalances(acIndex: Record<string, AssetClass>) {
		const root = acIndex['Allocation'];

		if (root == null) {
			throw new Error('Asset Allocation not defined. Please import the definition file.');
		}

		const sum = this.sumChildren(acIndex, root);

		root.currentValue = sum;
	}

	sumChildren(dictionary: object, item: AssetClass): Big {
		// find all children
		const children = findChildren(dictionary, item);
		if (children.length === 0) {
			return item.currentValue;
		}

		let sum = Big(0);
		for (let i = 0; i < children.length; i++) {
			const child: AssetClass = children[i];
			child.currentValue = this.sumChildren(dictionary, child);

			const amount = child.currentValue;
			sum = sum.plus(amount);
		}

		return sum;
	}
}

export function findChildren(dictionary: object, parent: AssetClass) {
	const children: AssetClass[] = [];

	Object.values(dictionary).forEach((val) => {
		if (parent.fullname === val.parentName) {
			children.push(val);
		}
	});

	return children;
}
