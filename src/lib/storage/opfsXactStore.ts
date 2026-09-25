import { createParsedLedger, ensureInitialized } from '$lib/services/rustledger';
import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import { CASHIER_XACT_FILE } from '$lib/constants';
import * as opfslib from '$lib/utils/opfslib';
import { mapDirectiveSpans, replaceDirectiveBySpan } from '$lib/rledger/sourceEditor';
import { findXactAtLine, locateXactsInSource } from '$lib/utils/xactLocator';
import type { StoredXact, XactId, XactStore } from './xactStore';

/**
 * Working set kept as the `cashier.bean` file in OPFS. Transactions are
 * identified by their source line span, so every write re-sorts the file
 * by date and re-locates the affected transaction.
 */
export class OpfsXactStore implements XactStore {
	readonly kind = 'opfs';

	private async read(): Promise<string> {
		return (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';
	}

	private async write(content: string): Promise<void> {
		await opfslib.saveFile(CASHIER_XACT_FILE, content);
		scheduleBackup();
	}

	/** Sort a Beancount source string by directive date, preserving raw source text. */
	private async sortSource(source: string): Promise<string> {
		if (!source.trim()) return source;
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) return source;
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const pairs = spans.map((span) => ({
				date: span.sourceText.slice(0, 10),
				sourceText: span.sourceText
			}));
			pairs.sort((a, b) => a.date.localeCompare(b.date));
			return pairs.map((p) => p.sourceText).join('\n\n') + '\n';
		} finally {
			tempLedger.free();
		}
	}

	/** The file store identifies a transaction by its (0-based) start line. */
	private static toId(startLine: number): XactId {
		return String(startLine);
	}

	private static toStartLine(id: XactId): number {
		return Number(id);
	}

	/** Locate the transaction whose text is `text` in the (already sorted) content. */
	private async locate(content: string, text: string): Promise<StoredXact> {
		// sortSource preserves sourceText verbatim, so indexOf is exact.
		const charIdx = content.indexOf(text);
		const line = charIdx >= 0 ? content.slice(0, charIdx).split('\n').length : 1;
		const location = findXactAtLine(await locateXactsInSource(content), line);
		if (!location) throw new Error('Could not locate the saved transaction');
		return { xact: location.xact, id: OpfsXactStore.toId(location.span.startLine) };
	}

	async append(beancountText: string): Promise<StoredXact> {
		await ensureInitialized();
		let content = await this.read();

		// Ensure a blank-line separator before the new entry.
		if (content.length > 0 && !content.endsWith('\n\n')) {
			content = content.trimEnd() + '\n\n';
		}
		const text = beancountText.trimEnd();
		content = await this.sortSource(content + text + '\n');
		await this.write(content);
		return this.locate(content, text);
	}

	async update(id: XactId, beancountText: string): Promise<StoredXact> {
		await ensureInitialized();
		const source = await this.read();
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) throw new Error(`Failed to parse ${CASHIER_XACT_FILE}`);
		const text = beancountText.trimEnd();
		let updated: string;
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const idx = spans.findIndex((s) => s.startLine === OpfsXactStore.toStartLine(id));
			if (idx === -1) {
				throw new Error(
					`Could not locate directive at line ${OpfsXactStore.toStartLine(id)} in ${CASHIER_XACT_FILE}`
				);
			}
			updated = await this.sortSource(replaceDirectiveBySpan(source, spans, idx, text));
		} finally {
			tempLedger.free();
		}
		await this.write(updated);
		return this.locate(updated, text);
	}

	async remove(id: XactId): Promise<void> {
		await ensureInitialized();
		const source = await this.read();
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) throw new Error(`Failed to parse ${CASHIER_XACT_FILE}`);
		let updated: string;
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const idx = spans.findIndex((s) => s.startLine === OpfsXactStore.toStartLine(id));
			if (idx === -1) {
				throw new Error(
					`Could not locate directive at line ${OpfsXactStore.toStartLine(id)} in ${CASHIER_XACT_FILE}`
				);
			}
			updated = replaceDirectiveBySpan(source, spans, idx, '');
			// Collapse runs of 3+ blank lines down to 2 (one visual separator).
			updated = updated.replace(/\n{3,}/g, '\n\n');
		} finally {
			tempLedger.free();
		}
		await this.write(updated);
	}

	async list(): Promise<StoredXact[]> {
		const locations = await locateXactsInSource(await this.read());
		return locations.map((l) => ({ xact: l.xact, id: OpfsXactStore.toId(l.span.startLine) }));
	}

	/** Reads the file, creating it empty on first use. */
	async toBeancount(): Promise<string> {
		let content = await opfslib.readFile(CASHIER_XACT_FILE);
		if (content === undefined) {
			await opfslib.saveFile(CASHIER_XACT_FILE, '');
			content = '';
		}
		return content;
	}

	async clear(): Promise<void> {
		await this.write('');
	}
}
