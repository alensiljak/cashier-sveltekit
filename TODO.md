# Tasks

## Projects

See the Projects folder for any active projects.

## General

- [x] research storing the configuration in OPFS, as a TOML file
- [x] currency calculator
- [ ] transaction import

## Onboarding

- [x] Setup wizard at `/onboarding` — triggered by clean-slate detection (transaction store not initialized, no `.bean` files, no linked book) rather than a stored `onboarded` flag, so it can't get stuck skipped/shown by a stale setting. Offers Try demo data / Import my ledger / Start empty.
- [x] Go through the initial settings (data storage, server)
- [ ] Add default settings to the wizard.

## Budgets

- [x] rollover
- [x] monthly or yearly budget amounts
- [ ] add savings to the budget? Accounts other than expenses.
- [ ] savings goals
- [ ] what-if, net worth projection

## Controls

- [x] standardize time period selection: day, week, month, quarter, year; this, last.
- [ ] charts: bar/line for trends, pie/donut for categories

## Investments

- [x] investment balances, Securities page. Commodities with cost (lots).
- [x] portfolio returns, [repo](https://github.com/andreasgerstmayr/fava-portfolio-returns)
- [x] ROI calculation per security
- [ ] price download
- [ ] improve/simplify asset allocation definition
- [ ] fee analyzer via metadata (ter?)
- [ ] time-weighted return (TWR)
- [ ] realized vs unrealized gains, tax lots
- [ ] distribution calendar

## Notifications

- [x] bill payment notification. Time setting, like in Orgzly. (in-app only; see Settings)
- [ ] low balance notifications (?)

## Reports

- [ ] spending trends over time (total, per category)
- [x] stacked bar expense report with main categories (first pass, 12 mo., top 6 + Other)
- [ ] base line in expense report: average or budget
- [ ] budget report: budgeted vs real amounts over 12 mo.
- [ ] tax report, capital gains
- [x] net worth (assets - liabilities)
- [ ] net worth projection
- [x] balance history: running balance over time
- [x] balance sheet - monthly, yearly. Income vs expenses summary.
- [ ] saving customized reports. Choose parameters and save under a name. Show on home screen.
