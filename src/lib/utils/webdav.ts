export interface WebDavEntry {
	name: string;
	isDirectory: boolean;
	size: number | null;
	lastModified: Date | null;
}

export class WebDavClient {
	private baseUrl: string;
	private username: string;
	private password: string;

	constructor(url: string, username: string, password: string) {
		this.baseUrl = url.endsWith('/') ? url : url + '/';
		this.username = username;
		this.password = password;
	}

	private authHeader(): string {
		return 'Basic ' + btoa(`${this.username}:${this.password}`);
	}

	fileUrl(filename: string): string {
		return this.baseUrl + filename;
	}

	async put(
		filename: string,
		content: string,
		contentType = 'text/plain; charset=utf-8'
	): Promise<Response> {
		return fetch(this.fileUrl(filename), {
			method: 'PUT',
			headers: { Authorization: this.authHeader(), 'Content-Type': contentType },
			body: content
		});
	}

	async get(filename: string): Promise<Response> {
		return fetch(this.fileUrl(filename), {
			method: 'GET',
			cache: 'no-store',
			headers: { Authorization: this.authHeader() }
		});
	}

	async list(): Promise<WebDavEntry[]> {
		const res = await fetch(this.baseUrl, {
			method: 'PROPFIND',
			cache: 'no-store',
			headers: {
				Authorization: this.authHeader(),
				Depth: '1',
				'Content-Type': 'application/xml'
			},
			body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>`
		});
		if (!res.ok) throw new Error(`PROPFIND failed: ${res.status} ${res.statusText}`);
		const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
		const ns = 'DAV:';
		return Array.from(doc.getElementsByTagNameNS(ns, 'response'))
			.slice(1) // skip the directory itself
			.map((r) => {
				const href = r.getElementsByTagNameNS(ns, 'href')[0]?.textContent ?? '';
				const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? href);
				const isDirectory = r.getElementsByTagNameNS(ns, 'collection').length > 0;
				const sizeEl = r.getElementsByTagNameNS(ns, 'getcontentlength')[0];
				const size = sizeEl?.textContent ? parseInt(sizeEl.textContent, 10) : null;
				const lmEl = r.getElementsByTagNameNS(ns, 'getlastmodified')[0];
				const lastModified = lmEl?.textContent ? new Date(lmEl.textContent) : null;
				return { name, isDirectory, size, lastModified };
			});
	}

	async lastModified(filename: string): Promise<Date | null> {
		try {
			const res = await fetch(this.fileUrl(filename), {
				method: 'HEAD',
				cache: 'no-store',
				headers: { Authorization: this.authHeader() }
			});
			if (!res.ok) return null;
			const lm = res.headers.get('Last-Modified');
			return lm ? new Date(lm) : null;
		} catch {
			return null;
		}
	}
}
