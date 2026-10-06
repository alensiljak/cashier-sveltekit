import * as Y from 'yjs';

/**
 * True when `update` holds operations that `base` lacks (any operation, when no `base` is given).
 * Compares the state vectors only, so a deletion of already-known records is not noticed; that
 * is fine for a "has anything changed" hint.
 */
export function hasNewOps(update: Uint8Array, base?: Uint8Array): boolean {
	const theirs = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
	const ours = base ? Y.decodeStateVector(Y.encodeStateVectorFromUpdate(base)) : new Map();
	for (const [client, clock] of theirs) {
		if (clock > (ours.get(client) ?? 0)) return true;
	}
	return false;
}
