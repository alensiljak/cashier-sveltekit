<script lang="ts">
	import { useRegisterSW } from 'virtual:pwa-register/svelte';

	const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
		onRegistered(swr) {
			console.log(`SW registered: ${swr}`);
		},
		onRegisterError(error) {
			console.log('SW registration error', error);
		}
	});

	function close() {
		offlineReady.set(false);
		needRefresh.set(false);
	}

	$: toast = $offlineReady || $needRefresh;
</script>

{#if toast}
	<div class="toast toast-bottom toast-end z-50">
		<div class="alert alert-info shadow-lg flex flex-row gap-4 items-center">
			<div class="flex-1">
				{#if $offlineReady}
					<span> App ready to work offline </span>
				{:else}
					<span> New content available, click on reload button to update. </span>
				{/if}
			</div>
			<div class="flex-none flex gap-2">
				{#if $needRefresh}
					<button class="btn btn-sm btn-primary" onclick={() => updateServiceWorker(true)}> Reload </button>
				{/if}
				<button class="btn btn-sm btn-ghost" onclick={close}> Close </button>
			</div>
		</div>
	</div>
{/if}
