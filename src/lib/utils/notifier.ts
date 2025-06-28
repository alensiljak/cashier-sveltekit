/**
 * Displays a message to the user.
 */
import { getContext } from 'svelte';
// import { type ToastContext } from '@skeletonlabs/skeleton-svelte';
// import { getToastStore } from '@skeletonlabs/skeleton';
// import type { ToastSettings, ToastStore } from '@skeletonlabs/skeleton';
import { toaster } from '../toaster-svelte';

// export const toast: ToastContext = getContext('toast');
// let toast: ToastContext;

// let toastStore: ToastStore;

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
		// const t: ToastSettings = {
		//   message: message,
		//   background: background,
		// };
		// toastStore.trigger(t);

		toaster.create({
			title: title,
			description: message,
			type: type
		});
	},

	success(message: string) {
		this.notify(message, 'success');
		// 'bg-positive-500'
	},
	error(message: string) {
		this.notify(message, 'error');
		// 'bg-negative-500'
	},
	info(message: string) {
		this.notify(message, 'info');
	}
	// warn(message: string) {
	//   this.notify(message, 'bg-tertiary-500 text-secondary-500')
	// }
};

export default Notifier;
