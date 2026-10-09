/**
 * One-off, human-readable summary of what merging another device's scheduled
 * transactions changed. Built from the changes `importState` returns; nothing is
 * stored, so it is only available to the caller that did the merge.
 */
import type { RecordChange } from '#lib/storage/crdtDocStore';
import type { ScxRecord } from '#lib/storage/crdtScxRecord';

export interface ScxMergeReport {
	added: number;
	changed: number;
	deleted: number;
	/** One line per changed record. */
	lines: string[];
}

function label(r: ScxRecord): string {
	return `${r.nextDate} · ${r.transaction?.payee || r.remarks || '(unnamed)'}`;
}

export function describeScxChanges(changes: RecordChange<ScxRecord>[]): ScxMergeReport {
	const report: ScxMergeReport = { added: 0, changed: 0, deleted: 0, lines: [] };
	for (const c of changes) {
		if (c.action === 'add' && c.after) {
			report.added++;
			report.lines.push(`Added: ${label(c.after)}`);
		} else if (c.action === 'delete' && c.before) {
			report.deleted++;
			report.lines.push(`Deleted: ${label(c.before)}`);
		} else if (c.action === 'update' && c.before && c.after) {
			report.changed++;
			const was = c.before.nextDate !== c.after.nextDate ? ` (was ${c.before.nextDate})` : '';
			report.lines.push(`Changed: ${label(c.after)}${was}`);
		}
	}
	return report;
}

/** "2 added, 1 changed", or "no changes". */
export function summarizeScxReport(report: ScxMergeReport): string {
	const parts = [
		report.added && `${report.added} added`,
		report.changed && `${report.changed} changed`,
		report.deleted && `${report.deleted} deleted`
	].filter(Boolean);
	return parts.length ? parts.join(', ') : 'no changes';
}
