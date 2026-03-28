/*
    Provides string representation of Directives.
*/

import type { Directive, TransactionDirective } from '@rustledger/wasm';

class DirectiveFormatter {
	static toString(directive: Directive): string {
		switch (directive.type) {
			case 'transaction':
				return this.formatTransaction(directive);
			case 'balance':
				return this.formatBalance(directive);
			case 'open':
				return this.formatOpen(directive);
			case 'close':
				return this.formatClose(directive);
			case 'commodity':
				return this.formatCommodity(directive);
			case 'pad':
				return this.formatPad(directive);
			case 'event':
				return this.formatEvent(directive);
			case 'note':
				return this.formatNote(directive);
			case 'document':
				return this.formatDocument(directive);
			case 'price':
				return this.formatPrice(directive);
			case 'query':
				return this.formatQuery(directive);
			case 'custom':
				return this.formatCustom(directive);
			default:
				throw new Error(`Unknown directive type: ${(directive as any).type}`);
		}
	}

	private static formatTransaction(
		directive: TransactionDirective & { type: 'transaction' }
	): string {
		const tx = directive as unknown as Record<string, unknown>;
		const txMeta = (tx.meta ?? {}) as Record<string, unknown>;
		const tags = Array.isArray(tx.tags) ? tx.tags : [];
		const links = Array.isArray(tx.links) ? tx.links : [];
		const postings = Array.isArray(tx.postings) ? tx.postings : [];
		const flag = tx.flag;
		const payee = tx.payee != null && tx.payee !== '' ? this.quoteString(tx.payee) : '';
		const narration =
			tx.narration != null && tx.narration !== '' ? this.quoteString(tx.narration) : '""';

		const tagTokens = tags
			.map((tag) => String(tag))
			.filter(Boolean)
			.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
		const linkTokens = links
			.map((link) => String(link))
			.filter(Boolean)
			.map((link) => (link.startsWith('^') ? link : `^${link}`));

		const headerParts = [
			String(tx.date ?? ''),
			flag,
			payee,
			narration,
			...tagTokens,
			...linkTokens
		].filter(Boolean);
		const lines = [headerParts.join(' ')];

		for (const [key, value] of Object.entries(txMeta)) {
			lines.push(`    ${key}: ${this.formatMetaValue(value)}`);
		}

		for (const postingValue of postings) {
			const posting = postingValue as Record<string, unknown>;
			const postingFlag = typeof posting.flag === 'string' ? `${posting.flag} ` : '';
			const account = String(posting.account ?? '');
			const units = posting.units ? `  ${this.formatAmount(posting.units)}` : '';
			const cost = this.formatCost(posting.cost);
			const price = this.formatPriceAmount(posting.price);
			const comment = typeof posting.comment === 'string' ? `  ; ${posting.comment}` : '';

			lines.push(`    ${postingFlag}${account}${units}${cost}${price}${comment}`);

			if (posting.meta && typeof posting.meta === 'object') {
				for (const [key, value] of Object.entries(posting.meta as Record<string, unknown>)) {
					lines.push(`        ${key}: ${this.formatMetaValue(value)}`);
				}
			}

			lines.push(
				...this.formatExtraFields(
					posting,
					new Set(['account', 'flag', 'units', 'cost', 'price', 'comment', 'meta']),
					'        '
				)
			);
		}

		lines.push(
			...this.formatExtraFields(
				tx,
				new Set([
					'type',
					'date',
					'flag',
					'payee',
					'narration',
					'tags',
					'links',
					'meta',
					'postings'
				]),
				'    '
			)
		);
		return lines.join('\n');
	}

	private static formatBalance(directive: Directive & { type: 'balance' }): string {
		const balance = directive as unknown as Record<string, unknown>;
		const date = String(balance.date ?? '');
		const account = String(balance.account ?? '');
		const amount = this.formatAmount(balance.amount);
		const tolerance =
			balance.tolerance != null ? `  tolerance: ${this.formatAmount(balance.tolerance)}` : '';
		const diffAmount =
			balance.diff_amount != null ? `  diff_amount: ${this.formatAmount(balance.diff_amount)}` : '';
		const metaLines: string[] = [];

		if (balance.meta && typeof balance.meta === 'object') {
			for (const [key, value] of Object.entries(balance.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} balance ${account} ${amount}${tolerance}${diffAmount}`.trim();
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatOpen(directive: Directive & { type: 'open' }): string {
		const open = directive as unknown as Record<string, unknown>;
		const date = String(open.date ?? '');
		const account = String(open.account ?? '');
		const currencies = Array.isArray(open.currencies) ? open.currencies : [];
		const booking = open.booking != null ? `  booking: ${open.booking}` : '';
		const metaLines: string[] = [];

		if (open.meta && typeof open.meta === 'object') {
			for (const [key, value] of Object.entries(open.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const currenciesStr = currencies.length > 0 ? `  ${currencies.join(' ')}` : '';
		const line = `${date} open ${account}${currenciesStr}${booking}`.trim();
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatClose(directive: Directive & { type: 'close' }): string {
		const close = directive as unknown as Record<string, unknown>;
		const date = String(close.date ?? '');
		const account = String(close.account ?? '');
		const metaLines: string[] = [];

		if (close.meta && typeof close.meta === 'object') {
			for (const [key, value] of Object.entries(close.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} close ${account}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatCommodity(directive: Directive & { type: 'commodity' }): string {
		const commodity = directive as unknown as Record<string, unknown>;
		const date = String(commodity.date ?? '');
		const currency = String(commodity.currency ?? '');
		const metaLines: string[] = [];

		if (commodity.meta && typeof commodity.meta === 'object') {
			for (const [key, value] of Object.entries(commodity.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} commodity ${currency}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatPad(directive: Directive & { type: 'pad' }): string {
		const pad = directive as unknown as Record<string, unknown>;
		const date = String(pad.date ?? '');
		const account = String(pad.account ?? '');
		const sourceAccount = String(pad.source_account ?? '');
		const metaLines: string[] = [];

		if (pad.meta && typeof pad.meta === 'object') {
			for (const [key, value] of Object.entries(pad.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} pad ${account}  ${sourceAccount}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatEvent(directive: Directive & { type: 'event' }): string {
		const event = directive as unknown as Record<string, unknown>;
		const date = String(event.date ?? '');
		const eventType = String(event.event_type ?? '');
		const value = event.value != null ? `  "${this.quoteString(event.value)}"` : '';
		const metaLines: string[] = [];

		if (event.meta && typeof event.meta === 'object') {
			for (const [key, value] of Object.entries(event.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} event "${eventType}"${value}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatNote(directive: Directive & { type: 'note' }): string {
		const note = directive as unknown as Record<string, unknown>;
		const date = String(note.date ?? '');
		const account = String(note.account ?? '');
		const comment = note.comment != null ? `  "${this.quoteString(note.comment)}"` : '';
		const metaLines: string[] = [];

		if (note.meta && typeof note.meta === 'object') {
			for (const [key, value] of Object.entries(note.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} note ${account}${comment}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatDocument(directive: Directive & { type: 'document' }): string {
		const doc = directive as unknown as Record<string, unknown>;
		const date = String(doc.date ?? '');
		const account = String(doc.account ?? '');
		const path = doc.path != null ? `  "${this.quoteString(doc.path)}"` : '';
		const metaLines: string[] = [];

		if (doc.meta && typeof doc.meta === 'object') {
			for (const [key, value] of Object.entries(doc.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} document ${account}${path}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatPrice(directive: Directive & { type: 'price' }): string {
		const price = directive as unknown as Record<string, unknown>;
		const date = String(price.date ?? '');
		const currency = String(price.currency ?? '');
		const amount = this.formatAmount(price.amount);
		const metaLines: string[] = [];

		if (price.meta && typeof price.meta === 'object') {
			for (const [key, value] of Object.entries(price.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} price ${currency} ${amount}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatQuery(directive: Directive & { type: 'query' }): string {
		const query = directive as unknown as Record<string, unknown>;
		const date = String(query.date ?? '');
		const name = String(query.name ?? '');
		const queryString =
			query.query_string != null ? `  "${this.quoteString(query.query_string)}"` : '';
		const metaLines: string[] = [];

		if (query.meta && typeof query.meta === 'object') {
			for (const [key, value] of Object.entries(query.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} query "${name}"${queryString}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static formatCustom(directive: Directive & { type: 'custom' }): string {
		const custom = directive as unknown as Record<string, unknown>;
		const date = String(custom.date ?? '');
		const customType = String(custom.custom_type ?? '');
		const metaLines: string[] = [];

		if (custom.meta && typeof custom.meta === 'object') {
			for (const [key, value] of Object.entries(custom.meta as Record<string, unknown>)) {
				metaLines.push(`    ${key}: ${this.formatMetaValue(value)}`);
			}
		}

		const line = `${date} custom ${customType}`;
		return metaLines.length > 0 ? `${line}\n${metaLines.join('\n')}` : line;
	}

	private static quoteString(value: unknown): string {
		const text = String(value ?? '');
		return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}

	private static formatAmount(value: unknown): string {
		if (!value || typeof value !== 'object') {
			return String(value ?? '');
		}

		const record = value as Record<string, unknown>;
		if (typeof record.number === 'string' || typeof record.number === 'number') {
			const currency = typeof record.currency === 'string' ? ` ${record.currency}` : '';
			return `${record.number}${currency}`.trim();
		}

		return JSON.stringify(value);
	}

	private static formatMetaValue(value: unknown): string {
		if (typeof value === 'string') {
			return this.quoteString(value);
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (value == null) {
			return 'null';
		}
		if (Array.isArray(value) || typeof value === 'object') {
			return this.quoteString(JSON.stringify(value));
		}
		return this.quoteString(String(value));
	}

	private static formatCost(cost: unknown): string {
		if (!cost || typeof cost !== 'object') {
			return '';
		}

		const record = cost as Record<string, unknown>;
		if (record.number != null) {
			return ` {${this.formatAmount(cost)}}`;
		}

		return ` {${JSON.stringify(cost)}}`;
	}

	private static formatPriceAmount(price: unknown): string {
		if (!price) {
			return '';
		}
		return ` @ ${this.formatAmount(price)}`;
	}

	private static formatExtraFields(
		record: Record<string, unknown>,
		knownKeys: Set<string>,
		indent: string
	): string[] {
		const lines: string[] = [];
		for (const [key, value] of Object.entries(record)) {
			if (knownKeys.has(key) || value == null) {
				continue;
			}
			lines.push(`${indent}; ${key}: ${JSON.stringify(value)}`);
		}
		return lines;
	}
}

export { DirectiveFormatter };
