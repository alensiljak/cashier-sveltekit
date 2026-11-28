/**
 * The secrets inside the settings, and the encrypted block that carries them in a backup file.
 *
 * A secret is a field of a stored setting (the WebDAV password, the S3 secret key), not a whole
 * setting: the rest of the setting (URL, bucket, user) is plain and goes into the backup as it is.
 * Which fields these are is said by the backup rules (rules.ts). `splitSecrets` takes them out,
 * `mergeSecrets` puts them back.
 *
 * The block is optional. It is encrypted with a key derived from a passphrase the person enters
 * (the same PBKDF2 + AES-GCM as the S3 sync, see s3Crypto.ts), so the file alone does not give
 * the credentials away.
 */
import type { StoredSetting } from './model';
import { SECRET_SPECS, type SecretSpec } from './rules';
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
export const secretId = (spec: SecretSpec) => `${spec.store}:${spec.key}`;

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

/**
 * The restored value, with the secrets this device already has kept where the backup has none:
 * only for the same server (the spec's identity fields are equal), and only fields the restored
 * value leaves empty.
 */
export function keepExistingSecrets(
	restored: unknown,
	existing: unknown,
	spec: SecretSpec
): unknown {
	if (!isObj(restored) || !isObj(existing)) return restored;
	if (!spec.identity.every((f) => JSON.stringify(restored[f]) === JSON.stringify(existing[f]))) {
		return restored;
	}
	const out = { ...restored };
	for (const f of spec.secretFields) {
		if (!filled(out[f]) && filled(existing[f])) out[f] = existing[f];
	}
	return out;
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
