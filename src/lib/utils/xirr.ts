/**
 * Money-weighted rate of return (XIRR / MWRR) solver.
 *
 * Given a series of dated cash flows, finds the annualized discount rate `r` at which the
 * net present value of the flows is zero:
 *
 *   NPV(r) = Σ amount_i / (1 + r)^(days_i / 365) = 0
 *
 * Convention: negative amounts are money going into the investment (deposits, purchases),
 * positive amounts are money coming out (withdrawals, the final market value). This matches
 * beangrow's cash-flow sign convention.
 */

export interface CashFlow {
	date: Date;
	amount: number;
}

const DAYS_PER_YEAR = 365;
const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-7;
/** NPV derivative treated as flat below this magnitude — Newton step would blow up or stall. */
const MIN_DERIVATIVE = 1e-10;

/** Thrown when no rate produces NPV = 0 for the given flows within [-0.9999, 1e6]. */
export class XirrNoSolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'XirrNoSolutionError';
	}
}

function yearsBetween(from: Date, to: Date): number {
	return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR);
}

/** NPV(rate) and its derivative w.r.t. rate, evaluated against `flows[0].date` as day zero. */
function npvAndDerivative(flows: CashFlow[], rate: number): { npv: number; dNpv: number } {
	const t0 = flows[0].date;
	const base = 1 + rate;
	let npv = 0;
	let dNpv = 0;
	for (const { date, amount } of flows) {
		const t = yearsBetween(t0, date);
		const discount = base ** t;
		npv += amount / discount;
		if (t !== 0) {
			dNpv -= (t * amount) / base ** (t + 1);
		}
	}
	return { npv, dNpv };
}

/**
 * Bisection fallback over a bounded rate range. Requires a sign change between `low` and
 * `high`; narrows the bracket until it converges within TOLERANCE or MAX_ITERATIONS is hit.
 */
function bisect(flows: CashFlow[], low: number, high: number): number {
	let npvLow = npvAndDerivative(flows, low).npv;
	let npvHigh = npvAndDerivative(flows, high).npv;
	if (npvLow === 0) return low;
	if (npvHigh === 0) return high;
	if (Math.sign(npvLow) === Math.sign(npvHigh)) {
		throw new XirrNoSolutionError(
			'No sign change in NPV across the search range; cash flows may not have a valid IRR.'
		);
	}

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const mid = (low + high) / 2;
		const npvMid = npvAndDerivative(flows, mid).npv;
		if (Math.abs(npvMid) < TOLERANCE || high - low < TOLERANCE) {
			return mid;
		}
		if (Math.sign(npvMid) === Math.sign(npvLow)) {
			low = mid;
			npvLow = npvMid;
		} else {
			high = mid;
			npvHigh = npvMid;
		}
	}
	return (low + high) / 2;
}

/**
 * Solves for the annualized money-weighted rate of return of a cash-flow series.
 *
 * @param flows Dated cash flows. Must contain at least two flows, spanning more than one day,
 *   with both a negative and a positive amount (money in and money out) — otherwise no finite
 *   rate can zero the NPV.
 * @param guess Initial rate guess for Newton-Raphson (default 10%).
 * @returns The annualized rate `r` (e.g. 0.07 = 7%/year).
 * @throws XirrNoSolutionError if the flows have no valid sign change, or no root is found.
 */
export function xirr(flows: CashFlow[], guess = 0.1): number {
	if (flows.length < 2) {
		throw new XirrNoSolutionError('At least two cash flows are required to compute an IRR.');
	}
	const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
	if (sorted[0].date.getTime() === sorted[sorted.length - 1].date.getTime()) {
		throw new XirrNoSolutionError('Cash flows must span more than a single day.');
	}
	const hasPositive = sorted.some((f) => f.amount > 0);
	const hasNegative = sorted.some((f) => f.amount < 0);
	if (!hasPositive || !hasNegative) {
		throw new XirrNoSolutionError(
			'Cash flows must include both a negative (money in) and a positive (money out) amount.'
		);
	}

	// Newton-Raphson first; it converges fast when it converges at all.
	let rate = guess;
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const { npv: value, dNpv } = npvAndDerivative(sorted, rate);
		if (Math.abs(value) < TOLERANCE) {
			return rate;
		}
		if (Math.abs(dNpv) < MIN_DERIVATIVE) {
			break; // flat derivative — fall through to bisection
		}
		const next = rate - value / dNpv;
		// Guard against Newton stepping to an unrecoverable rate (<= -100%/year).
		if (!Number.isFinite(next) || next <= -1) {
			break;
		}
		if (Math.abs(next - rate) < TOLERANCE) {
			return next;
		}
		rate = next;
	}

	// Newton didn't converge (or was aborted) — fall back to bisection over a wide,
	// financially plausible range: -99.99%/year to +1,000,000%/year.
	return bisect(sorted, -0.9999, 1e6);
}
