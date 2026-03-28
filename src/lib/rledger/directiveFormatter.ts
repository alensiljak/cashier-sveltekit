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
		throw new Error('Not Implemented');
	}

	private static formatOpen(directive: Directive & { type: 'open' }): string {
		throw new Error('Not Implemented');
	}

	private static formatClose(directive: Directive & { type: 'close' }): string {
		throw new Error('Not Implemented');
	}

	private static formatCommodity(directive: Directive & { type: 'commodity' }): string {
		throw new Error('Not Implemented');
	}

	private static formatPad(directive: Directive & { type: 'pad' }): string {
		throw new Error('Not Implemented');
	}

	private static formatEvent(directive: Directive & { type: 'event' }): string {
		throw new Error('Not Implemented');
	}

	private static formatNote(directive: Directive & { type: 'note' }): string {
		throw new Error('Not Implemented');
	}

	private static formatDocument(directive: Directive & { type: 'document' }): string {
		throw new Error('Not Implemented');
	}

	private static formatPrice(directive: Directive & { type: 'price' }): string {
		throw new Error('Not Implemented');
	}

	private static formatQuery(directive: Directive & { type: 'query' }): string {
		throw new Error('Not Implemented');
	}

	private static formatCustom(directive: Directive & { type: 'custom' }): string {
		throw new Error('Not Implemented');
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
