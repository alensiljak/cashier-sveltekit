// Daisy UI toast implementation
type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
type ToastOptions = {
	message: string;
	type?: ToastType;
	duration?: number;
};

class DaisyUIToaster {
	private toastContainer: HTMLElement | null = null;

	constructor() {
		// Create a container for all toasts if it doesn't exist
		this.toastContainer = document.getElementById('toast-container');
		if (!this.toastContainer) {
			this.toastContainer = document.createElement('div');
			this.toastContainer.id = 'toast-container';
			this.toastContainer.className =
				'fixed top-8 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none w-[90%] max-w-md flex flex-col items-center gap-2';
			document.body.appendChild(this.toastContainer);
		}
	}

	show(options: ToastOptions) {
		if (!this.toastContainer) {
			console.error('Toast container not initialized');
			return;
		}

		// Create a toast element and add it to the container
		const toast = document.createElement('div');
		toast.className = 'alert w-full'; // Full width within container

		switch (options.type) {
			case 'success':
				toast.classList.add('alert-success');
				break;
			case 'error':
				toast.classList.add('alert-error');
				break;
			case 'warning':
				toast.classList.add('alert-warning');
				break;
			case 'info':
			default:
				toast.classList.add('alert-info');
				break;
		}

		toast.innerHTML = `<span>${options.message}</span>`;
		this.toastContainer.appendChild(toast);

		// Remove the toast after the specified duration
		setTimeout(() => {
			toast.remove();
		}, options.duration || 3000);
	}

	success(message: string) {
		this.show({ message, type: 'success' });
	}

	error(message: string) {
		this.show({ message, type: 'error' });
	}

	warning(message: string) {
		this.show({ message, type: 'warning' });
	}

	info(message: string) {
		this.show({ message, type: 'info' });
	}
}

export const toaster = new DaisyUIToaster();
