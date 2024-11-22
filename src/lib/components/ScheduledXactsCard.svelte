<script>
    import { CalendarClockIcon } from "lucide-svelte";
import HomeCardTemplate from "./HomeCardTemplate.svelte";

</script>
<HomeCardTemplate>
    {#snippet icon()}
    <CalendarClockIcon />
    {/snippet}
    {#snippet title()}
    Scheduled Transactions
    {/snippet}
</HomeCardTemplate>