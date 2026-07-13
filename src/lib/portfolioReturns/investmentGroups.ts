/**
 * Portfolio Returns investment groups, derived from the Asset Allocation definition.
 *
 * A group = one leaf asset class (one with `symbols` set) plus the investment accounts that
 * hold those symbols. This reuses the same commodity → account matching as the Asset
 * Allocation and Asset Class Detail pages (`account.balance.currency === symbol`), so a
 * group's account set always agrees with what those pages already show for that asset class.
 *
 * `accounts` is also the group's boundary for cash-flow classification: a posting on one of
 * them is internal (already reflected in market value); everything else — including a
 * shared settlement/cash account funding buys across multiple symbols — is external. See
 * doc/projects/portfolio-returns.md, "Flow classification", for why a wider boundary (e.g.
 * folding a broker's whole account subtree into "internal") is wrong when that broker's cash
 * account is shared across securities: cash isn't attributable to any specific group until a
 * buy actually converts it into that group's holding, so the buy/sell itself must carry the
 * flow.
 */

import type { Account } from '$lib/data/model';
import type { AssetClass } from '$lib/assetAllocation/AssetClass';

export interface InvestmentGroup {
	/** The asset class fullname, e.g. "Allocation:Equity:US". */
	name: string;
	/** Commodity symbols belonging to this asset class, e.g. ["VTI"]. */
	symbols: string[];
	/** Investment accounts currently holding one of `symbols`. */
	accounts: Account[];
}

/**
 * Groups investment accounts by leaf asset class. Asset classes without symbols (allocation
 * targets that only aggregate children) and asset classes whose symbols have no matching
 * investment account balance are dropped — there is nothing to report a return for.
 *
 * @param assetClasses The full Asset Allocation tree (as loaded from the AA definition).
 * @param investmentAccounts Accounts under the root investment account, with `balance`
 *   populated (see `accountsService.populateAccountBalances`).
 */
export function deriveInvestmentGroups(
	assetClasses: AssetClass[],
	investmentAccounts: Account[]
): InvestmentGroup[] {
	const groups: InvestmentGroup[] = [];
	for (const assetClass of assetClasses) {
		if (!assetClass.symbols || assetClass.symbols.length === 0) continue;

		const symbolSet = new Set(assetClass.symbols);
		const accounts = investmentAccounts.filter(
			(account) => account.balance && symbolSet.has(account.balance.currency)
		);
		if (accounts.length === 0) continue;

		groups.push({ name: assetClass.fullname, symbols: assetClass.symbols, accounts });
	}
	return groups;
}
