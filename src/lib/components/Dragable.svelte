<script lang="ts">
	/**
	 * @type {{
	 *   classs?: string
	 *   delay?: number
	 *   ondragstart?: (event: DragEvent) => void
	 *   setDragElement: (clientX: number, clientY: number, drag_element: HTMLElement) => void
	 * }}
	 */
	const { classs = '', delay, ondragstart, setDragElement } = $props();

	/** @type {HTMLDivElement} */
	let container: HTMLDivElement;
	/** @type {HTMLDivElement} */
	let drag_view: HTMLDivElement;
	/** @type {ReturnType<typeof setTimeout> | 0} */
	let timeout: ReturnType<typeof setTimeout> | 0;

	/** @param {{ clientX: number, clientY: number }} event */
	const handle_mousedown = ({ clientX, clientY }: { clientX: number; clientY: number }) => {
		if (delay) timeout = setTimeout(start_drag, delay, clientX, clientY);
		else start_drag(clientX, clientY);
	};
	const handle_mouseup = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = 0;
		}
	};
	/** @param {TouchEvent} event */
	const handle_touchstart = (event: TouchEvent) => {
		handle_mousedown(event.touches[0]);
	};
	const handle_touchend = () => {
		handle_mouseup();
	};
	/**
	 * @param {number} client_x
	 * @param {number} client_y
	 */
	const start_drag = (client_x: number, client_y: number) => {
		const drag_element: HTMLDivElement =
			/** @type {HTMLDivElement} */
			((drag_view.children[0] || container).cloneNode(true) as HTMLDivElement); /**/
		drag_element.style.position = 'absolute';
		drag_element.style.top = container.offsetTop + 'px';
		drag_element.style.left = container.offsetLeft + 'px';
		setDragElement(client_x, client_y, drag_element);
		ondragstart?.(new DragEvent('dragstart'));
	};
</script>

<svelte:window onmouseup={handle_mouseup} ontouchend={handle_touchend} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={container}
	class={classs}
	style="touch-action:none;user-select:none;width:fit-content;"
	onmousedown={handle_mousedown}
	ontouchstart={handle_touchstart}
>
	<slot />
</div>
<div bind:this={drag_view} style="display:none;">
	<slot name="drag" />
</div>
