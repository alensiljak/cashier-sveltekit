<script lang="ts">
	type Props = {
		editedText: string;
		directiveIndex: number;
		isLoading: boolean;
		error?: string | null;
		onSave: () => void;
		onCancel: () => void;
		onTextChange: (text: string) => void;
	};
	let { editedText, directiveIndex, isLoading, error, onSave, onCancel, onTextChange }: Props = $props();
</script>

<section class="card bg-base-100 shadow-xl border-2 border-info">
	<div class="card-body p-4">
		<div class="flex items-center justify-between mb-4">
			<h2 class="card-title m-0">Edit Transaction</h2>
			<button
				class="btn btn-sm btn-circle btn-ghost"
				onclick={onCancel}
				disabled={isLoading}
				aria-label="Cancel editing"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<p class="text-sm text-base-content/70 mb-4">
			Editing transaction at index {directiveIndex}.
			Make your changes below and click Save to update.
		</p>

		{#if error}
			<div class="alert alert-error mb-4">
				<span>{error}</span>
			</div>
		{/if}

		<div class="form-control">
			<textarea
				value={editedText}
				oninput={(e) => onTextChange(e.currentTarget.value)}
				class="textarea textarea-bordered h-64 font-mono text-sm w-full"
				placeholder="Edit transaction..."
			></textarea>
		</div>

		<div class="mt-4 flex gap-2">
			<button
				class="btn btn-primary"
				onclick={onSave}
				disabled={isLoading}
			>
				{#if isLoading}
					<span class="loading loading-spinner"></span>
					Saving...
				{:else}
					Save
				{/if}
			</button>

			<button
				class="btn btn-ghost"
				onclick={onCancel}
				disabled={isLoading}
			>
				Cancel
			</button>
		</div>
	</div>
</section>
