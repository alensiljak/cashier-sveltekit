<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';
	import { PLACEHOLDER_ACCOUNT } from '$lib/utils/xactUtils';
	import { getImporter } from '$lib/importers';
	import { trackOrigin } from '$lib/importers/navigation';
	import { loadImporterConfig, saveImporterConfig } from '$lib/importers/config';
	import { loadPendingImport } from '$lib/importers/pendingImport';
	import {
		allRules,
		countMatches,
		escapeRegex,
		isValidPattern,
		replaceRule,
		withRule,
		type Rule,
		type RuleConfig
	} from '$lib/importers/rules';
	import type { ImportedXact, Importer } from '$lib/importers/types';

	/** Opened from the import review (with a row to show) or from the rules list (edit only, no row). */
	const hasRow = page.url.searchParams.has('row');
	const rowIndex = Number(page.url.searchParams.get('row'));
	const importerParam = page.url.searchParams.get('importer');
	/** A blank rule, from the Add button on the rules list. */
	const isNew = page.url.searchParams.has('new');
	/** Position of the rule being edited; null when creating a new one. */
	const ruleParam = page.url.searchParams.get('rule');
	const ruleIndex = ruleParam === null ? null : Number(ruleParam);
	const editing = ruleIndex !== null;

	let importer = $state<Importer<any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
	let config = $state<RuleConfig | null>(null);
	let imported = $state<ImportedXact[]>([]);
	let form = $state({ match: '', payee: '', account: '', disabled: false });
	let accounts = $state<string[]>([]);
	let saving = $state(false);
	let ready = $state(false);
	/** Where Save, Delete and Cancel return to. */
	let backTo = $state('/importers');
	const returnTo = trackOrigin();

	let row = $derived(hasRow ? imported[rowIndex] : undefined);
	let affectedRows = $derived(
		countMatches(
			form.match,
			imported.map((r) => r.matchText)
		)
	);
	let valid = $derived(
		isValidPattern(form.match) && (form.payee.trim() !== '' || form.account !== '')
	);

	onMount(async () => {
		const pending = loadPendingImport();
		const found = getImporter(importerParam ?? pending?.importerId ?? '');
		const saved = found ? await loadImporterConfig<RuleConfig>(found.id) : null;
		// A file waiting for review lets the page show how many of its rows a pattern hits.
		const rows =
			pending && found && saved && pending.importerId === found.id
				? found.extract(pending.text, saved)
				: [];
		const target = hasRow ? rows[rowIndex] : undefined;
		const existing = editing && saved ? allRules(saved)[ruleIndex] : undefined;
		if (
			!found ||
			!saved ||
			(hasRow && !target) ||
			(editing && !existing) ||
			(!hasRow && !editing && !isNew)
		) {
			// Nothing to edit, e.g. the review was already accepted or cancelled.
			await goto('/importers', { replaceState: true });
			return;
		}

		importer = found;
		config = saved;
		imported = rows;
		backTo = hasRow ? '/importers/review' : `/importers/rules?importer=${found.id}`;
		if (existing) {
			form = {
				match: existing.match,
				payee: existing.payee ?? '',
				account: existing.account ?? '',
				disabled: !!existing.disabled
			};
		} else if (target) {
			const bankAccount = found.account(saved);
			const counter = target.xact.postings.find((p) => p.account !== bankAccount)?.account ?? '';
			form = {
				match: escapeRegex(target.matchText[0] ?? ''),
				payee: target.xact.payee ?? '',
				account: counter && counter !== PLACEHOLDER_ACCOUNT ? counter : '',
				disabled: false
			};
		}

		ready = true;

		try {
			accounts = (await fullLedgerService.getAllAccounts()).map((a) => a.name).sort();
		} catch {
			Notifier.warning('Could not load the account list. Is the ledger loaded?');
		}
	});

	async function save() {
		if (!importer || !config || !valid) return;
		const rule: Rule = { match: form.match };
		if (form.payee.trim()) rule.payee = form.payee.trim();
		if (form.account) rule.account = form.account;
		if (form.disabled) rule.disabled = true;
		await store(editing ? replaceRule(config, ruleIndex, rule) : withRule(config, rule));
	}

	async function remove() {
		if (!importer || !config || !editing) return;
		await store(replaceRule(config, ruleIndex, null));
	}

	let confirmDelete = $state(false);

	/** Saves the config and returns to where the user came from, which then reflects the change. */
	async function store(next: RuleConfig) {
		if (!importer) return;
		saving = true;
		try {
			await saveImporterConfig(importer.id, next);
			await returnTo(backTo);
		} catch (e) {
			Notifier.error(`Could not save the rule: ${e instanceof Error ? e.message : e}`);
			saving = false;
		}
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={editing ? `Edit rule #${ruleIndex + 1}` : 'New rule'}>
		{#snippet actions()}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	{#if ready}
		<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
			{#if row}
				<div class="rounded-box bg-base-200 p-3">
					<JournalXactRow xact={row.xact} linksEnabled={false} />
					<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-6 text-xs">
						{#each row.details as [label, value] (label)}
							<dt class="opacity-60">{label}</dt>
							<dd class="break-words">{value}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			<label class="flex flex-col gap-1">
				<span class="text-sm">When the payee or reference matches</span>
				<input
					type="text"
					class="input input-bordered w-full font-mono text-sm"
					class:input-error={form.match !== '' && !isValidPattern(form.match)}
					bind:value={form.match}
					spellcheck="false"
				/>
				<span class="text-xs opacity-70">
					Case-insensitive regex. Shorten it to cover more, e.g. <code>hofer</code>.
					{#if imported.length > 0}Matches {affectedRows} of {imported.length} rows in the file being
						imported.{/if}
				</span>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm">Set the payee to</span>
				<input type="text" class="input input-bordered w-full" bind:value={form.payee} />
			</label>

			<div class="flex flex-col gap-1">
				<span class="text-sm">Set the account to</span>
				<div class="flex gap-2 items-center">
					<SearchableSelect options={accounts} bind:value={form.account} placeholder="No change" />
					{#if form.account}
						<button class="btn btn-ghost btn-sm" onclick={() => (form.account = '')}>Clear</button>
					{/if}
				</div>
			</div>

			{#if editing}
				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input
						type="checkbox"
						class="toggle toggle-primary toggle-sm bg-transparent bg-none"
						bind:checked={form.disabled}
					/>
					Disabled (keep the rule but ignore it)
				</label>
			{:else}
				<p class="text-xs opacity-70">
					New rules go to the top of the list and win over older ones.
				</p>
			{/if}
		</div>

		<div class="flex gap-2 p-4 border-t border-base-300">
			{#if editing}
				<button
					class="btn btn-ghost text-error"
					disabled={saving}
					onclick={() => (confirmDelete = true)}>Delete</button
				>
			{/if}
			<span class="flex-1"></span>
			<button class="btn" disabled={saving} onclick={() => returnTo(backTo)}>Cancel</button>
			<button class="btn btn-primary" disabled={!valid || saving} onclick={save}>Save rule</button>
		</div>
	{/if}
</main>

<ConfirmDialog
	bind:open={confirmDelete}
	title="Confirm Delete"
	message="Do you want to delete rule #{(ruleIndex ?? 0) + 1} &quot;{form.match}&quot;?"
	onconfirm={remove}
/>
