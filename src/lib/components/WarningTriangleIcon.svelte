<!--
	A filled variant of lucide's TriangleAlertIcon: solid warning-colored triangle with a
	dark exclamation mark, instead of lucide's hollow/outlined stroke icon — reads as a
	proper warning sign rather than blending into surrounding text.
-->
<script lang="ts">
	interface Props {
		class?: string;
		/** Fill color of the triangle. */
		triangleClass?: string;
		/** Color of the exclamation mark, drawn on top of the triangle fill. */
		markClass?: string;
	}
	let { class: className = 'size-4', triangleClass = 'text-warning', markClass = 'text-warning-content' }: Props =
		$props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class={className} aria-hidden="true">
	<path
		d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
		class={triangleClass}
		fill="currentColor"
	/>
	<path
		d="M12 9v4"
		class={markClass}
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		fill="none"
	/>
	<path
		d="M12 17h.01"
		class={markClass}
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		fill="none"
	/>
</svg>
