import type { Importer } from '../types';
import { enableBankingDefaultConfig, type EnableBankingConfig } from './config';

/**
 * Enable Banking (open banking aggregator, api.enablebanking.com). Not a file
 * importer: it reads bank accounts live through the Enable Banking API. Each
 * request carries an RS256 JWT signed with the app's private key (stored
 * device-only, see auth.ts); the user consents per bank through a redirect
 * flow whose callback is /importers/enable-banking/callback. The Importers
 * page shows the importer's operations view (viewRoute) instead of a file
 * picker.
 */
export const enableBankingImporter: Importer<EnableBankingConfig> = {
	id: 'enablebanking',
	name: 'Enable Banking',
	source: 'api',
	viewRoute: '/importers/enable-banking',
	defaultConfig: enableBankingDefaultConfig,

	// API-based: no file is ever identified or parsed; accounts come from the sessions.
	account: () => '',
	identify: () => false,
	extract: () => []
};
