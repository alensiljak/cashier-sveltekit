<script lang="ts">
	interface Props {
		options: string[];
		value: string;
		placeholder?: string;
		onchange?: (value: string) => void;
	}

	let { options, value = $bindable(), placeholder = 'Select...', onchange }: Props = $props();

	let filter = $state('');
	let isOpen = $state(false);
	let container: HTMLElement = $state()!;
	let filterInput: HTMLInputElement = $state()!;

	let filtered = $derived(
		filter.trim() === ''
			? options
			: options.filter((o) => o.toLowerCase().includes(filter.toLowerCase()))
	);

	function select(option: string) {
		value = option;
		filter = '';
		isOpen = false;
		onchange?.(option);
	}

	function open() {
		isOpen = true;
		setTimeout(() => filterInput?.focus(), 0);
	}

	function handleClickOutside(e: MouseEvent) {
		if (container && !container.contains(e.target as Node)) {
			isOpen = false;
			filter = '';
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div bind:this={container} class="relative w-full">
	<button
		type="button"
		class="select select-bordered w-full flex items-center justify-between"
		onclick={open}
	>
		<span class="truncate">{value || placeholder}</span>
	</button>

	{#if isOpen}
		<div
			class="absolute z-50 w-full bg-base-100 border border-base-300 rounded-box shadow-xl mt-1"
		>
			<div class="p-2 border-b border-base-300">
				<input
					bind:this={filterInput}
					type="text"
					class="input input-bordered input-sm w-full"
					placeholder="Filter..."
					bind:value={filter}
       onkeydown={(e) => {
               if (e.key === 'Escape') {
                       isOpen = false;
                       filter = '';
               } else if (e.key === 'Enter' && filtered.length > 0) {
                       select(filtered[0]);
               } else if (e.key === 'ArrowDown') {
                       e.preventDefault();
                       if (filtered.length > 0) {
                               const currentIndex = filtered.findIndex(opt => opt === value);
                               const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, filtered.length - 1);
                               value = filtered[nextIndex];
                       }
               } else if (e.key === 'ArrowUp') {
                       e.preventDefault();
                       if (filtered.length > 0) {
                               const currentIndex = filtered.findIndex(opt => opt === value);
                               const prevIndex = currentIndex === -1 ? filtered.length - 1 : Math.max(currentIndex - 1, 0);
                               value = filtered[prevIndex];
                       }
               }
       }}
				/>
			</div>
			<ul class="max-h-56 overflow-y-auto py-1">
				{#each filtered as option}
                   <li>
                       <button
                           type="button"
                           class="w-full px-4 py-2 text-left text-sm hover:bg-base-200 {option === value
                                   ? 'font-semibold text-primary bg-base-200'
                                   : ''}"
                           onclick={() => select(option)}
                       >
                           {option}
                       </button>
                   </li>
				{/each}
				{#if filtered.length === 0}
					<li class="px-4 py-2 text-base-content/50 text-sm text-center">No results</li>
				{/if}
			</ul>
		</div>
	{/if}
</div>
