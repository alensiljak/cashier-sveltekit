<script lang="ts">
	import { AssetClass } from '$lib/AssetClass';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { onMount } from 'svelte';

    let _allocation: AssetClass[];

    onMount(() => {

    })
</script>

<article>
	<Toolbar title="Asset Allocation"></Toolbar>

	<section class="overflow-auto">
		<table class="mx-auto">
			<thead>
				<tr>
					<th colspan="1"></th>
					<th colspan="4" style="text-align: center; border-right-width: 1px;">Allocation</th>
					<th colspan="3" style="text-align: center;">Value</th>
				</tr>
				<tr>
					<th style="text-align: center;">Asset Class</th>
					<th style="text-align: center;">Target</th>
					<th style="text-align: center;">Current</th>
					<th style="text-align: center;">Diff&nbsp;%</th>
					<th style="text-align: center;">Allocated</th>
					<th style="text-align: center;">Current</th>
					<th style="text-align: center;">Difference</th>
				</tr>
			</thead>
			<tbody>
                {#each _allocation as item}
                    <tr>
                        <td>
                            {item.name}
                        </td>
                    </tr>
                {/each}
            </tbody>
		</table>
	</section>
</article>
