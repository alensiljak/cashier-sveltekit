<!-- Speed-dial FAB for Home: one main button expanding into labeled action mini-FABs. -->
<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { PlusIcon, XIcon } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import Fab from './FAB.svelte';

	type SpeedDialAction = {
		icon: Component;
		label: string;
		onclick: () => void | Promise<void>;
	};
	type Props = {
		actions: SpeedDialAction[];
		Icon?: Component;
		ariaLabel?: string;
	};
	let { actions, Icon = PlusIcon, ariaLabel = 'Add' }: Props = $props();

	let expanded = $state(false);
	let mainButtonEl: HTMLButtonElement | undefined = $state(undefined);

	function toggle() {
		expanded = !expanded;
	}

	function close() {
		expanded = false;
	}

	async function selectAction(action: SpeedDialAction) {
		close();
		await action.onclick();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && expanded) {
			close();
			mainButtonEl?.focus();
		}
	}

	const BOTTOM_OFFSETS = ['bottom-28', 'bottom-44', 'bottom-60'];
</script>

<svelte:window onkeydown={onKeydown} />

{#if expanded}
	<!-- Decorative dismiss target; Escape (svelte:window above) is the keyboard equivalent. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40"
		aria-hidden="true"
		transition:fade={{ duration: 150 }}
		onclick={close}
	></div>

	{#each actions as action, i (action.label)}
		<div
			class="fixed right-24 {BOTTOM_OFFSETS[i] ?? 'bottom-7'} z-50 flex h-14 items-center"
			transition:fly={{ x: 20, duration: 150, delay: i * 30 }}
		>
			<span class="badge badge-neutral shadow-md whitespace-nowrap">{action.label}</span>
		</div>
		<Fab
			Icon={action.icon}
			bottom={BOTTOM_OFFSETS[i] ?? 'bottom-7'}
			ariaLabel={action.label}
			onclick={() => selectAction(action)}
		/>
	{/each}
{/if}

<Fab
	Icon={expanded ? XIcon : Icon}
	onclick={toggle}
	ariaLabel={expanded ? 'Close menu' : ariaLabel}
	ariaExpanded={expanded}
	bind:buttonEl={mainButtonEl}
/>
