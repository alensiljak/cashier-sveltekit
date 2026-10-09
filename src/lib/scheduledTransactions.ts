/* eslint-disable @typescript-eslint/no-explicit-any */
/*
  Scheduled Transactions functionality
*/
import {
	add,
	endOfMonth,
	formatDate,
	parseDate,
	startOfMonth,
	type DateUnit
} from '#lib/utils/dates';
import type { ScheduledTransaction } from './data/model';

/**
 * Projects the scheduled transactions.
 */
export class Projector {
	schedules;

	constructor(schedules: any) {
		// this.dateFrom = dateFrom
		// this.dateTo = dateTo
		this.schedules = schedules;
	}

	/**
	 * Calculates the dates
	 */
	project(startDate: any, endDate: any) {
		let result: any = [];
		// For each schedule in the schedules
		for (let i = 0; i < this.schedules.length; i++) {
			const stx = this.schedules[i];
			const projections = this.projectTx(stx, startDate, endDate);
			result = [...result, ...projections];
		}

		return result;
	}

	/**
	 * Projects a single schedule into the given timeframe.
	 * @param {ScheduledTransaction} stx
	 */

	projectTx(stx: ScheduledTransaction, startDate: any, endDate: any) {
		const projections = [];

		// if the tx date falls into the range, use it.
		const tx = JSON.parse(JSON.stringify(stx.transaction));
		// date, payee
		if (startDate <= tx.date && tx.date <= endDate) {
			const event = {
				date: tx.date,
				payee: tx.payee
			};
			// console.debug('adding', event)
			projections.push(event);
		}

		// calculate next occurrences
		//const iterator = new Iterator()
		// let outsideTheScope = false
		// add them to the output so long as they are within the given period
		// while (!outsideTheScope) {}

		return projections;
	}
}

/** Maps a recurrence period ('days', 'weeks', ...) to a date unit. */
function toUnit(period: string): DateUnit {
	const unit = period.replace(/s$/, '');
	if (unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year') return unit;
	throw new Error(`unknown recurrence period: ${period}`);
}

/**
 * Calculate the schedule based on the given parameters.
 */
export function calculateNextIteration(startDate: any, count: number, period: any, endDate: any) {
	// calculate next iteration from the given date.

	if (!startDate || !count || !period) {
		throw new Error(`missing input parameter(s), received: ${startDate} ${count} ${period}`);
	}

	// Get the start point.
	const start = parseDate(startDate);

	// add the given period
	let next: Date;

	switch (period) {
		case 'start of month':
			next = startOfMonth(add(start, count, 'month'));
			break;
		case 'end of month':
			// move to the end of the month
			next = endOfMonth(add(start, count, 'month'));
			break;
		default:
			next = add(start, count, toUnit(period));
	}
	const output = formatDate(next);

	// handle end date, if any.
	if (endDate) {
		if (output > endDate) {
			// no more iterations, end date passed
			return null;
		}
	}

	return output;
}
