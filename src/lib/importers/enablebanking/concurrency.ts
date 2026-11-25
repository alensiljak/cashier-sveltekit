/** Run `task` for every item, at most `limit` at a time. `task` should not throw. */
export async function forEachLimited<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
