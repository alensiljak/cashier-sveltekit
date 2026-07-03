/*
	Manages the bundled demo book: activating it (write the static fixtures into
	OPFS and point the app's book/asset-allocation settings at them) and removing
	it again. Demo content is read-only reference data — the only file the app
	ever appends to is `cashier.bean` (see constants.ts), which this service
	never touches.
*/
import * as OpfsLib from '$lib/utils/opfslib';
import { settings, SettingKeys } from '$lib/settings';
import {
	USER_BOOK_FILENAME,
	DEMO_DIR,
	DEMO_BOOK_FILE,
	DEMO_ACCOUNTS_FILE,
	DEMO_COMMODITIES_FILE,
	DEMO_PRICES_FILE,
	DEMO_AA_FILE,
	DEMO_ROOT_INVESTMENT_ACCOUNT
} from '$lib/constants';
import fullLedgerService from './ledgerWorkerClient';

// Vite glob-imports the fixtures as raw strings, resolved at build time —
// works offline, no runtime fetch. Same pattern as $lib/help/helpContent.ts.
const fixtures = import.meta.glob('$lib/demo/fixtures/*', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function fixture(name: string): string {
	const entry = Object.entries(fixtures).find(([path]) => path.endsWith(`/${name}`));
	if (!entry) throw new Error(`Demo fixture not found: ${name}`);
	return entry[1];
}

class DemoDataService {
	/**
	 * Writes the bundled demo fixtures into OPFS under `DEMO_DIR` and links
	 * them as the active book / asset-allocation definition. Always
	 * overwrites `DEMO_DIR` contents (they're static, versioned with the app)
	 * but never touches `cashier.bean` or any of the user's own files.
	 */
	async activateDemoData(): Promise<void> {
		await OpfsLib.saveFile(DEMO_BOOK_FILE, fixture('book.bean'));
		await OpfsLib.saveFile(DEMO_ACCOUNTS_FILE, fixture('accounts.bean'));
		await OpfsLib.saveFile(DEMO_COMMODITIES_FILE, fixture('commodities.bean'));
		await OpfsLib.saveFile(DEMO_PRICES_FILE, fixture('prices.bean'));
		await OpfsLib.saveFile(DEMO_AA_FILE, fixture('asset-allocation.toml'));

		await settings.set(USER_BOOK_FILENAME, DEMO_BOOK_FILE);
		await settings.set(SettingKeys.assetAllocationDefinition, DEMO_AA_FILE);
		await settings.set(SettingKeys.rootInvestmentAccount, DEMO_ROOT_INVESTMENT_ACCOUNT);
		// AA valuation queries require a default currency; the demo book is
		// EUR-only, so seed it if the user hasn't chosen one yet — never
		// override an existing preference.
		if (!(await settings.get<string>(SettingKeys.currency))) {
			await settings.set(SettingKeys.currency, 'EUR');
		}

		await fullLedgerService.invalidate();
	}

	/**
	 * Deletes `DEMO_DIR` and unlinks any settings currently pointing at it.
	 * Settings are only cleared if they still match the demo paths, so this
	 * is safe to call even if the user has since pointed elsewhere.
	 */
	async removeDemoData(): Promise<void> {
		const bookFilename = await settings.get<string>(USER_BOOK_FILENAME);
		if (bookFilename === DEMO_BOOK_FILE) {
			await settings.set(USER_BOOK_FILENAME, null);
		}

		const aaDefinition = await settings.get<string>(SettingKeys.assetAllocationDefinition);
		if (aaDefinition === DEMO_AA_FILE) {
			await settings.set(SettingKeys.assetAllocationDefinition, null);
		}

		const rootInvestmentAccount = await settings.get<string>(SettingKeys.rootInvestmentAccount);
		if (rootInvestmentAccount === DEMO_ROOT_INVESTMENT_ACCOUNT) {
			await settings.set(SettingKeys.rootInvestmentAccount, null);
		}

		await OpfsLib.deleteDirectory(DEMO_DIR);
		await fullLedgerService.invalidate();
	}

	/** True if the demo book is the currently-linked user book. */
	async isDemoActive(): Promise<boolean> {
		const bookFilename = await settings.get<string>(USER_BOOK_FILENAME);
		return bookFilename === DEMO_BOOK_FILE;
	}
}

export default new DemoDataService();
