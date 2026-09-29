import { n26Importer } from './n26';
import type { Importer } from './types';

export type { Importer, DedupResult } from './types';
export { findDuplicates } from './dedup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const importers: Importer<any>[] = [n26Importer];

export function listImporters() {
	return importers;
}

export function getImporter(id: string) {
	return importers.find((i) => i.id === id);
}

/** The first importer that recognizes the file's content. */
export function identifyImporter(text: string) {
	return importers.find((i) => i.identify(text));
}
