<script lang="ts">
	import type { Snippet } from "svelte";

    // Props
    type Props = {
        targetNav?: string,
        text?: string,
        icon?: Snippet
    }
    let { targetNav = '/', text, icon } = $props()

</script>
<a href="{targetNav}">
    <span class="flex-auto">{text}</span>
    <span class="badge">
        {@render icon()}
    </span>
</a>
