<script lang="ts">
	import { goto } from '$app/navigation';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation.js';
	import { buildChildrenIndex } from '$lib/assetAllocation/assetAllocationUtils.js';
	import { serializeToToml } from '$lib/assetAllocation/assetAllocationSerializer.js';
	import { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import AaEditorNode from '$lib/components/AaEditorNode.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import Notifier from '$lib/utils/notifier.js';
	import { SaveIcon, XIcon } from '@lucide/svelte';

	Notifier.init();

	let { data } = $props();

	let draft = $state<AssetClass[]>([]);
	const childrenIndex = $derived(buildChildrenIndex(draft));
	const roots = $derived(draft.filter((ac) => ac.depth === 0));

	$effect(() => {
		if (data.definition) {
			try {
				const engine = new AssetAllocationEngine();
				draft = engine.parseDefinition(data.definition);
			} catch (e) {
				Notifier.error(`Could not parse definition: ${e}`);
			}
		}
	});

	function getDescendants(fullname: string): AssetClass[] {
		const children = childrenIndex.get(fullname) ?? [];
		return children.flatMap((c) => [c, ...getDescendants(c.fullname)]);
	}

	function onAddChild(parent: AssetClass) {
		const existing = new Set((childrenIndex.get(parent.fullname) ?? []).map((c) => c.name));
		let name = 'New';
		let i = 1;
		while (existing.has(name)) name = `New${i++}`;

		const node = new AssetClass();
		node.fullname = parent.fullname + ':' + name;
		node.allocation = 0;
		node.symbols = [];
		draft.push(node);
	}

	function onDelete(ac: AssetClass) {
		const desc = getDescendants(ac.fullname);
		const msg =
			desc.length > 0
				? `Delete "${ac.name}" and its ${desc.length} child node(s)?`
				: `Delete "${ac.name}"?`;
		if (!confirm(msg)) return;
		const remove = new Set([ac.fullname, ...desc.map((d) => d.fullname)]);
		draft = draft.filter((x) => !remove.has(x.fullname));
	}

	function onRename(ac: AssetClass, newName: string) {
		const oldPrefix = ac.fullname;
		const newFullname = (ac.parentName ? ac.parentName + ':' : '') + newName;
		draft = draft.map((node) => {
			if (node.fullname === oldPrefix || node.fullname.startsWith(oldPrefix + ':')) {
				const updated = Object.assign(new AssetClass(), node);
				updated.fullname =
					node.fullname === oldPrefix
						? newFullname
						: newFullname + node.fullname.slice(oldPrefix.length);
				return updated;
			}
			return node;
		});
	}

	function onAllocationChange(ac: AssetClass, value: number) {
		ac.allocation = value;
	}

	function onAddSymbol(ac: AssetClass, symbol: string) {
		if (!ac.symbols) ac.symbols = [];
		if (!ac.symbols.includes(symbol)) ac.symbols.push(symbol);
	}

	function onRemoveSymbol(ac: AssetClass, symbol: string) {
		ac.symbols = (ac.symbols ?? []).filter((s) => s !== symbol);
	}

	async function onSave() {
		if (!data.path) {
			Notifier.error('No definition file path configured in settings.');
			return;
		}
		const content = serializeToToml(draft);
		await OpfsLib.saveFile(data.path, content);
		Notifier.success('Asset allocation saved.');
		await goto('/asset-allocation');
	}

	function onCancel() {
		goto('/asset-allocation');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="AA Editor">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Save" Icon={SaveIcon} onclick={onSave} />
			<ToolbarMenuItem text="Cancel" Icon={XIcon} onclick={onCancel} />
		{/snippet}
	</Toolbar>

	{#if !data.definition}
		<div class="flex flex-1 items-center justify-center text-base-content/50">
			No asset allocation definition file configured. Check Settings.
		</div>
	{:else if roots.length === 0}
		<div class="flex flex-1 items-center justify-center text-base-content/50">Loading…</div>
	{:else}
		<section class="flex-1 overflow-y-auto p-2">
			<div class="mx-auto max-w-4xl">
				{#each roots as root (root.fullname)}
					<AaEditorNode
						ac={root}
						{childrenIndex}
						{onAddChild}
						{onDelete}
						{onRename}
						{onAllocationChange}
						{onAddSymbol}
						{onRemoveSymbol}
						commodities={data.commodities}
					/>
				{/each}
			</div>
		</section>
	{/if}
</main>
