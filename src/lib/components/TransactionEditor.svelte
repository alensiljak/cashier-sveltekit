<script lang="ts">
	import { xact } from '$lib/data/mainStore';
	import { Posting } from '$lib/data/model';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import PostingEditor from './PostingEditor.svelte';

	onMount(() => {
		// tx is already available
	});
</script>

<input title="Date" placeholder="Date" type="date" class="input" bind:value={$xact.date} />
<input title="Payee" placeholder="Payee" type="text" class="input" bind:value={$xact.payee} />
<input title="Note" placeholder="Note" type="text" class="input" bind:value={$xact.note} />

<!-- Postings -->
<!-- actions and sum -->
{#each $xact.postings as posting}
	<PostingEditor posting={posting} />
{/each}
