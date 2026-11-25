<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { loadCredentials } from '#lib/importers/enablebanking/auth';
	import { EnableBankingClient } from '#lib/importers/enablebanking/api';
	import {
		addSession,
		clearPendingAuth,
		findPendingAuth
	} from '#lib/importers/enablebanking/sessions';

	/**
	 * Redirect target of the Enable Banking consent flow: the bank sends the
	 * user back here with ?code=…&state=… (or ?error=…). The code is exchanged
	 * for a session (POST /sessions) and the session is stored device-only;
	 * then the user lands on the operations page.
	 */
	let status = $state<'working' | 'done' | 'error'>('working');
	let message = $state('Completing the bank connection…');

	onMount(async () => {
		const params = page.url.searchParams;
		const state = params.get('state');
		const pending = await findPendingAuth(state);
		const errorParam = params.get('error');
		if (errorParam) {
			const description = params.get('error_description');
			status = 'error';
			message = `Enable Banking returned an error: ${errorParam}${description ? ` — ${description}` : ''}`;
			// Only a redirect carrying the right state ends the pending connection.
			if (pending) await clearPendingAuth(pending.state);
			return;
		}
		const code = params.get('code');
		const credentials = await loadCredentials();
		if (!pending || !credentials || !code) {
			status = 'error';
			message =
				'No pending bank connection on this device matches this redirect (it may have expired) — start it from the Importers page.';
			return;
		}
		try {
			const client = new EnableBankingClient({ credentials });
			const session = await client.authorizeSession(code);
			await addSession({
				sessionId: session.session_id,
				aspsp: pending.aspsp,
				createdAt: new Date().toISOString(),
				validUntil: session.access?.valid_until ?? pending.validUntil,
				requiredPsuHeaders: pending.requiredPsuHeaders,
				accounts: session.accounts ?? []
			});
			await clearPendingAuth(pending.state);
			status = 'done';
			await goto('/importers/enable-banking', { replaceState: true });
		} catch (e) {
			status = 'error';
			message = e instanceof Error ? e.message : String(e);
			await clearPendingAuth(pending.state);
		}
	});
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Enable Banking — connecting bank">
		{#snippet actions()}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if status === 'working'}
			<div class="flex items-center gap-2 text-sm opacity-70">
				<span class="loading loading-spinner loading-sm"></span>
				<span>{message}</span>
			</div>
		{:else}
			<div class="alert {status === 'error' ? 'alert-error' : 'alert-success'} text-sm">
				{message}
			</div>
			<a class="btn btn-sm self-start" href="/importers/enable-banking">Go to Enable Banking</a>
		{/if}
	</div>
</main>
