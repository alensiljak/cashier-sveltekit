<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { CheckIcon, DeleteIcon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	let isDeleteConfirmationOpen = $state(false);
	let indexToDelete = $state(-1);

	let _accounts: string[] = $state([]);

	onMount(async () => {
		_accounts = await settings.get(SettingKeys.favouriteAccounts);
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	async function onDeleteClicked(index: number) {
		indexToDelete = index;
		isDeleteConfirmationOpen = true;
	}

	async function onDeleteConfirmed() {
		closeModal();

		_accounts.splice(indexToDelete, 1);
	}

	async function onFabClicked() {
		// save
		await settings.set(SettingKeys.favouriteAccounts, _accounts);

		Notifier.success('Favourites updated');

		history.back();
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Delete Favourites"></Toolbar>
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<section class="grow overflow-auto p-1">
		{#each _accounts as account, i}
			<div class="border-tertiary-200/15 flex flex-row border-b py-1">
				<data class="grow content-center">
					{account}
				</data>
				<div class="pr-2">
					<button
						type="button"
						class="btn btn-outline btn-secondary btn-icon text-tertiary"
						onclick={() => onDeleteClicked(i)}
					>
						<TrashIcon />
					</button>
				</div>
			</div>
		{/each}
	</section>
</article>

<!-- "Delete" dialog -->
<input type="checkbox" id="delete-fav-confirmation-modal" class="modal-toggle" bind:checked={isDeleteConfirmationOpen} />
<div class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Removal</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">
				Do you want to remove { _accounts[indexToDelete] } from favourites?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-tertiary-500"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	</div>
</div>
