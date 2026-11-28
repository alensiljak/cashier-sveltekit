<script lang="ts">
	/*
		Microphone button for Quick Entry's Voice mode. It owns the speech engine (built-in Web
		Speech API or Mistral Voxtral, chosen on the speech configuration page) and reports
		the recognised text through `onTranscript`; the host decides what to do with it.
		`interim` (live text from the built-in engine) and `error` are bindable so the host can
		show them next to its own input.
	*/
	import { onDestroy, onMount } from 'svelte';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SquareIcon from '@lucide/svelte/icons/square-stop';
	import {
		AUTO_SPEECH_LANGUAGE,
		DEFAULT_SPEECH_LANGUAGE,
		MicrophoneRecorder,
		describeSpeechError,
		getMistralApiKey,
		getSpeechEngine,
		getSpeechLanguage,
		getSpeechRecognitionCtor,
		isBuiltinSpeechSupported,
		isRecordingSupported,
		transcribeWithMistral,
		type SpeechEngine,
		type SpeechRecognitionLike
	} from '#lib/services/speechService';
	import { loadProxySettings } from '#lib/services/prices/proxyFetch';

	type Props = {
		onTranscript: (text: string) => void;
		interim?: string;
		error?: string;
		/** Persistent "missing configuration" message (empty when set up), for the host to show with a link. */
		setupNotice?: string;
	};
	let {
		onTranscript,
		interim = $bindable(''),
		error = $bindable(''),
		setupNotice = $bindable('')
	}: Props = $props();

	let engine = $state<SpeechEngine>('builtin');
	let language = $state(DEFAULT_SPEECH_LANGUAGE);
	let supported = $state(true);
	let isListening = $state(false);
	let isTranscribing = $state(false);

	let recognition: SpeechRecognitionLike | null = null;
	let recorder: MicrophoneRecorder | null = null;

	/** Reads the engine settings, so a change on the configuration page applies on return. */
	async function loadEngine() {
		engine = await getSpeechEngine();
		language = await getSpeechLanguage();
		// 'auto' is Voxtral-only; the Web Speech API needs a concrete tag.
		if (language === AUTO_SPEECH_LANGUAGE) language = DEFAULT_SPEECH_LANGUAGE;
		supported = engine === 'mistral' ? isRecordingSupported() : isBuiltinSpeechSupported();
		if (!supported) {
			error =
				engine === 'mistral'
					? 'This browser cannot record audio, so the Mistral engine is unavailable. Try another browser or switch engines in Speech settings.'
					: 'Speech recognition is not supported in this browser. Try Chrome or Edge, or switch to Mistral in Speech settings.';
		} else if (engine === 'mistral') {
			// Persistent (not a transient error): Voxtral needs the Mistral key, and the proxy
			// key when the server protects the proxy.
			const missing: string[] = [];
			if (!(await getMistralApiKey())) missing.push('a Mistral API key (Speech Settings)');
			if (!(await loadProxySettings()).key)
				missing.push('a proxy key (Settings → Device Settings)');
			setupNotice = missing.length
				? `Voxtral needs ${missing.join(' and ')}${missing.some((m) => m.startsWith('a proxy key')) ? ' — the proxy key is only needed when the proxy is protected' : ''}.`
				: '';
		}
	}

	onMount(() => void loadEngine());

	onDestroy(() => {
		try {
			recognition?.stop();
			void recorder?.stop();
		} catch {
			// Already stopped.
		}
	});

	// --- Built-in engine ---

	function startBuiltin() {
		const SR = getSpeechRecognitionCtor();
		if (!SR) {
			supported = false;
			return;
		}
		const r = new SR();
		r.continuous = false;
		r.interimResults = true;
		r.lang = language;

		r.onresult = (event) => {
			let interimText = '';
			let finalText = '';
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]!;
				const text = result[0].transcript;
				if (result.isFinal) finalText += text;
				else interimText += text;
			}
			interim = interimText;
			if (finalText) onTranscript(finalText);
		};
		r.onerror = (event) => {
			error = describeSpeechError(event.error);
			isListening = false;
		};
		r.onend = () => {
			isListening = false;
			interim = '';
		};

		recognition = r;
		try {
			r.start();
			isListening = true;
		} catch (e) {
			error = String(e);
		}
	}

	// --- Mistral engine ---

	async function toggleMistral() {
		if (isListening) {
			isListening = false;
			isTranscribing = true;
			try {
				const clip = await recorder?.stop();
				recorder = null;
				if (!clip) {
					error = 'Nothing was recorded. Try again and speak a little louder.';
					return;
				}
				const text = await transcribeWithMistral(clip);
				if (!text) {
					error = 'Mistral returned an empty transcription.';
					return;
				}
				onTranscript(text);
			} catch (e) {
				error = (e as Error).message;
			} finally {
				isTranscribing = false;
			}
			return;
		}

		try {
			recorder = new MicrophoneRecorder();
			await recorder.start();
			isListening = true;
			interim = '';
		} catch (e) {
			recorder = null;
			error = `Could not open the microphone: ${(e as Error).message}`;
		}
	}

	function toggle() {
		error = '';
		if (engine === 'mistral') {
			void toggleMistral();
		} else if (isListening) {
			recognition?.stop();
			isListening = false;
		} else {
			startBuiltin();
		}
	}
</script>

<button
	type="button"
	class="btn btn-circle shadow {isListening ? 'btn-error animate-pulse' : 'btn-primary'}"
	onclick={toggle}
	disabled={!supported || isTranscribing}
	aria-label={isListening ? 'Stop listening' : 'Start voice input'}
	title={isListening
		? engine === 'mistral'
			? 'Recording… tap to stop and transcribe'
			: 'Listening… tap to stop'
		: 'Speak a transaction'}
>
	{#if isTranscribing}
		<span class="loading loading-spinner loading-sm"></span>
	{:else if isListening && engine === 'mistral'}
		<SquareIcon size={20} />
	{:else}
		<MicIcon size={20} />
	{/if}
</button>
