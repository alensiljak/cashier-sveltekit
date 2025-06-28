function debounce<T extends unknown[], R>(func: (...args: T) => R, delay: number) {
	let timeoutId: ReturnType<typeof setTimeout>;
	return function (...args: T) {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => func(...args), delay);
	};
}

export function debounceAction(
	node: HTMLInputElement,
	{ callback, delay = 300 }: { callback: (value: string) => void; delay?: number }
) {
	const handleInput = debounce((event: Event) => {
		callback((event.target as HTMLInputElement).value);
	}, delay);

	node.addEventListener('input', handleInput);

	return {
		destroy() {
			node.removeEventListener('input', handleInput);
		}
	};
}
