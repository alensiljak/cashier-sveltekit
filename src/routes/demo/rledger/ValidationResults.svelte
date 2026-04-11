<script lang="ts">
	import type { BeancountError } from '@rustledger/wasm';
	import ErrorTable from './ErrorTable.svelte';

	type Props = {
		validationErrors: BeancountError[];
		validationWarnings: BeancountError[];
		isValid: boolean;
		hasValidated: boolean;
	};
	let { validationErrors, validationWarnings, isValid, hasValidated }: Props = $props();
</script>

{#if hasValidated && validationErrors.length === 0 && validationWarnings.length === 0}
	<div class="alert alert-success">
		<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
		</svg>
		<span>
			<strong>Validation Successful!</strong> The Beancount source is valid with no errors or warnings.
		</span>
	</div>
{:else if !hasValidated}
	<p class="text-base-content/50">No validation results yet. Click "Validate" to check the Beancount source.</p>
{:else}
	<!-- Overall Status -->
	<div class="mb-4">
		<div class="alert {isValid ? 'alert-success' : 'alert-error'}">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="{isValid ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'}" />
			</svg>
			<span>
				<strong>{isValid ? 'Valid' : 'Invalid'}</strong>
				- {validationErrors.length} error(s), {validationWarnings.length} warning(s)
			</span>
		</div>
	</div>

	<ErrorTable errors={validationErrors} title="Errors" variant="error" />
	<ErrorTable errors={validationWarnings} title="Warnings" variant="warning" />
{/if}
