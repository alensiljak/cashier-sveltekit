<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { CheckIcon, DeleteIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { Modal } from '@skeletonlabs/skeleton-svelte';

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
			<div class="flex flex-row border-b border-tertiary-200/15 py-1">
				<data class="grow content-center">
					{account}
				</data>
				<div class="pr-2">
					<button
						type="button"
						class="variant-outline btn-icon bg-secondary-500 text-tertiary-500"
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
<Modal
	open={isDeleteConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Removal</h2>
		</header>
		<article>
			<p class="opacity-60">
				Do you want to remove\n ${_accounts[indexToDelete]} \nfrom favourites?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary variant-filled-primary btn text-tertiary-500"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
