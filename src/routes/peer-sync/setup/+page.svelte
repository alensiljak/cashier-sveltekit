<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import Notifier from '#lib/utils/notifier';
	import { ArrowLeftIcon } from '@lucide/svelte';
	import { settings, SettingKeys, deviceSettings, DeviceSettingKeys } from '#lib/settings';
	import {
		RELAY_STRATEGIES,
		parseIceServers,
		type RelayStrategy
	} from '#lib/sync/peerPresence.svelte';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';

	// Shared singleton — changes here apply to the live connection.
	const presence = peerConnection.presence;

	let nameInput = $state('');
	let roomInput = $state('');
	let autoReload = $state(true);
	let iceInput = $state('');
	let iceSaved = $state('');
	let iceError = $derived.by(() => {
		try {
			parseIceServers(iceInput);
			return '';
		} catch (e) {
			return (e as Error).message;
		}
	});
	let saving = $state(false);
	let ready = $state(false);

	let dirty = $derived(
		ready && (nameInput.trim() !== presence.myName || roomInput.trim() !== presence.roomCode)
	);

	onMount(async () => {
		await peerConnection.ensureInit();
		nameInput = presence.myName;
		roomInput = presence.roomCode;
		autoReload = (await deviceSettings.get<boolean>(DeviceSettingKeys.peerAutoReload)) ?? true;
		iceSaved = presence.iceServers.length ? JSON.stringify(presence.iceServers, null, 2) : '';
		iceInput = iceSaved;
		ready = true;
	});

	async function saveIceServers() {
		try {
			const servers = parseIceServers(iceInput);
			const wasConnected = presence.isInRoom;
			if (wasConnected) await peerConnection.disconnect();
			await presence.setIceServers(servers);
			if (wasConnected) await peerConnection.connect();
			iceSaved = servers.length ? JSON.stringify(servers, null, 2) : '';
			iceInput = iceSaved;
			Notifier.success('Saved');
		} catch (e) {
			Notifier.error('Save failed: ' + (e as Error).message);
		}
	}

	async function saveIdentity() {
		const name = nameInput.trim();
		const room = roomInput.trim();
		saving = true;
		try {
			if (name && name !== presence.myName) await presence.setName(name);
			if (room && room !== presence.roomCode) {
				// A room change needs a fresh join; reconnect if we were connected.
				const wasConnected = presence.isInRoom;
				if (wasConnected) await peerConnection.disconnect();
				presence.roomCode = room;
				await settings.set(SettingKeys.peerRoom, room);
				if (wasConnected) await peerConnection.connect(room);
			}
			Notifier.success('Saved');
		} catch (e) {
			Notifier.error('Save failed: ' + (e as Error).message);
		} finally {
			saving = false;
		}
	}

	async function selectStrategy(value: RelayStrategy) {
		try {
			await peerConnection.setStrategy(value);
		} catch (e) {
			Notifier.error('Failed to switch network: ' + (e as Error).message);
		}
	}

	async function setAutoReload(value: boolean) {
		autoReload = value;
		await deviceSettings.set(DeviceSettingKeys.peerAutoReload, value);
	}

</script>

<main class="flex h-full flex-col">
	<Toolbar title="Peer Sync Setup">
		{#snippet actions()}
			<a href="/peer-sync" class="btn btn-ghost btn-sm btn-square" aria-label="Back" title="Back">
				<ArrowLeftIcon size={20} />
			</a>
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<!-- This device -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-sm">This device</h2>
				<label class="form-control w-full">
					<span class="label-text text-xs opacity-60">Device name</span>
					<input
						type="text"
						bind:value={nameInput}
						class="input input-bordered input-sm w-full"
						placeholder="My Phone"
						onkeydown={(e) => e.key === 'Enter' && dirty && saveIdentity()}
					/>
				</label>
				<label class="form-control w-full">
					<span class="label-text text-xs opacity-60">Room</span>
					<input
						type="text"
						bind:value={roomInput}
						class="input input-bordered input-sm w-full font-mono"
						placeholder="cashier"
						onkeydown={(e) => e.key === 'Enter' && dirty && saveIdentity()}
					/>
					<span class="label-text-alt pt-1 opacity-50"
						>Devices find each other only when they use the same room and network.</span
					>
				</label>
				<div>
					<span class="text-xs opacity-60">Device ID</span>
					<p class="font-mono text-xs break-all opacity-60">{presence.myId}</p>
				</div>
				<button class="btn btn-success btn-sm" disabled={!dirty || saving} onclick={saveIdentity}>
					{#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
					Save
				</button>
			</div>
		</div>

		<!-- Network -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body gap-2 p-4">
				<h2 class="card-title text-sm">Network</h2>
				<p class="text-xs opacity-60">
					Used to discover peers. Every device must pick the same network. Switching reconnects a
					live room.
				</p>
				<div role="radiogroup" aria-label="Network" class="flex flex-col gap-1">
					{#each RELAY_STRATEGIES as s (s.value)}
						<label class="flex cursor-pointer items-center gap-3 py-1">
							<input
								type="radio"
								name="strategy"
								class="radio radio-primary radio-sm"
								checked={presence.strategy === s.value}
								onchange={() => selectStrategy(s.value)}
							/>
							<span class="text-sm">{s.label}</span>
						</label>
					{/each}
				</div>
			</div>
		</div>

		<!-- Relay (TURN) -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body gap-2 p-4">
				<h2 class="card-title text-sm">Relay server (TURN)</h2>
				<p class="text-xs opacity-60">
					Optional. For devices that can't connect directly (e.g. mobile data). Paste the ICE servers
					JSON from your TURN provider. Stored on this device only; set it on every device. Saving
					reconnects a live room.
				</p>
				<textarea
					bind:value={iceInput}
					class="textarea textarea-bordered h-32 w-full font-mono text-xs"
					class:textarea-error={iceError}
					placeholder={'[{"urls": "turn:...", "username": "...", "credential": "..."}]'}
					spellcheck="false"
					autocomplete="off"
					aria-label="ICE servers JSON"
				></textarea>
				{#if iceError}<span class="text-error text-xs">{iceError}</span>{/if}
				<div>
					<button
						class="btn btn-success btn-sm"
						disabled={!ready || !!iceError || iceInput.trim() === iceSaved.trim()}
						onclick={saveIceServers}
					>
						Save
					</button>
				</div>
			</div>
		</div>

		<!-- After sync -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body flex-row items-center justify-between gap-3 p-4">
				<div>
					<p class="text-sm font-semibold">Reload ledger after sync</p>
					<p class="text-xs opacity-60">
						Reload the ledger automatically after synchronizing journal transactions.
					</p>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-success bg-transparent bg-none"
					checked={autoReload}
					aria-label="Reload ledger after sync"
					onchange={(e) => setAutoReload(e.currentTarget.checked)}
				/>
			</div>
		</div>

		<!-- Trusted Devices -->
		<a href="/settings/trusted-devices" class="card bg-base-200 shadow-sm">
			<div class="card-body flex-row items-center justify-between gap-3 p-4">
				<div>
					<p class="text-sm font-semibold">Trusted devices</p>
					<p class="text-xs opacity-60">
						Manage which devices to sync with. Also used by WebDAV and S3.
					</p>
				</div>
				<span class="badge badge-neutral badge-sm">{presence.trustedPeers.length}</span>
			</div>
		</a>
	</section>
</main>
