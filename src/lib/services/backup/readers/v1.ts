/**
 * Format 1: no `version` field; always the shared settings and the scheduled transactions.
 *
 *     { settings: { key, value }[], scx: ScheduledTransaction[] }
 *
 * The WebDAV password is blank (in the oldest files it may be filled in). Nothing says whether
 * the device had one.
 */
import type { BackupData, StoredSetting } from '../model';
import type { ScheduledTransaction } from '#lib/data/model';

export function readV1(file: Record<string, unknown>): BackupData {
	if (!Array.isArray(file.settings) || !Array.isArray(file.scx)) {
		throw new Error('Not a Cashier backup file: settings and scheduled transactions are missing');
	}
	return {
		version: 1,
		settings: file.settings as StoredSetting[],
		scx: { list: file.scx as ScheduledTransaction[] },
		withheld: []
	};
}
