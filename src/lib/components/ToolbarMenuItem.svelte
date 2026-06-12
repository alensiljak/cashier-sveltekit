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

<div>
	<button
		type="button"
		class="btn btn-primary flex w-full flex-row border-0 {extraClass}"
		{disabled}
		onclick={onMenuClicked}
	>
		<span class="grow text-start">{text}</span>
		{#if Icon}
			<span class="badge bg-primary/80 border-0">
				<Icon class={iconClass} />
			</span>
		{/if}
	</button>
</div>
