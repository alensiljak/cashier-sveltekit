<script lang="ts">
	import { getDrawerStore } from '@skeletonlabs/skeleton';

	const drawerStore = getDrawerStore();

	function drawerClose(): void {
		drawerStore.close();
	}
</script>

<!-- This is the navigation component. -->

<nav class="list-nav p-4">
	<ul>
		<li><a href="/" on:click={drawerClose}>Homepage</a></li>
		<li><a href="/about" on:click={drawerClose}>About</a></li>
		<li><a href="/blog" on:click={drawerClose}>Blog</a></li>
		<li><a href="/contact" on:click={drawerClose}>Contact</a></li>
	</ul>
</nav>
