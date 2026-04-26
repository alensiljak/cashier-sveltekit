<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccountGroupCard from '$lib/components/AccountGroupCard.svelte';
	import { defaultAccountGroups, SettingKeys, settings, type AccountGroup } from '$lib/settings';
	import { onMount } from 'svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { ArrowUpDownIcon, CirclePlusIcon } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	let groups: AccountGroup[] = $state([]);
	let isAddGroupModalOpen = $state(false);
	let newGroupName = $state('');

	onMount(async () => {
		let stored = await settings.get<AccountGroup[]>(SettingKeys.accountGroups);
		if (!stored || stored.length === 0) {
			stored = defaultAccountGroups;
			await settings.set(SettingKeys.accountGroups, stored);
		}
		groups = stored;
	});

	function closeAddGroupModal() {
		isAddGroupModalOpen = false;
		newGroupName = '';
	}

	async function createGroup() {
		if (!newGroupName.trim()) return;

		const newGroup: AccountGroup = {
			title: newGroupName.trim(),
			accounts: []
		};

		const updatedGroups = [...groups, newGroup];
		await settings.set(SettingKeys.accountGroups, updatedGroups);
		groups = updatedGroups;

		closeAddGroupModal();
	}

	function openAddGroupModal() {
		isAddGroupModalOpen = true;
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Groups">
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Add Group"
				Icon={CirclePlusIcon}
				onclick={openAddGroupModal}
			/>
			<ToolbarMenuItem
				text="Reorder Groups"
				Icon={ArrowUpDownIcon}
				targetNav="/accounts/groups/reorder"
			/>
		{/snippet}
	</Toolbar>
	<section class="flex grow flex-col gap-3 p-2">
		{#each groups as group, i (group.title)}
			<AccountGroupCard {group} index={i} onAccountClick={(name) => goto(`/account-xacts/${encodeURIComponent(name)}`)} />
		{/each}
	</section>
</article>

<!-- Add Group dialog -->
<input
	type="checkbox"
	id="add-group-modal"
	class="modal-toggle"
	bind:checked={isAddGroupModalOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Add Group</h2>
		</header>
		<article>
			<div class="form-control w-full">
				<label class="label" for="group-name-input">
					<span class="label-text">Group Name</span>
				</label>
				<input
					id="group-name-input"
					type="text"
					placeholder="Enter group name"
					class="input input-bordered w-full"
					bind:value={newGroupName}
					onkeydown={e => e.key === 'Enter' && createGroup()}
				/>
			</div>
		</article>
		<footer class="flex justify-end gap-4 mt-4">
			<button type="button" class="btn btn-ghost" onclick={closeAddGroupModal}>Cancel</button>
			<button type="button" class="btn btn-primary" onclick={createGroup}>Create</button>
		</footer>
	</div>
</dialog>