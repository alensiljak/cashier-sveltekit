/* eslint-disable @typescript-eslint/no-explicit-any */
/*
  Scheduled Transactions functionality
*/
import moment from 'moment'
import type { ScheduledTransaction } from './data/model';

/**
 * Projects the scheduled transactions.
 */
export class Projector {
  schedules;

  constructor(schedules: any) {
    // this.dateFrom = dateFrom
    // this.dateTo = dateTo
    this.schedules = schedules
  }

  /**
   * Calculates the dates
   */
  project(startDate: any, endDate: any) {
    let result: any = []
    // For each schedule in the schedules
    for (let i = 0; i < this.schedules.length; i++) {
      const stx = this.schedules[i]
      const projections = this.projectTx(stx, startDate, endDate)
      result = [...result, ...projections]
    }

    return result
  }

  /**
   * Projects a single schedule into the given timeframe.
   * @param {ScheduledTransaction} stx
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  projectTx(stx: ScheduledTransaction, startDate: any, endDate: any) {
    //console.log(stx)

    const projections = []

    // if the tx date falls into the range, use it.
    const tx = JSON.parse(stx.transaction)
    // date, payee
    if ((startDate <= tx.date) && (tx.date <= endDate)) {
      const event = {
        date: tx.date,
        payee: tx.payee
      }
      // console.debug('adding', event)
      projections.push(event)
    }

    // calculate next occurrences
    //const iterator = new Iterator()
    // let outsideTheScope = false
    // add them to the output so long as they are within the given period
    // while (!outsideTheScope) {}

    return projections
  }
}

/**
 * Calculate the schedule based on the given parameters.
 */
export function calculateNextIteration(startDate: any, count: number, 
  period: any, endDate: any) {
  // calculate next iteration from the given date.

  if (!startDate || !count || !period) {
    throw new Error(
      `missing input parameter(s), received: ${startDate} ${count} ${period}`
    )
  }

  const isoDateFormat = 'YYYY-MM-DD'

  // Get the start point.
  const start = moment(startDate)
  //console.debug('now:', start.format(isoDateFormat))

  // add the given period
  let next = null;
  let output = null;

  switch (period) {
    case 'start of month':
      next = start.add(count, 'month')
      next.startOf('month')
      break;
    case 'end of month':
      next = start.add(count, 'month')
      // move to the end of the month
      next.endOf('month')
      break;
    default:
      next = start.add(count, period)
  }
  output = next.format(isoDateFormat)

  // handle end date, if any.
  if (endDate) {
    if (output > endDate) {
      // no more iterations, end date passed
      return null
    }
  }

  console.debug('next:', output)

  return output
}
