/**
 * Display helpers for the records of the CRDT stores (transactions, scheduled transactions),
 * used to show what a sync would change.
 */
import type { CrdtRecord } from './s3Sync';

export interface FieldDiff {
	field: string;
	before?: string;
	after?: string;
}

/** Fields that say nothing about the content. */
const IGNORED = new Set(['schemaVersion']);

/** Flattens nested values into `a.b[0].c` keys with display strings. */
function flatten(value: unknown, path = '', out: Map<string, string> = new Map()) {
	if (Array.isArray(value)) {
		value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			if (!path && IGNORED.has(k)) continue;
			flatten(v, path ? `${path}.${k}` : k, out);
		}
	} else if (value !== undefined) {
		out.set(path, String(value));
	}
	return out;
}

/** The fields that differ between two versions of a record. Without `before`, every field of `after`. */
export function fieldDiffs(before?: CrdtRecord, after?: CrdtRecord): FieldDiff[] {
	const b = flatten(before);
	const a = flatten(after);
	const fields = [...new Set([...b.keys(), ...a.keys()])];
	return fields
		.filter((f) => b.get(f) !== a.get(f))
		.map((field) => ({ field, before: b.get(field), after: a.get(field) }));
}

/** One line naming a record: date, payee and note of a transaction, or a scheduled one's next date. */
export function describeRecord(record?: CrdtRecord): string {
	if (!record) return '';
	const r = record as unknown as Record<string, unknown> & {
		transaction?: { payee?: string; note?: string };
	};
	if ('nextDate' in r) {
		const t = r.transaction;
		return [r.nextDate, t?.payee, t?.note, r.period && `(${r.period})`].filter(Boolean).join(' ');
	}
	return [r.date, r.payee, r.note].filter(Boolean).join(' ');
}
