<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { CheckIcon, DeleteIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();
	Notifier.init();

	let _accounts: string[] = $state([]);

	onMount(async () => {
		_accounts = await settings.get(SettingKeys.favouriteAccounts);
	});

	async function onDeleteClicked(index: number) {
		let account = _accounts[index]

		// confirm dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Removal',
			body: `Do you want to remove\n ${account} \nfrom favourites?`,
			response: async (r: boolean) => {
				if (r) {
					_accounts.splice(index, 1)
				}
			}
		};
		modalStore.trigger(modal);
	}

	async function onFabClicked() {
		// save
		await settings.set(SettingKeys.favouriteAccounts, _accounts)

		Notifier.success('Favourites updated')

		history.back()
	}
</script>

<article class="h-screen flex flex-col">
	<Toolbar title="Delete Favourites"></Toolbar>
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<section class="p-1 grow overflow-auto">
		{#each _accounts as account, i}
			<div class="flex flex-row border-b border-tertiary-200/15 py-1">
				<data class="grow content-center"> {account}</data>
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
