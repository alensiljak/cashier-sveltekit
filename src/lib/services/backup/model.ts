/**
 * The data a restore works with, whatever the format version of the file. The readers
 * (readers/) produce it and apply.ts restores it.
 */
import type { Revocation, ScheduledTransaction, TrustedPeer } from '#lib/data/model';
import type { SecretSpec, SettingStore } from './rules';

/**
 * What can be backed up and restored by itself. `device` is "This device": the portable device
 * settings and the trusted devices.
 */
export type BackupSection = 'settings' | 'workingSet' | 'scx' | 'device' | 'credentials';

export const ALL_SECTIONS: BackupSection[] = [
	'settings',
	'workingSet',
	'scx',
	'device',
	'credentials'
];

/** The sections a backup holds. */
export function sectionsOf(data: BackupData): BackupSection[] {
	const held: Record<BackupSection, unknown> = {
		settings: data.settings,
		workingSet: data.workingSet,
		scx: data.scx,
		device: data.device ?? data.peers,
		credentials: data.openSecrets
	};
	return ALL_SECTIONS.filter((s) => held[s] !== undefined);
}

export interface StoredSetting {
	key: string;
	value: string;
}

export interface DeviceData {
	/** The ID of the device the backup was made on. */
	id: string;
	settings: StoredSetting[];
}

/**
 * The scheduled transactions: the store's Yjs state, with its history. Files of formats 1 and 2
 * hold only a list.
 */
export type ScxData = { state: Uint8Array } | { list: ScheduledTransaction[] };

export interface PeersData {
	peers: TrustedPeer[];
	revocations: Revocation[];
}

/**
 * One entry of the credentials: a whole setting as it was stored, or, in format 2, only the
 * secret fields of one, to be put back into its blanked value.
 */
export type Credential = { store: SettingStore; key: string } & (
	| { value: string }
	/** Shaped like the setting's value: an object, or a list of objects. */
	| { fields: unknown }
);

/** A secret field that had a value and is blank in the file's settings. */
export interface WithheldField {
	/** What the pages know the field by (see restoreMissing.ts), e.g. 's3.accessKeyId'. */
	id: string;
	store: SecretSpec['store'];
	key: string;
}

/** The contents of a backup file. A section the file does not hold is left out. */
export interface BackupData {
	/** The format version of the file. */
	version: number;
	settings?: StoredSetting[];
	scx?: ScxData;
	/** The working set's Yjs state. */
	workingSet?: Uint8Array;
	device?: DeviceData;
	peers?: PeersData;
	withheld: WithheldField[];
	/**
	 * Present when the file has encrypted credentials.
	 * Throws `WrongPassphraseError` when the passphrase does not match.
	 */
	openSecrets?: (passphrase: string) => Promise<Credential[]>;
	/** Which credentials the block holds, when the file says so (labels, see rules.ts). */
	credentials?: string[];
}
