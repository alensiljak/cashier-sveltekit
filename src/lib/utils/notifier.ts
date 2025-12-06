/**
 * Displays a message to the user.
 */
import { getContext } from 'svelte';
import { toaster } from '../toaster-svelte';

const Notifier = {
	init() {
		// toastStore = getToastStore();
		// toast = getContext('toast');
	},
	notify(
		message: string,
		type: 'info' | 'error' | 'success' | undefined,
		title: string | undefined = undefined
	) {
		switch(type) {
			case 'success':
				toaster.success(message);
				break;
			case 'error':
				toaster.error(message);
				break;
			case 'info':
			default:
				toaster.info(message);
				break;
		}
	},

	success(message: string) {
		toaster.success(message);
	},
	error(message: string) {
		toaster.error(message);
	},
	info(message: string) {
		toaster.info(message);
	}
};

export default Notifier;
