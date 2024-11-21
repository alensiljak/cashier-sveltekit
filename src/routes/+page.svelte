<script lang="ts">
	import GlossToolbar from '$lib/gloss-toolbar.svelte';
	import JournalCard from '$lib/journal-card.svelte';
	import { PlusIcon } from 'lucide-svelte';
	import Toolbar from '../lib/toolbar.svelte';
	import { goto } from '$app/navigation';

	function onFab() {
		console.log('fab clicked')

        // create new transaction in the app store
		// var xact = AppService.CreateNewXact();
        // State.Xact = xact;
		
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

	<h1>Welcome to SvelteKit</h1>
	<p>Visit <a href="https://kit.svelte.dev">kit.svelte.dev</a> to read the documentation</p>

	<div>
		Sub pages:

		<ul>
			<li><a href="framework7">Framework7</a></li>
		</ul>
	</div>

	<!-- Footer -->
	<!-- <footer class="bg-yellow">Footer</footer> -->

	Cards:

	<JournalCard />

	<!-- FAB -->
	<button class="absolute bottom-7 right-7 bg-tertiary-500 hover:bg-tertiary-500/75 text-secondary-500 rounded-full p-4 shadow-lg transition duration-200"
	on:click={onFab}>
		<PlusIcon />
	</button>
</main>
