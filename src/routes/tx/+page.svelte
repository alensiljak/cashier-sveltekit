<script>
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Check } from 'lucide-svelte';
	import { xact } from '$lib/data/mainStore';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';

    onMount(() => {
        // Get the Xact from the store?
        // No, it is available already.
        console.log(get(xact))
    })

	function onFab() {
		console.log('fab clicked!');
	}
</script>

<Toolbar title="Journal Entry">
    {#snippet menuItems()}
        <ToolbarMenuItem text="Save" />
        <ToolbarMenuItem text="Reset" />
        {/snippet}
</Toolbar>
<Fab Icon={Check} onclick={onFab} />

<!-- tx editor -->

<!-- confirm deletion dialog -->
