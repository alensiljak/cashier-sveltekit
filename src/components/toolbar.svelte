<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Paperclip from 'lucide-svelte/icons/paperclip';
	import Calendar from 'lucide-svelte/icons/calendar';
	import CircleUser from 'lucide-svelte/icons/circle-user';
    import { EllipsisVertical, Menu } from 'lucide-svelte';
</script>

<!-- Toolbar for pages -->
<header>
	<!-- Header -->
	<AppBar headlineClasses="sm:hidden" centerClasses="hidden sm:block">
		{#snippet lead()}
			<!-- <ArrowLeft size={24} /> -->
			<Menu size={24} />
		{/snippet}
		{#snippet trail()}
            <EllipsisVertical size={20} />
		{/snippet}
		{#snippet headline()}
			<h2 class="h2">Headline</h2>
		{/snippet}
		<span>Cashier</span>
	</AppBar>
</header>
