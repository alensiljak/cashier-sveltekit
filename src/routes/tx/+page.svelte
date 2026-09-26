<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check, ShieldCheck, TriangleAlertIcon } from '@lucide/svelte';
	import { xact, xactId } from '$lib/data/mainStore';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import { createParsedLedger, ensureInitialized } from '$lib/services/rustledger';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import { xactToBeancountText } from '$lib/utils/xactUtils';
	import { base } from '$app/paths';
	import TransactionEditor from '$lib/components/XactEditor.svelte';
	import { Xact } from '$lib/data/model';
	import type { StoredXact } from '$lib/storage/xactStore';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import type { ValidationIssue } from '$lib/data/validation';

	Notifier.init();

	// Arrived here directly (e.g. a nav link) without a transaction staged —
	// start a new one instead of leaving the editor with an undefined $xact.
	if (!get(xact)) {
		xact.set(Xact.create());
		xactId.set(undefined);
	}

	let previousUrl: URL | null = null;
	let isSaving = $state(false);

	let validationIssues = $state<ValidationIssue[]>([]);
	let hasValidationError = $derived(validationIssues.some((i) => i.kind === 'error'));
	// oxlint-disable-next-line no-unassigned-vars
	let validationDialog: HTMLDialogElement | undefined;

	// Live validation runs continuously as the user edits (see XactEditor); this just
	// keeps the toolbar indicator in sync without popping the dialog open.
	function onLiveValidationChange(issues: ValidationIssue[]) {
		validationIssues = issues;
	}

	afterNavigate(({ from }) => {
		if (from?.url) previousUrl = from.url;
	});

	async function onFab() {
		if (isSaving) return;
		isSaving = true;
		try {
			await saveXact();
		} catch (e: any) {
			Notifier.error(e.message);
			isSaving = false;
		}
	}

	/**
	 * Refresh `xact`/`xactId` from the saved transaction (the store may have
	 * re-sorted, so the old ID can be stale) — keeps pages like xact-actions,
	 * which gate Edit/Delete on `$xactId`, working after returning from a save.
	 */
	function refreshXact(stored: StoredXact) {
		xact.set(stored.xact);
		xactId.set(stored.id);
	}

	async function saveXact() {
		const clonedXact = JSON.parse(JSON.stringify($xact));
		const defaultCurrency = await appService.getDefaultCurrency();
		const beancountText = xactToBeancountText(clonedXact, defaultCurrency);
		const id = get(xactId);

		if (id !== undefined) {
			const stored = await (await getXactStore()).update(id, beancountText);
			refreshXact(stored);
			// Re-parse the full book in the background.
			void reloadLedgerFromOpfs();
			// If we came from the detail page, navigate back with the refreshed ID —
			// the store may have re-sorted, so the old ID is stale.
			if (previousUrl?.pathname.endsWith('/tx/detail')) {
				await goto(`/tx/detail?${new URLSearchParams({ id: stored.id })}`);
			} else {
				history.back();
			}
		} else {
			await (await getXactStore()).append(beancountText);
			xactId.set(undefined);
			// Re-parse the full book in the background.
			void reloadLedgerFromOpfs();
			history.back();
		}
	}

	function checkBalance(tx: Xact): ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		const byCurrency: Record<string, number[]> = {};
		let hasAutoBalance = false;

		for (const p of tx.postings) {
			if (!p.account) continue;
			if (p.amount != null && p.currency) {
				if (!byCurrency[p.currency]) byCurrency[p.currency] = [];
				byCurrency[p.currency].push(p.amount);
			} else if (p.amount == null) {
				hasAutoBalance = true;
			}
		}

		for (const [currency, amounts] of Object.entries(byCurrency)) {
			const sum = amounts.reduce((a, b) => a + b, 0);
			if (Math.abs(sum) > 0.005 && !hasAutoBalance) {
				const sign = sum > 0 ? '+' : '';
				issues.push({
					kind: 'error',
					message: `Postings for ${currency} don't balance: sum is ${sign}${sum.toFixed(2)} ${currency}`
				});
			}
		}

		return issues;
	}

	async function validateXact() {
		const tx = get(xact);
		if (!tx) return;

		const issues: ValidationIssue[] = [];

		// 1. Check for missing accounts
		const missingCount = tx.postings.filter((p) => !p.account).length;
		if (missingCount > 0) {
			issues.push({ kind: 'error', message: `${missingCount} posting(s) have no account set` });
		}

		// 2. Balance check per currency
		issues.push(...checkBalance(tx));

		// 3. WASM parse check — syntax only, no open directives needed so no false positives.
		// Skip when no posting has an amount yet: with nothing to anchor on, booking can
		// only fail interpolation (e.g. "cannot infer currency") — noise for a transaction
		// the user hasn't finished filling in, not a real syntax problem.
		const hasAnyAmount = tx.postings.some((p) => p.amount != null);
		if (hasAnyAmount) {
			try {
				await ensureInitialized();
				const defaultCurrency = await appService.getDefaultCurrency();
				const beancountText = xactToBeancountText(JSON.parse(JSON.stringify(tx)), defaultCurrency);
				const tempLedger = createParsedLedger(beancountText);
				if (tempLedger) {
					try {
						for (const err of tempLedger.getParseErrors()) {
							issues.push({
								kind: err.severity === 'error' ? 'error' : 'warning',
								message: String(err.message ?? err)
							});
						}
					} finally {
						tempLedger.free();
					}
				}
			} catch (e: any) {
				issues.push({ kind: 'warning', message: `WASM parse check unavailable: ${e.message}` });
			}
		}

		// 4. Account existence check against full ledger (best-effort, only if already loaded)
		if (fullLedgerService.isLoaded) {
			try {
				const knownAccounts = new Set(
					(await fullLedgerService.getAllAccounts()).map((a) => a.name)
				);
				for (const p of tx.postings) {
					if (p.account && !knownAccounts.has(p.account)) {
						issues.push({
							kind: 'warning',
							message: `Account "${p.account}" not found in full ledger`
						});
					}
				}
			} catch {
				// best-effort
			}
		}

		validationIssues = issues;
		validationDialog?.showModal();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Journal Entry">
		{#snippet actions()}
			{#if validationIssues.length > 0}
				<button
					type="button"
					class="btn btn-circle btn-sm border-0 shadow-none {hasValidationError
						? 'bg-error text-warning'
						: 'bg-warning text-warning-content'}"
					title={hasValidationError ? 'Errors found — tap to view' : 'Warnings found — tap to view'}
					onclick={() => validationDialog?.showModal()}
				>
					<TriangleAlertIcon size={18} strokeWidth={2.5} />
				</button>
			{/if}
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Validate" Icon={ShieldCheck} onclick={validateXact} />
			<ToolbarMenuItem text="Save" />
			<ToolbarMenuItem text="Reset" />
			<HelpButton topic="transaction-editor" variant="menu-item" />
		{/snippet}
	</Toolbar>

	<section class="container mx-auto flex-1 overflow-y-auto touch-pan-y lg:max-w-screen-sm">
		<Fab Icon={Check} onclick={onFab} disabled={isSaving} />

		<!-- tx editor -->
		<TransactionEditor
			onValidationChange={onLiveValidationChange}
			onShowIssues={() => validationDialog?.showModal()}
		/>

		<!-- dialog for confirming reset -->

		<!-- validation results dialog -->
		<dialog bind:this={validationDialog} class="modal">
			<div class="modal-box">
				<h3 class="font-bold text-lg mb-4">Validation Results</h3>
				{#if validationIssues.length === 0}
					<div class="alert alert-success">
						<span>Transaction is valid — no issues found</span>
					</div>
				{:else}
					<ul class="space-y-2">
						{#each validationIssues as issue}
							<li class="alert {issue.kind === 'error' ? 'alert-error' : 'alert-warning'} py-2">
								<span>{issue.message}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="modal-action">
					<button class="btn" onclick={() => validationDialog?.close()}>Close</button>
				</div>
			</div>
			<form method="dialog" class="modal-backdrop">
				<button>close</button>
			</form>
		</dialog>
	</section>
</main>
