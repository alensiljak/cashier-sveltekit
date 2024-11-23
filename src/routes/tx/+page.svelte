<script>
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/toolbar.svelte';
	import { Check } from 'lucide-svelte';

	function onFab() {
		console.log('fab clicked!');
	}
</script>

<Toolbar title="Journal Entry" />
<Fab Icon={Check} onclick={onFab} />

