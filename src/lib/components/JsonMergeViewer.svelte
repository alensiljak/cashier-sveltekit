<script module lang="ts">
	let instanceCounter = 0;
</script>

<script lang="ts" generics="T">
	/*
		Structural counterpart to DiffViewer: instead of a per-line Theirs/Mine
		pick on raw text, this diffs two item arrays by identity key
		(keyedMerge.ts) and lets the caller pick Theirs/Mine per *entry*. Reused
		by peer-sync's Settings/ScheduledTransactions diff — a raw text hunk
		merge risks producing invalid JSON wherever a hunk boundary falls inside
		the structure (trailing commas, unbalanced braces); rebuilding the array
		from picked entries and letting the caller `JSON.stringify` it doesn't
		have that failure mode. See keyedMerge.ts's header comment.
	*/
	import { ChevronUpIcon, ChevronDownIcon, ShieldCheckIcon } from '@lucide/svelte';
	import { diffKeyed, resolveKeyedMerge, type KeyedDiffEntry } from '$lib/utils/keyedMerge';

	interface Props {
		local: T[];
		remote: T[];
		/** Identity key an item is tracked by across local/remote — NOT necessarily what's displayed. */
		keyOf: (item: T) => string;
		/** Defaults to deep equality via JSON.stringify. */
		equal?: (a: T, b: T) => boolean;
		/** Heading shown per entry. Defaults to the identity key. */
		labelOf?: (item: T) => string;
		/** Diff content shown per entry. Defaults to a pretty-printed JSON.stringify of the item. */
		renderEntry?: (item: T) => string;
		/** Optional label shown above the entry list (e.g. a filename). */
		title?: string;
		banner?: { text: string; alertClass: string } | null;
		identicalMessage?: string;
		/** Shown as a "Mark as identical" action when the two sides already agree entry-for-entry. */
		onMarkIdentical?: () => void | Promise<void>;
		markingIdentical?: boolean;
		/** Enables the per-entry Theirs/Mine picker and an "Apply merge" action. */
		onApplyMerge?: (merged: T[]) => void | Promise<void>;
		applyingMerge?: boolean;
	}

	let {
		local,
		remote,
		keyOf,
		equal,
		labelOf,
		renderEntry = (item: T) => JSON.stringify(item, null, 2),
		title,
		banner = null,
		identicalMessage = 'Entries are identical.',
		onMarkIdentical,
		markingIdentical = false,
		onApplyMerge,
		applyingMerge = false
	}: Props = $props();

	const label = $derived(labelOf ?? keyOf);

	let entries = $derived(diffKeyed(local, remote, keyOf, equal));

	/** Entries flipped to "Mine" (keep the local side); missing = "Theirs". */
	let rejectedKeys = $state(new Set<string>());

	function setChoice(key: string, theirs: boolean) {
		const next = new Set(rejectedKeys);
		if (theirs) next.delete(key);
		else next.add(key);
		rejectedKeys = next;
	}

	let merged = $derived(resolveKeyedMerge(local, entries, keyOf, rejectedKeys));
	let mergeIsNoOp = $derived(entries.length === 0 || rejectedKeys.size === entries.length);

	/** Index into `entries` last scrolled to; -1 = none visited yet. */
	let currentEntry = $state(-1);
	const uid = instanceCounter++;

	function scrollToEntry(index: number) {
		if (!entries[index]) return;
		document
			.getElementById(`json-merge-${uid}-${index}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function prevEntry() {
		if (currentEntry <= 0) return;
		currentEntry -= 1;
		scrollToEntry(currentEntry);
	}

	function nextEntry() {
		if (currentEntry >= entries.length - 1) return;
		currentEntry += 1;
		scrollToEntry(currentEntry);
	}

	// The set of entries changes whenever the diffed content changes — restart
	// navigation and discard any per-entry Theirs/Mine choices.
	$effect(() => {
		void entries;
		currentEntry = -1;
		rejectedKeys = new Set();
	});

	const STATUS_LABEL: Record<KeyedDiffEntry<T>['status'], string> = {
		added: 'Added',
		removed: 'Removed',
		changed: 'Changed'
	};
</script>

<div class="flex flex-col gap-2">
	<div class="bg-base-100 sticky top-0 z-10 flex flex-col gap-2 pb-2">
		{#if title || entries.length > 0}
			<div class="flex items-center gap-2">
				{#if title}
					<p class="min-w-0 flex-1 truncate font-mono text-sm font-semibold opacity-60">{title}</p>
				{/if}
				{#if entries.length > 0}
					<span class="shrink-0 text-xs opacity-50">{currentEntry + 1}/{entries.length}</span>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-square"
						disabled={currentEntry <= 0}
						aria-label="Previous change"
						onclick={prevEntry}
					>
						<ChevronUpIcon class="h-4 w-4" />
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-square"
						disabled={currentEntry >= entries.length - 1}
						aria-label="Next change"
						onclick={nextEntry}
					>
						<ChevronDownIcon class="h-4 w-4" />
					</button>
				{/if}
			</div>
		{/if}

		{#if entries.length > 0}
			<div
				class="border-base-300 flex items-center justify-between gap-4 border-b pb-2 text-xs opacity-50"
			>
				<div class="flex gap-4">
					<span class="flex items-center gap-1.5"
						><span class="bg-success/40 inline-block h-3 w-3 rounded-sm"></span>added</span
					>
					<span class="flex items-center gap-1.5"
						><span class="bg-error/40 inline-block h-3 w-3 rounded-sm"></span>removed</span
					>
				</div>
				{#if onApplyMerge}
					<span>Dimmed entries are dropped by the picks below.</span>
				{/if}
			</div>
		{/if}
	</div>

	{#if banner}
		<div class="alert {banner.alertClass} text-xs">
			<span>{banner.text}</span>
		</div>
	{/if}

	{#if entries.length === 0}
		<p class="text-success text-sm">{identicalMessage}</p>
		{#if onMarkIdentical}
			<button
				type="button"
				class="btn btn-success btn-xs mt-1"
				disabled={markingIdentical}
				onclick={onMarkIdentical}
			>
				{#if markingIdentical}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					<ShieldCheckIcon class="h-3.5 w-3.5" />
				{/if}
				Mark as identical
			</button>
		{/if}
	{:else}
		<div class="flex flex-col gap-3">
			{#each entries as entry, i (entry.key)}
				{@const theirs = !rejectedKeys.has(entry.key)}
				<div id="json-merge-{uid}-{i}" class="rounded bg-base-200 p-2">
					<div class="mb-1 flex items-center justify-between gap-2">
						<span class="truncate text-sm font-semibold opacity-70">
							{label(entry.status === 'removed' ? (entry.local as T) : (entry.remote as T))}
						</span>
						<span class="badge badge-xs shrink-0">{STATUS_LABEL[entry.status]}</span>
					</div>
					{#if onApplyMerge}
						<div class="join mb-2">
							<button
								type="button"
								class="btn btn-xs join-item {theirs ? 'btn-primary' : 'btn-outline'}"
								onclick={() => setChoice(entry.key, true)}
							>
								Theirs
							</button>
							<button
								type="button"
								class="btn btn-xs join-item {!theirs ? 'btn-neutral' : 'btn-outline'}"
								onclick={() => setChoice(entry.key, false)}
							>
								Mine
							</button>
						</div>
					{/if}
					<div class="font-mono text-xs leading-5">
						{#if entry.status !== 'added'}
							<div
								class="bg-error/20 text-error-content break-all whitespace-pre-wrap"
								class:opacity-30={onApplyMerge && theirs}
							>
								- {renderEntry(entry.local as T)}
							</div>
						{/if}
						{#if entry.status !== 'removed'}
							<div
								class="bg-success/20 text-success-content break-all whitespace-pre-wrap"
								class:opacity-30={onApplyMerge && !theirs}
							>
								+ {renderEntry(entry.remote as T)}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		{#if onApplyMerge}
			<div class="border-base-300 flex items-center justify-between gap-3 border-t pt-3">
				<span class="text-xs opacity-60">
					{entries.length - rejectedKeys.size} theirs · {rejectedKeys.size} mine
				</span>
				<button
					type="button"
					class="btn btn-primary btn-sm"
					disabled={applyingMerge || mergeIsNoOp}
					onclick={() => onApplyMerge?.(merged)}
				>
					{#if applyingMerge}
						<span class="loading loading-spinner loading-xs"></span>
					{/if}
					Apply merge
				</button>
			</div>
		{/if}
	{/if}
</div>
