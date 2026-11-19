/**
 * Speech Entry transcription engines.
 *
 * Two engines can turn speech into text for the Speech Entry page
 * (`src/routes/tools/voice-entry`):
 *
 * - `builtin` — the browser's Web Speech API (`SpeechRecognition`), which
 *   transcribes live while the user speaks. It is the default and needs no
 *   setup, but Chrome sends the audio to Google's servers, so it needs a
 *   network connection and is unavailable in some browsers.
 * - `mistral` — Mistral's Voxtral transcription API. The page records the
 *   microphone with `MediaRecorder` and the clip is uploaded once, when the
 *   user stops. The API key is entered on the Speech Entry configuration page
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

/** The transcription engines the Speech Entry page can use. */
export type SpeechEngine = 'builtin' | 'mistral';

/** Default engine: the browser's own speech recognition. */
export const DEFAULT_SPEECH_ENGINE: SpeechEngine = 'builtin';

/** Default Voxtral model. */
export const MISTRAL_TRANSCRIPTION_MODEL = 'voxtral-mini-latest';

/** Voxtral transcription endpoint. */
export const MISTRAL_TRANSCRIPTION_URL = 'https://api.mistral.ai/v1/audio/transcriptions';

/** Default recognition language when none is configured. */
export const DEFAULT_SPEECH_LANGUAGE = 'en-US';

/** Languages offered on the configuration page (BCP-47 tags). */
export const SPEECH_LANGUAGES: ReadonlyArray<{ tag: string; label: string }> = [
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

/** Configured language tag, or the default when unset. */
export async function getSpeechLanguage(): Promise<string> {
	const stored = await deviceSettings.get<string>(DeviceSettingKeys.speechLanguage);
	return stored?.trim() || DEFAULT_SPEECH_LANGUAGE;
}

export async function setSpeechLanguage(language: string): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.speechLanguage, language.trim());
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
		throw new Error('Enter the Mistral API key on the Speech Entry configuration page first.');
	}
	const model = (options.model ?? (await getMistralModel())).trim() || MISTRAL_TRANSCRIPTION_MODEL;
	const language = (options.language ?? (await getSpeechLanguage())).trim();

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
