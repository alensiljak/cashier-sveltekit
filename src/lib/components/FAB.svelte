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
	};
	const clickHandler: EventHandler = (e: Event) => {};
	let {
		onclick = clickHandler,
		Icon = Check,
		backgroundColor = 'btn-accent',
		textColor = ''
	} = $props();
</script>

<button
	class={`btn btn-circle btn-xl !text-current ${backgroundColor} ${textColor} border-0 fixed right-7 bottom-7 shadow-lg transition duration-200`}
	{onclick}
>
	<!-- absolute-->

	<Icon class={textColor || 'text-[#92140c]'} />
</button>
