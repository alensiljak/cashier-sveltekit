/**
 * The secrets inside the settings, and the encrypted block that carries them in a backup file.
 *
 * A secret is a whole setting (an API key) or some fields of one (the WebDAV password, the S3
 * secret key), whose rest (URL, bucket, user) is plain. The backup rules (rules.ts) say which.
 * `splitSecrets` blanks the secret fields for the plain part of a backup. The block holds each
 * connection whole, so a secret cannot be paired with another URL. Format 2 held the secret
 * fields alone; `mergeSecrets` puts them back.
 *
 * The block is optional. It is encrypted with a key derived from a passphrase the person enters
 * (the same PBKDF2 + AES-GCM as the S3 sync, see s3Crypto.ts), so the file alone does not give
 * the credentials away.
 */
import type { StoredSetting } from './model';
import { SECRET_SPECS, type CredentialSetting, type SecretSpec } from './rules';
import {
	createKeyParams,
	decrypt,
	encrypt,
	fromBase64,
	openKey,
	toBase64,
	type KeyParams
} from '#lib/services/s3Crypto';

/** Shortest passphrase accepted for the secrets block. A typo or a short one is not recoverable. */
export const MIN_BACKUP_PASSPHRASE_LENGTH = 12;

export const specFor = (store: SecretSpec['store'], key: string) =>
	SECRET_SPECS.find((s) => s.store === store && s.key === key);

/** Key of a spec's entry in the secrets block. */
export const secretId = (spec: Pick<SecretSpec, 'store' | 'key'>) => `${spec.store}:${spec.key}`;

/** A stored setting's value, or undefined when it is not JSON. */
export const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const filled = (v: unknown) => typeof v === 'string' && v !== '';

function mapEntries<T>(value: unknown, fn: (entry: Obj) => T): T[] | T | undefined {
	if (Array.isArray(value)) return value.map((e) => (isObj(e) ? fn(e) : (e as T)));
	return isObj(value) ? fn(value) : undefined;
}

export interface SplitResult {
	/** The value with its secret fields blanked. */
	plain: unknown;
	/** The secret fields that had a value, shaped like the value; undefined when there are none. */
	secrets?: unknown;
	/** Ids of the secret fields that had a value ('webdav.password'). */
	withheld: string[];
}

export function splitSecrets(value: unknown, spec: SecretSpec): SplitResult {
	const entries = Array.isArray(value) ? value : [value];
	const withheld = new Set<string>();
	let any = false;
	for (const e of entries) {
		if (!isObj(e)) continue;
		for (const f of spec.secretFields) {
			if (filled(e[f])) {
				any = true;
				if (spec.track) withheld.add(`${spec.label}.${f}`);
			}
		}
	}
	const plain = mapEntries(value, (e) => {
		const copy = { ...e };
		for (const f of spec.secretFields) if (f in copy) copy[f] = '';
		return copy;
	});
	if (plain === undefined) return { plain: value, withheld: [] };
	const secrets = any
		? mapEntries(value, (e) =>
				Object.fromEntries(spec.secretFields.filter((f) => filled(e[f])).map((f) => [f, e[f]]))
			)
		: undefined;
	return { plain, secrets, withheld: [...withheld] };
}

/** Puts the secret fields back into `plain`. A mismatch in shape (array length) leaves it as it is. */
export function mergeSecrets(plain: unknown, secrets: unknown): unknown {
	if (Array.isArray(plain) && Array.isArray(secrets)) {
		return plain.map((e, i) => (isObj(e) && isObj(secrets[i]) ? { ...e, ...secrets[i] } : e));
	}
	if (isObj(plain) && isObj(secrets)) return { ...plain, ...secrets };
	return plain;
}

/** Whether two values of a setting are for the same server: the identity fields are equal. */
const sameIdentity = (a: Obj, b: Obj, spec: SecretSpec) =>
	spec.identity.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));

/** `sameIdentity` for whole values; lists have to match entry by entry. */
export function sameConnection(a: unknown, b: unknown, spec: SecretSpec): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((e, i) => sameConnection(e, b[i], spec));
	}
	return isObj(a) && isObj(b) && sameIdentity(a, b, spec);
}

/**
 * The restored value, with the secrets this device already has kept where the backup has none:
 * only for the same server, and only fields the restored value leaves empty. In a list, an entry
 * keeps them when exactly one existing entry is for the same server.
 */
export function keepExistingSecrets(
	restored: unknown,
	existing: unknown,
	spec: SecretSpec
): unknown {
	if (Array.isArray(restored) && Array.isArray(existing)) {
		return restored.map((entry) => {
			const same = existing.filter((e) => sameConnection(entry, e, spec));
			return same.length === 1 ? keepExistingSecrets(entry, same[0], spec) : entry;
		});
	}
	if (!isObj(restored) || !isObj(existing) || !sameIdentity(restored, existing, spec)) {
		return restored;
	}
	const out = { ...restored };
	for (const f of spec.secretFields) {
		if (!filled(out[f]) && filled(existing[f])) out[f] = existing[f];
	}
	return out;
}

/** Whether a stored value has a secret worth keeping: a filled secret field, or any content. */
export function holdsSecret(stored: string, setting: CredentialSetting): boolean {
	const value = parseJson(stored);
	const { secretFields } = setting;
	if (secretFields) {
		const entries = Array.isArray(value) ? value : [value];
		return entries.some((e) => isObj(e) && secretFields.some((f) => filled(e[f])));
	}
	if (value === undefined) return stored !== '';
	if (value === null || value === '') return false;
	return typeof value !== 'object' || Object.keys(value).length > 0;
}
/** Whether a restored value still lacks a secret field the backup withheld: 'webdav.password' etc. */
export function stillMissing(id: string, value: unknown): boolean {
	const field = id.slice(id.indexOf('.') + 1);
	return isObj(value) && !filled(value[field]);
}

/**
 * Blanks the secret fields of the settings that have them. Adds to `into` the secrets that were
 * taken out, keyed by `secretId`, and the ids of the fields that had a value.
 */
export function stripSecrets(
	list: StoredSetting[],
	store: SecretSpec['store'],
	into: { secrets: Record<string, unknown>; withheld: string[] } = { secrets: {}, withheld: [] }
): StoredSetting[] {
	return list.map((setting) => {
		const spec = specFor(store, setting.key);
		if (!spec) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		const { plain, secrets, withheld } = splitSecrets(value, spec);
		if (secrets !== undefined) into.secrets[secretId(spec)] = secrets;
		into.withheld.push(...withheld);
		return { ...setting, value: JSON.stringify(plain) };
	});
}

export interface SecretsBlock {
	v: 1;
	params: KeyParams;
	/** base64 of the encrypted JSON: { [secretId]: secrets } */
	data: string;
}

export function isSecretsBlock(value: unknown): value is SecretsBlock {
	return isObj(value) && value.v === 1 && isObj(value.params) && typeof value.data === 'string';
}

export function checkPassphrase(passphrase: string): void {
	if (passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
		throw new Error(`The passphrase needs at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters`);
	}
}

export async function sealSecrets(
	secrets: Record<string, unknown>,
	passphrase: string
): Promise<SecretsBlock> {
	checkPassphrase(passphrase);
	const { params, key } = await createKeyParams(passphrase);
	const data = await encrypt(key, new TextEncoder().encode(JSON.stringify(secrets)));
	return { v: 1, params, data: toBase64(data) };
}

/** Throws `WrongPassphraseError` when the passphrase does not match. */
export async function openSecrets(
	block: SecretsBlock,
	passphrase: string
): Promise<Record<string, unknown>> {
	const key = await openKey(passphrase, block.params);
	const plain = await decrypt(key, fromBase64(block.data));
	const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
	if (!isObj(parsed)) throw new Error('The credentials block is damaged');
	return parsed;
}
