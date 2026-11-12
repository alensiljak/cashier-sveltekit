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
	currencies: string[] = [];
	currentValue: number | string | undefined;
	currentCurrency: string | undefined;
	exists: boolean = true;

	constructor(accountName: string) {
		this.name = accountName;
	}

	getAccountName() {
		const parts = this.name.split(':');
		if (parts.length <= 2) return parts[parts.length - 1];
		return parts.slice(2).join(':');
	}

	getParentName() {
		const parts = this.name.split(':');
		return parts.slice(0, Math.min(2, parts.length - 1)).join(':');
	}
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
	// Price annotation: `@ priceAmount priceCurrency` or `@@ priceAmount priceCurrency` when totalPrice=true
	priceAmount?: number;
	priceCurrency?: string;
	totalPrice?: boolean;
	// Cost annotation: `{costAmount costCurrency[, costDate]}`
	costAmount?: number;
	costCurrency?: string;
	costDate?: string;

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

/** Identifier of a scheduled transaction. Opaque to callers: only pass back what the storage gave them. */
export type ScxId = string;

export class ScheduledTransaction {
	id?: ScxId;
	nextDate: string;
	transaction?: Xact;
	period?: string;
	count?: number;
	endDate: unknown;
	remarks?: string;
	repayment?: boolean;

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
	flag?: string;
	postings: Posting[];
	/** Transaction-level Beancount metadata (`key: value` lines). String values only. */
	meta: Record<string, string>;
	/**
	 * Set when this working-set record is a Beancount `balance` assertion instead of a
	 * transaction. Such a record has no postings; it is written as a `balance` directive.
	 */
	balanceAssertion?: { account: string; amount: number; currency: string };
	//
	//amount: any
	//currency: any

	constructor() {
		// this.id = newId()
		this.date = '';
		this.payee = '';
		this.flag = '*';
		this.postings = [];
		this.meta = {};
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

export class TrustedPeer {
	id: string = '';
	name: string = '';
	trustedAt: string = '';
	/**
	 * Base64 SPKI of the key this peer proved at pairing. Peer sync trusts the peer only while its
	 * signed hello carries this key; records without one (older versions, S3/WebDAV) must re-pair.
	 */
	publicKey?: string;
	/** Short form of the key-derived ID (`7KQ2-M9XA`), shown next to the name. Empty without a key. */
	fingerprint?: string;
	/**
	 * The IDs this device had before its ID was derived from its key (UUIDs). What it wrote under
	 * them stays trusted until it is forgotten (see sync/identityMigration.ts).
	 */
	legacyIds?: string[];
	/** The name the peer announced. `name` is this device's own label for it and may be renamed. */
	announcedName?: string;
	/** Set when this device was trusted on the word of another trusted device (an approved introduction): that device's ID. Empty for devices paired directly. */
	addedBy?: string;
	lastSeen?: string;
	/** The peer may pull our data, but nothing it sends (live updates, sync pushes, its WebDAV file) is merged here. */
	readOnly?: boolean;
}

/**
 * A trusted device vouched for another device (see sync/introductions.ts). It stays a request
 * until a person approves it on this device; only then is the device trusted.
 */
export class PendingIntroduction {
	/** The key-derived ID of `publicKey`: one request per key, however many devices vouch for it. */
	id: string = '';
	/** The device ID the subject announces. */
	subjectId: string = '';
	name: string = '';
	publicKey: string = '';
	fingerprint: string = '';
	/** Every trusted device that introduced this key. */
	introducedBy: { id: string; name: string; at: number }[] = [];
	/** `dismissed` requests are kept so the same introduction is not asked again. */
	status: 'pending' | 'dismissed' = 'pending';
	receivedAt: string = '';
}

/** A signed eviction: `by` vouches that `revoked` is no longer part of the group (see sync/revocations.ts). */
export type RevocationRecord = {
	v: 1;
	/** The ID of the evicted device. */
	revoked: string;
	/** The ID of the trusted device that evicted it. */
	by: string;
	/** ms since the epoch. Part of the signature. */
	at: number;
	sig: string;
};

/**
 * The tombstone of an evicted device. It is its own table, not a flag on `TrustedPeer`, so that
 * nothing that reads the trusted list can take an evicted device for a trusted one. While
 * `evicted`, the device is not trusted, is not introduced, and is not re-admitted by gossip or an
 * old invite; a person who pairs with it again clears it (`readmitted`).
 */
export class Revocation {
	/** The evicted device's ID (and one row for each legacy ID of its trusted record). */
	id: string = '';
	status: 'evicted' | 'readmitted' = 'evicted';
	/** The signed record, kept so it can be passed on to devices that have not heard of it. */
	record!: RevocationRecord;
	/** What this device called it, for the notice. Empty when it was not trusted here. */
	name: string = '';
	fingerprint: string = '';
	/** What this device called the evictor. */
	byName: string = '';
	receivedAt: string = '';
	/** A person has read the notice. */
	seen: boolean = false;
	/** When a person paired with the device again (ISO). Older eviction records are then ignored. */
	readmittedAt?: string;
}

/**
 * Last-synced content hash for one path against one peer endpoint. Compared
 * against a fresh SyncEntry scan (see src/lib/sync/syncDiff.ts) to classify
 * each path as unchanged / local-newer / remote-newer / conflict.
 * Keyed `[endpointId+path]` — one baseline per (peer, file), since a device
 * may sync with multiple peers.
 *
 * Local and remote hashes are recorded independently (not one shared value)
 * because a manual merge (DiffViewer's per-hunk pick) can leave the two
 * sides holding deliberately different, reconciled content — the baseline
 * then records what each side actually holds post-merge, not a single
 * "they agree" hash. See doc/projects/2026-07-02_beancount-peer-sync.md.
 */
export class PeerSyncBaseline {
	endpointId: string = '';
	path: string = '';
	localHash: string = '';
	remoteHash: string = '';
	syncedAt: string = '';
}
