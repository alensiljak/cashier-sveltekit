/**
 * Xact parser
 * Used for calculation of the empty postings
 */
import { Posting, Xact } from '$lib/data/model'
// import { TransactionAugmenter } from '$lib/transactionAugmenter'

export class TransactionParser {
  /**
   * Extract the postings for the given account from the list of Transactions
   * @param accountName The name of the account
   */
  static extractPostingsFor(
    txs: Xact[],
    accountName: string
  ): Posting[] {
    let result: Posting[] = []

    txs.forEach((tx) => {
      const postings = tx.postings.filter(
        (posting) => posting.account == accountName
      )
      result = result.concat(postings)
    })
    return result
  }
}

export function parseXact(input: string) {
  const parts = input.split('\n');
  console.log(parts);
  
  // date, payee
  // postings
}
