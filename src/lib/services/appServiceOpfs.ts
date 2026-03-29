/*
App Service that operates on .beancount files in OPFS
*/

import { Xact, Posting } from '$lib/data/model';
import { ensureInitialized, createParsedLedger } from '$lib/services/rustledger';
import * as opfslib from '$lib/utils/opfslib';
import type { TransactionDirective } from '@rustledger/wasm';

class AppServiceOpfs {
	async loadXacts(): Promise<Xact[]> {
		try {
			// Ensure WASM is initialized
			await ensureInitialized();

			const content = await opfslib.readFile('cashier.bean');
			if (!content) {
				console.warn('No content loaded from OPFS');
				return [];
			}

			// Create a ParsedLedger from the beancount source
			const ledger = createParsedLedger(content);
			if (!ledger) {
				console.error('Failed to create ParsedLedger');
				return [];
			}

			try {
				// Get all directives from the ledger
				const directives = ledger.getDirectives();

				// Filter for transaction directives and convert to Xact objects
				const xacts: Xact[] = directives
					.filter((directive: any) => directive.type === 'transaction')
					.map((directive: any) => this.directiveToXact(directive));

				console.log(`Loaded ${xacts.length} transactions from OPFS`);
				return xacts;
			} finally {
				// Free the ledger resources
				ledger.free();
			}
		} catch (error) {
			console.error('Error loading content from OPFS:', error);
			return [];
		}
	}

	/**
	 * Convert a rustledger transaction directive to an Xact object
	 */
	private directiveToXact(directive: TransactionDirective): Xact {
		const xact = new Xact();

		// Set date (format: YYYY-MM-DD)
		xact.date = directive.date;

		// Set payee
		xact.payee = directive.payee || '';

		// Set note (narration)
		xact.note = directive.narration || '';

		// Convert postings
		if (directive.postings && Array.isArray(directive.postings)) {
			xact.postings = directive.postings.map((posting: any) => {
				const postingObj = new Posting();
				postingObj.account = posting.account || '';

				// Extract amount from posting
				if (posting.units && posting.units.number !== undefined) {
					postingObj.amount = parseFloat(posting.units.number);
				}
				if (posting.units && posting.units.currency) {
					postingObj.currency = posting.units.currency;
				}

				return postingObj;
			});
		}

		return xact;
	}
}

export default new AppServiceOpfs();
