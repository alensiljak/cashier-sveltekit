/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (`""`), and
 * newlines inside quotes. Returns one object per data row, keyed by header.
 */
export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	// Strip the BOM that some bank exports start with.
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && src[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const [header, ...data] = rows.filter((r) => r.some((f) => f !== ''));
	if (!header) return [];
	return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
