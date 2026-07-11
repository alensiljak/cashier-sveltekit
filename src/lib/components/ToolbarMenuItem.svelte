<script lang="ts">
	import { goto } from '$app/navigation';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: any;
		iconClass?: string;
		disabled?: boolean;
		class?: string;
		onclick?: () => void;
	};
	let { targetNav, text, Icon, iconClass, disabled = false, class: extraClass = '', onclick }: Props = $props();

	async function onMenuClicked(event: Event) {
		event.preventDefault();

		if (targetNav) {
			// navigate to the given destination.
			await goto(targetNav);
		}

		if (onclick) {
			onclick();
		}
	}
</script>

<!--
Example usage:
<ToolbarMenuItem text="Restore Settings" targetNav="/settings" Icon={ArrowBigUpIcon} />
-->

<li>
	<button
		type="button"
		role="menuitem"
		class="flex w-full items-center gap-2 py-2 disabled:pointer-events-none disabled:opacity-40 {extraClass}"
		{disabled}
		onclick={onMenuClicked}
	>
		{#if Icon}
			<Icon size={18} class={iconClass} />
		{/if}
		<span class="grow text-start">{text}</span>
	</button>
</li>
