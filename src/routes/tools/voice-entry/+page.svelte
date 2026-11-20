<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { Xact } from '#lib/data/model';
	import { xact as xactStore, xactId } from '#lib/data/mainStore';
	import {
		type ParseResult,
		parseTranscript,
		buildTransaction,
		formatBeancount
	} from '#lib/utils/nlpEntry';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
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
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import SquareIcon from '@lucide/svelte/icons/square-stop';

	// --- State ---

	/** The engine chosen on the configuration page (built-in by default). */
	let engine = $state<SpeechEngine>('builtin');
	let language = $state('en-US');
	let engineLoaded = $state(false);
	/** Whether the selected engine can run in this browser. */
	let supported = $state(true);
	/** Whether the Mistral engine has an API key to work with. */
	let hasApiKey = $state(true);

	let isListening = $state(false);
	let isTranscribing = $state(false);
	let transcript = $state('');
	let interimTranscript = $state('');
	let parseResult = $state<ParseResult | null>(null);
	let transaction = $state<Xact | null>(null);
	let errorMsg = $state('');
	let resolvingFrom = $state(false);

	function handleTranscript(text: string) {
		transcript = text;
		if (!text.trim()) return;
		parseResult = parseTranscript(text);
		transaction = buildTransaction(parseResult);
	}

	// --- Engine selection ---

	async function loadEngine() {
		engine = await getSpeechEngine();
		language = await getSpeechLanguage();
		// 'auto' is a Voxtral-only choice (the language field is omitted); the
		// Web Speech API needs a concrete tag, so fall back to the default.
		if (language === AUTO_SPEECH_LANGUAGE) language = DEFAULT_SPEECH_LANGUAGE;
		hasApiKey = engine === 'mistral' ? Boolean(await getMistralApiKey()) : true;
		supported = engine === 'mistral' ? isRecordingSupported() : isBuiltinSpeechSupported();
		engineLoaded = true;
	}

	// Runs once on mount; the configuration page is a separate route, so the
	// engine is read again whenever this page is opened.
	onMount(() => {
		void loadEngine();
	});

	// --- Built-in engine (Web Speech API) ---

	let recognition: SpeechRecognitionLike | null = null;

	function initRecognition(): SpeechRecognitionLike | null {
		const SR = getSpeechRecognitionCtor();
		if (!SR) {
			supported = false;
			return null;
		}

		const r = new SR();
		r.continuous = false;
		r.interimResults = true;
		r.lang = language;

		r.onresult = (event) => {
			let interim = '';
			let final = '';
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]!;
				const text = result[0].transcript;
				if (result.isFinal) final += text;
				else interim += text;
			}
			interimTranscript = interim;
			if (final) handleTranscript(final);
		};

		r.onerror = (event) => {
			errorMsg = describeSpeechError(event.error);
			isListening = false;
		};

		r.onend = () => {
			isListening = false;
			interimTranscript = '';
		};

		return r;
	}

	function toggleBuiltinListening() {
		errorMsg = '';
		if (isListening) {
			recognition?.stop();
			isListening = false;
			return;
		}

		recognition = initRecognition();
		if (!recognition) return;

		try {
			recognition.start();
			isListening = true;
			transcript = '';
			parseResult = null;
			transaction = null;
		} catch (e) {
			errorMsg = String(e);
		}
	}

	// --- Mistral engine (Voxtral) ---

	let recorder: MicrophoneRecorder | null = null;

	async function toggleMistralRecording() {
		errorMsg = '';
		if (isListening) {
			isListening = false;
			isTranscribing = true;
			try {
				const clip = await recorder?.stop();
				recorder = null;
				if (!clip) {
					errorMsg = 'Nothing was recorded. Try again and speak a little louder.';
					return;
				}
				const text = await transcribeWithMistral(clip);
				if (!text) {
					errorMsg = 'Mistral returned an empty transcription.';
					return;
				}
				handleTranscript(text);
			} catch (err) {
				errorMsg = (err as Error).message;
			} finally {
				isTranscribing = false;
			}
			return;
		}

		try {
			recorder = new MicrophoneRecorder();
			await recorder.start();
			isListening = true;
			transcript = '';
			interimTranscript = '';
			parseResult = null;
			transaction = null;
		} catch (err) {
			recorder = null;
			errorMsg = `Could not open the microphone: ${(err as Error).message}`;
		}
	}

	function toggleListening() {
		if (engine === 'mistral') void toggleMistralRecording();
		else toggleBuiltinListening();
	}

	// --- Text input ---

	let textInput = $state('');

	function submitTextInput() {
		if (!textInput.trim()) return;
		handleTranscript(textInput.trim());
		transcript = textInput.trim();
	}

	function useExample(phrase: string) {
		textInput = phrase;
		handleTranscript(phrase);
		transcript = phrase;
	}

	function openInEditor() {
		if (!transaction) return;
		xactStore.set(transaction);
		xactId.set(undefined);
		goto('/tx');
	}

	async function resolveFromAccount() {
		if (!parseResult?.fromAccount || parseResult.fromAccount.includes(':')) return;
		resolvingFrom = true;
		try {
			const raw = parseResult.fromAccount;
			const result = await fullLedgerService.query(
				`SELECT account WHERE account ~ '(?i)${raw}' GROUP BY account ORDER BY account`
			);
			if (result.errors.length === 0 && result.rows.length > 0) {
				const accountIdx = result.columns.indexOf('account');
				parseResult.fromAccount = (result.rows[0] as unknown[])[accountIdx] as string;
				transaction = buildTransaction(parseResult);
			}
		} finally {
			resolvingFrom = false;
		}
	}

	function clearAll() {
		transcript = '';
		interimTranscript = '';
		textInput = '';
		parseResult = null;
		transaction = null;
		errorMsg = '';
	}

	/** Label under the microphone button. */
	const micHint = $derived(
		isTranscribing
			? 'Transcribing…'
			: isListening
				? engine === 'mistral'
					? 'Recording… tap to stop and transcribe'
					: 'Listening… tap to stop'
				: engine === 'mistral'
					? 'Tap to record'
					: 'Tap to speak'
	);
</script>

{#snippet menuItems()}
	<ToolbarMenuItem text="Configuration" Icon={SettingsIcon} targetNav="/tools/voice-entry/config" />
	<HelpButton topic="voice-entry" variant="menu-item" />
{/snippet}

<main class="flex h-screen flex-col">
	<Toolbar title="Speech Entry" {menuItems} />

	<section class="flex flex-1 flex-col gap-4 overflow-y-auto p-4 touch-pan-y">
		{#if engineLoaded && !supported}
			<div class="alert alert-error">
				{#if engine === 'mistral'}
					This browser cannot record audio, so the Mistral engine is unavailable. Try Chrome or
					Edge, or switch to the built-in engine in the
					<a class="link" href="/tools/voice-entry/config">configuration</a>.
				{:else}
					Web Speech API is not supported in this browser. Try Chrome or Edge, or switch to the
					Mistral engine in the <a class="link" href="/tools/voice-entry/config">configuration</a>.
				{/if}
			</div>
		{/if}

		{#if engineLoaded && engine === 'mistral' && !hasApiKey}
			<div class="alert alert-warning text-sm">
				No Mistral API key is set. Add one in the
				<a class="link" href="/tools/voice-entry/config">configuration</a>.
			</div>
		{/if}

		<!-- Mic button -->
		<div class="flex flex-col items-center gap-3 py-4">
			<button
				class="btn btn-circle h-24 w-24 text-4xl shadow-lg transition-all
                       {isListening ? 'btn-error animate-pulse' : 'btn-primary'}"
				onclick={toggleListening}
				disabled={!supported || isTranscribing}
				aria-label={isListening ? 'Stop listening' : 'Start listening'}
			>
				{#if isTranscribing}
					<span class="loading loading-spinner loading-lg"></span>
				{:else if isListening && engine === 'mistral'}
					<SquareIcon size={36} />
				{:else}
					🎤
				{/if}
			</button>
			<span class="text-sm opacity-60">{micHint}</span>
			<span class="text-xs opacity-40">
				Engine: {engine === 'mistral' ? 'Mistral Voxtral' : 'Built-in (browser)'}
			</span>
		</div>

		<!-- Text input fallback -->
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				submitTextInput();
			}}
		>
			<input
				class="input input-bordered flex-1 text-sm"
				type="text"
				placeholder="Or type a phrase…"
				bind:value={textInput}
			/>
			<button class="btn btn-primary btn-sm" type="submit">Parse</button>
		</form>

		<!-- Transcript display -->
		{#if transcript || interimTranscript}
			<div class="card bg-base-200 shadow">
				<div class="card-body gap-1 p-4">
					<h3 class="card-title text-sm">Transcript</h3>
					<p class="text-base">
						{transcript}
						{#if interimTranscript}
							<span class="opacity-40 italic">{interimTranscript}</span>
						{/if}
					</p>
				</div>
			</div>
		{/if}

		<!-- Parse results -->
		{#if parseResult}
			<div class="card bg-base-200 shadow">
				<div class="card-body gap-2 p-4">
					<div class="flex items-center justify-between">
						<h3 class="card-title text-sm">Parsed fields</h3>
						<div
							class="badge {parseResult.confidence >= 60
								? 'badge-success'
								: parseResult.confidence >= 30
									? 'badge-warning'
									: 'badge-error'}"
						>
							{parseResult.confidence}% confidence
						</div>
					</div>
					<ul class="list-disc list-inside text-sm space-y-1">
						{#each parseResult.matched as item}
							<li>{item}</li>
						{/each}
					</ul>
					{#if parseResult.fromAccount && !parseResult.fromAccount.includes(':')}
						<div class="flex items-center gap-2 pt-1">
							<span class="text-xs opacity-60">
								from account "{parseResult.fromAccount}" not resolved
							</span>
							<button
								class="btn btn-xs btn-ghost gap-1"
								onclick={resolveFromAccount}
								disabled={resolvingFrom}
							>
								{#if resolvingFrom}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									<span>↻</span>
								{/if}
								Resolve
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Beancount preview -->
		{#if transaction}
			<div class="card bg-base-200 shadow">
				<div class="card-body gap-2 p-4">
					<h3 class="card-title text-sm">Transaction preview</h3>
					<pre
						class="text-xs bg-base-300 rounded p-3 whitespace-pre-wrap font-mono">{formatBeancount(
							transaction
						)}</pre>
				</div>
			</div>
		{/if}

		{#if transaction}
			<button class="btn btn-primary self-center" onclick={openInEditor}>Open in Editor</button>
		{/if}

		{#if errorMsg}
			<div class="alert alert-error text-sm">{errorMsg}</div>
		{/if}

		<!-- Example phrases -->
		{#if !transcript && !isListening}
			<div class="card bg-base-200 shadow">
				<div class="card-body gap-2 p-4">
					<h3 class="card-title text-sm">Example phrases</h3>
					<ul class="text-sm space-y-1">
						{#each ['Paid 25 euros at Starbucks', 'Spent 12 dollars for lunch', 'Received 500 euros from salary', 'Transferred 100 euros from checking to savings', 'Bought groceries for 35 euros'] as phrase}
							<li>
								<button
									class="text-left opacity-70 hover:opacity-100 hover:underline"
									onclick={() => useExample(phrase)}
								>
									"{phrase}"
								</button>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}

		<!-- Clear -->
		{#if transcript}
			<button class="btn btn-ghost btn-sm self-center" onclick={clearAll}>Clear</button>
		{/if}
	</section>
</main>
