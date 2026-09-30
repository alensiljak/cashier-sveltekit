<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';
	import { PLACEHOLDER_ACCOUNT } from '$lib/utils/xactUtils';
	import { getImporter } from '$lib/importers';
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

	const rowIndex = Number(page.url.searchParams.get('row'));
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

	let row = $derived(imported[rowIndex]);
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
		const found = pending ? getImporter(pending.importerId) : undefined;
		const saved = found ? await loadImporterConfig<RuleConfig>(found.id) : null;
		const rows = pending && found && saved ? found.extract(pending.text, saved) : [];
		const target = rows[rowIndex];
		const existing = editing && saved ? allRules(saved)[ruleIndex] : undefined;
		if (!found || !saved || !target || (editing && !existing)) {
			// Nothing to attach a rule to, e.g. the review was already accepted or cancelled.
			await goto('/importers', { replaceState: true });
			return;
		}

		importer = found;
		config = saved;
		imported = rows;
		if (existing) {
			form = {
				match: existing.match,
				payee: existing.payee ?? '',
				account: existing.account ?? '',
				disabled: !!existing.disabled
			};
		} else {
			const bankAccount = found.account(saved);
			const counter = target.xact.postings.find((p) => p.account !== bankAccount)?.account ?? '';
			form = {
				match: escapeRegex(target.matchText[0] ?? ''),
				payee: target.xact.payee ?? '',
				account: counter && counter !== PLACEHOLDER_ACCOUNT ? counter : '',
				disabled: false
			};
		}

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
		if (!confirm(`Delete rule #${ruleIndex + 1}?`)) return;
		await store(replaceRule(config, ruleIndex, null));
	}

	/** Saves the config and returns to the review, which then reapplies the rules. */
	async function store(next: RuleConfig) {
		if (!importer) return;
		saving = true;
		try {
			await saveImporterConfig(importer.id, next);
			await goto('/importers/review');
		} catch (e) {
			Notifier.error(`Could not save the rule: ${e instanceof Error ? e.message : e}`);
			saving = false;
		}
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={editing ? `Edit rule #${ruleIndex + 1}` : 'New rule'} />

	{#if row}
		<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
			<div class="rounded-box bg-base-200 p-3">
				<JournalXactRow xact={row.xact} linksEnabled={false} />
				<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-6 text-xs">
					{#each row.details as [label, value] (label)}
						<dt class="opacity-60">{label}</dt>
						<dd class="break-words">{value}</dd>
					{/each}
				</dl>
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-sm">When the partner name or reference matches</span>
				<input
					type="text"
					class="input input-bordered w-full font-mono text-sm"
					class:input-error={form.match !== '' && !isValidPattern(form.match)}
					bind:value={form.match}
					spellcheck="false"
				/>
				<span class="text-xs opacity-70">
					Case-insensitive regex. Shorten it to cover more, e.g. <code>hofer</code>. Matches
					{affectedRows} of {imported.length} rows in this file.
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
				<button class="btn btn-ghost text-error" disabled={saving} onclick={remove}>Delete</button>
			{/if}
			<span class="flex-1"></span>
			<button class="btn" disabled={saving} onclick={() => goto('/importers/review')}>Cancel</button
			>
			<button class="btn btn-primary" disabled={!valid || saving} onclick={save}>Save rule</button>
		</div>
	{/if}
</main>
