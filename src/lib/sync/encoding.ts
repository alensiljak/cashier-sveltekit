/** Byte/text encodings shared by the device key, the sync group and invites. */

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
	let s = '';
	for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
		s += String.fromCharCode(b);
	}
	return btoa(s);
}

/** Throws on text that is not base64. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	const s = atob(text);
	const bytes = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
	return bytes;
}

/** Base64 with `-` and `_` and no padding, safe in a URL fragment. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on text that is not base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(length));
}

/** HMAC-SHA256 of `message` under `key`. */
export async function hmacSha256(
	key: Uint8Array<ArrayBuffer>,
	message: string
): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
}
