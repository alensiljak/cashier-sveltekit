/**
 * The sync group: the devices that have been paired with each other share one random secret. The
 * Peer Sync room is derived from it, so a stranger who guesses nothing never sees a hello; the
 * secret also keys the encryption of the signaling messages that pass the relay (trystero's
 * `password`). Trust itself is still decided by the device keys: the room is privacy, not
 * authentication. See doc/projects/2026-11-11_device-identity.md, step 3.
 */
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { fromBase64, hmacSha256, randomBytes, toBase64, toHex } from '#lib/sync/encoding';

const SECRET_BYTES = 32;

export function generateGroupSecret(): string {
	return toBase64(randomBytes(SECRET_BYTES));
}

/** Whether `value` is a secret as `generateGroupSecret` makes it (32 bytes, base64). */
export function isValidGroupSecret(value: unknown): value is string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
	try {
		return fromBase64(value).length === SECRET_BYTES;
	} catch {
		return false;
	}
}

/** The name of the room the group meets in. */
export async function deriveSyncRoom(secret: string): Promise<string> {
	return 'sync-' + toHex(await hmacSha256(fromBase64(secret), 'room-v1'));
}

/** The signaling password of the group's room. */
export async function deriveSyncPassword(secret: string): Promise<string> {
	return toBase64(await hmacSha256(fromBase64(secret), 'password-v1'));
}

export async function getGroupSecret(): Promise<string | null> {
	const secret = await deviceSettings.get<string>(DeviceSettingKeys.syncGroupSecret);
	return isValidGroupSecret(secret) ? secret : null;
}

/** Replaces this device's secret, e.g. when it joins another device's group. */
export async function setGroupSecret(secret: string): Promise<void> {
	if (!isValidGroupSecret(secret)) throw new Error('Not a valid sync group secret');
	await deviceSettings.set(DeviceSettingKeys.syncGroupSecret, secret);
}

let creating: Promise<string> | null = null;

/** The group's secret, created on first use (a group of one device). */
export function ensureGroupSecret(): Promise<string> {
	creating ??= (async () => {
		const existing = await getGroupSecret();
		if (existing) return existing;
		const secret = generateGroupSecret();
		await setGroupSecret(secret);
		return secret;
	})().finally(() => {
		creating = null;
	});
	return creating;
}
