import { afterNavigate, goto } from '$app/navigation';

/**
 * Lets a page hand control back to the page it was opened from without leaving a
 * stale entry in the history (a plain `goto` would push one, so Back would return
 * to the page just closed). Call during component initialisation.
 *
 * The returned function goes back one step when the previous page is `target`.
 * Otherwise (opened directly, or from elsewhere) it navigates to `target`,
 * replacing the current entry.
 */
export function trackOrigin(): (target: string) => Promise<void> {
	let cameFrom: string | null = null;
	afterNavigate((navigation) => {
		cameFrom = navigation.from?.url.pathname ?? null;
	});

	return async (target) => {
		if (cameFrom === target.split('?')[0]) history.back();
		else await goto(target, { replaceState: true });
	};
}
