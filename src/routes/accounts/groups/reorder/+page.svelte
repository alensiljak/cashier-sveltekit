<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings, type AccountGroup } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let groups: AccountGroup[] = $state([]);

	onMount(async () => {
		groups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
	});
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Reorder Groups" />

	<Fab Icon={CheckIcon} onclick={() => history.back()} />

	<DragReorderList
		bind:items={groups}
		getLabel={(g) => g.title}
		ondragend={(updated) => settings.set(SettingKeys.accountGroups, updated)}
		class="grow overflow-y-auto"
	>
		{#snippet row(group)}
			<span class="grow font-medium">{group.title}</span>
			{#if group.color}
				<div class="h-4 w-4 shrink-0 rounded-full" style="background-color: {group.color}"></div>
			{/if}
		{/snippet}
	</DragReorderList>
</main>
