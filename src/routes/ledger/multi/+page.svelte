<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import { ensureInitialized, parseMultiFile } from '$lib/services/rustledger';
	import { loadFileMap } from '$lib/sync/sync-fs';
	import JsonTreeNode from '../JsonTreeNode.svelte';

	let isLoading = $state(false);
	let error: string | null = $state(null);
	let parseResult: Record<string, unknown> | null = $state(null);
	let fileMap: Record<string, string> | null = $state(null);
	let mainFileName: string | null = $state(null);
	let expandedSections: Record<string, boolean> = $state({});

	function toggleSection(id: string) {
		expandedSections[id] = !expandedSections[id];
	}

	async function loadAndParse() {
		try {
			isLoading = true;
			error = null;
			parseResult = null;

			const loaded = await loadFileMap();
			fileMap = loaded.fileMap;
			mainFileName = loaded.mainFileName;

			await ensureInitialized();
			const result = parseMultiFile(loaded.fileMap, loaded.mainFileName);

			parseResult = {
				ledger: result.ledger,
				errors: result.errors,
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load or parse files';
			console.error('Multi-parse error:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(loadAndParse);
</script>

<Toolbar title="Multi-File Ledger Debug" />

<main class="mx-auto max-w-5xl space-y-4 p-4">
	<!-- Controls -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4">
			<div class="flex items-center gap-4">
				<h2 class="card-title m-0">parseMultiFile Inspector</h2>
				<button class="btn btn-sm btn-primary" onclick={loadAndParse} disabled={isLoading}>
					{#if isLoading}
						<span class="loading loading-spinner loading-xs"></span> Loading...
					{:else}
						Reload
					{/if}
				</button>
			</div>
			<p class="text-sm text-base-content/60">
				Reads beancount files from the filesystem (resolving includes) and parses them with
				parseMultiFile. Useful for debugging multi-file parsing.
			</p>
			{#if error}
				<div class="alert alert-error mt-2 py-2 text-sm">{error}</div>
			{/if}
		</div>
	</section>

	{#if parseResult !== null}
		<!-- Summary -->
		<section class="card bg-base-100 shadow-xl">
			<div class="card-body p-4 gap-2">
				<div class="flex flex-wrap gap-2 items-center">
					<span
						class="badge"
						class:badge-success={parseResult.ledger != null}
						class:badge-error={parseResult.ledger == null}
					>
						{parseResult.ledger != null ? 'Parsed' : 'No ledger'}
					</span>
					{#if parseResult.ledger != null}
						<span class="badge badge-outline">
							{((parseResult.ledger as { directives: unknown[] }).directives ?? []).length} directives
						</span>
					{/if}
					{#if (parseResult.errors as unknown[]).length > 0}
						<span class="badge badge-warning">
							{(parseResult.errors as unknown[]).length} errors
						</span>
					{/if}
					{#if mainFileName}
						<span class="badge badge-ghost text-xs">{mainFileName}</span>
					{/if}
					{#if fileMap}
						<span class="badge badge-ghost text-xs">{Object.keys(fileMap).length} files</span>
					{/if}
				</div>
			</div>
		</section>

		<!-- File Map -->
		<AccordionSection
			title="File Map"
			badge={fileMap ? Object.keys(fileMap).length : 0}
			expanded={expandedSections['fileMap'] ?? false}
			onToggle={() => toggleSection('fileMap')}
		>
			<div class="overflow-x-auto overflow-y-auto max-h-[300px] bg-base-200 rounded-lg p-3">
				<JsonTreeNode label="fileMap" value={fileMap ? Object.keys(fileMap) : []} defaultExpanded={true} />
			</div>
		</AccordionSection>

		<!-- Directives Tree -->
		{#if parseResult.ledger != null}
			<AccordionSection
				title="Directives"
				badge={((parseResult.ledger as { directives: unknown[] }).directives ?? []).length}
				expanded={expandedSections['directives'] ?? false}
				onToggle={() => toggleSection('directives')}
			>
				<div class="overflow-x-auto overflow-y-auto max-h-[600px] bg-base-200 rounded-lg p-3">
					<JsonTreeNode
						label="directives"
						value={(parseResult.ledger as { directives: unknown[] }).directives}
						defaultExpanded={true}
					/>
				</div>
			</AccordionSection>
		{/if}

		<!-- Parse Errors -->
		<AccordionSection
			title="Parse Errors"
			badge={(parseResult.errors as unknown[]).length}
			expanded={expandedSections['errors'] ?? false}
			onToggle={() => toggleSection('errors')}
		>
			<div class="overflow-x-auto overflow-y-auto max-h-[400px] bg-base-200 rounded-lg p-3">
				<JsonTreeNode label="errors" value={parseResult.errors} defaultExpanded={true} />
			</div>
		</AccordionSection>
	{/if}
</main>
