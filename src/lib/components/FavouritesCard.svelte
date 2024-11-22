<script>
	import { StarIcon } from "lucide-svelte";
	import CardTemplate from "./HomeCardTemplate.svelte";

</script>
<CardTemplate>
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
</CardTemplate>
