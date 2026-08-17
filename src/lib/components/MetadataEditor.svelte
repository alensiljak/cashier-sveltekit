<script lang="ts">
	import { TrashIcon } from '@lucide/svelte';
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
	//
	// A blank row is always kept at the end so a new entry can be typed without an
	// explicit "add" click; once both its fields are filled, a fresh blank row is
	// appended below it.
	let rows = $state<Row[]>(
		untrack(() => [...Object.entries(meta ?? {}).map(([key, value]) => ({ key, value })), { key: '', value: '' }])
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

	function ensureTrailingEmptyRow() {
		const last = rows[rows.length - 1];
		if (last && (last.key.trim() !== '' || last.value.trim() !== '')) {
			rows = [...rows, { key: '', value: '' }];
		}
	}

	function onRowInput() {
		ensureTrailingEmptyRow();
		commit();
	}

	function removeRow(row: Row) {
		rows = rows.filter((r) => r !== row);
		ensureTrailingEmptyRow();
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
					onRowInput();
				}}
			/>
			<input
				type="text"
				class="input input-sm input-bordered flex-1"
				placeholder="value"
				value={row.value}
				oninput={(e) => {
					row.value = e.currentTarget.value;
					onRowInput();
				}}
			/>
			{#if row.key.trim() !== '' || row.value.trim() !== ''}
				<button
					type="button"
					class="btn btn-ghost btn-sm px-2"
					aria-label="Remove metadata entry"
					onclick={() => removeRow(row)}
				>
					<TrashIcon class="h-4 w-4" />
				</button>
			{:else}
				<div class="w-8"></div>
			{/if}
		</div>
	{/each}
</div>
