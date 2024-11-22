<script>
	import { ScrollIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
</script>

<HomeCardTemplate>
	{#snippet icon()}
		<ScrollIcon />
	{/snippet}
	{#snippet title()}
		Journal Card
	{/snippet}
</HomeCardTemplate>
