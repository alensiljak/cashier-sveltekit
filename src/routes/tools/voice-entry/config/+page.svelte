<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import Notifier from '#lib/utils/notifier';
	import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
	import {
		DEFAULT_SPEECH_LANGUAGE,
		MISTRAL_TRANSCRIPTION_MODEL,
		SPEECH_LANGUAGES,
		MicrophoneRecorder,
		getMistralApiKey,
		getMistralModel,
		getSpeechEngine,
		getSpeechLanguage,
		isBuiltinSpeechSupported,
		isRecordingSupported,
		setMistralApiKey,
		setMistralModel,
		setSpeechEngine,
		setSpeechLanguage,
		transcribeWithMistral,
		type SpeechEngine
	} from '#lib/services/speechService';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import SquareIcon from '@lucide/svelte/icons/square-stop';

	// --- State ---

	let engine = $state<SpeechEngine>('builtin');
	let language = $state(DEFAULT_SPEECH_LANGUAGE);
	let apiKey = $state('');
	let model = $state(MISTRAL_TRANSCRIPTION_MODEL);
	let proxyKey = $state('');
	let loaded = $state(false);
	let saving = $state(false);

	let builtinSupported = $state(true);
	let recordingSupported = $state(true);

	// Test transcription
	let testing = $state(false);
	let testResult = $state('');
	let testError = $state('');
	let recorder: MicrophoneRecorder | null = null;
	let testRecording = $state(false);

	onMount(async () => {
		builtinSupported = isBuiltinSpeechSupported();
		recordingSupported = isRecordingSupported();

		engine = await getSpeechEngine();
		language = await getSpeechLanguage();
		apiKey = await getMistralApiKey();
		model = await getMistralModel();
		proxyKey = (await deviceSettings.get<string>(DeviceSettingKeys.proxyKey)) ?? '';
		loaded = true;
	});

	/** The language tag to store: the picked one, or the default when blank. */
	function normalizedLanguage(): string {
		return language.trim() || DEFAULT_SPEECH_LANGUAGE;
	}

	async function save() {
		saving = true;
		try {
			await setSpeechEngine(engine);
			await setSpeechLanguage(normalizedLanguage());
			await setMistralApiKey(apiKey);
			await setMistralModel(model);
			await deviceSettings.set(DeviceSettingKeys.proxyKey, proxyKey.trim());
			language = normalizedLanguage();
			model = model.trim() || MISTRAL_TRANSCRIPTION_MODEL;
			apiKey = apiKey.trim();
			proxyKey = proxyKey.trim();
			Notifier.success('Speech settings saved');
		} catch (err) {
			Notifier.error(`Could not save the speech settings: ${(err as Error).message}`);
		} finally {
			saving = false;
		}
	}

	// --- Test transcription (Mistral) ---

	async function toggleTestRecording() {
		testError = '';
		if (testRecording) {
			testRecording = false;
			testing = true;
			try {
				const clip = await recorder?.stop();
				recorder = null;
				if (!clip) {
					testError = 'Nothing was recorded. Try again and speak a little louder.';
					return;
				}
				testResult = await transcribeWithMistral(clip, {
					apiKey: apiKey.trim(),
					model: model.trim() || MISTRAL_TRANSCRIPTION_MODEL,
					language: normalizedLanguage()
				});
				if (!testResult) testError = 'Mistral returned an empty transcription.';
			} catch (err) {
				testError = (err as Error).message;
			} finally {
				testing = false;
			}
			return;
		}

		testResult = '';
		testError = '';
		try {
			recorder = new MicrophoneRecorder();
			await recorder.start();
			testRecording = true;
		} catch (err) {
			recorder = null;
			testError = `Could not open the microphone: ${(err as Error).message}`;
		}
	}
</script>

{#snippet menuItems()}
	<HelpButton topic="voice-entry" variant="menu-item" />
{/snippet}

<Toolbar title="Speech Entry Configuration" {menuItems} />

<main class="mx-auto w-full max-w-2xl space-y-4 p-4 pb-24">
	{#if !loaded}
		<div class="flex justify-center p-8">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:else}
		<!-- Engine -->
		<section class="card bg-base-200 shadow">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-lg">Transcription engine</h2>
				<p class="text-sm opacity-70">
					Which service turns your speech into text on the
					<a class="link link-primary" href="/tools/voice-entry">Speech Entry</a> page.
				</p>

				<label
					class="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3 {engine ===
					'builtin'
						? 'border-primary'
						: ''}"
				>
					<input
						type="radio"
						class="radio radio-primary mt-1"
						name="speech-engine"
						value="builtin"
						bind:group={engine}
					/>
					<span class="flex-1">
						<span class="flex items-center gap-2 font-medium">
							<MicIcon size={18} /> Built-in (browser)
						</span>
						<span class="block text-sm opacity-70">
							The browser's own speech recognition. No setup and no API key; the audio is
							transcribed live by the browser's provider (Google in Chrome), so it needs a network
							connection.
						</span>
						{#if !builtinSupported}
							<span class="badge badge-warning badge-sm mt-1"> Not available in this browser </span>
						{/if}
					</span>
				</label>

				<label
					class="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3 {engine ===
					'mistral'
						? 'border-primary'
						: ''}"
				>
					<input
						type="radio"
						class="radio radio-primary mt-1"
						name="speech-engine"
						value="mistral"
						bind:group={engine}
					/>
					<span class="flex-1">
						<span class="flex items-center gap-2 font-medium">
							<SparklesIcon size={18} /> Mistral Voxtral
						</span>
						<span class="block text-sm opacity-70">
							Records the microphone and uploads the clip to Mistral's transcription API when you
							stop. Needs a Mistral API key and works in any browser that can record audio.
						</span>
						{#if !recordingSupported}
							<span class="badge badge-warning badge-sm mt-1">
								Recording is not available in this browser
							</span>
						{/if}
					</span>
				</label>
			</div>
		</section>

		<!-- Language -->
		<section class="card bg-base-200 shadow">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-lg">Language</h2>
				<p class="text-sm opacity-70">
					The language you speak. Both engines use it; leave it on the default if unsure.
				</p>
				<select class="select select-bordered w-full" bind:value={language}>
					{#each SPEECH_LANGUAGES as option (option.tag)}
						<option value={option.tag}>{option.label} ({option.tag})</option>
					{/each}
					{#if !SPEECH_LANGUAGES.some((option) => option.tag === language)}
						<option value={language}>{language}</option>
					{/if}
				</select>
			</div>
		</section>

		<!-- Mistral -->
		<section class="card bg-base-200 shadow">
			<div class="card-body gap-3 p-4">
				<h2 class="card-title text-lg">
					<KeyRoundIcon size={20} /> Mistral Voxtral
				</h2>

				<div class="space-y-1">
					<label class="text-sm font-medium" for="mistral-api-key">API key</label>
					<input
						id="mistral-api-key"
						type="password"
						class="input input-bordered w-full"
						autocomplete="off"
						placeholder="Paste your Mistral API key"
						bind:value={apiKey}
					/>
					<p class="text-xs opacity-60">
						Stored on this device only and never exported or synced. Create one in the
						<a
							class="link link-primary"
							href="https://console.mistral.ai/api-keys"
							target="_blank"
							rel="noreferrer"
						>
							Mistral console
						</a>.
					</p>
				</div>

				<div class="space-y-1">
					<label class="text-sm font-medium" for="mistral-model">Model</label>
					<input
						id="mistral-model"
						type="text"
						class="input input-bordered w-full font-mono text-sm"
						placeholder={MISTRAL_TRANSCRIPTION_MODEL}
						bind:value={model}
					/>
					<p class="text-xs opacity-60">
						Voxtral transcription model id. Default: <code>{MISTRAL_TRANSCRIPTION_MODEL}</code>.
					</p>
				</div>

				<div class="space-y-1">
					<label class="text-sm font-medium" for="proxy-key">Proxy key</label>
					<input
						id="proxy-key"
						type="password"
						class="input input-bordered w-full"
						autocomplete="off"
						placeholder="Required when the server sets PROXY_KEY"
						bind:value={proxyKey}
					/>
					<p class="text-xs opacity-60">
						The app's own proxy carries the request to Mistral (it sends no CORS headers). Leave
						empty when the proxy is not protected. The same key is used by
						<a class="link link-primary" href="/prices/download">Price Download</a>.
					</p>
				</div>

				<div class="divider my-1"></div>

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="btn btn-sm {testRecording ? 'btn-error' : 'btn-outline'}"
						onclick={() => void toggleTestRecording()}
						disabled={testing || !recordingSupported}
					>
						{#if testing}
							<span class="loading loading-spinner loading-xs"></span>
							Transcribing…
						{:else if testRecording}
							<SquareIcon size={16} /> Stop and transcribe
						{:else}
							<MicIcon size={16} /> Test transcription
						{/if}
					</button>
					{#if testRecording}
						<span class="text-sm opacity-70">Recording… speak now</span>
					{/if}
				</div>

				{#if testResult}
					<div class="alert alert-success text-sm">
						<span class="font-mono">{testResult}</span>
					</div>
				{/if}
				{#if testError}
					<div class="alert alert-error text-sm">{testError}</div>
				{/if}
			</div>
		</section>

		<button class="btn btn-primary w-full" onclick={() => void save()} disabled={saving}>
			{#if saving}
				<span class="loading loading-spinner loading-sm"></span>
			{/if}
			Save
		</button>
	{/if}
</main>
