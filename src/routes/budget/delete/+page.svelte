<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { type BudgetCategory, SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';
	import Notifier from '$lib/utils/notifier';
	import { CheckIcon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	let isDeleteConfirmationOpen = $state(false);
	let indexToDelete = $state(-1);

	let categories: BudgetCategory[] = $state([]);
	let currency = $state('');

	onMount(async () => {
		categories = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
		currency = (await settings.get<string>(SettingKeys.currency)) ?? '';
	});

	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	function onDeleteClicked(index: number) {
		indexToDelete = index;
		isDeleteConfirmationOpen = true;
	}

	function onDeleteConfirmed() {
		closeModal();

		categories.splice(indexToDelete, 1);
	}

	async function onFabClicked() {
		await settings.set(SettingKeys.budgetDefinition, categories);

		Notifier.success('Budget categories updated');

		history.back();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Delete Categories"></Toolbar>
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<section class="grow p-1">
		{#each categories as category, i (category.account)}
			<div class="border-base-content/15 flex flex-row items-center border-b py-1">
				<data class="grow content-center">
					{category.account}
				</data>
				<span class="pr-2 text-sm text-base-content/60 tabular-nums">
					{formatAmount(category.amount)}
					{currency}
				</span>
				<div class="pr-2">
					<button
						type="button"
						class="btn btn-outline btn-secondary btn-icon text-secondary-content"
						onclick={() => onDeleteClicked(i)}
					>
						<TrashIcon />
					</button>
				</div>
			</div>
		{/each}
	</section>
</main>

<!-- "Delete" dialog -->
<input type="checkbox" id="delete-budget-confirmation-modal" class="modal-toggle" bind:checked={isDeleteConfirmationOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Removal</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">
				Do you want to remove {categories[indexToDelete]?.account} from the budget?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button type="button" class="btn btn-primary text-primary-content" onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
