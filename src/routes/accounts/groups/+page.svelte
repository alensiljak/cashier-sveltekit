<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccountGroupCard from '$lib/components/AccountGroupCard.svelte';
	import { defaultAccountGroups, SettingKeys, settings, type AccountGroup } from '$lib/settings';
	import { onMount } from 'svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { CirclePlusIcon } from '@lucide/svelte';

	let groups: AccountGroup[] = $state([]);

	onMount(async () => {
		let stored = await settings.get<AccountGroup[]>(SettingKeys.accountGroups);
		if (!stored || stored.length === 0) {
			stored = defaultAccountGroups;
			await settings.set(SettingKeys.accountGroups, stored);
		}
		groups = stored;
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Groups">
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Add Group"
				Icon={CirclePlusIcon}
				targetNav="/import-ledger-xact"
			/>
		{/snippet}
	</Toolbar>
	<section class="flex grow flex-col gap-3 overflow-auto p-2">
		{#each groups as group, i (group.title)}
			<AccountGroupCard {group} index={i} />
		{/each}
	</section>
</article>
