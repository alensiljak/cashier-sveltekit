<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { SelectionType } from '$lib/enums';
	import { SelectionModeMetadata, SettingKeys, settings, type AccountGroup } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import {
		CheckIcon,
		PencilIcon,
		PlusIcon,
		Trash2Icon,
		TrashIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	const groupIndex = parseInt(page.params.index ?? '0', 10);

	let groups: AccountGroup[] = $state([]);
	let accounts: string[] = $state([]);
	let groupTitle = $state('');
	let groupColor = $state('');
	let isDeleteConfirmationOpen = $state(false);
	let indexToDelete = $state(-1);
	let isDeleteGroupConfirmationOpen = $state(false);
	let isRenameModalOpen = $state(false);
	let editedGroupName = $state('');

	onMount(async () => {
		await handleAccountSelection();
		await loadData();
	});

	async function loadData() {
		groups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
		const group = groups[groupIndex];
		if (group) {
			groupTitle = group.title;
			groupColor = group.color ?? '';
			accounts = [...group.accounts];
		}
	}

	async function handleAccountSelection() {
		if (!$selectionMetadata?.selectedId) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		const name = $selectionMetadata.selectedId as string;
		selectionMetadata.set(undefined);

		const currentGroups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
		const currentGroup = currentGroups[groupIndex];
		if (!currentGroup) return;

		if (currentGroup.accounts.includes(name)) {
			Notifier.info('Account already in this group');
			return;
		}
		currentGroup.accounts.push(name);
		await settings.set(SettingKeys.accountGroups, currentGroups);
		Notifier.success('Account added');
	}

	function onDeleteClicked(i: number) {
		indexToDelete = i;
		isDeleteConfirmationOpen = true;
	}

	function onDeleteGroupClicked() {
		isDeleteGroupConfirmationOpen = true;
	}

	async function onDeleteGroupConfirmed() {
		isDeleteGroupConfirmationOpen = false;
		const currentGroups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
		currentGroups.splice(groupIndex, 1);
		settings.set(SettingKeys.accountGroups, currentGroups);
		Notifier.success('Group deleted');
		history.back();
	}

	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	function onDeleteConfirmed() {
		closeModal();
		accounts.splice(indexToDelete, 1);
		accounts = [...accounts];
	}

	async function onAddClicked() {
		$selectionMetadata = new SelectionModeMetadata();
		$selectionMetadata.selectionType = SelectionType.ACCOUNT;
		await goto('/accounts');
	}

	function openRenameModal() {
		editedGroupName = groupTitle;
		isRenameModalOpen = true;
	}

	function closeRenameModal() {
		isRenameModalOpen = false;
		editedGroupName = '';
	}

	async function onRenameConfirmed() {
		const trimmed = editedGroupName.trim();
		if (!trimmed) {
			closeRenameModal();
			return;
		}
		const currentGroups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
		if (currentGroups[groupIndex]) {
			currentGroups[groupIndex].title = trimmed;
			await settings.set(SettingKeys.accountGroups, currentGroups);
			groupTitle = trimmed;
			Notifier.success('Group renamed');
		}
		closeRenameModal();
	}

	async function onSave() {
		const currentGroups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
		if (currentGroups[groupIndex]) {
			currentGroups[groupIndex].accounts = accounts;
			currentGroups[groupIndex].color = groupColor || undefined;
			await settings.set(SettingKeys.accountGroups, currentGroups);
			Notifier.success('Group saved');
			history.back();
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title={groupTitle}>
		{#snippet menuItems()}
			<ToolbarMenuItem text="Rename" Icon={PencilIcon} onclick={openRenameModal} />
			<ToolbarMenuItem text="Add Account" Icon={PlusIcon} onclick={onAddClicked} />
			<ToolbarMenuItem text="Delete Group" Icon={Trash2Icon} onclick={onDeleteGroupClicked} />
		{/snippet}
	</Toolbar>

	<Fab Icon={CheckIcon} onclick={onSave} />

	<section class="border-base-content/15 border-b p-3">
		<p class="mb-2 text-sm font-medium opacity-70">Card Colour</p>
		<ColorPicker bind:value={groupColor} />
	</section>

	<hr class="border-base-content/15" />

	<div class="flex items-center justify-between px-3 py-2">
		<h3 class="text-base font-semibold opacity-80">Accounts</h3>
		<button
			type="button"
			class="btn btn-primary btn-sm"
			onclick={onAddClicked}
			aria-label="Add account"
		>
			<PlusIcon size={18} />
		</button>
	</div>

	<DragReorderList bind:items={accounts} getLabel={(a) => a} class="grow overflow-y-auto p-1">
		{#snippet empty()}
			<p class="p-2 opacity-60">No accounts in this group. Use the menu to add accounts.</p>
		{/snippet}
		{#snippet row(account, i)}
			<span class="grow">{account}</span>
			<button
				type="button"
				class="btn btn-outline btn-secondary btn-sm mr-1"
				onclick={() => onDeleteClicked(i)}
				aria-label="Remove account"
			>
				<TrashIcon size={16} />
			</button>
		{/snippet}
	</DragReorderList>
</article>

<!-- Rename group dialog -->
<input
	type="checkbox"
	id="rename-group-modal"
	class="modal-toggle"
	bind:checked={isRenameModalOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Rename Group</h2>
		</header>
		<article>
			<div class="form-control w-full">
				<label class="label" for="rename-group-input">
					<span class="label-text">Group Name</span>
				</label>
				<input
					id="rename-group-input"
					type="text"
					placeholder="Enter group name"
					class="input input-bordered w-full"
					bind:value={editedGroupName}
					onkeydown={(e) => e.key === 'Enter' && onRenameConfirmed()}
				/>
			</div>
		</article>
		<footer class="flex justify-end gap-4 mt-4">
			<button type="button" class="btn btn-ghost" onclick={closeRenameModal}>Cancel</button>
			<button type="button" class="btn btn-primary" onclick={onRenameConfirmed}>Save</button>
		</footer>
	</div>
</dialog>

<!-- Delete group confirmation dialog -->
<input
	 type="checkbox"
	id="delete-group-confirm-modal"
	class="modal-toggle"
	bind:checked={isDeleteGroupConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Delete Group</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Delete group "{groupTitle}"?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={() => (isDeleteGroupConfirmationOpen = false)}>Cancel</button>
			<button type="button" class="btn btn-error text-error-content" onclick={onDeleteGroupConfirmed}>Delete</button>
		</footer>
	</div>
</dialog>

<!-- Delete account confirmation dialog -->
<input
	type="checkbox"
	id="delete-account-confirm-modal"
	class="modal-toggle"
	bind:checked={isDeleteConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Remove Account</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">
				Remove {accounts[indexToDelete]} from this group?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
