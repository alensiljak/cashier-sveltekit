<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
</script>

<article>
	<Toolbar title="Reports" />

	<div class="flex-1 overflow-y-auto px-1">
		<div class="mx-auto flex w-350 max-w-[350px] flex-col gap-6 px-4 pt-4 sm:px-6">
			<a href="/reports/query" class="btn btn-primary">
				Queries
			</a>
			<a href="/reports/tx-search" class="btn btn-primary">
				Transaction Search
			</a>
			<a href="/reports/expenses" class="btn btn-primary">
				Expenses
			</a>
		</div>
	</div>
</article>
