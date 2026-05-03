<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/fullLedgerService';
	import type { BeancountError } from '@rustledger/wasm';

	type Status = 'idle' | 'loading' | 'done' | 'error';

	let status: Status = $state('idle');
	let loadError: string | null = $state(null);

	let isValid = $state(false);
	let errors: BeancountError[] = $state([]);
	let warnings: BeancountError[] = $state([]);

	onMount(async () => {
		await runValidation();
	});

	async function runValidation() {
		try {
			status = 'loading';
			loadError = null;

			await fullLedgerService.load();

			const allErrors = fullLedgerService.getErrors();
			errors = allErrors.filter((e) => e.severity === 'error');
			warnings = allErrors.filter((e) => e.severity === 'warning');
			isValid = fullLedgerService.isValid();

			status = 'done';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load ledger';
			status = 'error';
		}
	}

	let totalIssues = $derived(errors.length + warnings.length);
</script>

<Toolbar title="Ledger Validation" />

<main class="mx-auto max-w-4xl space-y-4 p-4">
	<!-- Controls -->
	<div class="flex items-center gap-3">
		<button
			class="btn btn-primary"
			onclick={runValidation}
			disabled={status === 'loading'}
		>
			{#if status === 'loading'}
				<span class="loading loading-spinner loading-sm"></span>
				Validating…
			{:else}
				Reload &amp; Validate
			{/if}
		</button>

		{#if status === 'done'}
			<div class="badge {isValid ? 'badge-success' : 'badge-error'} gap-1 text-sm">
				{isValid ? 'Valid' : 'Invalid'}
			</div>
			{#if totalIssues > 0}
				<span class="text-sm text-base-content/60">
					{errors.length} error{errors.length !== 1 ? 's' : ''},
					{warnings.length} warning{warnings.length !== 1 ? 's' : ''}
				</span>
			{/if}
		{/if}
	</div>

	<!-- Load error -->
	{#if status === 'error' && loadError}
		<div class="alert alert-error">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<div>
				<p class="font-semibold">Failed to load ledger</p>
				<p class="text-sm">{loadError}</p>
			</div>
		</div>
	{/if}

	<!-- Idle -->
	{#if status === 'idle'}
		<p class="text-base-content/50">Press "Reload &amp; Validate" to check your ledger.</p>
	{/if}

	<!-- Loading skeleton -->
	{#if status === 'loading'}
		<div class="card bg-base-100 shadow">
			<div class="card-body gap-3">
				<div class="skeleton h-4 w-48"></div>
				<div class="skeleton h-4 w-full"></div>
				<div class="skeleton h-4 w-3/4"></div>
			</div>
		</div>
	{/if}

	<!-- Results -->
	{#if status === 'done'}
		{#if totalIssues === 0}
			<div class="alert alert-success">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span><strong>All clear!</strong> No errors or warnings found in the ledger.</span>
			</div>
		{:else}
			<!-- Errors -->
			{#if errors.length > 0}
				<section class="card bg-base-100 shadow">
					<div class="card-body p-4">
						<h2 class="card-title text-error">
							Errors
							<span class="badge badge-error badge-sm">{errors.length}</span>
						</h2>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th class="w-20">Line</th>
										<th class="w-20">Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each errors as err}
										<tr class="text-error">
											<td class="font-mono">{err.line}</td>
											<td class="font-mono">{err.column}</td>
											<td>{err.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</section>
			{/if}

			<!-- Warnings -->
			{#if warnings.length > 0}
				<section class="card bg-base-100 shadow">
					<div class="card-body p-4">
						<h2 class="card-title text-warning">
							Warnings
							<span class="badge badge-warning badge-sm">{warnings.length}</span>
						</h2>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th class="w-20">Line</th>
										<th class="w-20">Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each warnings as warn}
										<tr class="text-warning">
											<td class="font-mono">{warn.line}</td>
											<td class="font-mono">{warn.column}</td>
											<td>{warn.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</section>
			{/if}
		{/if}
	{/if}
</main>
