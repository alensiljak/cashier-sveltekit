<script>
	import { RefreshCwIcon } from "lucide-svelte";
import CardTemplate from "./HomeCardTemplate.svelte";

</script>
<CardTemplate>
    {#snippet icon()}
    <RefreshCwIcon />
    {/snippet}
    {#snippet title()}
        Synchronization
    {/snippet}
    sync
</CardTemplate>