<script lang="ts">
	import { CheckIcon } from "lucide-svelte";
	import type { EventHandler } from "svelte/elements";

    interface Props {
        Icon: any,
        text?: string
        colour?: string
        onclick?: EventHandler
    }
    let { Icon = CheckIcon, text, colour = 'primary', onclick }: Props = $props();

    let buttonColour = $derived(colour ? 'variant-filled-' + colour : '')

</script>
<div class="flex flex-col items-center text-center bg-surface-600/50 h-32 justify-center m-4">
    <button type="button" class={`btn-icon btn-icon-xl ${buttonColour}`} {onclick}>
        <Icon />
    </button>
    <span>{text}</span>
</div>