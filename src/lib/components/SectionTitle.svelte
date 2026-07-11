<script lang="ts">
	import type { Snippet } from 'svelte';

	// Elegant, financial-style section/panel title: serif, small, tracked caps.
	// Uses Tailwind's built-in system-font serif stack — no web-font download.
	type Props = {
		class?: string;
		children: Snippet;
	};
	let { class: extraClass = '', children }: Props = $props();
</script>

<!--
Example usage:
<SectionTitle>Postings</SectionTitle>
<div class="divider"><SectionTitle>General</SectionTitle></div>
-->

<span class="font-serif font-semibold tracking-widest uppercase {extraClass}">
	{@render children()}
</span>
