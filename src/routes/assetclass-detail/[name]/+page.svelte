<script lang="ts">
	import { page } from "$app/stores";
	import Toolbar from "$lib/components/Toolbar.svelte";
	import { onMount } from "svelte";

	const name = $page.params.name;
    export let data

    onMount(() => {
        console.debug(name)
        console.debug(data)
    })
</script>
<article>
    <Toolbar title="Asset Class Detail"></Toolbar>
    <section class="p-1">
        <p>{name}</p>
        <p>Allocation: </p>
    </section>
</article>