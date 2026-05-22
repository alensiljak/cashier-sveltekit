/**
 * Xact parser
 * Used for calculation of the empty postings
 */
import { Posting, Xact } from '$lib/data/model';

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

function validateEmptyString(input: string) {
	if (!input) {
		throw new Error('Missing input');
	}
}

export function parseXact(input: string) {
	validateEmptyString(input);

	const lines = input.split('\n');

	const xact = new Xact();
	let postingIndex = 1;

	// date
	let line = lines[0];
	validateEmptyString(line);
	let separatorIndex = lines[0].indexOf(' ');
	const date = lines[0].substring(0, separatorIndex);
	xact.date = date;
	// payee
	xact.payee = lines[0].substring(separatorIndex + 1);

	// note?
	line = lines[1].trim();
	validateEmptyString(line);
	if (line.startsWith(';')) {
		xact.note = line.substring(1).trim();
		postingIndex = 2;
	}

	// postings
	for (let i = postingIndex; i < lines.length; i++) {
		line = lines[i].trim();
		validateEmptyString(line);

		const posting = new Posting();

		// separator
		separatorIndex = line.indexOf('  ');
		if (separatorIndex === -1) {
			// no separator
			posting.account = line;
		} else {
			// account
			posting.account = line.substring(0, separatorIndex);

			const amountPart = line.substring(separatorIndex).trimStart();
			separatorIndex = amountPart.indexOf(' ');
			if (separatorIndex !== -1) {
				posting.amount = Number(amountPart.substring(0, separatorIndex));
				const restAfterAmount = amountPart.substring(separatorIndex + 1).trim();
				const spaceAfterCurrency = restAfterAmount.indexOf(' ');
				if (spaceAfterCurrency === -1) {
					posting.currency = restAfterAmount;
				} else {
					posting.currency = restAfterAmount.substring(0, spaceAfterCurrency);
					const annotation = restAfterAmount.substring(spaceAfterCurrency + 1).trim();
					// Check @@ before @ to avoid partial match
					const totalPriceMatch = annotation.match(/^@@\s+(\S+)\s+(\S+)/);
					const unitPriceMatch = annotation.match(/^@\s+(\S+)\s+(\S+)/);
					if (totalPriceMatch) {
						posting.totalPrice = true;
						posting.priceAmount = Number(totalPriceMatch[1]);
						posting.priceCurrency = totalPriceMatch[2];
					} else if (unitPriceMatch) {
						posting.totalPrice = false;
						posting.priceAmount = Number(unitPriceMatch[1]);
						posting.priceCurrency = unitPriceMatch[2];
					}
				}
			}
		}
		xact.postings.push(posting);
	}

	return xact;
}
