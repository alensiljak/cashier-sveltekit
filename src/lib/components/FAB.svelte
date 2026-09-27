<!-- Floating action button -->
<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		onclick?: EventHandler;
		Icon?: Component;
		backgroundColor?: string;
		textColor?: string;
		disabled?: boolean;
		/** Tailwind bottom offset, so several FABs can be stacked. */
		bottom?: string;
		ariaLabel?: string;
		ariaExpanded?: boolean;
		buttonEl?: HTMLButtonElement;
	};
	const clickHandler: EventHandler = (e: Event) => {};
	let {
		onclick = clickHandler,
		Icon = Check,
		backgroundColor = 'btn-accent',
		textColor = '',
		disabled = false,
		bottom = 'bottom-7',
		ariaLabel = undefined,
		ariaExpanded = undefined,
		buttonEl = $bindable(undefined)
	}: Props = $props();
</script>

<button
	bind:this={buttonEl}
	class={`btn btn-circle btn-xl text-current! ${backgroundColor} ${textColor} border-0 fixed right-7 ${bottom} z-50 shadow-lg hover:shadow-xl focus-visible:shadow-xl active:shadow-md transition-shadow duration-200`}
	{onclick}
	{disabled}
	aria-label={ariaLabel}
	aria-expanded={ariaExpanded}
>
	<!-- absolute-->

	<Icon class={textColor || 'text-secondary'} />
</button>
