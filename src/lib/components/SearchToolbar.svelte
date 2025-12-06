<script lang="ts">
	import { debounceAction } from '$lib/utils/debounce';
	import { SearchIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	interface Props {
		focus: boolean;
		onSearch?: (arg0: string) => void;
	}
	let { focus = false, onSearch }: Props = $props();

	let searchField: HTMLInputElement;

	onMount(() => {
		if (focus) {
			searchField.focus();
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

<search class="bg-primary-500">
	<div
		class="input-group input-group-divider mx-auto w-5/6 grid-cols-[1fr_auto]
		rounded-full lg:w-2/5"
	>
		<input
			type="search"
			placeholder="Search..."
			bind:this={searchField}
			use:debounceAction={{ callback: handleSearch, delay: 400 }}
			class="ig-input bg-surface-900"
		/>
		<div class="ig-cell bg-surface-900"><SearchIcon /></div>
	</div>
</search>
