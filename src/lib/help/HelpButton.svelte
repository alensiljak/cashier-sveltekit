<script lang="ts">
	import { CircleQuestionMarkIcon } from '@lucide/svelte';
	import { helpTopics } from './helpContent';
	import HelpDialog from './HelpDialog.svelte';

	type Props = {
		topic: string;
	};
	let { topic }: Props = $props();

	let isOpen = $state(false);
</script>

{#if topic in helpTopics}
	<button
		type="button"
		class="btn btn-ghost btn-circle hover-transparent"
		title="Help"
		onclick={() => (isOpen = true)}
	>
		<CircleQuestionMarkIcon size={20} />
	</button>

	<HelpDialog {topic} bind:isOpen />
{/if}
