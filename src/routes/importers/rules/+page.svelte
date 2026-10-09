<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { PlusIcon, Trash2Icon } from '@lucide/svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import DragReorderList from '#lib/components/DragReorderList.svelte';
	import Notifier from '#lib/utils/notifier';
	import { getImporter } from '#lib/importers';
	import { loadImporterConfig, saveImporterConfig } from '#lib/importers/config';
	import { allRules, withRules, type Rule, type RuleConfig } from '#lib/importers/rules';

	const importer = getImporter(page.url.searchParams.get('importer') ?? '');

	let config: RuleConfig | null = null;
	let rules = $state<Rule[]>([]);

	onMount(async () => {
		config = importer ? await loadImporterConfig<RuleConfig>(importer.id) : null;
		if (!importer || !config) {
			await goto('/importers', { replaceState: true });
			return;
		}
		rules = allRules(config);
	});

	/** Saves the new order as soon as a rule is dropped. */
	async function saveOrder(ordered: Rule[]) {
		if (!importer || !config) return;
		try {
			config = withRules(config, ordered);
			await saveImporterConfig(importer.id, config);
		} catch (e) {
			Notifier.error(`Could not save the order: ${e instanceof Error ? e.message : e}`);
		}
	}

	async function edit(index: number) {
		await goto(`/importers/rule?importer=${importer?.id}&rule=${index}`);
	}

	async function add() {
		await goto(`/importers/rule?importer=${importer?.id}&new=1`);
	}

	let deleteIndex = $state<number | null>(null);
	let confirmDelete = $state(false);

	function askRemove(index: number) {
		deleteIndex = index;
		confirmDelete = true;
	}

	async function remove() {
		const index = deleteIndex;
		if (index === null) return;
		rules = rules.filter((_, i) => i !== index);
		await saveOrder(rules);
	}

	function summary(rule: Rule): string {
		return [rule.payee && `→ ${rule.payee}`, rule.account].filter(Boolean).join(' · ');
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={importer ? `Rules: ${importer.name}` : 'Rules'}>
		{#snippet actions()}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<p class="px-4 pt-3 text-sm opacity-70">
		Drag to reorder, tap a rule to edit it. For each field the first matching rule wins, so put
		specific rules above general ones.
	</p>

	<DragReorderList
		bind:items={rules}
		getLabel={(rule) => rule.match}
		ondragend={saveOrder}
		class="flex-1 overflow-y-auto p-1 pb-28"
	>
		{#snippet row(rule, i)}
			<button
				type="button"
				class="flex min-w-0 grow items-center gap-2 text-left"
				class:opacity-50={rule.disabled}
				onclick={() => edit(i)}
			>
				<span class="w-7 shrink-0 text-xs opacity-50">#{i + 1}</span>
				<span class="min-w-0 grow">
					<span class="block truncate font-mono text-sm">{rule.match}</span>
					<span class="block truncate text-xs opacity-70">
						{summary(rule)}{rule.disabled ? ' (disabled)' : ''}
					</span>
				</span>
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square text-error"
				aria-label="Delete rule #{i + 1}"
				onclick={() => askRemove(i)}
			>
				<Trash2Icon size={18} />
			</button>
		{/snippet}
		{#snippet empty()}
			<p class="p-4 text-sm opacity-70">
				No rules yet. Add one below, or create one from a row's Details in the import review.
			</p>
		{/snippet}
	</DragReorderList>

	<Fab Icon={PlusIcon} onclick={add} ariaLabel="Add rule" />
</main>

<ConfirmDialog
	bind:open={confirmDelete}
	title="Confirm Delete"
	message={deleteIndex === null
		? ''
		: `Do you want to delete rule #${deleteIndex + 1} "${rules[deleteIndex]?.match ?? ''}"?`}
	onconfirm={remove}
/>
