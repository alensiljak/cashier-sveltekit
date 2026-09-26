/**
 * Raw text of the built-in demo book (src/lib/demo/fixtures), for tests that
 * want realistic Beancount input. Keyed by file name, e.g. `book.bean`.
 * Reflects fixture changes automatically as the demo data grows.
 */
const raw = import.meta.glob('/src/lib/demo/fixtures/*', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

export const demoFixtures: Record<string, string> = Object.fromEntries(
	Object.entries(raw).map(([path, text]) => [path.split('/').pop()!, text])
);
