# Quick Query

Quick Query is a form-based builder for BQL (Beancount Query Language) queries. Instead of typing raw BQL, you pick a command and fill in filters — the query text is generated for you and can be run directly against your ledger.

## Building a query

Choose a command along the top: **Balance**, **Register**, **Lots**, **Assert**, or **Price**.

Enter a pattern in the text field below the commands — for most commands this is an account filter (e.g. `Assets not Bank @Payee`); for **Price** it's a commodity/currency code (e.g. `EUR`).

Tap **Filters** to expand additional options:

- **Begin** / **End** / **Date range** — restrict results to a date window.
- **Currency filter** — comma-separated list of currencies/commodities to include.
- **Exchange (convert to)** — convert amounts into a single currency.
- **Sort** — column to sort by (prefix with `-` for descending).
- **Limit** — maximum number of rows.
- **Show total / running total** — adds a running total to **Register** results.

**Balance** adds: **Hierarchy** (show the account tree), **Exclude zero balances**, **Include closed accounts**, and **Depth** (collapse accounts beyond a given depth).

**Lots** adds: a Show filter (**Active** / **All** / **Closed**), **Average cost**, and **Sort by** (Date, Price, or Symbol).

## Running and reading results

The **Generated BQL** box shows the query that will run, built live from your selections — tap the copy icon next to it to copy the query text to the clipboard.

Tap **Run** (or press **Ctrl+Enter**) to execute the query. Errors from the query engine appear below the BQL box, with line/column information when available.

Successful results are shown as a table, with the row count above it. Tap the copy icon above the results to copy the table (tab-separated, ready to paste into a spreadsheet). When **Show total / running total** is enabled for a **Register** query, an extra **Running Total** column is appended to both the table and the copied data.
