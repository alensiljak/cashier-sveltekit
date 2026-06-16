/**
 * Process items in batches with a concurrency limit.
 * Waits for all items in a batch to complete before starting the next batch.
 * @param items - Array of items to process
 * @param batchSize - Number of items to process concurrently
 * @param processor - Async function to process each item
 */
export async function processInBatches<T>(
	items: T[],
	batchSize: number,
	processor: (item: T) => Promise<void>
): Promise<void> {
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		await Promise.allSettled(batch.map((item) => processor(item)));
	}
}

/**
 * Process items with a concurrency limit, starting each item as soon as a slot is available.
 * Results are shown immediately as each item completes, without waiting for batches.
 * @param items - Array of items to process
 * @param concurrency - Maximum number of concurrent operations
 * @param processor - Async function to process each item
 */
export function processWithConcurrencyLimit<T>(
	items: T[],
	concurrency: number,
	processor: (item: T) => Promise<void>
): Promise<void> {
	if (items.length === 0) return Promise.resolve();

	const queue = items.map((item) => () => processor(item));
	let activeCount = 0;
	let resolveAll: () => void;
	const allDone = new Promise<void>((r) => (resolveAll = r));

	const next = () => {
		while (activeCount < concurrency && queue.length > 0) {
			const task = queue.shift()!;
			activeCount++;
			task().finally(() => {
				activeCount--;
				if (activeCount === 0 && queue.length === 0) {
					resolveAll();
				} else {
					next();
				}
			});
		}
	};

	next();
	return allDone;
}
