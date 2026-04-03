<script lang="ts">
	import { syncProgress } from '$lib/stores/syncProgressStore';
</script>

{#if $syncProgress.length > 0}
	<div class="border border-base-200 rounded-lg p-4">
		<h4 class="font-medium mb-4">Sync Progress</h4>
		<ul class="space-y-2">
			{#each $syncProgress as step}
				<li class="flex items-center space-x-2">
					{#if step.status === 'in-progress'}
						<span class="loading loading-spinner loading-sm"></span>
					{:else if step.status === 'completed'}
						<span class="text-green-500">✓</span>
					{:else if step.status === 'error'}
						<span class="text-red-500">✗</span>
					{:else}
						<span class="text-gray-500">⏳</span>
					{/if}
					<span>{step.name}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}