<script>
	import { RefreshCwIcon, SettingsIcon } from "lucide-svelte";
import CardTemplate from "./HomeCardTemplate.svelte";

</script>
<CardTemplate>
    {#snippet icon()}
    <RefreshCwIcon />
    {/snippet}
    {#snippet title()}
        Cashier Sync
    {/snippet}
    {#snippet content()}
        <p>Status:</p>
    {/snippet}
    {#snippet footer()}
        <center>
            <a href="/sync" class="btn variant-outline-warning uppercase">
                <span><SettingsIcon /></span>
                <span>Sync Settings</span>
            </a>
        </center>
    {/snippet}
</CardTemplate>