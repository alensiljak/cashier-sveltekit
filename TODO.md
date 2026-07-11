# Tasks

## Projects

None at the moment. Regular ongoing maintenance.

## General

- [ ] research storing the configuration in OPFS, as a TOML file
- [x] currency calculator
- [ ] transaction import

## Quick Xact Entry

- [x] voice entry, Web Speech API + NLP rule engine.
- [x] add a home screen shortcut to /quick-add page
- [x] Drafts. User speaks / types a narrative. Creates a transaction later.
- [x] read the last transaction from the ledger, not special table
- [x] list multiple last transactions, to choose from

## Onboarding

- [x] Setup wizard at `/onboarding` — triggered by clean-slate detection (no `cashier.bean`, no other `.bean` files, no linked book) rather than a stored `onboarded` flag, so it can't get stuck skipped/shown by a stale setting. Offers Try demo data / Import my ledger / Start empty.
- [ ] Go through the initial settings (data storage, server)
- [ ] Add default settings to the wizard.

## Budgets

- [ ] rollover
- [x] monthly or yearly budget amounts
- [ ] add savings to the budget? Accounts other than expenses.
- [ ] savings goals
- [ ] what-if, net worth projection

## Controls

- [ ] standardize time period selection: day, week, month, quarter, year; this, last.
- [ ] charts: bar/line for trends, pie/donut for categories

## Investments

- [x] investment balances, Securities page. Commodities with cost (lots).
- [ ] ROI calculation per security
- [ ] price download
- [ ] improve/simplify asset allocation definition
- [ ] fee analyzer via metadata (ter?)
- [ ] time-weighted return (TWR)
- [ ] realized vs unrealized gains, tax lots
- [ ] distribution calendar

## Notifications

- [ ] bill payment notification. Time setting, like in Orgzly.
- [ ] low balance notifications (?)

## Reports

- [ ] tax report, capital gains
- [x] net worth (assets - liabilities)
- [ ] net worth projection
- [ ] spending trends over time
- [x] balance history: running balance over time
- [x] balance sheet - monthly, yearly. Income vs expenses summary.
- [ ] saving customized reports. Choose parameters and save under a name. Show on home screen.
