// Daisy UI toast implementation
type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
type ToastOptions = {
	message: string;
	type?: ToastType;
	duration?: number;
};

class DaisyUIToaster {
	show(options: ToastOptions) {
		// Create a toast element and add it to the DOM
		const toast = document.createElement('div');
		toast.className = `toast toast-top toast-end`;

		let alertClass = 'alert';
		switch(options.type) {
			case 'success':
				alertClass += ' alert-success';
				break;
			case 'error':
				alertClass += ' alert-error';
				break;
			case 'warning':
				alertClass += ' alert-warning';
				break;
			case 'info':
			default:
				alertClass += ' alert-info';
				break;
		}

		toast.innerHTML = `<div class="${alertClass}"><span>${options.message}</span></div>`;
		document.body.appendChild(toast);

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
