<script lang="ts">
	import type { BeancountError } from '@rustledger/wasm';

	type Props = {
		errors: BeancountError[];
		title?: string;
		variant?: 'error' | 'warning';
	};
	let { errors, title, variant = 'error' }: Props = $props();

	let textClass = $derived(variant === 'error' ? 'text-error' : 'text-warning');
</script>

{#if errors.length > 0}
	<div class="mb-4">
		{#if title}
			<h3 class="text-lg font-bold {textClass}">{title} ({errors.length})</h3>
		{/if}
		<div class="overflow-x-auto">
			<table class="table table-zebra table-sm">
				<thead>
					<tr>
						<th>Line</th>
						<th>Column</th>
						<th>Message</th>
					</tr>
				</thead>
				<tbody>
					{#each errors as err}
						<tr class={textClass}>
							<td>{err.line}</td>
							<td>{err.column}</td>
							<td>{err.message}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
