export const SelectionType = {
  ACCOUNT: 'Account',
} as const;

export const HomeCardNames = {
  FAVOURITES: 'FavouritesCard',
  FORECAST: 'ForecastCard',
  JOURNAL: 'JournalCard',
  SCHEDULED: 'ScheduledXactCard',
  SYNC: 'SyncCard',
} as const;

export const RecurrencePeriods = {
  Days: 'days',
  Weeks: 'weeks',
  Months: 'months',
  StartOfMonth: 'start of month',
  EndOfMonth: 'end of month',
  Years: 'years'
}