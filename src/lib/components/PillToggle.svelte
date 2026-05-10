<script lang="ts">
	type Option = { value: string; label: string };

	type Props = {
		options: Option[];
		value: string;
		onchange?: (value: string) => void;
		class?: string;
	};

	let { options, value = $bindable(), onchange, class: className = '' }: Props = $props();

	function select(v: string) {
		value = v;
		onchange?.(v);
	}
</script>

<div class="join {className}">
	{#each options as opt}
		<button
			class="btn btn-sm join-item"
			class:btn-primary={value === opt.value}
			class:btn-ghost={value !== opt.value}
			onclick={() => select(opt.value)}
		>
			{opt.label}
		</button>
	{/each}
</div>
