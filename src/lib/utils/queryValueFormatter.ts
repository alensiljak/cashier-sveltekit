/*
	Display formatting of ledger query (BQL) result values: amounts, positions and
	inventories (e.g. from `sum(position)`) come back as objects and are shown as
	readable amounts, not JSON. Shared by the Query report and the Quick Query results.
*/
import { formatAmount } from '$lib/utils/formatter';

/** Formats a decimal string like the rest of the app; returns it unchanged if it isn't a number. */
export function formatNumber(numStr: string): string {
	const n = parseFloat(numStr);
	if (isNaN(n)) return numStr;
	return formatAmount(n);
}

function formatAmountParts(number: string, currency: string): string {
	return `${formatNumber(number)} ${currency}`;
}

/**
 * Handles inventory {positions:[{units:{number,currency}}]}, single amount
 * {number,currency}, and position {units:{number,currency}}. An inventory with
 * several currencies gets one line per position.
 * Returns null when the value doesn't match any known financial shape.
 */
export function formatFinancialValue(value: unknown): string | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;

	// Single amount: { number, currency }
	if (typeof v.number === 'string' && typeof v.currency === 'string') {
		return formatAmountParts(v.number, v.currency);
	}

	// Position with units: { units: { number, currency }, cost?: ... }
	if (typeof v.units === 'object' && v.units !== null) {
		const units = v.units as Record<string, unknown>;
		if (typeof units.number === 'string' && typeof units.currency === 'string') {
			return formatAmountParts(units.number, units.currency);
		}
	}

	// Inventory: { positions: [ { units: { number, currency } } | { number, currency } ] }
	if (Array.isArray(v.positions)) {
		const parts = (v.positions as unknown[])
			.map((pos) => {
				if (typeof pos !== 'object' || pos === null) return null;
				const p = pos as Record<string, unknown>;
				if (typeof p.units === 'object' && p.units !== null) {
					const u = p.units as Record<string, unknown>;
					if (typeof u.number === 'string' && typeof u.currency === 'string') {
						return formatAmountParts(u.number, u.currency);
					}
				}
				if (typeof p.number === 'string' && typeof p.currency === 'string') {
					return formatAmountParts(p.number, p.currency);
				}
				return null;
			})
			.filter((s): s is string => s !== null);
		if (parts.length > 0) return parts.join('\n');
	}

	return null;
}

/** Text for one result cell: plain values as-is, financial objects as amounts, anything else as JSON. */
export function formatCellValue(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	try {
		return formatFinancialValue(value) ?? JSON.stringify(value, null, 1);
	} catch {
		return String(value);
	}
}
