<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { getImporter } from '#lib/importers';
	import { trackOrigin } from '#lib/importers/navigation';
	import { loadImporterConfig } from '#lib/importers/config';
	import { clearPendingImport, loadPendingImport } from '#lib/importers/pendingImport';
	import ImportReview from '#lib/importers/ImportReview.svelte';

	type Session = {
		importer: NonNullable<ReturnType<typeof getImporter>>;
		config: unknown;
		fileName: string;
		text: string;
	};
	let session = $state<Session | null>(null);

	onMount(async () => {
		const pending = loadPendingImport();
		const importer = pending ? getImporter(pending.importerId) : undefined;
		const config = importer ? await loadImporterConfig<unknown>(importer.id) : null;
		if (!pending || !importer || !config) {
			// Nothing to review, e.g. it was already accepted or cancelled.
			await goto('/importers', { replaceState: true });
			return;
		}
		session = { importer, config, fileName: pending.fileName, text: pending.text };
	});

	const returnTo = trackOrigin();

	async function cancel() {
		clearPendingImport();
		await returnTo('/importers');
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={session ? `Import: ${session.importer.name}` : 'Import'}>
		{#snippet actions()}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	{#if session}
		<ImportReview
			importer={session.importer}
			config={session.config}
			fileName={session.fileName}
			text={session.text}
			oncancel={cancel}
		/>
	{/if}
</main>
