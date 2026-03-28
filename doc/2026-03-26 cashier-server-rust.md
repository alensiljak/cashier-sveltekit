# Cashier Server Rust

The goal of this project is to switch to Cashier Server Rust and adapt the project to handle the improved output (JSON).
The output is provided by Rust Ledger directly.

The communication to Cashier Server is performed in the `/sync` page.

## Status

Track progress on features here.

| Section        | Progress   |
| -------------- | ---------- |
| Accounts       | ✅ Ready   |
| Balances       | ❌ blocked |
| Payees         | ❌ blocked |
| Infrastructure | ✅ Ready   |

## Sections

### ✅ Accounts

Accounts query response:

```json
{
	"columns": ["sum", "currency", "account"],
	"row_count": 1,
	"rows": [
		{
			"account": "Expenses:Food",
			"currency": "EUR",
			"sum": "0.00"
		}
	]
}
```

### ❌ Balances

Blocker: The Rust Ledger query does not support `convert()` function!

Accounts with balances for asset allocation:

```json
{
	"columns": ["account", "str"],
	"row_count": 0,
	"rows": []
}
```

### ❌ Payees

Blocker:

```txt
error: failed to execute query: evaluation error: table 'transactions' does not exist
```

### ✅ Infrastructure

```json
{
	"contents": "<file contents>"
}
```
