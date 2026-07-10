# Tasks

## Projects

None at the moment. Regular ongoing maintenance.

## General

- [ ] research storing the configuration in OPFS, as a TOML file
- [ ] savings goals
- [x] currency calculator
- [ ] transaction import
- [ ] price download

## Quick Xact Entry

- [x] voice entry, Web Speech API + NLP rule engine.
- [ ] add a home screen shortcut to /quick-add page
- [ ] Drafts. User speaks / types a narrative. Creates a transaction later.
- [x] read the last transaction from the ledger, not special table
- [x] list multiple last transactions, to choose from

## Onboarding

- [x] Setup wizard at `/onboarding` — triggered by clean-slate detection (no `cashier.bean`, no other `.bean` files, no linked book) rather than a stored `onboarded` flag, so it can't get stuck skipped/shown by a stale setting. Offers Try demo data / Import my ledger / Start empty.
- [ ] Go through the initial settings (data storage, server)
- [ ] Add defaults to the wizard.

## Controls

- [ ] standardize time period selection: day, week, month, quarter, year; this, last.
- [ ] charts: bar/line for trends, pie/donut for categories

## Reports

- [x] net worth (assets - liabilities)
- [ ] spending trends over time
- [ ] balance history: running balance over time
- [ ] balance sheet - monthly, yearly. Income vs expenses summary.
- [ ] saving customized reports. Choose parameters and save under a name. Show on home screen.
