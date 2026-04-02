<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import OpfsTreeView from '$lib/components/OpfsTreeView.svelte';
</script>

<main class="flex flex-col gap-4">
	<Toolbar title="Book" />
	<div class="flex-1 overflow-y-auto px-1">
		<p>Here we select the files to include in the book.</p>

		<!-- treeview of OPFS files -->
		<OpfsTreeView />

		<p>Incomplete...</p>
	</div>
</main>
