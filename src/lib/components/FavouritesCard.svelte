<script>
	import { StarIcon } from "lucide-svelte";
	import HomeCardTemplate from "./HomeCardTemplate.svelte";
	import { goto } from "$app/navigation";

	async function onClick() {
		await goto('/favourites', { replaceState: false })
	}

</script>
<HomeCardTemplate onclick={onClick}>
    {#snippet icon()}
    <StarIcon />
    {/snippet}
    {#snippet title()}
    Favourites
    {/snippet}
    {#snippet content()}
    (content)
    {/snippet}
    {#snippet footer()}
    (footer)
    {/snippet}
</HomeCardTemplate>
