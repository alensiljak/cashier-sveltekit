/**
 * Xact parser
 * Used for calculation of the empty postings
 */
import { Posting, Xact } from '$lib/data/model';
import rustledger from '$lib/services/rustledger';

export class TransactionParser {
	/**
	 * Extract the postings for the given account from the list of Transactions
	 * @param accountName The name of the account
	 */
	static extractPostingsFor(txs: Xact[], accountName: string): Posting[] {
		let result: Posting[] = [];

		txs.forEach((tx) => {
			const postings = tx.postings.filter((posting) => posting.account == accountName);
			result = result.concat(postings);
		});
		return result;
	}
}

/**
 * Map a raw WASM transaction directive object to an Xact view model.
 * Works with directives from both ParsedLedger.getDirectives() and
 * parse(source).ledger.directives.
 */
export function directiveToXact(directive: any): Xact {
	const tx = new Xact();
	tx.date = directive.date;
	tx.payee = directive.payee ?? '';
	tx.note = directive.narration ?? '';
	tx.flag = directive.flag ?? '*';
	tx.postings = (directive.postings ?? []).map((p: any) => {
		const posting = new Posting();
		posting.account = p.account ?? '';
		if (p.units?.number != null) posting.amount = parseFloat(p.units.number);
		if (p.units?.currency) posting.currency = p.units.currency;
		if (p.price?.number != null) posting.priceAmount = parseFloat(p.price.number);
		if (p.price?.currency) posting.priceCurrency = p.price.currency;
		if (p.price) posting.totalPrice = !!p.price.total;
		if (p.cost?.number != null) posting.costAmount = parseFloat(p.cost.number);
		if (p.cost?.currency) posting.costCurrency = p.cost.currency;
		if (p.cost?.date) posting.costDate = p.cost.date;
		return posting;
	});
	return tx;
}

export function parseXact(input: string): Xact {
	if (!input) {
		throw new Error('Missing input');
	}

	const result = rustledger.parseSource(input);
	const directive = (result.ledger as any)?.directives?.find(
		(d: any) => d.type === 'transaction'
	);

	if (!directive) {
		throw new Error('No transaction found in input');
	}

	return directiveToXact(directive);
}
