<script lang="ts">
	import type { Directive, ParsedLedger } from '@rustledger/wasm';
	import { formatDirectiveSummary } from '$lib/rledger/rledgerPageService';

	type Props = {
		directives: Directive[];
		parsedLedger: ParsedLedger | null;
		onEdit?: (index: number) => void;
	};
	let { directives, parsedLedger, onEdit }: Props = $props();
</script>

{#if !parsedLedger}
	<p class="text-base-content/50">No parsed ledger yet. Click "Parse" to load directives.</p>
{:else if directives.length === 0}
	<p class="text-base-content/50">No directives found in the parse result.</p>
{:else}
	<div class="overflow-x-auto overflow-y-auto max-h-[400px]">
		<table class="table table-zebra table-sm">
			<thead>
				<tr>
					<th>#</th>
					<th>Date</th>
					<th>Type</th>
					<th>Summary</th>
					{#if onEdit}
						<th></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each directives as directive, idx}
					<tr>
						<td>{idx + 1}</td>
						<td>{directive.date}</td>
						<td><span class="badge badge-outline">{directive.type}</span></td>
						<td class="font-mono text-xs">{formatDirectiveSummary(directive)}</td>
						{#if onEdit && directive.type === 'transaction'}
							<td>
								<button
									class="btn btn-xs btn-ghost"
									onclick={() => onEdit(idx)}
								>
									Edit
								</button>
							</td>
						{:else if onEdit}
							<td></td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
