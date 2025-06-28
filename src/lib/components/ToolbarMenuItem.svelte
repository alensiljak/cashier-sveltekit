<script lang="ts">
	import { goto } from '$app/navigation';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: any;
		onclick?: () => void;
	};
	let { targetNav, text, Icon, onclick }: Props = $props();

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

<div class="hover:bg-primary-600">
	<button type="button" class="btn flex w-full flex-row" onclick={onMenuClicked}>
		<span class="grow text-start">{text}</span>
		<span class="badge">
			<Icon />
		</span>
	</button>
</div>
