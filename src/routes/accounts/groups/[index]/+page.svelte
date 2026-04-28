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
	import {
		CheckIcon,
		GripVerticalIcon,
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

	let listEl = $state<HTMLElement | null>(null);
	let isDragging = $state(false);
	let dragCurIndex = $state(-1);
	let ghostName = $state('');
	let ghostTop = $state(0);
	let ghostLeft = $state(0);
	let ghostWidth = $state(0);
	let ghostHeight = $state(0);
	let pointerOffsetY = 0;
	let dragBaseIndex = 0;
	let dragStartY = 0;
	let estItemHeight = 44;
	let autoScrollId: ReturnType<typeof setInterval> | null = null;

	function startDrag(e: PointerEvent, idx: number) {
		e.preventDefault();
		const itemEl = (e.currentTarget as HTMLElement).closest('[data-item]') as HTMLElement;
		const rect = itemEl.getBoundingClientRect();
		isDragging = true;
		dragCurIndex = idx;
		dragBaseIndex = idx;
		dragStartY = e.clientY;
		ghostName = accounts[idx];
		ghostLeft = rect.left;
		ghostTop = rect.top;
		ghostWidth = rect.width;
		ghostHeight = rect.height;
		pointerOffsetY = e.clientY - rect.top;
		estItemHeight = rect.height;
		listEl?.setPointerCapture(e.pointerId);
	}

	function onDragPointerMove(e: PointerEvent) {
		if (!isDragging || !listEl) return;
		ghostTop = e.clientY - pointerOffsetY;
		const targetIdx = Math.max(
			0,
			Math.min(
				accounts.length - 1,
				Math.round(dragBaseIndex + (e.clientY - dragStartY) / estItemHeight)
			)
		);
		if (targetIdx !== dragCurIndex) {
			const updated = [...accounts];
			const [moved] = updated.splice(dragCurIndex, 1);
			updated.splice(targetIdx, 0, moved);
			accounts = updated;
			dragCurIndex = targetIdx;
		}
		const listRect = listEl.getBoundingClientRect();
		stopAutoScroll();
		if (e.clientY < listRect.top + 60) {
			autoScrollId = setInterval(() => { listEl!.scrollTop -= 6; }, 16);
		} else if (e.clientY > listRect.bottom - 60) {
			autoScrollId = setInterval(() => { listEl!.scrollTop += 6; }, 16);
		}
	}

	function onDragPointerUp() {
		if (!isDragging) return;
		isDragging = false;
		dragCurIndex = -1;
		stopAutoScroll();
	}

	function stopAutoScroll() {
		if (autoScrollId !== null) { clearInterval(autoScrollId); autoScrollId = null; }
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
			class="btn btn-primary btn-circle btn-sm"
			onclick={onAddClicked}
			aria-label="Add account"
		>
			<PlusIcon size={18} />
		</button>
	</div>

	<!-- Drag ghost -->
	{#if isDragging}
		<div
			class="border-base-300 bg-base-100 pointer-events-none fixed z-50 flex items-center gap-3 border px-3 shadow-xl"
			style="top: {ghostTop}px; left: {ghostLeft}px; width: {ghostWidth}px; height: {ghostHeight}px;"
		>
			<GripVerticalIcon size={18} class="text-base-content/40 shrink-0" />
			<span class="grow text-sm">{ghostName}</span>
		</div>
	{/if}

	<section
		role="list"
		class="grow overflow-y-auto p-1"
		bind:this={listEl}
		onpointermove={onDragPointerMove}
		onpointerup={onDragPointerUp}
		onpointercancel={onDragPointerUp}
	>
		{#if accounts.length === 0}
			<p class="p-2 opacity-60">No accounts in this group. Use the menu to add accounts.</p>
		{:else}
			{#each accounts as account, i (account)}
				<div
					role="listitem"
					data-item
					class="border-base-content/15 flex flex-row items-center border-b py-1"
					class:opacity-20={isDragging && i === dragCurIndex}
				>
					<button
						type="button"
						class="text-base-content/30 touch-none cursor-grab px-1 active:cursor-grabbing"
						aria-label="Drag to reorder"
						onpointerdown={(e) => startDrag(e, i)}
					>
						<GripVerticalIcon size={18} />
					</button>
					<data class="grow content-center px-2">{account}</data>
					<button
						type="button"
						class="btn btn-outline btn-secondary btn-sm mr-1"
						onclick={() => onDeleteClicked(i)}
						aria-label="Remove account"
					>
						<TrashIcon size={16} />
					</button>
				</div>
			{/each}
		{/if}
	</section>
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
