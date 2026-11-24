<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import Notifier from '#lib/utils/notifier';
	import {
		DEFAULT_SPEECH_LANGUAGE,
		MISTRAL_TRANSCRIPTION_MODEL,
		VOXTRAL_MODELS,
		MicrophoneRecorder,
		getMistralApiKey,
		getMistralModel,
		getSpeechEngine,
		getSpeechLanguage,
		isBuiltinSpeechSupported,
		isKnownVoxtralModel,
		isRecordingSupported,
		mistralLanguageCode,
		setMistralApiKey,
		setMistralModel,
		setSpeechEngine,
		setSpeechLanguage,
		speechLanguageOptions,
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
	/** True when the model field is a free-text id instead of the dropdown. */
	let manualModel = $state(false);
	let loaded = $state(false);
	let saving = $state(false);

	/** Language options for the selected engine and model. */
	const languageOptions = $derived(speechLanguageOptions(engine, model));

	/**
	 * The tag to select in the dropdown. The two engines store the same setting
	 * in different shapes (`sl-SI` for the browser, `sl` for Voxtral), so a tag
	 * that is not in the current list is mapped to its primary subtag when that
	 * one is offered, and otherwise falls back to the first option.
	 */
	const selectedLanguage = $derived.by(() => {
		if (languageOptions.some((option) => option.tag === language)) return language;
		const code = mistralLanguageCode(language);
		const match = languageOptions.find((option) => option.tag === code);
		return match ? match.tag : (languageOptions[0]?.tag ?? DEFAULT_SPEECH_LANGUAGE);
	});

	/**
	 * The language the user last saw selected. The warning fires when the
	 * resolved value changes, and once on load when the stored value was
	 * already unsupported.
	 */
	let shownLanguage = $state('');

	// Warn when the stored language is not offered by the current engine and
	// model, so the dropdown had to fall back to another one.
	$effect(() => {
		const shown = selectedLanguage;
		// Before the settings load, `language` is still the default: record
		// nothing, so the first real value is reported as a change.
		if (!loaded) return;
		const previous = shownLanguage;
		shownLanguage = shown;
		// The stored tag is offered as-is: nothing was replaced.
		if (languageOptions.some((option) => option.tag === language)) return;
		// Only report a change, so the warning is not repeated on every update.
		if (previous === shown) return;
		const label = languageOptions.find((option) => option.tag === shown)?.label ?? shown;
		Notifier.warning(
			`${language} is not available for this engine and model. Using ${label} (${shown}) instead.`
		);
	});

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
		manualModel = !isKnownVoxtralModel(model);
		loaded = true;
	});

	/**
	 * The language tag to store: the one the dropdown shows, which is the picked
	 * tag, its primary subtag, or the first option when neither is offered.
	 */
	function normalizedLanguage(): string {
		return selectedLanguage.trim() || DEFAULT_SPEECH_LANGUAGE;
	}

	async function save() {
		saving = true;
		try {
			await setSpeechEngine(engine);
			await setSpeechLanguage(normalizedLanguage());
			await setMistralApiKey(apiKey);
			await setMistralModel(model);
			language = normalizedLanguage();
			model = model.trim() || MISTRAL_TRANSCRIPTION_MODEL;
			apiKey = apiKey.trim();
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

<Toolbar title="Speech Settings" {menuItems} />

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
					Which service turns your speech into text in
					<a class="link link-primary" href="/tx/quick-entry">Quick Entry</a>'s Voice mode.
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
					{#if engine === 'mistral'}
						All languages the selected Voxtral model supports are listed. <strong>Auto-detect</strong>
						leaves the language to the model — try it for languages not on the list (e.g. Bosnian),
						but a pinned language is more reliable on short recordings.
					{/if}
				</p>
				<select class="select select-bordered w-full" bind:value={language}>
					{#each languageOptions as option (option.tag)}
						<option value={option.tag}>{option.label} ({option.tag})</option>
					{/each}
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
					{#if manualModel}
						<input
							id="mistral-model"
							type="text"
							class="input input-bordered w-full font-mono text-sm"
							placeholder={MISTRAL_TRANSCRIPTION_MODEL}
							bind:value={model}
						/>
					{:else}
						<select id="mistral-model" class="select select-bordered w-full" bind:value={model}>
							{#each VOXTRAL_MODELS as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					{/if}
					<p class="text-xs opacity-60">
						Voxtral transcription model id. Default: <code>{MISTRAL_TRANSCRIPTION_MODEL}</code>.
						{#if manualModel}
							The language list is only known for the models above; a manual id uses the default
							model's list.
						{:else}
							Only file-transcription models work here — the TTS and realtime models answer on
							other endpoints.
						{/if}
					</p>
					<label class="label cursor-pointer justify-start gap-2 py-0">
						<input
							type="checkbox"
							class="checkbox checkbox-xs"
							bind:checked={manualModel}
							onchange={() => {
								if (!manualModel) model = MISTRAL_TRANSCRIPTION_MODEL;
							}}
						/>
						<span class="text-xs opacity-70">Enter the model id manually</span>
					</label>
				</div>

				<p class="text-xs opacity-60">
					The request to Mistral goes through the app's HTTP proxy (Mistral sends no CORS headers).
					Set the proxy URL and its key in
					<a class="link link-primary" href="/settings#device-settings"
						>Settings → Device Settings → HTTP Proxy</a
					>. The same settings are used by
					<a class="link link-primary" href="/prices/download">Price Download</a>.
				</p>

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
