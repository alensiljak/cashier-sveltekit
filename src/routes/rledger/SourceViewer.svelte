<script lang="ts">
	type Props = {
		source: string;
		infrastructureLength: number;
		transactionLength: number;
	};
	let { source, infrastructureLength, transactionLength }: Props = $props();

	let sourceContainer: HTMLDivElement;
	let sourceLines = $derived(source ? source.split('\n') : []);
</script>

<p class="text-sm text-base-content/70">
	Combined infrastructure (book.bean) and transactions. This is what gets validated and parsed.
</p>

<div class="form-control mt-4">
	<div class="border border-base-300 rounded-lg overflow-hidden bg-base-200 font-mono text-sm">
		<div class="h-96 overflow-auto p-4" bind:this={sourceContainer}>
			{#each sourceLines as line, i}
				<div class="flex">
					<div class="flex-shrink-0 bg-base-300 text-base-content/50 text-right select-none px-3 py-1 border-r border-base-300 min-w-[3rem] leading-relaxed">
						{i + 1}
					</div>
					<div class="flex-1 px-4 py-1 whitespace-pre leading-relaxed">
						{line}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
<div class="mt-2 text-sm text-base-content/50">
	Infrastructure: {infrastructureLength} chars | Transactions: {transactionLength} chars | Total: {source.length} chars
</div>
