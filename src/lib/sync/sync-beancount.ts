/**
 * Sync source: Cashier Server (network).
 * Fetches data from the CashierSync server over HTTP.
 */
import { settings, SettingKeys } from '$lib/settings';
import moment from 'moment';
import { ISODATEFORMAT, PtaSystems } from '$lib/constants';
import { getQueries } from './sync-queries';
import type { Queries } from './sync-queries';
import Notifier from '$lib/utils/notifier';
import * as SyncCommon from '$lib/sync/sync-common';
import type { SyncOptions } from '$lib/sync/sync-common';
import { initializeSyncProgress, updateSyncStep } from '$lib/stores/syncProgressStore';

Notifier.init();

/**
 * Cashier Sync class communicates with the CashierSync server over network.
 * The methods here represent the methods implemented by the server.
 * This is a proxy class for fetching Ledger data.
 */
class CashierSync {
	serverUrl: string;
	queries: Queries;
	ptaSystem: string;

	constructor(serverUrl: string, ptaSystem: string) {
		if (!serverUrl) {
			throw new Error('CashierSync URL not set.');
		}
		if (serverUrl.endsWith('/')) {
			serverUrl = serverUrl.substring(0, serverUrl.length - 1);
		}
		this.serverUrl = serverUrl;

		this.ptaSystem = ptaSystem;
		this.queries = getQueries(ptaSystem);
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
	async readAccounts(ptaSystem: string): Promise<Record<string, unknown>> {
		const accountsQuery = this.queries.accounts();
		const response = await this.send(accountsQuery);
		if (!response.ok) {
			throw new Error('Error reading accounts!');
		}

		let content: any;

		// if (ptaSystem === PtaSystems.rledger) {
		// 	content = await response.json();
		// } else
		if (ptaSystem === PtaSystems.beancount) {
			content = await response.json();
		} else if (ptaSystem === PtaSystems.ledger) {
			throw new Error('Not supported!');
		}

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
async function synchronize(syncOptions?: SyncOptions) {
	// Initialize sync progress
	initializeSyncProgress();

	// Cashier Sync synchronization

	const activeUrl = getActiveServerUrlOrNotify();
	if (!activeUrl) return;

	const _ptaSystem = (await settings.get(SettingKeys.ptaSystem)) as PtaSystems;
	const sync = new CashierSync(activeUrl, _ptaSystem);

	try {
		if (syncOptions?.syncAccounts) {
			updateSyncStep(1, 'in-progress');
			await synchronizeAccounts(sync);
			updateSyncStep(1, 'completed');
		}
		if (syncOptions?.syncAaValues) {
			updateSyncStep(4, 'in-progress');
			await synchronizeAaValues(sync);
			updateSyncStep(4, 'completed');
		}
		if (syncOptions?.syncPayees) {
			updateSyncStep(5, 'in-progress');
			await synchronizePayees(sync);
			updateSyncStep(5, 'completed');
		}
	} catch (error: any) {
		console.error(error);
		Notifier.error(error.message);
		// Update the current step to error
		syncProgress.update(steps => {
			const currentStep = steps.find(step => step.status === 'in-progress');
			if (currentStep) {
				return steps.map(step =>
					step.id === currentStep.id ? { ...step, status: 'error' } : step
				);
			}
			return steps;
		});
	}
}

export function getActiveServerUrlOrNotify(serverUrl?: string): string | null {
	const url = serverUrl?.trim();

	if (!url) {
		Notifier.error('No sync server configured. Please configure a sync server first.');
		return null;
	}

	return url;
}

async function synchronizeAccounts(sync: CashierSync) {
	const response = await sync.readAccounts(sync.ptaSystem);
	await SyncCommon.syncAccounts(sync.ptaSystem, response);
	Notifier.success('Accounts fetched from Ledger');
}

async function synchronizeAaValues(sync: CashierSync) {
	const result = await sync.readCurrentValues();
	await SyncCommon.syncCurrentValues(sync.ptaSystem, result);
	Notifier.success('Asset Allocation values loaded');
}

async function synchronizePayees(sync: CashierSync) {
	const response = await sync.readPayees();
	await SyncCommon.syncPayees(response);
	Notifier.success('Payees fetched from Ledger');
}

export { CashierSync, type SyncOptions, synchronize };
