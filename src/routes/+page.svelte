<script>
	import GlossToolbar from '$lib/gloss-toolbar.svelte';
	import JournalCard from '$lib/journal-card.svelte';
	import Toolbar from '../lib/toolbar.svelte';
</script>

<Toolbar />

<div class="container space-y-4 p-1 lg:p-10">
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

	<!-- Main -->
	<main class="space-y-4 bg-green-500 p-4">Main</main>
	<!-- Footer -->
	<!-- <footer class="bg-yellow">Footer</footer> -->

	Cards:

	<JournalCard />
</div>
