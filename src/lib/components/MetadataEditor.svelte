<script lang="ts">
	import { PlusIcon, TrashIcon } from '@lucide/svelte';
	import { untrack } from 'svelte';

	type Props = {
		meta: Record<string, string> | undefined;
		onChange: (meta: Record<string, string>) => void;
	};
	let { meta, onChange }: Props = $props();

	type Row = { key: string; value: string };

	// Local row list keyed by object identity (not the key string) so renaming a key
	// mid-edit doesn't remount the input and drop focus. Initialized once — this
	// component is always mounted fresh per transaction (see XactEditor usage).
	// Committed to the parent explicitly on each input/removal, never via a
	// reactive $effect — an effect that both reads local state and (indirectly,
	// through onChange) writes the parent store creates a render feedback loop.
	let rows = $state<Row[]>(
		untrack(() => Object.entries(meta ?? {}).map(([key, value]) => ({ key, value })))
	);

	function commit() {
		const result: Record<string, string> = {};
		for (const row of rows) {
			const key = row.key.trim();
			if (!key) continue;
			result[key] = row.value;
		}
		onChange(result);
	}

	function addRow() {
		rows = [...rows, { key: '', value: '' }];
	}

	function removeRow(row: Row) {
		rows = rows.filter((r) => r !== row);
		commit();
	}
</script>

<div class="space-y-2">
	{#each rows as row (row)}
		<div class="flex items-center gap-2">
			<input
				type="text"
				class="input input-sm input-bordered w-2/5 font-mono"
				placeholder="key"
				value={row.key}
				oninput={(e) => {
					row.key = e.currentTarget.value;
					commit();
				}}
			/>
			<input
				type="text"
				class="input input-sm input-bordered flex-1"
				placeholder="value"
				value={row.value}
				oninput={(e) => {
					row.value = e.currentTarget.value;
					commit();
				}}
			/>
			<button
				type="button"
				class="btn btn-ghost btn-sm px-2"
				aria-label="Remove metadata entry"
				onclick={() => removeRow(row)}
			>
				<TrashIcon class="h-4 w-4" />
			</button>
		</div>
	{/each}
	{#if rows.length === 0}
		<p class="text-xs opacity-50">No metadata. Tap "Add entry" to add a key/value pair.</p>
	{/if}
	<button type="button" class="btn btn-outline btn-sm" onclick={addRow}>
		<PlusIcon class="h-4 w-4" />
		Add entry
	</button>
</div>
