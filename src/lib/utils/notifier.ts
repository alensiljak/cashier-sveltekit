/**
 * Displays a message to the user.
 */
import { getToastStore } from '@skeletonlabs/skeleton';
import type { ToastSettings, ToastStore } from '@skeletonlabs/skeleton';

let toastStore: ToastStore;

const Notifier = {
  init() {
    toastStore = getToastStore();
  },
  notify(message: string, background: string | undefined = undefined) {
    const t: ToastSettings = {
      message: message,
      background: background,
    };
    toastStore.trigger(t);

  },

  success(message: string) {
    this.notify(message, 'bg-primary-500')
    // 'bg-positive-500'
  },
  error(message: string) {
    this.notify(message, 'bg-secondary-500')
    // 'bg-negative-500'
  },
  neutral(message: string) {
    this.notify(message)
  }
}

export default Notifier