<!--
	Asks how to set up the scheduled transactions store on first launch after the move to the CRDT store.
	TODO: remove together with `scxMigration.ts` once the Dexie `scheduled` table is dropped.
-->
<script lang="ts">
	import { scxMigrationPrompt } from '$lib/services/scxMigration';
</script>

{#if $scxMigrationPrompt}
	{@const prompt = $scxMigrationPrompt}
	<dialog class="modal modal-open">
		<div class="modal-box">
			<h2 class="text-lg font-bold">Scheduled transactions</h2>
			<p class="py-4 opacity-70">
				Scheduled transactions are now stored in a new, syncable format. This device has {prompt.count}
				saved in the old one.
			</p>
			<p class="pb-4 text-sm opacity-60">
				Migrate them on <strong>one device only</strong>. On the others, start empty and receive
				them through sync, otherwise they will be duplicated.
			</p>
			<div class="flex flex-col gap-3">
				<button type="button" class="btn btn-primary" onclick={() => prompt.choose('migrate')}>
					Migrate the {prompt.count} scheduled transactions
				</button>
				<button type="button" class="btn btn-outline" onclick={() => prompt.choose('empty')}>
					Start empty and sync later
				</button>
			</div>
		</div>
	</dialog>
{/if}
