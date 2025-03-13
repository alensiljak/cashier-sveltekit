<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { DEFAULT_FORECAST_DAYS } from '$lib/constants';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { SelectionType } from '$lib/enums';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { CheckIcon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let days = $state(DEFAULT_FORECAST_DAYS);
	let accountNames: string[] = $state([]);

	onMount(async () => {
		await loadData();
		await handleAccountSelection();
	});

	async function loadData() {
        let accounts = await settings.get(SettingKeys.forecastAccounts)
        if(!accounts) return;

        accountNames = accounts

        // days
        days = await settings.get(SettingKeys.forecastDays)
    }

	async function handleAccountSelection() {
		if (!$selectionMetadata) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		let acctName = $selectionMetadata.selectedId as string;
		if (!acctName || acctName.length === 0) return;

		// reset selection mode
		selectionMetadata.set(undefined);

		accountNames.push(acctName);

		await saveSettings();
	}

	async function onAddAccountClicked() {
		var meta = new SelectionModeMetadata();
		meta.selectionType = SelectionType.ACCOUNT;
		selectionMetadata.set(meta);

		await goto('/accounts');
	}

    function onDeleteClicked(index: number) {
        accountNames.splice(index, 1)
    }

	async function onFabClicked() {
		await saveSettings();

		history.back();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.forecastAccounts, accountNames);
		await settings.set(SettingKeys.forecastDays, days);
	}
</script>

<Toolbar title="Financial Forecast Settings">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Add Account" onclick={onAddAccountClicked} />
	{/snippet}
</Toolbar>

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-1">
	<h4 class="h4">Forecast for days:</h4>
    <input type="number" class="input text-right" bind:value={days} />

	<h4 class="h4">Accounts</h4>


    {#if accountNames.length === 0}
    <p>No accounts selected for forecasting. Please use the menu to add.</p>
    {:else}
    {#each accountNames as accountName, index}
        <div class="w-full flex p-2">
            <div class="grow">
                {accountName}
            </div>
            <button class="btn-icon preset-filled-error-500" onclick={() => onDeleteClicked(index)}>
                <TrashIcon />
            </button>
        </div>
    {/each}
    {/if}
</main>
