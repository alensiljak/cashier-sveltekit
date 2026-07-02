<script module lang="ts">
	let instanceCounter = 0;
</script>

<script lang="ts">
	/*
		Shared line-diff viewer: legend, prev/next-hunk navigation with a
		counter, and (when `onApplyMerge` is supplied) a per-hunk Theirs/Mine
		toggle that lets the caller write back a hunk-level merge instead of a
		whole-file overwrite. Used by both the generic beancount peer-sync
		preview modal and peer-sync's own cashier.bean/settings/scheduled diff
		modal — merge only makes sense for line-oriented content (cashier.bean),
		so JSON sections there simply omit `onApplyMerge` and get a read-only
		diff with the same navigation.
	*/
	import { ChevronUpIcon, ChevronDownIcon, ShieldCheckIcon } from '@lucide/svelte';
	import { buildDiffLines } from '$lib/utils/diffText';
	import { normalizeEol } from '$lib/sync/SyncSource';

	interface Props {
		oldText: string;
		newText: string;
		/** Optional label shown above the diff (e.g. a filename). */
		title?: string;
		banner?: { text: string; alertClass: string } | null;
		identicalMessage?: string;
		/** Shown as a "Mark as identical" action when the two sides already agree byte-for-byte. */
		onMarkIdentical?: () => void | Promise<void>;
		markingIdentical?: boolean;
		/** Enables the per-hunk Theirs/Mine picker and an "Apply merge" action. */
		onApplyMerge?: (mergedContent: string) => void | Promise<void>;
		applyingMerge?: boolean;
	}

	let {
		oldText,
		newText,
		title,
		banner = null,
		identicalMessage = 'Files are identical.',
		onMarkIdentical,
		markingIdentical = false,
		onApplyMerge,
		applyingMerge = false
	}: Props = $props();

	/** Unique per-instance id prefix — multiple viewers can be mounted at once (e.g. peer-sync's 3-file diff). */
	const uid = instanceCounter++;

	let diffLines = $derived(buildDiffLines(oldText, newText));

	/** Contiguous run of added/removed lines — the unit a hunk decision applies to. */
	let hunkRanges = $derived.by(() => {
		const ranges: { start: number; end: number }[] = [];
		let start = -1;
		diffLines.forEach((line, i) => {
			if (line.type === 'context') {
				if (start !== -1) ranges.push({ start, end: i });
				start = -1;
			} else if (start === -1) {
				start = i;
			}
		});
		if (start !== -1) ranges.push({ start, end: diffLines.length });
		return ranges;
	});

	/** Hunk index for each line, or null on a context line. */
	let lineHunkIndex = $derived.by(() => {
		const arr: (number | null)[] = [];
		let idx = -1;
		let inHunk = false;
		for (const line of diffLines) {
			if (line.type === 'context') {
				inHunk = false;
				arr.push(null);
			} else {
				if (!inHunk) {
					idx += 1;
					inHunk = true;
				}
				arr.push(idx);
			}
		}
		return arr;
	});

	/** Hunks flipped to "Mine" (keep the local/old lines, drop the incoming ones); missing = "Theirs". */
	let rejectedHunks = $state(new Set<number>());

	function setHunkChoice(hunkIndex: number, theirs: boolean) {
		const next = new Set(rejectedHunks);
		if (theirs) next.delete(hunkIndex);
		else next.add(hunkIndex);
		rejectedHunks = next;
	}

	/** Reconstructs content from diffLines, keeping "added" or "removed" lines per-hunk per `rejectedHunks`. */
	let mergedContent = $derived.by(() => {
		const out: string[] = [];
		diffLines.forEach((line, i) => {
			const hunkIndex = lineHunkIndex[i];
			if (hunkIndex === null) {
				out.push(line.content);
				return;
			}
			const theirs = !rejectedHunks.has(hunkIndex);
			if ((line.type === 'added') === theirs) out.push(line.content);
		});
		return out.length ? out.join('\n') + '\n' : '';
	});

	let mergeIsNoOp = $derived(normalizeEol(mergedContent) === normalizeEol(oldText));

	/** Index into hunkRanges of the hunk last scrolled to; -1 = none visited yet. */
	let currentHunk = $state(-1);

	function scrollToHunk(index: number) {
		const hunk = hunkRanges[index];
		if (!hunk) return;
		document
			.getElementById(`diff-line-${uid}-${hunk.start}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function prevHunk() {
		if (currentHunk <= 0) return;
		currentHunk -= 1;
		scrollToHunk(currentHunk);
	}

	function nextHunk() {
		if (currentHunk >= hunkRanges.length - 1) return;
		currentHunk += 1;
		scrollToHunk(currentHunk);
	}

	// The set of hunks changes whenever the diffed content changes — restart
	// navigation and discard any per-hunk Theirs/Mine choices.
	$effect(() => {
		void diffLines;
		currentHunk = -1;
		rejectedHunks = new Set();
	});
</script>

<div class="flex flex-col gap-2">
	{#if title || hunkRanges.length > 0}
		<div class="flex items-center gap-2">
			{#if title}
				<p class="min-w-0 flex-1 truncate font-mono text-sm font-semibold opacity-60">{title}</p>
			{/if}
			{#if hunkRanges.length > 0}
				<span class="shrink-0 text-xs opacity-50">{currentHunk + 1}/{hunkRanges.length}</span>
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					disabled={currentHunk <= 0}
					aria-label="Previous change"
					onclick={prevHunk}
				>
					<ChevronUpIcon class="h-4 w-4" />
				</button>
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					disabled={currentHunk >= hunkRanges.length - 1}
					aria-label="Next change"
					onclick={nextHunk}
				>
					<ChevronDownIcon class="h-4 w-4" />
				</button>
			{/if}
		</div>
	{/if}

	{#if banner}
		<div class="alert {banner.alertClass} text-xs">
			<span>{banner.text}</span>
		</div>
	{/if}

	{#if diffLines.every((l) => l.type === 'context')}
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
		<div class="flex items-center justify-between gap-4 text-xs opacity-50">
			<div class="flex gap-4">
				<span class="flex items-center gap-1.5"
					><span class="bg-success/40 inline-block h-3 w-3 rounded-sm"></span>added</span
				>
				<span class="flex items-center gap-1.5"
					><span class="bg-error/40 inline-block h-3 w-3 rounded-sm"></span>removed</span
				>
			</div>
			{#if onApplyMerge}
				<span>Dimmed lines are dropped by the picks below.</span>
			{/if}
		</div>
		<div class="rounded bg-base-200 p-2 font-mono text-xs leading-5">
			{#each diffLines as line, i}
				{@const hunkIndex = lineHunkIndex[i]}
				{@const theirs = hunkIndex !== null && !rejectedHunks.has(hunkIndex)}
				{@const included =
					hunkIndex === null ||
					(line.type === 'added' ? theirs : line.type === 'removed' ? !theirs : true)}
				{#if onApplyMerge && hunkIndex !== null && hunkRanges[hunkIndex].start === i}
					<div class="join mt-2 mb-1">
						<button
							type="button"
							class="btn btn-xs join-item {theirs ? 'btn-primary' : 'btn-outline'}"
							onclick={() => setHunkChoice(hunkIndex, true)}
						>
							Theirs
						</button>
						<button
							type="button"
							class="btn btn-xs join-item {!theirs ? 'btn-neutral' : 'btn-outline'}"
							onclick={() => setHunkChoice(hunkIndex, false)}
						>
							Mine
						</button>
					</div>
				{/if}
				<div id="diff-line-{uid}-{i}" class:opacity-30={onApplyMerge && !included}>
					{#if line.type === 'removed'}
						<div class="bg-error/20 text-error-content break-all whitespace-pre-wrap">
							- {line.content}
						</div>
					{:else if line.type === 'added'}
						<div class="bg-success/20 text-success-content break-all whitespace-pre-wrap">
							+ {line.content}
						</div>
					{:else}
						<div class="break-all whitespace-pre-wrap opacity-50">
							&nbsp; {line.content}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if onApplyMerge}
			<div class="border-base-300 flex items-center justify-between gap-3 border-t pt-3">
				<span class="text-xs opacity-60">
					{hunkRanges.length - rejectedHunks.size} theirs · {rejectedHunks.size} mine
				</span>
				<button
					type="button"
					class="btn btn-primary btn-sm"
					disabled={applyingMerge || mergeIsNoOp}
					onclick={() => onApplyMerge?.(mergedContent)}
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
