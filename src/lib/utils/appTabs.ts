/**
 * Whether the app is open elsewhere too (another tab or window), using the Web Locks API: every
 * open app holds the same shared lock for as long as it lives.
 */
const LOCK_NAME = 'cashier-open-tab';

let announced = false;

/** Makes this tab visible to `otherTabsOpen` in the others. Call once at startup. */
export function announceTab(): void {
	if (announced || !navigator.locks) return;
	announced = true;
	// Never resolves: the lock is released when the tab goes away.
	void navigator.locks.request(LOCK_NAME, { mode: 'shared' }, () => new Promise<never>(() => {}));
}

/** Null when the browser cannot tell. Requires `announceTab` to have run here. */
export async function otherTabsOpen(): Promise<boolean | null> {
	if (!navigator.locks) return null;
	const { held = [] } = await navigator.locks.query();
	return held.filter((lock) => lock.name === LOCK_NAME).length > 1;
}
