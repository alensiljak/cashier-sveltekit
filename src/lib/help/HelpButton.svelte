<script lang="ts">
	import { CircleQuestionMarkIcon } from '@lucide/svelte';
	import { helpTopics } from './helpContent';
	import HelpDialog from './HelpDialog.svelte';

	type Props = {
		topic: string;
		/** 'icon' (default) for a toolbar circle button, 'menu-item' for a dropdown menu row. */
		variant?: 'icon' | 'menu-item';
	};
	let { topic, variant = 'icon' }: Props = $props();

	let isOpen = $state(false);
</script>

{#if topic in helpTopics}
	{#if variant === 'menu-item'}
		<li>
			<button type="button" role="menuitem" class="flex w-full items-center gap-2 py-2" onclick={() => (isOpen = true)}>
				<CircleQuestionMarkIcon size={18} />
				<span class="grow text-start">Help</span>
			</button>
		</li>
	{:else}
		<button
			type="button"
			class="btn btn-ghost btn-circle hover-transparent"
			title="Help"
			onclick={() => (isOpen = true)}
		>
			<CircleQuestionMarkIcon size={20} />
		</button>
	{/if}

	<HelpDialog {topic} bind:isOpen />
{/if}
