/**
 * Hands the file the user picked on the Importers page to the review page.
 * A File can't travel in a URL, so it waits here for one navigation.
 */
let pending: { importerId: string; file: File } | null = null;

export function setPendingImport(importerId: string, file: File): void {
	pending = { importerId, file };
}

/** Returns the waiting file and clears it. Null if there is none, e.g. after a page reload. */
export function takePendingImport(): { importerId: string; file: File } | null {
	const result = pending;
	pending = null;
	return result;
}
