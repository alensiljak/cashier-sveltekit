<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import ledgerService from '$lib/services/ledgerService';
	import JsonTreeNode from './JsonTreeNode.svelte';

	let isLoading = $state(false);
	let error: string | null = $state(null);
	let ledgerData: Record<string, unknown> | null = $state(null);
	let expandedSections: Record<string, boolean> = $state({});

	function toggleSection(id: string) {
		expandedSections[id] = !expandedSections[id];
	}

	function loadLedger() {
		try {
			isLoading = true;
			error = null;

			ledgerData = {
				isValid: ledgerService.isValid(),
				directives: ledgerService.getDirectives(),
				parseErrors: ledgerService.getParseErrors(),
				validationErrors: ledgerService.getValidationErrors(),
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to read ledger';
			console.error('Ledger read error:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(loadLedger);
</script>

<Toolbar title="Ledger Debug" />

<main class="mx-auto max-w-5xl space-y-4 p-4">
	<!-- Controls -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4">
			<div class="flex items-center gap-4">
				<h2 class="card-title m-0">ParsedLedger Inspector</h2>
				<button class="btn btn-sm btn-primary" onclick={loadLedger} disabled={isLoading}>
					{#if isLoading}
						<span class="loading loading-spinner loading-xs"></span> Loading...
					{:else}
						Reload
					{/if}
				</button>
			</div>
			<p class="text-sm text-base-content/60">
				Treeview of the ParsedLedger used for BQL queries. Useful for debugging and troubleshooting.
			</p>
			{#if error}
				<div class="alert alert-error mt-2 py-2 text-sm">{error}</div>
			{/if}
		</div>
	</section>

	{#if ledgerData}
		<!-- Summary -->
		<section class="card bg-base-100 shadow-xl">
			<div class="card-body p-4 gap-2">
				<div class="flex flex-wrap gap-2 items-center">
					<span
						class="badge"
						class:badge-success={ledgerData.isValid}
						class:badge-error={!ledgerData.isValid}
					>
						{ledgerData.isValid ? 'Valid' : 'Invalid'}
					</span>
					<span class="badge badge-outline">
						{(ledgerData.directives as unknown[]).length} directives
					</span>
					{#if (ledgerData.parseErrors as unknown[]).length > 0}
						<span class="badge badge-warning">
							{(ledgerData.parseErrors as unknown[]).length} parse errors
						</span>
					{/if}
					{#if (ledgerData.validationErrors as unknown[]).length > 0}
						<span class="badge badge-error">
							{(ledgerData.validationErrors as unknown[]).length} validation errors
						</span>
					{/if}
				</div>
			</div>
		</section>

		<!-- Directives Tree -->
		<AccordionSection
			title="Directives"
			badge={(ledgerData.directives as unknown[]).length}
			expanded={expandedSections['directives'] ?? true}
			onToggle={() => toggleSection('directives')}
		>
			<div class="overflow-x-auto overflow-y-auto max-h-[600px] bg-base-200 rounded-lg p-3">
				<JsonTreeNode label="directives" value={ledgerData.directives} defaultExpanded={true} />
			</div>
		</AccordionSection>

		<!-- Parse Errors Tree -->
		<AccordionSection
			title="Parse Errors"
			badge={(ledgerData.parseErrors as unknown[]).length}
			expanded={expandedSections['parseErrors'] ?? false}
			onToggle={() => toggleSection('parseErrors')}
		>
			<div class="overflow-x-auto overflow-y-auto max-h-[400px] bg-base-200 rounded-lg p-3">
				<JsonTreeNode label="parseErrors" value={ledgerData.parseErrors} defaultExpanded={true} />
			</div>
		</AccordionSection>

		<!-- Validation Errors Tree -->
		<AccordionSection
			title="Validation Errors"
			badge={(ledgerData.validationErrors as unknown[]).length}
			expanded={expandedSections['validationErrors'] ?? false}
			onToggle={() => toggleSection('validationErrors')}
		>
			<div class="overflow-x-auto overflow-y-auto max-h-[400px] bg-base-200 rounded-lg p-3">
				<JsonTreeNode label="validationErrors" value={ledgerData.validationErrors} defaultExpanded={true} />
			</div>
		</AccordionSection>
	{/if}
</main>