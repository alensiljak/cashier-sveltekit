<script lang="ts">
	import { goto } from '$app/navigation';
	import type { MouseEventHandler } from 'svelte/elements';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: any;
		onclick?: () => void;
	};
	let { targetNav, text, Icon, onclick }: Props = $props();

	async function onMenuClicked() {
		if(targetNav) {
			// navigate to the given destination.
			await goto(targetNav)
		}

		if(onclick) {
			onclick()
		}
	}
</script>

<!--
Example usage:
<ToolbarMenuItem text="Restore Settings" targetNav="/settings" Icon={ArrowBigUpIcon} />
-->

<li class="hover:bg-primary-600">
	<button type="button" class="btn flex flex-row w-full"
		onclick={onMenuClicked}>
		<span class="grow">{text}</span>
		<span class="badge">
			<Icon />
		</span>
	</button>
</li>
