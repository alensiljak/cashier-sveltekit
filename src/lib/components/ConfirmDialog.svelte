<!-- Confirmation dialog, same structure as the "Delete" dialog on the transaction actions page. -->
<script lang="ts">
	interface Props {
		open: boolean;
		title?: string;
		message: string;
		onconfirm: () => void | Promise<void>;
	}
	let { open = $bindable(), title = 'Confirm', message, onconfirm }: Props = $props();

	async function confirm() {
		open = false;
		await onconfirm();
	}
</script>

<input type="checkbox" class="modal-toggle" bind:checked={open} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">{title}</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">{message}</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
			<button type="button" class="btn btn-primary text-primary-content" onclick={confirm}
				>OK</button
			>
		</footer>
	</div>
</dialog>
