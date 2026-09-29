<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { getImporter } from '$lib/importers';
	import { loadImporterConfig } from '$lib/importers/config';
	import { takePendingImport } from '$lib/importers/pendingImport';
	import ImportReview from '$lib/importers/ImportReview.svelte';

	type Session = {
		importer: NonNullable<ReturnType<typeof getImporter>>;
		config: unknown;
		file: File;
	};
	let session = $state<Session | null>(null);

	onMount(async () => {
		const pending = takePendingImport();
		const importer = pending ? getImporter(pending.importerId) : undefined;
		const config = importer ? await loadImporterConfig<unknown>(importer.id) : null;
		if (!pending || !importer || !config) {
			// Nothing to review, e.g. the page was reloaded.
			await goto('/importers', { replaceState: true });
			return;
		}
		session = { importer, config, file: pending.file };
	});
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={session ? `Import: ${session.importer.name}` : 'Import'} />

	{#if session}
		<ImportReview
			importer={session.importer}
			config={session.config}
			file={session.file}
			oncancel={() => goto('/importers')}
		/>
	{/if}
</main>
