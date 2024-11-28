<script>
	import { CalendarClockIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';

	function onClick() {
		goto('/scheduled-xacts');
	}
</script>

<HomeCardTemplate onclick={onClick}>
	{#snippet icon()}
		<CalendarClockIcon />
	{/snippet}
	{#snippet title()}
		Scheduled Transactions
	{/snippet}
</HomeCardTemplate>
