<!--
	Says which folder access API the browser offers, so it is clear what a page can do.
-->
<script lang="ts">
	type Props = {
		/** Whether the File System Access API is available. */
		supported: boolean;
		/** What the page does without it. */
		fallbackText: string;
	};

	let { supported, fallbackText }: Props = $props();
</script>

{#if supported}
	<p class="text-xs text-base-content/50 text-right">
		Using the File System Access API: folder access can be remembered between visits.
	</p>
{:else}
	<div class="alert alert-info text-sm">
		<span>
			The File System Access API is not available in this browser (e.g. Firefox, or Brave with
			default settings). {fallbackText}
		</span>
	</div>
{/if}
