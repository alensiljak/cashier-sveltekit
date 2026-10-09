/**
 * Calendar-date helpers on native `Date` (local time), replacing moment.js.
 * All functions are pure: they return new `Date` instances and never mutate their input.
 * Month/year arithmetic clamps to the end of a shorter month (Jan 31 + 1 month = Feb 28/29).
 */

export type DateUnit = 'day' | 'week' | 'month' | 'year';

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/**
 * Parses an ISO date ('2025-12-07'), or a month ('2025-12', day 1), as local midnight.
 * Anything else is handed to the `Date` constructor; unparseable input gives an Invalid Date.
 */
export function parseDate(value: string): Date {
	const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
	if (!match) return new Date(value);
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1));
}

/** Today at local midnight. */
export function today(): Date {
	return startOfDay(new Date());
}

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 0, 1);
}

/** The last calendar day of the month, at local midnight. */
export function endOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** The last calendar day of the year (Dec 31), at local midnight. */
export function endOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 11, 31);
}

export function addDays(d: Date, n: number): Date {
	const result = new Date(d);
	result.setDate(result.getDate() + n);
	return result;
}

export function addMonths(d: Date, n: number): Date {
	const result = new Date(d);
	const day = result.getDate();
	result.setDate(1);
	result.setMonth(result.getMonth() + n);
	const daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
	result.setDate(Math.min(day, daysInMonth));
	return result;
}

export function addYears(d: Date, n: number): Date {
	return addMonths(d, n * 12);
}

export function add(d: Date, n: number, unit: DateUnit): Date {
	switch (unit) {
		case 'day':
			return addDays(d, n);
		case 'week':
			return addDays(d, n * 7);
		case 'month':
			return addMonths(d, n);
		case 'year':
			return addYears(d, n);
	}
}

/** Whether both dates fall in the same calendar month or year. */
export function isSameUnit(a: Date, b: Date, unit: 'month' | 'year'): boolean {
	return a.getFullYear() === b.getFullYear() && (unit === 'year' || a.getMonth() === b.getMonth());
}

/** Whole calendar days from `b` to `a`, ignoring the time of day. */
export function diffDays(a: Date, b: Date): number {
	return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/** Whole months from `b` to `a` (truncated toward zero), counting a month once its day-of-month is reached. */
export function diffMonths(a: Date, b: Date): number {
	const months = (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth();
	if (months > 0 && a.getDate() < b.getDate()) return months - 1;
	if (months < 0 && a.getDate() > b.getDate()) return months + 1;
	return months;
}

/** Whole years from `b` to `a` (truncated toward zero). */
export function diffYears(a: Date, b: Date): number {
	return Math.trunc(diffMonths(a, b) / 12);
}

const TOKENS = /\[([^\]]*)]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|mm|ss/g;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Formats a date with a moment.js-style format string. Supported tokens:
 * YYYY YY MMMM MMM MM M DD D HH mm ss, plus `[literal]` text. Any other characters are kept as is.
 * The formats saved in user settings (e.g. 'D MMM YYYY') stay valid.
 */
export function formatDate(d: Date, format = 'YYYY-MM-DD'): string {
	return format.replace(TOKENS, (token, literal?: string) => {
		switch (token) {
			case 'YYYY':
				return String(d.getFullYear());
			case 'YY':
				return pad(d.getFullYear() % 100);
			case 'MMMM':
				return MONTHS[d.getMonth()];
			case 'MMM':
				return MONTHS[d.getMonth()].slice(0, 3);
			case 'MM':
				return pad(d.getMonth() + 1);
			case 'M':
				return String(d.getMonth() + 1);
			case 'DD':
				return pad(d.getDate());
			case 'D':
				return String(d.getDate());
			case 'HH':
				return pad(d.getHours());
			case 'mm':
				return pad(d.getMinutes());
			case 'ss':
				return pad(d.getSeconds());
			default:
				return literal ?? token;
		}
	});
}
