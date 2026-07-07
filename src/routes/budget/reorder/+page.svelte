<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { type BudgetCategory, SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let categories = $state<BudgetCategory[]>([]);
	let currency = $state('');

	onMount(async () => {
		categories = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
		currency = (await settings.get<string>(SettingKeys.currency)) ?? '';
	});

	async function onFabClicked() {
		await settings.set(SettingKeys.budgetDefinition, categories);
		history.back();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Reorder Budget" />
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<DragReorderList
		bind:items={categories}
		getLabel={(c) => c.account}
		class="grow overflow-y-auto pb-24 p-1"
	>
		{#snippet row(category: BudgetCategory)}
			<span class="grow truncate">{category.account}</span>
			<span class="shrink-0 text-sm text-base-content/60 tabular-nums">
				{formatAmount(category.amount)}
				{currency}
			</span>
		{/snippet}
	</DragReorderList>
</main>
