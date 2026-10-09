import { describe, expect, it } from 'vitest';
import { describeScxChanges, summarizeScxReport } from '#lib/services/scxMergeReport';
import type { RecordChange } from '#lib/storage/crdtDocStore';
import type { ScxRecord } from '#lib/storage/crdtScxRecord';

const rec = (id: string, payee: string, nextDate = '2026-01-01'): ScxRecord =>
	({
		id,
		schemaVersion: 1,
		nextDate,
		transaction: { payee, postings: [] }
	}) as unknown as ScxRecord;

describe('describeScxChanges', () => {
	it('counts and describes each kind of change', () => {
		const changes: RecordChange<ScxRecord>[] = [
			{ id: 'a', action: 'add', after: rec('a', 'Rent') },
			{ id: 'b', action: 'update', before: rec('b', 'Gym'), after: rec('b', 'Gym', '2026-02-01') },
			{ id: 'c', action: 'delete', before: rec('c', 'Old') }
		];

		const report = describeScxChanges(changes);

		expect(report).toMatchObject({ added: 1, changed: 1, deleted: 1 });
		expect(report.lines).toEqual([
			'Added: 2026-01-01 · Rent',
			'Changed: 2026-02-01 · Gym (was 2026-01-01)',
			'Deleted: 2026-01-01 · Old'
		]);
	});

	it('does not mention the old date when only other fields changed', () => {
		const before = rec('a', 'Rent');
		const after = { ...rec('a', 'Rent'), remarks: 'edited' } as ScxRecord;

		expect(describeScxChanges([{ id: 'a', action: 'update', before, after }]).lines).toEqual([
			'Changed: 2026-01-01 · Rent'
		]);
	});
});

describe('summarizeScxReport', () => {
	it('lists only the non-zero counts', () => {
		expect(summarizeScxReport({ added: 2, changed: 0, deleted: 1, lines: [] })).toBe(
			'2 added, 1 deleted'
		);
	});

	it('says so when nothing changed', () => {
		expect(summarizeScxReport({ added: 0, changed: 0, deleted: 0, lines: [] })).toBe('no changes');
	});
});
