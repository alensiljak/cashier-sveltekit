/*
    Orchestration tests for the Price Download service: shared config,
    device status, fetch → write flow, unchanged re-runs, failure retention,
    missing symbols, direction handling and destination validation. The pure
    file/plan logic has its own suites; here the collaborators are mocked so
    the wiring is under test.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from '#lib/settings';

const state = vi.hoisted(() => ({
	files: new Map<string, string>(),
	shared: new Map<string, unknown>(),
	device: new Map<string, unknown>(),
	bookFilename: 'book.bean' as string | null,
	operating: ['EUR'] as string[],
	accounts: [] as Array<{ currencies?: string[] }>,
	directives: [] as unknown[],
	queryResult: { columns: ['currency', 'amount'], rows: [] as unknown[][] },
	reloadCalls: 0,
	saveCalls: [] as Array<{ path: string; text: string }>,
	fetchLatest: vi.fn()
}));

vi.mock('#lib/utils/opfslib', () => ({
	readFile: vi.fn(async (path: string) => state.files.get(path)),
	saveFile: vi.fn(async (path: string, text: string) => {
		state.saveCalls.push({ path, text });
		state.files.set(path, text);
	})
}));

vi.mock('#lib/services/appService', () => ({
	default: { readBookFilename: vi.fn(async () => state.bookFilename) }
}));

vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: {
		ensureLoaded: vi.fn(async () => {}),
		getOperatingCurrencies: vi.fn(async () => state.operating),
		query: vi.fn(async () => state.queryResult),
		getAllAccounts: vi.fn(async () => state.accounts),
		getDirectives: vi.fn(async () => state.directives)
	}
}));

vi.mock('#lib/services/ledgerReload', () => ({
	reloadLedgerFromOpfs: vi.fn(async () => {
		state.reloadCalls++;
	})
}));

vi.mock('#lib/settings', async (importOriginal) => {
	const actual = await importOriginal<typeof SettingsModule>();
	return {
		...actual,
		settings: {
			get: vi.fn(async (key: string) => state.shared.get(key) ?? null),
			set: vi.fn(async (key: string, value: unknown) => {
				state.shared.set(key, value);
			})
		},
		deviceSettings: {
			get: vi.fn(async (key: string) => state.device.get(key) ?? null),
			set: vi.fn(async (key: string, value: unknown) => {
				state.device.set(key, value);
			})
		}
	};
});

vi.mock('#lib/services/prices/priceProviderRegistry', () => {
	const provider = {
		id: 'test',
		name: 'Test rates',
		base: 'EUR',
		covers: () => true,
		fetchLatest: (...args: unknown[]) => state.fetchLatest(...args)
	};
	return {
		getPriceProvider: () => provider,
		defaultPriceProvider: () => provider,
		listPriceProviders: () => [provider]
	};
});

import {
	downloadPrices,
	getDownloadStatus,
	isTargetIncluded,
	resolveConfig,
	saveConfig,
	validateTargetFile,
	type PriceDownloadConfig
} from '#lib/services/prices/priceDownloadService';
import { DeviceSettingKeys, SettingKeys } from '#lib/settings';
import { PRICES_DEFAULT_DESTINATION } from '#lib/constants';

const config = (patch: Partial<PriceDownloadConfig> = {}): PriceDownloadConfig => ({
	providerId: 'test',
	targetFile: PRICES_DEFAULT_DESTINATION,
	writeMode: 'overwrite',
	...patch
});

const quote = (quote: string, rate: number) => ({ base: 'EUR', rate, quote });

beforeEach(() => {
	state.files.clear();
	state.shared.clear();
	state.device.clear();
	state.bookFilename = 'book.bean';
	state.operating = ['EUR'];
	state.accounts = [];
	state.directives = [];
	state.queryResult = { columns: ['currency', 'amount'], rows: [] };
	state.reloadCalls = 0;
	state.saveCalls.length = 0;
	state.fetchLatest.mockReset();
	state.fetchLatest.mockResolvedValue({
		source: 'test',
		asOf: '2026-11-13',
		quotes: [quote('USD', 1.1052)],
		missing: []
	});
});

describe('config', () => {
	it('defaults to the registered provider, default destination and overwrite', async () => {
		expect(await resolveConfig()).toEqual({
			providerId: 'test',
			targetFile: PRICES_DEFAULT_DESTINATION,
			writeMode: 'overwrite'
		});
	});

	it('reads stored values and normalizes an unknown write mode', async () => {
		state.shared.set(SettingKeys.priceProvider, 'test');
		state.shared.set(SettingKeys.priceTargetFile, 'prices/custom.bean');
		state.shared.set(SettingKeys.priceWriteMode, 'append');
		expect(await resolveConfig()).toEqual({
			providerId: 'test',
			targetFile: 'prices/custom.bean',
			writeMode: 'append'
		});

		state.shared.set(SettingKeys.priceWriteMode, 'bogus');
		expect((await resolveConfig()).writeMode).toBe('overwrite');
	});

	it('saves all three shared keys', async () => {
		await saveConfig(config({ writeMode: 'append' }));
		expect(state.shared.get(SettingKeys.priceProvider)).toBe('test');
		expect(state.shared.get(SettingKeys.priceTargetFile)).toBe(PRICES_DEFAULT_DESTINATION);
		expect(state.shared.get(SettingKeys.priceWriteMode)).toBe('append');
	});
});

describe('downloadPrices', () => {
	it('fetches the planned symbols, writes the file, records status and reloads', async () => {
		state.shared.set(SettingKeys.currency, 'USD');

		const result = await downloadPrices(config());

		expect(state.fetchLatest).toHaveBeenCalledWith(['USD']);
		expect(result).toMatchObject({
			fixingDate: '2026-11-13',
			targetFile: PRICES_DEFAULT_DESTINATION,
			writeMode: 'overwrite',
			added: 1,
			updated: 0,
			unchanged: false,
			symbols: ['USD'],
			missing: []
		});
		expect(state.files.get(PRICES_DEFAULT_DESTINATION)).toBe(
			'; Test rates — latest fixing: 2026-11-13\n2026-11-13 price EUR 1.1052 USD\n'
		);
		expect(await getDownloadStatus()).toMatchObject({
			fixingDate: '2026-11-13',
			added: 1,
			targetFile: PRICES_DEFAULT_DESTINATION,
			writeMode: 'overwrite',
			lastError: null
		});
		expect(state.reloadCalls).toBe(1);
	});

	it('skips the write and reload when the file already has the same content', async () => {
		state.shared.set(SettingKeys.currency, 'USD');
		await downloadPrices(config());
		state.saveCalls.length = 0;
		state.reloadCalls = 0;

		const result = await downloadPrices(config());

		expect(result).toMatchObject({ added: 0, updated: 0, unchanged: true });
		expect(state.saveCalls).toEqual([]);
		expect(state.reloadCalls).toBe(0);
	});

	it('writes inverted into the book’s series direction and drops the opposite series', async () => {
		state.shared.set(SettingKeys.currency, 'USD');
		// The user keeps USD → EUR, the opposite of the provider's native pair.
		state.queryResult = {
			columns: ['currency', 'amount'],
			rows: [['USD', { currency: 'EUR' }]]
		};
		state.files.set(PRICES_DEFAULT_DESTINATION, '2026-11-01 price EUR 1.09 USD\n');

		const result = await downloadPrices(config({ writeMode: 'append' }));

		expect(result.invertedSymbols).toEqual(['USD']);
		expect(result.removed).toBe(1);
		expect(result.added).toBe(1);
		expect(state.files.get(PRICES_DEFAULT_DESTINATION)).toBe('2026-11-13 price USD 0.904814 EUR\n');
	});

	it('surfaces requested symbols missing from the response', async () => {
		state.shared.set(SettingKeys.currency, 'USD');
		state.operating = ['EUR', 'CHF'];
		state.fetchLatest.mockResolvedValue({
			source: 'test',
			asOf: '2026-11-13',
			quotes: [quote('USD', 1.1052)],
			missing: ['CHF']
		});

		const result = await downloadPrices(config());

		expect(result.missing).toEqual(['CHF']);
		expect(state.files.get(PRICES_DEFAULT_DESTINATION)).not.toContain('CHF');
		expect(await getDownloadStatus()).toMatchObject({ missing: ['CHF'] });
	});

	it('keeps the previous successful status when the fetch fails', async () => {
		state.shared.set(SettingKeys.currency, 'USD');
		state.device.set(DeviceSettingKeys.priceDownloadStatus, {
			lastRun: '2026-11-01T10:00:00.000Z',
			fixingDate: '2026-11-01',
			added: 1,
			updated: 0,
			removed: 0,
			symbols: ['USD'],
			invertedSymbols: [],
			skippedUnsupported: [],
			securities: [],
			missing: [],
			targetFile: 'prices/old.bean',
			writeMode: 'overwrite',
			lastError: null
		});
		state.fetchLatest.mockRejectedValue(new Error('provider down'));

		await expect(downloadPrices(config())).rejects.toThrow('provider down');

		expect(await getDownloadStatus()).toMatchObject({
			fixingDate: '2026-11-01',
			targetFile: 'prices/old.bean',
			lastError: 'provider down'
		});
		expect(state.saveCalls).toEqual([]);
		expect(state.reloadCalls).toBe(0);
	});

	it('records a run with nothing to fetch without calling the provider', async () => {
		const result = await downloadPrices(config());

		expect(state.fetchLatest).not.toHaveBeenCalled();
		expect(result).toMatchObject({ fixingDate: '', added: 0, unchanged: false });
		expect(state.saveCalls).toEqual([]);
		expect(await getDownloadStatus()).toMatchObject({ lastError: null });
	});
});

describe('destination validation', () => {
	it('accepts a separate .bean file and rejects the book, demo files and unsafe paths', async () => {
		expect(await validateTargetFile(PRICES_DEFAULT_DESTINATION)).toBeNull();
		expect(await validateTargetFile('book.bean')).toMatch(/main book/);
		expect(await validateTargetFile('cashier-demo/prices.bean')).toMatch(/Demo/);
		expect(await validateTargetFile('/absolute.bean')).toMatch(/relative/);
		expect(await validateTargetFile('a/../b.bean')).toMatch(/relative/);
		expect(await validateTargetFile('prices/x.txt')).toMatch(/\.bean/);
		expect(await validateTargetFile('')).toMatch(/Choose/);
	});

	it('follows nested includes and reports paths that are not included', async () => {
		state.files.set('book.bean', 'include "prices/main.bean"\n');
		state.files.set('prices/main.bean', 'include "current.bean"\n');
		state.files.set('prices/current.bean', '');

		expect(await isTargetIncluded('prices/current.bean')).toBe(true);
		expect(await isTargetIncluded('prices/other.bean')).toBe(false);
	});
});
