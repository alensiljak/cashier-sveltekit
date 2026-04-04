<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { BookTextIcon } from '@lucide/svelte';

	function openBook() {
		window.open('https://alensiljak.github.io/cashier-book/', '_blank');
	}
</script>

<article>
	<Toolbar title="Help"></Toolbar>

	<section class="p-1">
		<p>
			For User Manual, see
			<a class="link link-primary" href="https://alensiljak.github.io/cashier-book/">Cashier Book</a
			>.
		</p>
	</section>
	<section class="p-5 text-center m-5 border border-primary rounded-xl h-50 flex items-center justify-center">
		<button class="btn btn-primary gap-2" onclick={openBook}>
			<BookTextIcon class="w-5 h-5" />
			<span>Open Book</span>
		</button>
	</section>
</article>
