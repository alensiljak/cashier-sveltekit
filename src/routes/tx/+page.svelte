<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check, ShieldCheck } from '@lucide/svelte';
	import { xact, xactSpan } from '$lib/data/mainStore';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Notifier from '$lib/utils/notifier';
	import ledgerService from '$lib/services/ledgerService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { xactToBeancountText } from '$lib/utils/xactUtils';
	import { base } from '$app/paths';
	import TransactionEditor from '$lib/components/XactEditor.svelte';
	import { Xact } from '$lib/data/model';
	import HelpButton from '$lib/help/HelpButton.svelte';

	Notifier.init();

	// Arrived here directly (e.g. a nav link) without a transaction staged —
	// start a new one instead of leaving the editor with an undefined $xact.
	if (!get(xact)) {
		xact.set(Xact.create());
		xactSpan.set(undefined);
	}

	let previousPage: string = base;

	interface ValidationIssue {
		kind: 'error' | 'warning';
		message: string;
	}
	let validationIssues: ValidationIssue[] = [];
	// oxlint-disable-next-line no-unassigned-vars
	let validationDialog: HTMLDialogElement | undefined;

	afterNavigate(({ from }) => {
		previousPage = from?.url?.pathname || previousPage;
	});

	async function onFab() {
		try {
			await saveXact();
		} catch (e: any) {
			Notifier.error(e.message);
		}
	}

	async function saveXact() {
		const clonedXact = JSON.parse(JSON.stringify($xact));
		const beancountText = xactToBeancountText(clonedXact);
		const span = get(xactSpan);

		if (span) {
			await ledgerService.editTransaction(span, beancountText);
		} else {
			await ledgerService.appendTransaction(beancountText);
		}
		xactSpan.set(undefined);

		// Re-parse the full book in the background — cards show a loading indicator.
		fullLedgerService.invalidate();

		history.back();
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

		// 3. WASM parse check — syntax only, no open directives needed so no false positives
		try {
			await ledgerService.ensureInitialized();
			const beancountText = xactToBeancountText(JSON.parse(JSON.stringify(tx)));
			const tempLedger = ledgerService.createParsedLedger(beancountText);
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
			<HelpButton topic="transaction-editor" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Validate" Icon={ShieldCheck} onclick={validateXact} />
			<ToolbarMenuItem text="Save" />
			<ToolbarMenuItem text="Reset" />
		{/snippet}
	</Toolbar>

	<section class="container mx-auto flex-1 overflow-y-auto touch-pan-y lg:max-w-screen-sm">
		<Fab Icon={Check} onclick={onFab} />

		<!-- tx editor -->
		<TransactionEditor />

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
