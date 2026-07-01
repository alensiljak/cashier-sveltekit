<script lang="ts">
	import { getHelpHtml } from './helpContent';

	type Props = {
		topic: string;
		isOpen: boolean;
	};
	let { topic, isOpen = $bindable(false) }: Props = $props();

	const html = $derived(getHelpHtml(topic) ?? '<p>No help available for this page yet.</p>');
</script>

<input type="checkbox" class="modal-toggle" bind:checked={isOpen} />
<dialog class="modal">
	<div class="modal-box max-h-[80vh] overflow-y-auto">
		<header class="flex items-center justify-between">
			<h2 class="text-lg font-bold">Help</h2>
			<button type="button" class="btn btn-ghost btn-circle btn-sm" onclick={() => (isOpen = false)}>✕</button>
		</header>
		<article class="prose prose-sm max-w-none pt-2">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html html}
		</article>
	</div>
</dialog>
