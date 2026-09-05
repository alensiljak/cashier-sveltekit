/*
	Regression test: locateXactsInSource must resolve each transaction's own
	@@ price annotation, not the first line in the whole file matching the
	posting's account name.
*/
import { describe, it, expect } from 'vitest';
import { locateXactsInSource } from '$lib/utils/xactLocator';

describe('locateXactsInSource', () => {
	it('attributes distinct @@ prices to each transaction sharing an account', async () => {
		const source = `2026-09-03 * "VGTY.DE distribution"
  Assets:Bank-Accounts:N26  2.04 EUR @@ 2.37 USD
  Income:Investment:Interest:N26  -2.37 USD

2026-09-04 * "VUCP.AS distribution"
  Assets:Bank-Accounts:N26  4.76 EUR @@ 5.53 USD
  Income:Investment:Interest:N26  -5.53 USD
`;

		const locations = await locateXactsInSource(source);
		expect(locations).toHaveLength(2);

		const first = locations.find((l) => l.xact.note === 'VGTY.DE distribution');
		const second = locations.find((l) => l.xact.note === 'VUCP.AS distribution');

		expect(first?.xact.postings[0].priceAmount).toBe(2.37);
		expect(second?.xact.postings[0].priceAmount).toBe(5.53);
	});
});
