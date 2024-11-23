<script lang="ts">
	import type { Posting } from '$lib/data/model';

	type Props = {
		posting: Posting;
	};
	let { posting }: Props = $props();
</script>

<input
	title="Account"
	placeholder="Account"
	type="text"
	class="input"
	bind:value={posting.account}
/>

<!-- amount sign -->

<input
	title="Amount"
	placeholder="Amount"
	type="number"
	class="input"
	bind:value={posting.amount}
/>
<input
	title="Currency"
	placeholder="Currency"
	type="text"
	class="input uppercase"
	bind:value={posting.currency}
/>
