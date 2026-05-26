<script lang="ts">
	import type { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import AaEditorNode from './AaEditorNode.svelte';

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	type Props = {
		ac: AssetClass;
		childrenIndex: Map<string, AssetClass[]>;
		commodities?: string[];
		onAddChild: (parent: AssetClass) => void;
		onDelete: (ac: AssetClass) => void;
		onRename: (ac: AssetClass, newName: string) => void;
		onAllocationChange: (ac: AssetClass, value: number) => void;
		onAddSymbol: (ac: AssetClass, symbol: string) => void;
		onRemoveSymbol: (ac: AssetClass, symbol: string) => void;
	};

	let {
		ac,
		childrenIndex,
		commodities = [],
		onAddChild,
		onDelete,
		onRename,
		onAllocationChange,
		onAddSymbol,
		onRemoveSymbol
	}: Props = $props();

	const datalistId = $derived(
		`aa-commodities-${ac.fullname.replace(/[^a-zA-Z0-9]/g, '-')}`
	);

	const children = $derived(childrenIndex.get(ac.fullname) ?? []);
	const isLeaf = $derived(children.length === 0);
	const childrenSum = $derived(children.reduce((s, c) => s + (c.allocation ?? 0), 0));
	const balanced = $derived(isLeaf || childrenSum === ac.allocation);

	let editingName = $state(false);
	let nameInput = $state('');
	let newSymbol = $state('');
	let collapsed = $state(false);

	function startEdit() {
		nameInput = ac.name;
		editingName = true;
	}

	function confirmRename() {
		editingName = false;
		const trimmed = nameInput.trim();
		if (trimmed && trimmed !== ac.name) {
			onRename(ac, trimmed);
		}
	}

	function handleNameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') confirmRename();
		else if (e.key === 'Escape') {
			nameInput = ac.name;
			editingName = false;
		}
	}

	function addSymbol() {
		const sym = newSymbol.trim().toUpperCase();
		if (sym && !(ac.symbols ?? []).includes(sym)) {
			onAddSymbol(ac, sym);
			newSymbol = '';
		}
	}

	function handleSymbolKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addSymbol();
		}
	}
</script>

<div>
	<!-- Row -->
	<div
		class="flex gap-2 border-b border-base-300/30 py-1 pr-2 text-sm hover:bg-base-200/20 {isLeaf ? 'items-start' : 'items-center'}"
		style="padding-left: calc({ac.depth * 1.25}rem + 0.5rem)"
	>
		<!-- Collapse toggle for parent nodes -->
		{#if !isLeaf}
			<button
				class="btn btn-ghost btn-xs h-4 min-h-4 w-4 p-0 text-xs"
				onclick={() => (collapsed = !collapsed)}
			>
				{collapsed ? '▶' : '▼'}
			</button>
		{:else}
			<span class="w-4 shrink-0"></span>
		{/if}

		<!-- Name (double-click to rename) -->
		{#if editingName}
			<input
				class="input input-xs w-28 font-medium"
				bind:value={nameInput}
				onblur={confirmRename}
				onkeydown={handleNameKey}
				use:focusOnMount
			/>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="min-w-24 cursor-pointer select-none font-medium"
				title="Double-click to rename"
				ondblclick={startEdit}
			>{ac.name}</span>
		{/if}

		<!-- Allocation % -->
		<div class="flex items-center gap-0.5">
			<input
				type="number"
				class="input input-xs w-16 text-right tabular-nums"
				value={ac.allocation}
				min="0"
				max="100"
				step="1"
				onchange={(e) =>
					onAllocationChange(ac, parseFloat((e.target as HTMLInputElement).value) || 0)}
			/>
			<span class="text-xs text-base-content/50">%</span>
		</div>

		<!-- Children sum badge (parent nodes only) -->
		{#if !isLeaf}
			<span
				class="badge badge-xs font-mono {balanced ? 'badge-success' : 'badge-warning'}"
				title="Sum of children / this node's allocation"
			>{childrenSum}/{ac.allocation}</span>
		{/if}

		<!-- Symbol chips (leaf nodes only) -->
		{#if isLeaf}
			<div class="flex flex-1 flex-wrap items-center gap-1">
				{#each ac.symbols ?? [] as sym (sym)}
					<span class="badge badge-outline badge-sm gap-0.5 font-mono">
						{sym}
						<button
							class="leading-none opacity-50 hover:text-error hover:opacity-100"
							onclick={() => onRemoveSymbol(ac, sym)}
						>×</button>
					</span>
				{/each}
				<div class="flex items-center gap-0.5">
					<datalist id={datalistId}>
						{#each commodities as c (c)}
							<option value={c}></option>
						{/each}
					</datalist>
					<input
						class="input input-xs w-24 font-mono uppercase"
						placeholder="SYM.EX"
						list={datalistId}
						bind:value={newSymbol}
						onkeydown={handleSymbolKey}
					/>
					<button class="btn btn-ghost btn-xs" onclick={addSymbol} title="Add symbol">+</button>
				</div>
			</div>
		{:else}
			<span class="flex-1"></span>
		{/if}

		<!-- Actions -->
		<div class="flex shrink-0 items-center gap-3">
			{#if !isLeaf}
				<button
					class="btn btn-ghost btn-xs"
					onclick={() => onAddChild(ac)}
					title="Add child class"
				>+</button>
			{/if}
			{#if ac.depth > 0}
				<button
					class="btn btn-ghost btn-xs text-error/60 hover:text-error"
					onclick={() => onDelete(ac)}
					title="Delete"
				>✕</button>
			{/if}
		</div>
	</div>

	<!-- Children (recursive) -->
	{#if !collapsed}
		{#each children as child (child.fullname)}
			<AaEditorNode
				ac={child}
				{childrenIndex}
				{commodities}
				{onAddChild}
				{onDelete}
				{onRename}
				{onAllocationChange}
				{onAddSymbol}
				{onRemoveSymbol}
			/>
		{/each}
	{/if}
</div>
