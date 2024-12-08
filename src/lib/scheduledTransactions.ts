/*
  Scheduled Transactions functionality
*/
import moment from 'moment'

/**
 * Projects the scheduled transactions.
 */
export class Projector {
  constructor(schedules) {
    // this.dateFrom = dateFrom
    // this.dateTo = dateTo
    this.schedules = schedules
  }

  /**
   * Calculates the dates
   */
  project(startDate, endDate) {
    let result = []
    // For each schedule in the schedules
    for (let i = 0; i < this.schedules.length; i++) {
      let stx = this.schedules[i]
      let projections = this.projectTx(stx, startDate, endDate)
      result = [...result, ...projections]
    }

    return result
  }

  /**
   * Projects a single schedule into the given timeframe.
   * @param {ScheduledTransaction} stx
   */
  projectTx(stx, startDate, endDate) {
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
export function calculateNextIteration(startDate, count: number, period, endDate) {
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
