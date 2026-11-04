/*
	threeWay tests — the channel-independent change classification shared by
	every sync channel. Pure, no I/O. See src/lib/sync/threeWay.ts.
*/

import { compareToBase, type SyncBase } from '#lib/sync/threeWay';
import { assert, test } from 'vitest';

const base = (local: string | null, remote: string | null = local): SyncBase => ({ local, remote });

test('same: identical content, with or without a base', () => {
	assert.equal(compareToBase('a', 'a', null), 'same');
	assert.equal(compareToBase('a', 'a', base('b')), 'same');
});

test('same: absent on both sides', () => {
	assert.equal(compareToBase(null, null, null), 'same');
	assert.equal(compareToBase(null, null, base('a')), 'same');
});

test('same: each side matches its own base half even though they differ from each other', () => {
	assert.equal(compareToBase('l', 'r', base('l', 'r')), 'same');
});

test('local: only local moved', () => {
	assert.equal(compareToBase('b', 'a', base('a')), 'local');
});

test('remote: only remote moved', () => {
	assert.equal(compareToBase('a', 'b', base('a')), 'remote');
});

test('both: each side moved away from the base', () => {
	assert.equal(compareToBase('b', 'c', base('a')), 'both');
});

test('unrelated: both sides have the file, different content, no base', () => {
	assert.equal(compareToBase('l', 'r', null), 'unrelated');
});

test('only one side has the file and there is no base: that side is the change', () => {
	assert.equal(compareToBase('l', null, null), 'local');
	assert.equal(compareToBase(null, 'r', null), 'remote');
});

test('deletion since the base counts as a change on that side', () => {
	assert.equal(compareToBase(null, 'a', base('a')), 'local');
	assert.equal(compareToBase('a', null, base('a')), 'remote');
});

test('deleted on one side and changed on the other is both', () => {
	assert.equal(compareToBase(null, 'b', base('a')), 'both');
});
