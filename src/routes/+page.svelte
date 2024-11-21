<script lang="ts">
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import JournalCard from '$lib/components/journal-card.svelte';
	import { PlusIcon } from 'lucide-svelte';
	import Toolbar from '../lib/components/toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '$lib/data/mainStore'
	import { Transaction } from '$lib/data/model';

	function onFab() {
		console.log('fab clicked')

        // create a new transaction in the app store
		var tx = Transaction.create()
		xact.set(tx)

		goto('/tx')
	}
</script>

<Toolbar />

<!-- Main -->
<main class="container space-y-4 p-1 lg:p-10">
	<h1>Homepage</h1>
	<hr />
	<p>
		Lorem ipsum dolor sit amet, consectetur adipisicing elit. Cupiditate nostrum, vero explicabo
		sunt ipsum asperiores. Molestias nostrum mollitia cumque veniam eum error atque, dolores
		nesciunt voluptas ea consectetur sed delectus.
	</p>

	<JournalCard />

	<!-- FAB -->
	<button class="absolute bottom-7 right-7 bg-tertiary-500 hover:bg-tertiary-500/75 text-secondary-500 rounded-full p-4 shadow-lg transition duration-200"
	on:click={onFab}>
		<PlusIcon />
	</button>
</main>
