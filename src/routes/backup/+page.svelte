<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ISODATEFORMAT, LONGTIMEFORMAT } from '$lib/constants';
	import { createBackup, getBackupFilename } from '$lib/services/backupService';
	import { FileButton } from '@skeletonlabs/skeleton';
	import moment from 'moment';
	import { onMount } from 'svelte';

	let _filename: string;
	// let files: FileList;

	onMount(() => {
		_filename = getBackupFilename()
	});

	async function onBackupClick() {
        await createBackup(_filename)
	}

	function onChangeHandler(e: Event): void {
		console.log('file data:', e);
	}

</script>

<article>
	<Toolbar title="Backup"></Toolbar>
	<section>
		<p>You can backup all local data:</p>
		<ul>
			<li>transactions</li>
			<li>scheduled transactions</li>
			<li>settings</li>
		</ul>
		<p>into</p>

		<div class="flex flex-row">
			<input type="text" class="input" bind:value={_filename} readonly />
			<!-- <FileButton
				name="files"
				button="btn variant-soft-primary"
				bind:files
				on:change={onChangeHandler}
			/> -->
		</div>

		<center class="pt-4">
			<button type="button" class="variant-filled-primary btn" onclick={onBackupClick}
				>Backup</button
			>
		</center>
	</section>
</article>
