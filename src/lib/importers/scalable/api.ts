/**
 * Typed wrappers around the read-only Scalable Capital MCP tools the importer
 * uses. Shapes mirror what the endpoint returns; fields the UI relies on are
 * required, the rest optional, so an endpoint change degrades gracefully.
 */
import type { McpClient } from './mcp';

export interface ScProfile {
	profile?: {
		displayName?: string;
		firstName?: string;
		lastName?: string;
		locale?: string;
		personId?: string;
	};
	brokerPortfolioContext?: {
		accessiblePortfolioCount?: number;
		resolution?: { autoResolvedPortfolioId?: string; status?: string };
	};
}

export interface ScPortfolio {
	portfolioId: string;
	displayName: string;
}

export interface ScPortfolios {
	portfolios: ScPortfolio[];
	resolution?: { autoResolvedPortfolioId?: string; status?: string };
}

export interface ScPerformancePoint {
	timeframe: string;
	simpleAbsoluteReturn: number;
}

export interface ScOverview {
	portfolioId?: string;
	valuation?: { total?: number; securities?: number; crypto?: number };
	performance?: ScPerformancePoint[];
	timestamps?: { valuationTimestampUtc?: string; inventoryTimestampUtc?: string };
}

export interface ScCashBreakdown {
	portfolioId?: string;
	cash?: {
		cashBalance?: number;
		buyingPower?: number;
		buyingPowerWithoutCredit?: number;
		estimatedTaxes?: number;
		pendingBuyOrdersAmount?: number;
	};
	credit?: { availableCreditLine?: number; loaned?: number };
	derivatives?: { availableForDerivatives?: number; buyingPower?: number };
}

export interface ScHolding {
	isin: string;
	name: string;
	fifoPrice?: number;
	valuation?: number;
	valuationCurrency?: string;
	currentQuote?: { midPrice?: number; currency?: string; timestamp?: string };
	position?: { filled?: number; pending?: number; blocked?: number };
	savingsPlan?: unknown;
}

export interface ScHoldings {
	portfolioId?: string;
	holdings: ScHolding[];
}

export interface ScSecurityLeg {
	amount?: string;
	isin?: string;
	quantity?: string;
	side?: string;
	limitPrice?: string | null;
	stopPrice?: string | null;
	transactionType?: string;
}

export interface ScTransaction {
	id: string;
	category: string;
	kind: string;
	currency: string;
	description: string;
	status: string;
	lastEventAt: string;
	isCancellation: boolean;
	security?: ScSecurityLeg | null;
	cash?: { amount?: string; transactionType?: string; relatedIsin?: string | null } | null;
}

export interface ScTransactionsPage {
	portfolioId?: string;
	transactions: ScTransaction[];
	page: { nextCursor: string | null; returnedCount: number; totalCount: number };
}

export interface ScTransactionListArgs {
	portfolioId?: string;
	cursor?: string;
	pageSize?: number;
	fromTime?: string;
	toTime?: string;
	searchTerm?: string;
	transactionTypes?: string[];
	statuses?: string[];
	isin?: string;
}

/** Add `portfolioId` to the tool arguments when set. */
function withPortfolio(
	portfolioId: string | undefined,
	args: Record<string, unknown> = {}
): Record<string, unknown> {
	return portfolioId ? { ...args, portfolioId } : args;
}

/** Basic reachability check. */
export function ping(client: McpClient): Promise<unknown> {
	return client.callTool('ping');
}

export function getAccountProfile(client: McpClient): Promise<ScProfile> {
	return client.callTool<ScProfile>('get_account_profile');
}

export function listAccessiblePortfolios(client: McpClient): Promise<ScPortfolios> {
	return client.callTool<ScPortfolios>('list_accessible_portfolios');
}

export function getPortfolioOverview(client: McpClient, portfolioId?: string): Promise<ScOverview> {
	return client.callTool<ScOverview>(
		'get_portfolio_overview',
		withPortfolio(portfolioId, { includeYearToDate: true })
	);
}

export function getPortfolioHoldings(client: McpClient, portfolioId?: string): Promise<ScHoldings> {
	return client.callTool<ScHoldings>('get_portfolio_holdings', withPortfolio(portfolioId));
}

export function getPortfolioCashBreakdown(
	client: McpClient,
	portfolioId?: string
): Promise<ScCashBreakdown> {
	return client.callTool<ScCashBreakdown>(
		'get_portfolio_cash_breakdown',
		withPortfolio(portfolioId)
	);
}

export function listPortfolioTransactions(
	client: McpClient,
	args: ScTransactionListArgs = {}
): Promise<ScTransactionsPage> {
	const { portfolioId, ...rest } = args;
	return client.callTool<ScTransactionsPage>(
		'list_portfolio_transactions',
		withPortfolio(portfolioId, rest)
	);
}

export function getTransactionDetails(
	client: McpClient,
	transactionId: string,
	portfolioId?: string
): Promise<unknown> {
	return client.callTool('get_transaction_details', withPortfolio(portfolioId, { transactionId }));
}
