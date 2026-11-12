# Backup and Restore of a Whole Device

Status: Implemented, to be checked by hand

## Goal

Restoring a backup on a clean device brings back everything except the secrets and what is tied to the device. The secrets can be left out (copied from a password manager) or put in the file encrypted with a passphrase.

## File format

`version: 2` (`BACKUP_VERSION`). Files without `version` are version 1 (`settings` + `scx`, both required) and still restore. A newer `version` is refused.

| Section      | Content                                                               | On restore                            |
| ------------ | --------------------------------------------------------------------- | ------------------------------------- |
| `settings`   | shared settings, secret fields blanked                                | replaces the table                    |
| `scx`        | scheduled transactions                                                | replaces them                         |
| `workingSet` | the working set's Yjs state, base64                                   | merged (`importState`)                |
| `device`     | `id` of the source device, portable device settings (secrets blanked) | written key by key, others untouched  |
| `peers`      | `peers` (trusted devices) and `revocations` (tombstones)              | added if absent, evicted ones skipped |
| `secrets`    | `{ v, params, data }`: the blanked fields, AES-GCM, PBKDF2 key        | applied when the passphrase fits      |
| `withheld`   | ids of the secret fields that had a value ('s3.secretAccessKey')      | drives the "required" markers         |

All sections are chosen when the backup is made (default: all), and again when restoring.

### Device settings that travel

`PORTABLE_DEVICE_KEYS` in `backupService.ts`: home cards, `peerName`, the auto-reload and cache switches, notification settings, the WebDAV/S3 auto-backup and enabled switches, the import/export folder _names_, `webdavEncryption`, `s3Settings`, `peerIceServers`.

Not in the file: `peerId` and `previousDeviceId`, the device key (not extractable, by design), `syncGroupSecret` (an invite hands it out again), the delta-sync state and S3 hashes, the last-sync times, `ledgerMetaSnapshot`, the demo IDs.

### Secrets

`SECRET_SPECS` in `backupSecrets.ts` names the secret fields inside each setting: the WebDAV `password`; the S3 `accessKeyId`, `secretAccessKey` and `passphrase`; the WebDAV encryption `passphrase`; the `username` and `credential` of each TURN server. The rest of a setting is plain.

- No passphrase: the fields are blanked and the file has no `secrets`.
- With a passphrase (at least 12 characters, entered twice, or generated): the fields go into the `secrets` block. A wrong or missing passphrase on restore does not fail the restore; the result says `wrong-passphrase` or `skipped`.
- A secret already on the device is kept through a restore when the backup has none, only if the plain identity fields match (same server and user, same bucket): it is never paired with another server.
- After a restore, withheld fields that are still empty are written to `DeviceSettingKeys.restoreMissing`; the WebDAV and S3 pages mark them required until they are filled in (`restoreMissing.ts`).

## Identity after a restore

A restored device is a new device (new key, new ID). Everything else follows from existing machinery:

- **Trusted devices** are restored, so the new device trusts the others. They do not trust its key: one invite to one of them, and the introductions flow asks the rest to approve it. The restore does not copy trust in the other direction, since nothing proves the new key belongs to the old device.
- **Evicted devices stay evicted.** Tombstones in the backup are added, and no peer with a tombstone (its ID or a legacy ID) is restored.
- **Old identity's files.** The source device's ID becomes `previousDeviceId` (the slot used for a device's pre-key UUID). So `loadIgnoreReasons` lets its objects through as own, the device lists and the journal count them as own, and the hello and device record carry it as `previousId`. A keyed trusted record is never replaced on that claim (`matchLegacy` only matches key-less records).
- **Retiring is held.** `previousDeviceHeld` stops `afterSync` from running `DeltaSync.retire(previousId)` (merge, snapshot, delete) until a person answers the notice (`RestoredDeviceNotice.svelte`, on Backup and Trusted Devices): _lost_ releases the hold, _still in use_ clears `previousDeviceId`, so the old device is an ordinary peer.

## Required fields

- Secrets: see above.
- Folders: only the name is kept in `deviceSettings`; the handle lives in IndexedDB. When a name is known and the browser holds no handle, the import, sync and export pages mark the folder as required.

## Security notes

- The file is plain JSON. A file an attacker can edit could add a trusted device to `peers`; the restore dialog says to restore only a file you trust and shows how many devices it adds. Tombstones are not re-verified.
- Secrets are protected only by the passphrase (PBKDF2-SHA256, 250k iterations, AES-256-GCM, as in S3 sync). A short passphrase is refused.

## Tests

`tests/unit/backupService.test.ts`: format and version, sections, v1 compatibility, rejected files, credentials (left out, sealed, right/wrong/no passphrase, kept for the same bucket only, missing list), the device section and the previous device, trusted devices and tombstones, the working set, `inspectBackup`.

## Not done / to check by hand

- A full restore on a second browser profile with S3: pair, approve, confirm the old device's objects are merged and, after _It is lost_, retired.
- Share as a file (`navigator.canShare({ files })`) on a phone.
- The WebDAV page when encryption is on and the passphrase is missing (the field is editable then).
- The TURN credentials are not marked required anywhere.
