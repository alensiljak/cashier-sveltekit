import type { Importer } from '../types';
import { scalableDefaultConfig, type ScalableConfig } from './config';

/**
 * Scalable Capital (MCP). Not a file importer: it reads the account live from
 * Scalable's MCP endpoint (https://mcp.scalable.capital/mcp) with the user's
 * access token, stored device-only (see token.ts). The Importers page shows
 * the importer's data view (viewRoute) instead of a file picker.
 */
export const scalableImporter: Importer<ScalableConfig> = {
	id: 'scalable',
	name: 'Scalable Capital (MCP)',
	source: 'api',
	viewRoute: '/importers/scalable',
	defaultConfig: scalableDefaultConfig,

	// API-based: no file is ever identified or parsed.
	account: () => '',
	identify: () => false,
	extract: () => []
};
