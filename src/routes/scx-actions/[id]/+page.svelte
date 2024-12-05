<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ScheduledXact, xact } from '$lib/data/mainStore';
	import { CheckIcon, ChevronsRightIcon, PenSquareIcon, ScrollIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const id = $page.params.id;

    onMount(() => {
        if(!id) {
            goto('/')
        }
    })
</script>

<article>
	<Toolbar title="Scheduled Transaction Actions"></Toolbar>

	<section class="p-1">
		<JournalXactRow xact={$xact} />

		<!-- recurrence details -->
		<div class="mt-4">
			{#if $ScheduledXact.count}
				<span>Repeats every {$ScheduledXact.count} {$ScheduledXact.period}.</span>
			{/if}
			{#if $ScheduledXact.endDate}
				<p>until {$ScheduledXact.endDate}.</p>
			{/if}
		</div>

		<!-- remarks -->
		<div>
			<p>Remarks:</p>
			<textarea class="textarea" readonly>{$ScheduledXact.remarks}</textarea>
		</div>

		<!-- actions -->
		<div class="pt-10 grid grid-cols-3 lg:px-20">
            <SquareButton Icon={ScrollIcon} classes="bg-tertiary-500 text-secondary-500">
                Enter
            </SquareButton>
            <SquareButton Icon={ChevronsRightIcon} classes="bg-tertiary-500 text-secondary-500">
                Skip
            </SquareButton>
            <SquareButton Icon={PenSquareIcon} classes="bg-tertiary-500 text-secondary-500">
                Edit
            </SquareButton>
            <SquareButton Icon={TrashIcon} classes="bg-tertiary-500 text-secondary-500">
                Delete
            </SquareButton>
		</div>
	</section>
</article>
