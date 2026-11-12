<script lang="ts">
	/**
	 * A device as people see it: its name and the short fingerprint of its key (`Anna's phone ·
	 * 7KQ2-M9XA`). Names are not unique and anyone can announce any name, so the fingerprint is
	 * what tells two devices with the same name apart. The full ID is never shown.
	 */
	let { name, fingerprint = '' }: { name: string; fingerprint?: string } = $props();
</script>

<span class="min-w-0 truncate">{name}</span>{#if fingerprint}<span
		class="shrink-0 whitespace-nowrap font-mono text-xs opacity-60"
		title="Fingerprint of the device key">&nbsp;· {fingerprint}</span
	>{/if}
