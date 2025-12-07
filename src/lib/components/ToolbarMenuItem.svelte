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

<div class="hover:bg-accent">
	<button type="button" class="btn btn-primary flex w-full flex-row border-0" onclick={onMenuClicked}>
		<span class="grow text-start">{text}</span>
		<span class="badge bg-primary/80 border-0">
			<Icon />
		</span>
	</button>
</div>
