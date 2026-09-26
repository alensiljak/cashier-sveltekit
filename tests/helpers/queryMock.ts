/**
 * Helpers for faking the ledger's BQL query function (`QueryFn`) so
 * report/analysis code can be tested without the WASM engine.
 */
export interface QueryResult {
	columns: string[];
	rows: unknown[][];
	errors: unknown[];
}

export type MockQueryFn = (bql: string) => Promise<QueryResult>;

export function queryResult(columns: string[], rows: unknown[][] = []): QueryResult {
	return { columns, rows, errors: [] };
}

/**
 * Builds a query function from rules tried in order. An unmatched query
 * throws, so a test fails loudly if the code under test asks something new.
 */
export function mockQueryFn(
	rules: { match: (bql: string) => boolean; result: QueryResult }[]
): MockQueryFn {
	return async (bql) => {
		const rule = rules.find((r) => r.match(bql));
		if (!rule) throw new Error(`Unmatched BQL in test: ${bql}`);
		return rule.result;
	};
}
