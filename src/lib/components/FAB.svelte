<!-- Floating action button -->
<script lang="ts">
	import { Check } from 'lucide-svelte';
	import type { Component } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		onclick?: EventHandler;
        Icon?: Component
        backgroundColor?: string
        textColor?: string
	};
	const clickHandler: EventHandler = (e: Event) => {};
	let { onclick = clickHandler, Icon=Check, backgroundColor='bg-tertiary-500', textColor='text-secondary-500' } = $props();
</script>

<button
	class={`fixed bottom-7 right-7 rounded-full ${backgroundColor} hover:${backgroundColor}/75 p-4 ${textColor} shadow-lg transition duration-200`}
	onclick={onclick}>
    <!-- absolute-->

	<Icon />
</button>
