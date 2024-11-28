<script lang="ts">
	import type { MouseEventHandler } from 'svelte/elements';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: any;
		onclick?: MouseEventHandler<HTMLElement>;
	};
	let { targetNav = '#', text, Icon, onclick }: Props = $props();
</script>

<!--
Example usage:
<ToolbarMenuItem text="Restore Settings" targetNav="/settings" Icon={ArrowBigUpIcon} />
-->

<li class="hover:bg-primary-600">
	<a href={targetNav} {onclick} data-sveltekit-replacestate={targetNav === '#' || null}>
		<span class="flex-auto">{text}</span>
		<span class="badge">
			<Icon />
		</span>
	</a>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<!-- <div class="flex cursor-pointer flex-row p-4 hover:bg-primary-600" {onclick} role="button">
		<div class="grow">{text}</div>
		<div><Icon /></div>
	</div> -->
</li>
