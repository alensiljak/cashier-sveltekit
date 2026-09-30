/**
 * The file being reviewed, kept in sessionStorage so the review survives
 * navigating away (e.g. to look at a matched transaction) and page reloads.
 * A File can't be stored, but bank exports are small text, so the text is kept
 * and everything else is recomputed on return.
 */
const KEY = 'importer.pending';

export interface PendingImport {
	importerId: string;
	fileName: string;
	text: string;
	/** Which rows are ticked, by row index. Applies only if the row count is unchanged. */
	selection?: boolean[];
	/** What was open and where the list was scrolled to, restored when returning from the rule page. */
	view?: { matchOpen: number[]; detailsOpen: number[]; scrollTop: number };
}

export function savePendingImport(pending: PendingImport): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(pending));
	} catch {
		// Storage unavailable or full: the review still works, it just won't survive leaving the page.
	}
}

export function loadPendingImport(): PendingImport | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as PendingImport) : null;
	} catch {
		return null;
	}
}

export function saveSelection(selection: boolean[]): void {
	const pending = loadPendingImport();
	if (pending) savePendingImport({ ...pending, selection });
}

export function saveView(view: NonNullable<PendingImport['view']>): void {
	const pending = loadPendingImport();
	if (pending) savePendingImport({ ...pending, view });
}

export function clearPendingImport(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// Nothing to clear.
	}
}
