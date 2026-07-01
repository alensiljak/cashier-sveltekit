<!--
  Stand-in for any @lucide/svelte icon in tests. Renders a plain <svg> so
  markup structure and any `class`/other passthrough props are preserved.
  See tests/setup.ts for why the real icon package is mocked out entirely.
-->
<script lang="ts">
	let { ...rest }: Record<string, unknown> = $props();
</script>

<svg data-icon-stub {...rest}></svg>
