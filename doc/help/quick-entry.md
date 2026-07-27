# Quick Entry

Type a description and Quick Entry does two things at once:

1. **Parses it into a new transaction.** Amount, currency, payee, narration, and a
   guessed expense/income account are extracted and shown as a "Suggested new transaction"
   at the top. Anything it had to guess (e.g. the counter-account) is flagged with
   `!` and the suggestion is marked **needs review**; tap it to open the result in
   the editor with today's date, ready to adjust and save. Once a search below
   returns matches, the suggestion is refined using the accounts from your most
   frequently matching past transactions.
2. **Searches your existing transactions** for reuse as a template — see below.

## Wording

Beancount splits a transaction description in two: the **payee** is _who_ you paid, the
**narration** is _what_ you paid for. Quick Entry follows the same split:

- **at / to / @ <name>** names the payee — "10 euros for tickets **at Brumby's**" →
  payee _Brumby's_, narration _tickets_.
- **for <thing>** names the narration, never the payee, whenever a payee is given
  elsewhere in the phrase.
- With no "at/to", a "for" phrase becomes the payee instead ("10 euros for Decathlon"),
  unless it only names a spending category ("12 euros for groceries") — then it stays
  the narration and the payee is left for you to fill in.
- Leading articles are dropped, so "at the pharmacy" gives the payee _Pharmacy_.
- Transfers ("transferred 100 from checking to savings") get no payee at all — both
  sides are your own accounts.

Try phrases like "10 euros for tickets at Brumby's" or "Received 500 euros salary".

## Search

Type at least 2 characters to search payee, narration, and account text (partial matches count). Matching transactions appear below the suggestion, most recent first, deduplicated by payee/narration/accounts — up to 15 results.

Tap a result to use it as a template: a new transaction opens in the editor with today's date and the same payee, narration, and postings, ready to adjust and save.

## Filters

Expand **Filters** above the results to narrow a search:

- **Date range** — From/To dates limit results to transactions posted in that range.
- **Account type** — restrict results to transactions touching an account of one type (Assets, Liabilities, Income, Expenses, Equity), or leave on **All**.

Filters only apply once you've typed a search; changing a filter re-runs the current search automatically.

## Starting blank

Tap the **+** button (bottom-right) at any time to skip the search and open a blank transaction in the editor instead.

## Show Query

The toolbar menu (⋮) has a **Show Query** item that displays the BQL query behind your last search, with a button to copy it — useful for troubleshooting unexpected results.
