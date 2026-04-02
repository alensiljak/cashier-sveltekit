<script lang="ts">
	import { ChevronRight, ChevronDown } from '@lucide/svelte';
	import Self from './JsonTreeNode.svelte';

	type Props = {
		label: string;
		value: unknown;
		defaultExpanded?: boolean;
		depth?: number;
	};

	let { label, value, defaultExpanded = false, depth = 0 }: Props = $props();

	let expanded = $state(defaultExpanded);

	function toggle() {
		expanded = !expanded;
	}

	function getType(v: unknown): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' {
		if (v === null || v === undefined) return 'null';
		if (typeof v === 'boolean') return 'boolean';
		if (typeof v === 'number') return 'number';
		if (typeof v === 'string') return 'string';
		if (Array.isArray(v)) return 'array';
		return 'object';
	}

	let type = $derived(getType(value));
	let isExpandable = $derived(type === 'array' || type === 'object');
	let childEntries = $derived(
		type === 'array'
			? (value as unknown[]).map((v, i) => ({ key: `[${i}]`, val: v }))
			: type === 'object'
			? Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, val: v }))
			: []
	);
	let summary = $derived(
		type === 'array'
			? `[${(value as unknown[]).length}]`
			: type === 'object'
			? `{${Object.keys(value as object).length}}`
			: ''
	);
</script>

<div class="font-mono text-xs leading-relaxed">
	{#if isExpandable}
		<button
			class="flex items-center gap-1 hover:bg-base-200 rounded px-1 w-full text-left"
			onclick={toggle}
		>
			<span class="text-base-content/40 w-3 shrink-0">
				{#if expanded}
					<ChevronDown size={12} />
				{:else}
					<ChevronRight size={12} />
				{/if}
			</span>
			<span class="text-base-content/70">{label}</span>
			<span class="text-base-content/40 ml-1">{summary}</span>
		</button>
		{#if expanded}
			<div class="ml-4 border-l border-base-300 pl-2">
				{#each childEntries as { key, val }}
					<Self label={key} value={val} depth={depth + 1} />
				{/each}
			</div>
		{/if}
	{:else}
		<div class="flex items-center gap-1 px-1 py-0.5">
			<span class="w-3 shrink-0"></span>
			<span class="text-base-content/70">{label}:</span>
			{#if type === 'null'}
				<span class="text-base-content/30 italic">null</span>
			{:else if type === 'boolean'}
				<span class="text-info">{String(value)}</span>
			{:else if type === 'number'}
				<span class="text-success">{String(value)}</span>
			{:else if type === 'string'}
				<span class="text-warning break-all">"{value}"</span>
			{/if}
		</div>
	{/if}
</div>
