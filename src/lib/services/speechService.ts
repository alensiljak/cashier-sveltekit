/**
 * Speech transcription engines for Quick Entry.
 *
 * Two engines can turn speech into text for Quick Entry's Voice mode
 * (`VoiceInputButton.svelte`; configured at `src/routes/tools/voice-entry/config`):
 *
 * - `builtin` — the browser's Web Speech API (`SpeechRecognition`), which
 *   transcribes live while the user speaks. It is the default and needs no
 *   setup, but Chrome sends the audio to Google's servers, so it needs a
 *   network connection and is unavailable in some browsers.
 * - `mistral` — Mistral's Voxtral transcription API. The page records the
 *   microphone with `MediaRecorder` and the clip is uploaded once, when the
 *   user stops. The API key is entered in Speech Settings
 *   and kept in device settings only (it is a credential).
 *
 * The engine choice, language and model are device settings
 * (`DeviceSettingKeys.speechEngine`, `speechLanguage`, `mistralTranscriptionModel`).
 *
 * Voxtral is called through the app's same-origin CORS proxy
 * (`worker/proxy.ts`), because `api.mistral.ai` sends no CORS headers for the
 * app's origin. The proxy forwards the user's key as `Authorization: Bearer`
 * and only to that host.
 */

import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { proxyFetch } from './prices/proxyFetch';

/** The transcription engines Quick Entry can use. */
export type SpeechEngine = 'builtin' | 'mistral';

/** Default engine: the browser's own speech recognition. */
export const DEFAULT_SPEECH_ENGINE: SpeechEngine = 'builtin';

/** Voxtral transcription endpoint. */
export const MISTRAL_TRANSCRIPTION_URL = 'https://api.mistral.ai/v1/audio/transcriptions';

/** Default recognition language when none is configured. */
export const DEFAULT_SPEECH_LANGUAGE = 'en-US';

/**
 * The Voxtral "auto" choice: the `language` field is omitted and the model
 * detects the language itself. Useful for languages the model does not
 * officially list (e.g. Bosnian). Not offered for the built-in engine, which
 * has no detection — it always needs a concrete tag.
 *
 * `mistralLanguageCode` maps this tag to '', which makes
 * `transcribeWithMistral` drop the `language` field.
 */
export const AUTO_SPEECH_LANGUAGE = 'auto';

/**
 * Languages offered for the built-in engine (BCP-47 tags).
 *
 * This list is the browser's constraint, not Voxtral's: the Web Speech API
 * accepts full tags and its coverage differs from Mistral's. Voxtral has its
 * own list per model, below.
 */
export const BUILTIN_SPEECH_LANGUAGES: ReadonlyArray<{ tag: string; label: string }> = [
	{ tag: 'en-US', label: 'English (US)' },
	{ tag: 'en-GB', label: 'English (UK)' },
	{ tag: 'en-AU', label: 'English (Australia)' },
	{ tag: 'de-DE', label: 'German' },
	{ tag: 'fr-FR', label: 'French' },
	{ tag: 'es-ES', label: 'Spanish' },
	{ tag: 'it-IT', label: 'Italian' },
	{ tag: 'nl-NL', label: 'Dutch' },
	{ tag: 'pt-PT', label: 'Portuguese' },
	{ tag: 'sl-SI', label: 'Slovenian' },
	{ tag: 'hr-HR', label: 'Croatian' },
	{ tag: 'sr-RS', label: 'Serbian' }
];

/**
 * The 53 languages Voxtral 3 file transcription accepts, as ISO 639-1 codes.
 *
 * Transcribed from
 * https://docs.mistral.ai/studio/audio/specs-and-limits/languages on
 * 2026-11-19, for `voxtral-mini-transcribe-3` and
 * `voxtral-small-transcribe-3` (both list the same 53). Re-check that page
 * when adding a model or bumping a model id: the API rejects a code outside
 * the model's list with HTTP 422.
 */
const VOXTRAL_3_STT_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
	{ code: 'ar', label: 'Arabic' },
	{ code: 'bn', label: 'Bengali' },
	{ code: 'bg', label: 'Bulgarian' },
	{ code: 'my', label: 'Burmese' },
	{ code: 'ca', label: 'Catalan' },
	{ code: 'zh', label: 'Chinese' },
	{ code: 'cs', label: 'Czech' },
	{ code: 'da', label: 'Danish' },
	{ code: 'nl', label: 'Dutch' },
	{ code: 'en', label: 'English' },
	{ code: 'et', label: 'Estonian' },
	{ code: 'tl', label: 'Filipino' },
	{ code: 'fi', label: 'Finnish' },
	{ code: 'fr', label: 'French' },
	{ code: 'de', label: 'German' },
	{ code: 'el', label: 'Greek' },
	{ code: 'gu', label: 'Gujarati' },
	{ code: 'hi', label: 'Hindi' },
	{ code: 'hu', label: 'Hungarian' },
	{ code: 'is', label: 'Icelandic' },
	{ code: 'id', label: 'Indonesian' },
	{ code: 'it', label: 'Italian' },
	{ code: 'ja', label: 'Japanese' },
	{ code: 'kn', label: 'Kannada' },
	{ code: 'km', label: 'Khmer' },
	{ code: 'ko', label: 'Korean' },
	{ code: 'lv', label: 'Latvian' },
	{ code: 'lt', label: 'Lithuanian' },
	{ code: 'lb', label: 'Luxembourgish' },
	{ code: 'mk', label: 'Macedonian' },
	{ code: 'ms', label: 'Malay' },
	{ code: 'ml', label: 'Malayalam' },
	{ code: 'mt', label: 'Maltese' },
	{ code: 'mr', label: 'Marathi' },
	{ code: 'no', label: 'Norwegian' },
	{ code: 'or', label: 'Odia' },
	{ code: 'fa', label: 'Persian' },
	{ code: 'pl', label: 'Polish' },
	{ code: 'pt', label: 'Portuguese' },
	{ code: 'pa', label: 'Punjabi' },
	{ code: 'ro', label: 'Romanian' },
	{ code: 'ru', label: 'Russian' },
	{ code: 'sr', label: 'Serbian' },
	{ code: 'sk', label: 'Slovak' },
	{ code: 'sl', label: 'Slovenian' },
	{ code: 'es', label: 'Spanish' },
	{ code: 'sv', label: 'Swedish' },
	{ code: 'ta', label: 'Tamil' },
	{ code: 'te', label: 'Telugu' },
	{ code: 'th', label: 'Thai' },
	{ code: 'tr', label: 'Turkish' },
	{ code: 'uk', label: 'Ukrainian' },
	{ code: 'vi', label: 'Vietnamese' }
];

/** A Voxtral file-transcription model and the languages it accepts. */
export interface VoxtralModel {
	/** Model id sent in the `model` field. */
	id: string;
	label: string;
	/** ISO 639-1 codes accepted in the `language` field. */
	languages: ReadonlyArray<{ code: string; label: string }>;
}

/**
 * Voxtral file-transcription models offered on the configuration page.
 *
 * Only transcribe models belong here: the TTS model (`voxtral-mini-tts-3-0`)
 * and the realtime model answer on other endpoints and would fail here.
 *
 * The ids are Mistral's major-version aliases (`-3`), which follow the 3.x
 * minor releases, so they need no change per release.
 */
export const VOXTRAL_MODELS: ReadonlyArray<VoxtralModel> = [
	{
		id: 'voxtral-mini-transcribe-3',
		label: 'Voxtral Mini Transcribe 3 (default)',
		languages: VOXTRAL_3_STT_LANGUAGES
	},
	{
		id: 'voxtral-small-transcribe-3',
		label: 'Voxtral Small Transcribe 3 (higher quality)',
		languages: VOXTRAL_3_STT_LANGUAGES
	}
];

/** Default Voxtral model. */
export const MISTRAL_TRANSCRIPTION_MODEL = VOXTRAL_MODELS[0]!.id;

/** The known model with this id, or undefined for a manually entered one. */
export function findVoxtralModel(id: string): VoxtralModel | undefined {
	const trimmed = id.trim();
	return VOXTRAL_MODELS.find((model) => model.id === trimmed);
}

/**
 * The languages to offer for a model id. A manually entered id has no known
 * list, so the default model's list is offered as the best guess.
 */
export function languagesForModel(id: string): ReadonlyArray<{ code: string; label: string }> {
	return (findVoxtralModel(id) ?? VOXTRAL_MODELS[0]!).languages;
}

/** Whether a model id is one of the known Voxtral transcription models. */
export function isKnownVoxtralModel(id: string): boolean {
	return findVoxtralModel(id) !== undefined;
}

/** Whether the browser has the Web Speech API (Chrome, Edge, Safari). */
export function isBuiltinSpeechSupported(): boolean {
	if (typeof window === 'undefined') return false;
	const w = window as unknown as Record<string, unknown>;
	return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Whether the browser can record audio for the Voxtral engine. */
export function isRecordingSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.MediaRecorder !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		Boolean(navigator.mediaDevices?.getUserMedia)
	);
}

// --- Settings ---------------------------------------------------------------

export async function getSpeechEngine(): Promise<SpeechEngine> {
	const stored = await deviceSettings.get<string>(DeviceSettingKeys.speechEngine);
	return stored === 'mistral' ? 'mistral' : DEFAULT_SPEECH_ENGINE;
}

export async function setSpeechEngine(engine: SpeechEngine): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.speechEngine, engine);
}

/** Whether Quick Entry shows the microphone button (the toolbar's Voice mode toggle). */
export async function getVoiceMode(): Promise<boolean> {
	return (await deviceSettings.get<boolean>(DeviceSettingKeys.speechVoiceMode)) === true;
}

export async function setVoiceMode(enabled: boolean): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.speechVoiceMode, enabled);
}

/** Configured language tag, or the default when unset. */
export async function getSpeechLanguage(): Promise<string> {
	const stored = await deviceSettings.get<string>(DeviceSettingKeys.speechLanguage);
	return stored?.trim() || DEFAULT_SPEECH_LANGUAGE;
}

export async function setSpeechLanguage(language: string): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.speechLanguage, language.trim());
}

/**
 * The language options to show for an engine.
 *
 * The stored setting is a BCP-47 tag shared by both engines (option A): the
 * built-in engine gets the full tag, Voxtral gets its primary subtag.
 *
 * Each engine therefore offers its own list in full. The built-in engine shows
 * the tags the browser knows; Voxtral shows an auto-detect choice first, then
 * every language the selected model accepts, as a `code` tag (`sl`, `zh`, …) —
 * a superset of the browser's list, so Croatian (browser-only) disappears and
 * Arabic, Chinese or Polish (Voxtral only) become reachable.
 */
export function speechLanguageOptions(
	engine: SpeechEngine,
	model: string
): ReadonlyArray<{ tag: string; label: string }> {
	if (engine === 'builtin') return BUILTIN_SPEECH_LANGUAGES;
	return [
		{ tag: AUTO_SPEECH_LANGUAGE, label: 'Auto-detect' },
		...languagesForModel(model).map((language) => ({
			tag: language.code,
			label: language.label
		}))
	];
}

/**
 * Whether the stored tag can be sent to this model. A tag with no two-letter
 * primary subtag is allowed: the `language` field is then omitted and Voxtral
 * detects the language itself.
 */
export function isLanguageSupportedByModel(tag: string, model: string): boolean {
	const code = mistralLanguageCode(tag);
	if (!code) return true;
	return languagesForModel(model).some((language) => language.code === code);
}

/** Configured Voxtral model id, or the default when unset. */
export async function getMistralModel(): Promise<string> {
	const stored = await deviceSettings.get<string>(DeviceSettingKeys.mistralTranscriptionModel);
	return stored?.trim() || MISTRAL_TRANSCRIPTION_MODEL;
}

export async function setMistralModel(model: string): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.mistralTranscriptionModel, model.trim());
}

/** The stored Mistral API key (device-only credential), trimmed. */
export async function getMistralApiKey(): Promise<string> {
	return ((await deviceSettings.get<string>(DeviceSettingKeys.mistralApiKey)) ?? '').trim();
}

export async function setMistralApiKey(key: string): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.mistralApiKey, key.trim());
}

// --- Built-in engine (Web Speech API) ---------------------------------------

/** The slice of the Web Speech API this module uses. */
export interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

export interface SpeechRecognitionEventLike {
	resultIndex: number;
	results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's `SpeechRecognition` constructor, or null when unsupported. */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as Record<string, unknown>;
	return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

/** A human-readable message for a Web Speech API error code. */
export function describeSpeechError(code: string): string {
	switch (code) {
		case 'network':
			return 'Network error: Chrome sends audio to Google servers, which are unreachable. Use the text input below, or switch to the Mistral engine in the configuration.';
		case 'not-allowed':
		case 'service-not-allowed':
			return 'Microphone permission denied. Allow access and try again.';
		case 'no-speech':
			return 'No speech was detected. Try again.';
		case 'audio-capture':
			return 'No microphone was found.';
		case 'aborted':
			return 'Listening stopped.';
		default:
			return `Speech error: ${code}`;
	}
}

// --- Mistral engine (Voxtral) -----------------------------------------------

/** A recorded audio clip, ready to upload. */
export interface RecordedClip {
	blob: Blob;
	/** File name sent with the upload; the extension follows the MIME type. */
	fileName: string;
}

/** The slice of `Response` the transcription call needs. */
export interface TranscriptionResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export type TranscriptionFetch = (
	url: string,
	init?: RequestInit & { upstreamBearer?: string }
) => Promise<TranscriptionResponse>;

/** File extension for a recorder MIME type (`audio/webm;codecs=opus` → `webm`). */
export function extensionForMimeType(mimeType: string): string {
	const base = mimeType.split(';')[0]!.trim().toLowerCase();
	switch (base) {
		case 'audio/webm':
			return 'webm';
		case 'audio/ogg':
			return 'ogg';
		case 'audio/mp4':
		case 'audio/m4a':
		case 'audio/x-m4a':
			return 'm4a';
		case 'audio/mpeg':
			return 'mp3';
		case 'audio/wav':
		case 'audio/x-wav':
			return 'wav';
		default:
			return 'webm';
	}
}

/**
 * The ISO 639-1 alpha-2 code Mistral's `language` field expects (`en-US` →
 * `en`). The API rejects any other format with HTTP 422, so the BCP-47 tag
 * stored for the built-in engine is shortened here. Returns '' when the tag
 * has no two-letter primary subtag; the field is then omitted and the model
 * detects the language.
 */
export function mistralLanguageCode(tag: string): string {
	const match = /^([a-z]{2})(?:[-_]|$)/i.exec(tag.trim());
	return match ? match[1]!.toLowerCase() : '';
}

/** The `text` field of a Voxtral transcription response. Throws on a changed shape. */
export function parseTranscriptionResponse(body: unknown): string {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new Error('Mistral returned an unexpected transcription response');
	}
	const text = (body as Record<string, unknown>).text;
	if (typeof text !== 'string') {
		throw new Error('Mistral returned no transcription text');
	}
	return text.trim();
}

/** The error message inside a Mistral error body, when there is one. */
function mistralErrorMessage(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const message = (body as Record<string, unknown>).message;
	if (typeof message === 'string' && message.trim()) return message.trim();
	const detail = (body as Record<string, unknown>).detail;
	if (typeof detail === 'string' && detail.trim()) return detail.trim();
	return undefined;
}

export interface TranscribeOptions {
	/** Overrides the stored key (used by the configuration page's test button). */
	apiKey?: string;
	/** Overrides the stored model. */
	model?: string;
	/** Overrides the stored language. */
	language?: string;
	/** Injectable fetch for unit tests. */
	fetchImpl?: TranscriptionFetch;
}

/**
 * Transcribe a recorded clip with Mistral Voxtral.
 *
 * The request goes through the app's CORS proxy, which forwards the key as
 * `Authorization: Bearer` to `api.mistral.ai` only.
 */
export async function transcribeWithMistral(
	clip: RecordedClip,
	options: TranscribeOptions = {}
): Promise<string> {
	const apiKey = (options.apiKey ?? (await getMistralApiKey())).trim();
	if (!apiKey) {
		throw new Error('Enter the Mistral API key in Speech Settings first.');
	}
	const model = (options.model ?? (await getMistralModel())).trim() || MISTRAL_TRANSCRIPTION_MODEL;
	const tag = options.language ?? (await getSpeechLanguage());
	const language = mistralLanguageCode(tag);

	// Fail with a readable message instead of Mistral's opaque 422.
	if (language && !isLanguageSupportedByModel(tag, model)) {
		const name = languagesForModel(model).find((entry) => entry.code === language)?.label;
		throw new Error(
			`${model} does not support the language "${tag}"${name ? ` (${name})` : ''}. Pick another language on the configuration page, or leave it empty to let Voxtral detect it.`
		);
	}

	const form = new FormData();
	form.append('file', clip.blob, clip.fileName);
	form.append('model', model);
	if (language) form.append('language', language);

	const fetchImpl = options.fetchImpl ?? proxyFetch;
	const response = await fetchImpl(MISTRAL_TRANSCRIPTION_URL, {
		method: 'POST',
		upstreamBearer: apiKey,
		body: form
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error('Mistral rejected the API key. Check it on the configuration page.');
	}
	if (!response.ok) {
		let detail: string | undefined;
		try {
			detail = mistralErrorMessage(await response.json());
		} catch {
			detail = undefined;
		}
		throw new Error(
			`Mistral transcription failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`
		);
	}

	return parseTranscriptionResponse(await response.json());
}

// --- Microphone recording ---------------------------------------------------

/** Preferred recorder MIME types, best first. */
const RECORDER_MIME_TYPES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4'
];

/** The first recorder MIME type this browser supports, or '' for its default. */
export function pickRecorderMimeType(): string {
	if (typeof MediaRecorder === 'undefined') return '';
	const supported = MediaRecorder.isTypeSupported?.bind(MediaRecorder);
	if (!supported) return '';
	return RECORDER_MIME_TYPES.find((type) => supported(type)) ?? '';
}

/**
 * Records the microphone into a single clip. `start()` opens the microphone
 * (the permission prompt appears here), `stop()` closes it and resolves with
 * the clip.
 */
export class MicrophoneRecorder {
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private mimeType = '';

	/** Whether a recording is in progress. */
	get isRecording(): boolean {
		return this.recorder?.state === 'recording';
	}

	async start(): Promise<void> {
		if (this.isRecording) return;
		if (!isRecordingSupported()) {
			throw new Error('This browser cannot record audio. Use the built-in engine instead.');
		}
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.mimeType = pickRecorderMimeType();
		this.chunks = [];
		const recorder = this.mimeType
			? new MediaRecorder(this.stream, { mimeType: this.mimeType })
			: new MediaRecorder(this.stream);
		recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		};
		recorder.start();
		this.recorder = recorder;
	}

	/** Stops recording and resolves with the clip (null when nothing was captured). */
	async stop(): Promise<RecordedClip | null> {
		const recorder = this.recorder;
		if (!recorder) return null;
		const stopped = new Promise<void>((resolve) => {
			recorder.onstop = () => resolve();
		});
		if (recorder.state !== 'inactive') recorder.stop();
		await stopped;
		this.release();
		if (this.chunks.length === 0) return null;
		const type = this.mimeType || this.chunks[0]!.type || 'audio/webm';
		const blob = new Blob(this.chunks, { type });
		this.chunks = [];
		return { blob, fileName: `speech.${extensionForMimeType(type)}` };
	}

	/** Stops recording and discards the audio. */
	cancel(): void {
		const recorder = this.recorder;
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		this.chunks = [];
		this.release();
	}

	private release(): void {
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.recorder = null;
	}
}
