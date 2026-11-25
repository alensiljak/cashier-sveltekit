/**
 * The localhost token script offered to the user for copying
 * (ScalableConfigForm.svelte): a PWA cannot run the OAuth loopback itself, so
 * the user saves this script on their computer, runs it, and pastes the JSON
 * it prints back into the form. Single source of truth — the raw text of
 * `scripts/scalable_token.py`, bundled via Vite's `?raw` import.
 */
import tokenScript from '../../../../scripts/scalable_token.py?raw';

export const SCALABLE_TOKEN_SCRIPT = tokenScript;
export const SCALABLE_TOKEN_SCRIPT_NAME = 'scalable_token.py';
