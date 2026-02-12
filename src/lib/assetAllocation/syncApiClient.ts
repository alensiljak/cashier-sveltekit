import ky from 'ky';
import { settings, SettingKeys } from '../settings';
import { ApiError, TimeoutError } from '$lib/utils/errors';

const DEFAULT_TIMEOUT = 15000; // 15 seconds
const MAX_RETRIES = 2;

/**
 * Used to communicate with Ledger server.
 */
export class SyncApiClient {
	serverUrl: string;
	timeout: number;

	constructor(timeout: number = DEFAULT_TIMEOUT) {
		this.serverUrl = '';
		this.timeout = timeout;
	}

	async init() {
		// Server base url
		this.serverUrl = await settings.get(SettingKeys.syncServerUrl);
	}

	/**
	 * Perform a ledger-cli query with timeout and retry logic
	 * @param {String} query Ledger command. i.e. "balance assets -b 2022-08-01"
	 * @param {number} customTimeout Optional custom timeout in milliseconds
	 */
	async query(query: string, customTimeout?: number): Promise<Array<any>> {
		const url = new URL(`${this.serverUrl}?query=${encodeURIComponent(query)}`);
		const timeout = customTimeout || this.timeout;

		try {
			const response = await ky(url, {
				timeout: timeout,
				retry: { limit: MAX_RETRIES }
			});

			if (!response.ok) {
				throw new ApiError(
					`Server returned ${response.status}: ${response.statusText}`,
					response.status,
					'Please check your sync server configuration and try again'
				);
			}

			const result: Array<any> = await response.json();
			return result;
		} catch (error) {
			// Check for timeout errors (ky throws HTTPError or generic Errors with timeout message)
			if (
				error instanceof Error &&
				(error.name === 'TimeoutError' || error.message.includes('timeout'))
			) {
				throw new TimeoutError(
					`Query "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`,
					timeout,
					'The sync server is taking too long to respond. Try again or check your connection.'
				);
			}

			if (error instanceof ApiError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new ApiError(
					`Failed to query sync server: ${error.message}`,
					undefined,
					'Please check that the sync server is running and accessible'
				);
			}

			throw error;
		}
	}
}
