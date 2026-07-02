<script lang="ts">
	import { debounceAction } from '$lib/utils/debounce';
	import { SearchIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	interface Props {
		focus: boolean;
		onSearch?: (arg0: string) => void;
		/** Debounce delay in ms before a keystroke triggers onSearch. */
		delay?: number;
		/** Initial input value, set once on mount (not reactively bound). */
		value?: string;
	}
	let { focus = false, onSearch, delay = 400, value = '' }: Props = $props();

	let searchField = $state<HTMLInputElement | null>(null);

	onMount(() => {
		if (searchField && value) {
			searchField.value = value;
		}
		if (focus) {
			searchField?.focus();
		}
	});

	/**
	 * Triggered when a (debounced) typing has been performed in the input field.
	 * @param value
	 */
	function handleSearch(value: string) {
		if (onSearch) {
			onSearch(value);
		}
	}
</script>

<div class="bg-primary p-0.5">
	<div class="relative mx-auto w-5/6 lg:w-2/5">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 z-10">
			<SearchIcon class="text-gray-400 h-4 w-4" />
		</div>
		<input
			type="search"
			placeholder="Search..."
			bind:this={searchField}
			use:debounceAction={{ callback: handleSearch, delay }}
			class="w-full rounded-full border-0 bg-base-200 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-base"
		/>
	</div>
</div>
