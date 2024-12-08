import { Account, Money, Posting, Xact } from '$lib/data/model'
import appService from '$lib/services/appService'
import { TransactionParser } from '$lib/utils/transactionParser'
import { getAccountBalance } from '$lib/services/accountsService'

/**
 * Modifies the transaction records in-memory to create the missing parts,
 * like the amount on a missing posting.
 */
export class XactAugmenter {
  constructor() { }

  /**
   * Calculates and adds the amounts for the empty postings. This "completes" the Postings
   * so that they have an amount and a currency.
   * @param transactions Array of Transactions
   * @returns The same array of Transactions
   */
  static calculateEmptyPostingAmounts(
    transactions: Xact[]
  ): Xact[] {
    // iterate
    transactions.forEach((tx) => {
      const postings = tx.postings

      // todo: what about multiple currencies?
      // do we have multiple currencies?
      let currencies = postings.map((posting) => posting.currency)
      // eliminate blanks
      currencies = currencies.filter((currency) => currency)
      // Convert to a set to get unique values only.
      const currencySet = new Set(currencies)
      if (currencySet.size > 1) {
        console.warn(
          'Multiple currencies detected:',
          ...currencySet,
          '. Ignoring transaction',
          tx.date,
          tx.payee
        )
        return
      }
      // use the common currency
      const commonCurrency = currencySet.values().next().value

      // do we have empty postings?
      const amounts = postings.map((posting) => posting.amount)
      if (amounts.length <= 0) return

      // add all the existing amounts
      const sum = amounts.reduce((prev, curr) => {
        if (!prev) prev = 0
        if (!curr) curr = 0

        return prev + curr
      })

      // put this value into the empty posting.
      const emptyPostings = postings.filter((posting) => !posting.amount)
      if (emptyPostings.length > 1) {
        const msg = `Multiple empty postings found on ${tx.payee}`
        //throw new Error(msg)
        console.warn(msg)
        return
      } else if (emptyPostings.length === 0) {
        // no empty postings
        return
      }

      const emptyPosting: Posting = emptyPostings[0]
      emptyPosting.amount = Number(sum) * -1

      if (!emptyPosting.currency) {
        emptyPosting.currency = commonCurrency || ''
      }
    })

    return transactions
  }

  /**
   * Corrects the account balance by adding the local transactions into the calculation.
   * The initial value is the account's balance from Ledger. Then we calculate the
   * local transactions and adjust the balance accordingly.
   * @param {Array} accounts The list of Account records.
   * @returns {Promise<Array<Account>>} The list of accounts with adjusted balances.
   */
  async adjustAccountBalances(accounts: Account[]): Promise<Array<Account>> {
    if (!accounts) {
      console.info('no favourite accounts found for balance adjustment')
      return accounts
    }

    const defaultCurrency = await appService.getDefaultCurrency()

    for (let i = 0; i < accounts.length; i++) {
      // load all postings for the account
      const account = accounts[i]
      // todo: if the favourite account is not found, gray it out?
      if (!account) continue // null check

      // handle empty balances
      if (!account.balance) {
        account.balance = getAccountBalance(account, defaultCurrency)
      }

      //let sum = parseFloat(account.balance.amount)
      let sum = account.balance.amount

      //
      const txs = await appService.loadAccountTransactionsFor(account.name)

      XactAugmenter.calculateEmptyPostingAmounts(txs)
      const postings = TransactionParser.extractPostingsFor(txs, account.name)

      for (let j = 0; j < postings.length; j++) {
        let amount = postings[j].amount
        if (!amount) continue
        if (typeof amount === 'string') {
          amount = parseFloat(amount)
        }

        sum += amount

        // For accounts with no starting balance, use the currency from the first expense.
        if (!account.balance.currency) {
          account.balance.currency = postings[j].currency
        }
      }

      if (isNaN(sum)) {
        console.warn('The sum for ' + account.name + ' is not a number: ', sum)
        sum = 0
      }

      const newBalance = Number(sum.toFixed(2))

      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NumberFormat
      //let x = new Intl.NumberFormat('en-AU').format(newBalance)
      account.balance.amount = newBalance
      // { style: 'currency', currency: 'EUR' }
    }
    return accounts
  }

  /**
   * Identifies the amount to display, from the user's perspective - a debit, credit, transfer for
   * a Xact.
   * Appends {amount, currency} to the Xact record.
   * It is normally useful to run calculateEmptyPostingAmounts() to populate the blank Postings.
   * @param {Array<Xact>} txs
   * @returns {Array<Money>} An array of balance records that matches the transactions.
   */
  static calculateXactAmounts(xacts: Xact[]): Money[] {
    // get Amounts
    XactAugmenter.calculateEmptyPostingAmounts(xacts)

    const result: Money[] = []

    // Find the asset account and decide on the flow direction.
    xacts.forEach((xact) => {
      const balance = this.calculateXactAmount(xact);

      // Assemble the output
      result.push(balance)
    })

    return result
  }

  static calculateXactAmount(xact: Xact): Money {
    const balance = new Money()

    // Get the assets and liabilities posting(s) from the transaction.
    const postings = xact.postings.filter(
      (posting) =>
        posting.account.startsWith('Assets:') ||
        posting.account.startsWith('Liabilities:')
    )

    if (postings.length === 0) {
      console.warn('No postings found in Assets or Liabilities!')
    } else if (postings.length === 1) {
      // a clear payment case with one source (asset/liability) account.
      const posting = postings[0]
      if (!posting || !posting.amount || typeof posting.amount === 'string') {
        // The amount is invalid. Ignore.

        // const msg = `Invalid amount on ${xact.date}, ${xact.payee}, ${posting.account}, ${posting.amount}`
        // console.error(msg)

        //return
      } else {
        balance.amount = Number(posting.amount?.toFixed(2) as string)
        balance.currency = posting.currency
      }
    } else if (postings.length === 2) {
      if (!postings[0].amount) {
        return balance
      }

      // involves a transfer
      balance.amount = Math.abs(postings[0].amount as number)
      balance.currency = postings[0].currency

      // Treat the liability account as an expense.
      if (
        postings.filter((posting) => posting.account.startsWith('Assets:'))
          .length > 0 &&
        postings.filter((posting) =>
          posting.account.startsWith('Liabilities:')
        ).length > 0
      ) {
        // Take the sign from the Asset posting
        const assetPostings = postings.filter((posting) =>
          posting.account.startsWith('Assets:')
        )
        balance.amount = assetPostings[0].amount as number
      }
    } else {
      // todo: handle these cases (transfers, complex tx)
      console.warn('more than one posting found with assets')
    }

    return balance;
  }
}
