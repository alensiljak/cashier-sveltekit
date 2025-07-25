/*
    The domain model
*/

export class Money {
	quantity = 0;
	currency = '';

	/**
	 * Parse values from a number string. Usually from the reports.
	 * @param amount_str Amount string, "-125.35 EUR"
	 */
	static fromString(amount_str: string): Money {
		const parts = amount_str.split(' ');
		const result = new Money();
		result.quantity = parseFloat(parts[0]);
		result.currency = parts[1];
		return result;
	}
}

export class Account {
	/**
	 * Used to sum up the balance of sub-accounts in Asset Allocation calculation.
	 */
	balance?: Money;

	name = '';
	balances?: Record<string, number>;
	// currency: any
	currentValue: number | string | undefined;
	currentCurrency: string | undefined;

	constructor(accountName: string) {
		this.name = accountName;
	}

	getAccountName() {
		const separatorIndex = this.name.lastIndexOf(':');
		return this.name.substring(separatorIndex + 1);
	}

	getParentName() {
		const separatorIndex = this.name.lastIndexOf(':');
		return this.name.substring(0, separatorIndex);
	}
}

export class LastXact {
	payee = '';
	transaction?: Xact;
}

export class Payee {
	// id?: number
	name = '';

	constructor(name: string) {
		this.name = name;
	}
}

export class Posting {
	// id?: number
	// transactionId: number | undefined
	account: string;
	amount?: number;
	currency: string;

	constructor() {
		// Id is inserted automatically.
		// this.id = null
		// this.transactionId = undefined
		this.account = '';
		this.currency = '';
	}
}

/**
 * Intended for price download and export.
 * Not used.
 */
export class Price {
	// symbol used in the book
	symbol: string | undefined;
	// symbol on the exchange
	ticker: string | undefined;
	// downloaded price
	price: unknown;
	// currency of the price
	currency: string | undefined;
}

export class ScheduledTransaction {
	id?: number;
	nextDate: string;
	transaction?: Xact;
	period?: string;
	count?: number;
	endDate: unknown;
	remarks?: string;

	// Transaction Amount, for display only.
	amount?: Money;

	constructor() {
		this.nextDate = '';
		this.period = '';
	}
}

export class Xact {
	id?: number;
	date?: string;
	payee?: string;
	note?: string;
	postings: Posting[];
	//
	//amount: any
	//currency: any

	constructor() {
		// this.id = newId()
		this.date = '';
		this.payee = '';
		this.postings = [];
	}

	static create() {
		const tx = new Xact();
		// Set the date to today.
		tx.date = new Date().toISOString().substring(0, 10);

		// add two Posting records by default.
		tx.postings.push(new Posting());
		tx.postings.push(new Posting());

		return tx;
	}
}

export class Setting {
	key: string;
	value: string;

	constructor(key: string, value: string) {
		this.key = key;
		this.value = value;
	}
}
