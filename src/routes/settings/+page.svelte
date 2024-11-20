<script lang="ts">
	import { onMount } from 'svelte';
	import GlossToolbar from '$lib/gloss-toolbar.svelte';
	import Toolbar from '$lib/toolbar.svelte';

	onMount(() => {
		console.log('the component has mounted');
		loadSettings();
	});

	function loadSettings() {
		console.log('loading settings')

		// currency
		// root investment account
		// remember last transaction
	}

</script>

<!-- <GlossToolbar /> -->

<Toolbar title="Settings" />

<main class="container space-y-4 p-1">
	<!-- currency -->
	<label class="label">
		<span>Main Currency</span>
		<input class="input" type="text" placeholder="Main Currency" />
	</label>
	<!-- investment account -->
	<label class="label">
		<span>Investment account root</span>
		<input class="input" type="text" placeholder="Investment account root" />
	</label>

	<!-- last transaction -->
	<label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" />
		<p>Remember last transaction for payees.</p>
	</label>

	<!-- <label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" checked />
		<p>Dark mode</p>
	</label> -->

	<center>
		<button class="btn variant-filled-error !text-warning-500 uppercase ">Save</button>
	</center>

	<section>
		Import Asset Allocation file
	</section>

	<section>
		Restore Settings from file
	</section>

	<section>
		Reload App
	</section>
</main>
