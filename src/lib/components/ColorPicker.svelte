<script lang="ts">
	type Props = {
		value?: string;
	};
	let { value = $bindable('') }: Props = $props();

	const presetColors = [
		{ hex: '#E57373', name: 'Red' },
		{ hex: '#F06292', name: 'Pink' },
		{ hex: '#BA68C8', name: 'Purple' },
		{ hex: '#9575CD', name: 'Deep Purple' },
		{ hex: '#7986CB', name: 'Indigo' },
		{ hex: '#64B5F6', name: 'Blue' },
		{ hex: '#4FC3F7', name: 'Sky' },
		{ hex: '#4DD0E1', name: 'Cyan' },
		{ hex: '#4DB6AC', name: 'Teal' },
		{ hex: '#81C784', name: 'Green' },
		{ hex: '#AED581', name: 'Lime Green' },
		{ hex: '#DCE775', name: 'Lime' },
		{ hex: '#FFD54F', name: 'Amber' },
		{ hex: '#FFB74D', name: 'Orange' },
		{ hex: '#FF8A65', name: 'Deep Orange' },
		{ hex: '#A1887F', name: 'Brown' }
	];

	let hexText = $state(value || '');

	function selectPreset(hex: string) {
		value = hex;
		hexText = hex;
	}

	function clearColor() {
		value = '';
		hexText = '';
	}

	function onColorPickerInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		value = v;
		hexText = v;
	}

	function onHexInput(e: Event) {
		hexText = (e.target as HTMLInputElement).value;
		if (/^#[0-9A-Fa-f]{6}$/i.test(hexText)) {
			value = hexText;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Preset swatches -->
	<div class="grid grid-cols-8 gap-1.5">
		<!-- Default / no colour swatch -->
		<button
			type="button"
			class="flex h-8 w-8 items-center justify-center rounded border-2 text-xs transition-transform {!value
				? 'border-base-content scale-110'
				: 'border-base-content/30'} bg-base-200"
			onclick={clearColor}
			title="Default"
			aria-label="Default (no colour)"
		>
			<span class="opacity-50">—</span>
		</button>
		{#each presetColors as color}
			<button
				type="button"
				class="h-8 w-8 rounded border-2 transition-transform {value === color.hex
					? 'border-base-content scale-110'
					: 'border-base-content/20 hover:border-base-content/50'}"
				style="background-color: {color.hex};"
				onclick={() => selectPreset(color.hex)}
				title={color.name}
				aria-label={color.name}
			></button>
		{/each}
	</div>

	<!-- Custom colour row -->
	<div class="flex items-center gap-2">
		<span class="text-sm opacity-70">Custom:</span>
		<input
			type="color"
			class="h-8 w-8 cursor-pointer rounded border border-base-content/20 bg-transparent p-0.5"
			value={value || '#ffffff'}
			oninput={onColorPickerInput}
		/>
		<input
			type="text"
			class="input input-sm input-bordered w-28 font-mono"
			placeholder="#rrggbb"
			value={hexText}
			oninput={onHexInput}
			maxlength={7}
		/>
		{#if value}
			<div class="h-6 w-6 rounded border border-base-content/20" style="background-color: {value};"></div>
		{/if}
	</div>
</div>
