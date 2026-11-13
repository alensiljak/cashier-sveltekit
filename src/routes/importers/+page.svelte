<script lang="ts">
	import { onMount } from 'svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { goto } from '$app/navigation';
	import { allRules, type RuleConfig } from '#lib/importers/rules';
	import { listImporters } from '#lib/importers';
	import IbkrConfigForm from '#lib/importers/ibkr/IbkrConfigForm.svelte';
	import type { IbkrConfig } from '#lib/importers/ibkr/config';
	import { savePendingImport } from '#lib/importers/pendingImport';
	import {
		loadImporterConfig,
		resetImporterConfig,
		saveImporterConfig
	} from '#lib/importers/config';

	const importers = listImporters();

	/** Saved config per importer id; absent means not configured. */
	let configs = $state<Record<string, unknown>>({});
	let editingId = $state<string | null>(null);
	let editorText = $state('');
	let error = $state('');

	/** Importers with a form editor; the others are edited as JSON. */
	const FORM_IMPORTERS = ['ibkr'];
	let jsonMode = $state(false);
	/** Bumped to remount the form after the text changed from outside it (defaults, JSON). */
	let formKey = $state(0);

	// The edit in progress survives a page reload (e.g. the dev server reloading after a code change).
	const DRAFT_KEY = 'cashier.importers.draft';
	function saveDraft() {
		try {
			if (editingId)
				sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ editingId, editorText, jsonMode }));
			else sessionStorage.removeItem(DRAFT_KEY);
		} catch {
			// Storage unavailable: the draft is simply not kept.
		}
	}
	$effect(() => {
		// Track the edit state, then store it.
		void [editingId, editorText, jsonMode];
		saveDraft();
	});

	onMount(async () => {
		for (const importer of importers) {
			const config = await loadImporterConfig<unknown>(importer.id);
			if (config !== null) configs[importer.id] = config;
		}
		try {
			const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
			if (draft && importers.some((i) => i.id === draft.editingId)) {
				editingId = draft.editingId;
				editorText = draft.editorText;
				jsonMode = draft.jsonMode;
			}
		} catch {
			// No usable draft.
		}
	});

	function edit(id: string, fallback: unknown) {
		editingId = id;
		editorText = JSON.stringify(configs[id] ?? fallback, null, 2);
		jsonMode = !FORM_IMPORTERS.includes(id);
		error = '';
	}

	/** The config in the editor, or undefined if the text is not valid JSON. */
	function draftConfig<T>(): T | undefined {
		try {
			return JSON.parse(editorText) as T;
		} catch {
			return undefined;
		}
	}

	function showForm() {
		if (draftConfig() === undefined) {
			error = 'The JSON is not valid; fix it before switching to the form.';
			return;
		}
		error = '';
		formKey++;
		jsonMode = false;
	}

	async function save(id: string) {
		try {
			const parsed = JSON.parse(editorText);
			await saveImporterConfig(id, parsed);
			configs[id] = parsed;
			editingId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	let fileInput: HTMLInputElement;
	let pickingFor: string | null = null;

	function pickFile(id: string) {
		pickingFor = id;
		fileInput.click();
	}

	async function onFileSelected() {
		const file = fileInput.files?.[0];
		const id = pickingFor;
		// Allow picking the same file again later.
		fileInput.value = '';
		if (!file || !id) return;
		savePendingImport({ importerId: id, fileName: file.name, text: await file.text() });
		await goto('/importers/review');
	}

	let resetId = $state<string | null>(null);
	let confirmReset = $state(false);

	function askReset(id: string) {
		resetId = id;
		confirmReset = true;
	}

	async function reset() {
		const id = resetId;
		if (!id) return;
		await resetImporterConfig(id);
		delete configs[id];
		if (editingId === id) editingId = null;
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Importers">
		{#snippet actions()}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<input
		type="file"
		accept=".csv,text/csv,.xml,text/xml,application/xml"
		class="hidden"
		bind:this={fileInput}
		onchange={onFileSelected}
	/>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		<p class="text-sm opacity-70">
			Bank statement formats Cashier can import. The format is recognised from the file's content.
		</p>

		{#each importers as importer (importer.id)}
			{@const configured = importer.id in configs}
			<div class="card bg-base-200">
				<div class="card-body p-4 gap-3">
					{#if editingId === importer.id}
						<div class="flex items-center justify-between gap-2">
							<span class="font-medium">{importer.name}</span>
							{#if FORM_IMPORTERS.includes(importer.id)}
								<div class="join">
									<button
										class="btn btn-xs join-item"
										class:btn-active={!jsonMode}
										onclick={showForm}>Form</button
									>
									<button
										class="btn btn-xs join-item"
										class:btn-active={jsonMode}
										onclick={() => (jsonMode = true)}>JSON</button
									>
								</div>
							{/if}
						</div>
						{#if !jsonMode && importer.id === 'ibkr'}
							{#key formKey}
								<IbkrConfigForm
									value={draftConfig<IbkrConfig>() ?? importer.defaultConfig}
									onchange={(c) => (editorText = JSON.stringify(c, null, 2))}
								/>
							{/key}
						{:else}
							<textarea
								class="textarea textarea-bordered w-full font-mono text-xs h-72"
								bind:value={editorText}
								spellcheck="false"></textarea>
						{/if}
						{#if error}<p class="text-error text-sm">{error}</p>{/if}
						<div class="flex gap-2 flex-wrap">
							<button class="btn btn-primary btn-sm" onclick={() => save(importer.id)}>Save</button>
							<button class="btn btn-sm" onclick={() => (editingId = null)}>Cancel</button>
							<button
								class="btn btn-ghost btn-sm"
								onclick={() => {
									editorText = JSON.stringify(importer.defaultConfig, null, 2);
									formKey++;
								}}
							>
								Load defaults
							</button>
							{#if importer.id in configs}
								<button
									class="btn btn-ghost btn-sm text-error ml-auto"
									onclick={() => askReset(importer.id)}
								>
									Reset
								</button>
							{/if}
						</div>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<div class="flex min-w-0 flex-col gap-3">
								<span class="font-medium">{importer.name}</span>
								<div class="flex flex-wrap items-center gap-2">
									<button
										class="btn btn-sm"
										onclick={() => edit(importer.id, importer.defaultConfig)}
									>
										{configured ? 'Edit' : 'Configure'}
									</button>
									{#if configured}
										{#if importer.usesRules}
											<a class="btn btn-sm" href="/importers/rules?importer={importer.id}">
												Rules ({allRules(configs[importer.id] as RuleConfig).length})
											</a>
										{/if}
									{/if}
								</div>
							</div>
							{#if configured}
								<button class="btn btn-primary shrink-0" onclick={() => pickFile(importer.id)}>
									Import file
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</main>

<ConfirmDialog
	bind:open={confirmReset}
	title="Confirm Reset"
	message="Do you want to reset {importers.find((i) => i.id === resetId)?.name ??
		'this importer'}? Its saved configuration, including its rules, will be deleted."
	onconfirm={reset}
/>
