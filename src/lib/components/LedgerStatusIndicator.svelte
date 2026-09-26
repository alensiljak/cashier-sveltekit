<script module lang="ts">
	// The "ready" checkmark plays once per session; later reloads only show the loading dot.
	let readyShown = false;
</script>

<script lang="ts">
	const SHOW_DOT_DELAY_MS = 300;
	const CHECK_DRAW_MS = 400;
	const HOLD_MS = 500;
	const FADE_MS = 300;

	interface Props {
		/** True once the ledger is loaded and its validation has been evaluated. */
		validated: boolean;
		/** Validation errors take over the toolbar via their own icon, so nothing is shown here. */
		hasErrors: boolean;
	}

	let { validated, hasErrors }: Props = $props();

	let phase = $state<'hidden' | 'loading' | 'ready' | 'fading'>('hidden');

	$effect(() => {
		const timers: ReturnType<typeof setTimeout>[] = [];

		if (!validated) {
			// Skip the dot for fast loads to avoid a flash.
			timers.push(setTimeout(() => (phase = 'loading'), SHOW_DOT_DELAY_MS));
		} else if (hasErrors || readyShown) {
			phase = 'hidden';
		} else {
			readyShown = true;
			phase = 'ready';
			timers.push(setTimeout(() => (phase = 'fading'), CHECK_DRAW_MS + HOLD_MS));
			timers.push(setTimeout(() => (phase = 'hidden'), CHECK_DRAW_MS + HOLD_MS + FADE_MS));
		}

		return () => timers.forEach(clearTimeout);
	});
</script>

<span class="status-slot" aria-live="polite">
	{#if phase === 'loading'}
		<span class="dot" title="Loading ledger…"></span>
		<span class="sr-only">Loading ledger</span>
	{:else if phase === 'ready' || phase === 'fading'}
		<svg
			class="check"
			class:fading={phase === 'fading'}
			viewBox="0 0 24 24"
			width="28"
			height="28"
			fill="currentColor"
		>
			<title>Ledger ready</title>
			<defs>
				<mask id="ledger-check-reveal" maskUnits="userSpaceOnUse">
					<path
						class="reveal"
						d="M4 12.5 L9.8 18 L20.5 5"
						pathLength="1"
						fill="none"
						stroke="white"
						stroke-width="7"
					/>
				</mask>
			</defs>
			<!-- Tapered, brush-style check, revealed left to right by the mask. -->
			<path
				mask="url(#ledger-check-reveal)"
				d="M3.2 12.2C3.6 11.5 4.6 11.6 5.2 12L9.4 15.4L18.6 4.6C19.4 3.7 20.6 3.3 21.3 3.9C21.9 4.4 21.6 5.2 21 5.9L10.6 19.6C10.2 20.2 9.5 20.4 9 19.9L3.4 13.6C3 13.2 3 12.6 3.2 12.2Z"
			/>
		</svg>
		<span class="sr-only">Ledger ready</span>
	{/if}
</span>

<style>
	.status-slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		vertical-align: middle;
		width: 28px;
		height: 28px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 9999px;
		background: var(--color-base-content);
		opacity: 0.35;
		animation: pulse 1.6s ease-in-out infinite;
	}
	.check {
		color: var(--color-success);
		/* Optical alignment with the neighbouring toolbar icons. */
		transform: translateY(-1px);
		transition: opacity 300ms ease-out;
	}
	.check .reveal {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 400ms ease-out forwards;
	}
	.check.fading {
		opacity: 0;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
		.check .reveal {
			animation: none;
			stroke-dashoffset: 0;
		}
	}
</style>
