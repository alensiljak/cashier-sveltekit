/**
 * Sync source: Cashier Server (network).
 * Fetches data from the CashierSync server over HTTP.
 */
import { settings, SettingKeys } from '$lib/settings';
import moment from 'moment';
import { ISODATEFORMAT } from '$lib/constants';
import { getQueries } from './sync-queries';
import type { Queries } from './sync-queries';
import Notifier from '$lib/utils/notifier';
import * as SyncCommon from '$lib/sync/sync-common';
import type { SyncSteps } from '$lib/sync/sync-common';
import { initializeSyncProgress, updateSyncStep } from '$lib/stores/syncProgressStore';
import { LedgerFilenames, PtaSystems } from '$lib/enums';
import { OPFSBackend } from '$lib/storage';

Notifier.init();

/**
 * Cashier Sync class communicates with the CashierSync server over network.
 * The methods here represent the methods implemented by the server.
 * This is a proxy class for fetching Ledger data.
 */
class CashierSyncBeancount {
	serverUrl: string;
	queries: Queries;
	ptaSystem: PtaSystems;

	constructor(serverUrl: string) {
		if (!serverUrl) {
			throw new Error('CashierSync URL not set.');
		}
		if (serverUrl.endsWith('/')) {
			serverUrl = serverUrl.substring(0, serverUrl.length - 1);
		}
		this.serverUrl = serverUrl;

		this.ptaSystem = PtaSystems.beancount;
		this.queries = getQueries(this.ptaSystem);
	}

	async get(path: string, options?: object) {
		const url = new URL(`${this.serverUrl}${path}`);
		const response = await fetch(url, options);
		return response;
	}

	createUrl(query: string): URL {
		const path = this.createPath(query);
		const url = new URL(`${this.serverUrl}${path}`);
		return url;
	}

	createPath(query: string) {
		return `?query=${query}`;
	}

	/**
	 * Sends a ledger query to the Ledger server and returns the response.
	 */
	async send(query: string, options?: object) {
		const url = this.createUrl(query);
		const response = await fetch(url, options);
		return response;
	}

	/**
	 * See if the server is running
	 */
	async healthCheck(): Promise<string> {
		const result = await this.get('/ping');
		if (!result.ok) {
			throw new Error('Error contacting Cashier server!');
		}

		const text = await result.text();
		return text;
	}

	async reloadData() {
		const response = await this.get('/reload');
		if (!response.ok) {
			throw new Error('Error reloading data!');
		}
	}

	/**
	 * Retrieve the list of accounts with their balances.
	 */
	async readAccounts(): Promise<Record<string, unknown>> {
		const accountsQuery = this.queries.accounts();
		const response = await this.send(accountsQuery);
		if (!response.ok) {
			throw new Error('Error reading accounts!');
		}

		const content = await response.json();

		return content;
	}

	/**
	 * Retrieve the account balances for all accounts.
	 */
	async readBalances(): Promise<string[]> {
		const balancesQuery = this.queries.balances();
		const response = await this.send(balancesQuery);
		const content: string[] = await response.json();

		return content;
	}

	/**
	 * Get current account values in the base currency.
	 */
	async readCurrentValues(): Promise<any> {
		const rootAccount = (await settings.get(SettingKeys.rootInvestmentAccount)) as string;
		if (!rootAccount) {
			throw new Error('No root investment account set!');
		}
		const currency = await settings.get<string>(SettingKeys.currency);
		if (!currency) {
			throw new Error('No default currency set!');
		}

		const query = this.queries.currentValues(rootAccount, currency);
		const response = await this.send(query);
		const result: any = await response.json();

		return result;
	}

	/**
	 * Read file content from Cashier server.
	 */
	async readFile(filePath: string): Promise<string> {
		const url = new URL(`${this.serverUrl}/infrastructure`);
		url.searchParams.append('file_path', filePath);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Error reading infrastructure file: ${filePath}`);
		}

		const json = await response.json();
		return json.content;
	}

	async readLots(symbol: string) {
		const query = this.queries.lots(symbol);

		const response = await this.send(query);
		if (!response.ok) throw new Error('error fetching lots: ' + response.text());

		const result: string[] = await response.json();

		// remove "Assets" account title
		const lastIndex = result.length - 1;
		const lastLine = result[lastIndex];
		if (lastLine.includes('Assets')) {
			const parts = lastLine.split('Assets');
			const value = parts[0];
			result[lastIndex] = value;
		}

		return result;
	}

	/**
	 * Retrieve the list of Payees
	 */
	async readPayees(): Promise<string[]> {
		const from = moment().subtract(20, 'years').format(ISODATEFORMAT);

		const query = this.queries.payees(from);
		const response = await this.send(query, { timeout: 20000 });
		if (!response.ok) {
			throw new Error('Error reading payees!');
		}

		let content = (await response.json()) as string[];

		if (this.ptaSystem === PtaSystems.beancount) {
			content = content.map((subArray) => subArray[0]);
		} else if (this.ptaSystem === PtaSystems.rledger) {
			// content = content.rows.map((item) => item.payee);
		}

		return content;
	}

	async search(searchParams: object) {
		const url = new URL(`${this.serverUrl}/search`);
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(searchParams)
		});
		const result = await response.json();
		return result;
	}

	async xact(parameters: object) {
		const url = new URL(`${this.serverUrl}/xact`);
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(parameters)
		});
		const result = await response.text();
		return result;
	}

	/**
	 * Shutdown Cashier Server from the client app.
	 */
	shutdown() {
		return this.get('/shutdown');
	}
}

/**
 * Entry point
 * @returns
 */
async function synchronize(syncOptions?: SyncSteps): Promise<boolean> {
	// defaults
	if (!syncOptions) {
		syncOptions = {
			syncAccounts: true,
			syncAaValues: true,
			syncAssetAllocation: true,
			syncPayees: true
		};
	}

	// Initialize sync progress
	initializeSyncProgress();

	// Cashier Sync synchronization

	// const activeUrl = getActiveServerUrlOrNotify();
	const activeUrl = await settings.get<string>(SettingKeys.syncServerUrl);
	if (!activeUrl) return false;

	// const _ptaSystem = (await settings.get(SettingKeys.ptaSystem)) as PtaSystems;
	const sync = new CashierSyncBeancount(activeUrl);

	try {
		if (syncOptions.syncAccounts) {
			updateSyncStep(1, 'in-progress');
			await synchronizeAccounts(sync);
			updateSyncStep(1, 'completed');
		}

		// Asset Allocation definition (.toml)
		if (syncOptions.syncAssetAllocation) {
			updateSyncStep(3, 'in-progress');
			await syncAssetAllocation(sync);
			updateSyncStep(3, 'completed');
		}

		if (syncOptions.syncAaValues) {
			updateSyncStep(4, 'in-progress');
			await synchronizeAaValues(sync);
			updateSyncStep(4, 'completed');
		}
		if (syncOptions.syncPayees) {
			updateSyncStep(5, 'in-progress');
			await synchronizePayees(sync);
			updateSyncStep(5, 'completed');
		}
	} catch (error: any) {
		console.error(error);
		Notifier.error(error.message);
		return false;
	}

	return true;
}

async function synchronizeAccounts(sync: CashierSyncBeancount) {
	const response = await sync.readAccounts();
	await SyncCommon.syncAccounts(sync.ptaSystem, response);
	Notifier.success('Accounts fetched from Ledger');
}

async function synchronizeAaValues(sync: CashierSyncBeancount) {
	const result = await sync.readCurrentValues();
	await SyncCommon.syncCurrentValues(sync.ptaSystem, result);
	Notifier.success('Asset Allocation values loaded');
}

async function syncAssetAllocation(sync: CashierSyncBeancount) {
	// Get Asset Allocation from the sync server.
	const content = await sync.readFile('portfolio/asset-allocation.toml');
	
	// Save to OPFS.
	const opfs = new OPFSBackend();
	await opfs.writeFile(LedgerFilenames.asset_allocation, content);
	
}

async function synchronizePayees(sync: CashierSyncBeancount) {
	const response = await sync.readPayees();
	await SyncCommon.syncPayees(response);
	Notifier.success('Payees fetched from Ledger');
}

export { CashierSyncBeancount, type SyncSteps, synchronize };
