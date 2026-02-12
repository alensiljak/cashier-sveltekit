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
export async function processWithConcurrencyLimit<T>(
	items: T[],
	concurrency: number,
	processor: (item: T) => Promise<void>
): Promise<void> {
	let activeCount = 0;
	const queue: (() => Promise<void>)[] = [];

	const processNext = async (): Promise<void> => {
		if (queue.length === 0) return;

		const task = queue.shift()!;
		activeCount++;

		try {
			await task();
		} finally {
			activeCount--;
			// Start next queued item if any
			if (queue.length > 0) {
				processNext();
			}
		}
	};

	// Queue all items
	for (const item of items) {
		queue.push(() => processor(item));

		// Start processing if under concurrency limit
		if (activeCount < concurrency) {
			processNext();
		}
	}

	// Wait for all to complete
	while (activeCount > 0 || queue.length > 0) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
