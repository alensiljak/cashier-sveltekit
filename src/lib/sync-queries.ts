/**
 * Contains queries for the sync, PTA system.
 */

const LedgerQueries = {
    'accounts': 'b --flat --empty --no-total',
    'balances': 'b --flat --no-total',
    currentValues(rootAccount: string, currency: string) {
        const query = `b ^${rootAccount} -X ${currency} --flat --no-total`
        return query
    },
    lots(symbol: string) {
        const query = `b ^Assets and invest and :${symbol}$ --lots --no-total --collapse`
        return query
    }
}

const BeancountQueries = {
    'accounts': 'select distinct account order by account',
    'balances': '',
    currentValues(rootAccount: string, currency: string) {
        const query = ''
        return query
    },
    lots(symbol: string) {
        const query = ''
        return query
    }
}

function getQueries(ptaSystem: string): Record<string, any> {
    if (ptaSystem === 'ledger') {
        return LedgerQueries
    } else if (ptaSystem == 'beancount') {
        return BeancountQueries
    } else {
        throw new Error('Unknown PTA system: ' + ptaSystem)
    }
}

export { getQueries }
