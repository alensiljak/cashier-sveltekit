<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		/** Simple header: a plain-text title and an icon component. Snippets below take precedence. */
		heading?: string;
		Icon?: Component<{ size?: number }>;
		icon?: Snippet;
		title?: Snippet;
		menu?: Snippet;
		header?: Snippet;
		/** Muted explanatory line shown at the top of the body. */
		description?: Snippet;
		content?: Snippet;
		/** Body content; used when no `content` snippet is given. */
		children?: Snippet;
		footer?: Snippet;
		onclick?: EventHandler;
		headerStyle?: string;
		/** Classes for the body section; replaces the default horizontal padding (px-1). */
		bodyClass?: string;
	};
	let {
		heading,
		Icon,
		icon,
		title,
		menu,
		header,
		description,
		content,
		children,
		footer,
		onclick,
		headerStyle,
		bodyClass
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<article class="card bg-base-100 rounded-lg" {onclick} role="list">
	<div class="card-body p-0">
		<div class="flex rounded-t-lg px-3 py-2 text-lg" class:bg-primary={!headerStyle} style={headerStyle}>
			{#if header}{@render header()}{/if}
			{#if icon}{@render icon()}{:else if Icon}<Icon />{/if}
			<span class="grow pl-3">
				{#if title}{@render title()}{:else if heading}{heading}{/if}
			</span>
			{#if menu}
				{@render menu()}
			{/if}
		</div>
		<section class={['py-2', bodyClass ?? 'px-1']} class:pb-0={!!footer}>
			{#if description}
				<p class="text-xs opacity-60">{@render description()}</p>
			{/if}
			{#if content}{@render content()}{:else if children}{@render children()}{/if}
		</section>
		{#if footer}
			<footer class="card-actions justify-center p-0">
				{@render footer()}
			</footer>
		{/if}
	</div>
</article>
