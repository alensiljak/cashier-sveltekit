/**
 * Displays a message to the user.
 */
import { Toast, getToastStore } from '@skeletonlabs/skeleton';
import type { ToastSettings, ToastStore } from '@skeletonlabs/skeleton';

let toastStore: ToastStore;

var Notifier = {
    init() {
        toastStore = getToastStore();
    },
    notify(message: string, background: string | undefined = undefined) {
		const t: ToastSettings = {
			message: message,
			background: background,
		};
		toastStore.trigger(t);

    }
}

export default Notify