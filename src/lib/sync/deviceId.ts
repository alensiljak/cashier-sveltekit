/** An ID that is the hash of a key (see `deviceIdFromPublicKey` in deviceKey.ts); a legacy UUID has hyphens. */
export const isDerivedId = (id: string): boolean => /^[0-9a-hjkmnp-tv-z]{26}$/.test(id);
