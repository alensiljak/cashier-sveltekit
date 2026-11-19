/*
    Tests for the Speech Entry transcription engines (services/speechService.ts):
    the stored engine choice, the Voxtral request shape through the CORS proxy,
    and the response/error handling.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	store: new Map<string, unknown>(),
	proxyCalls: [] as Array<{ url: string; init?: RequestInit & { upstreamBearer?: string } }>,
	proxyResponse: null as null | (() => Promise<Response>)
}));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => state.store.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => {
			state.store.set(key, value);
		})
	},
	DeviceSettingKeys: {
		speechEngine: 'speech.engine',
		speechLanguage: 'speech.language',
		mistralApiKey: 'speech.mistral.api-key',
		mistralTranscriptionModel: 'speech.mistral.model',
		proxyKey: 'proxy.key'
	}
}));

vi.mock('#lib/services/prices/proxyFetch', () => ({
	proxyFetch: vi.fn(async (url: string, init?: RequestInit & { upstreamBearer?: string }) => {
		state.proxyCalls.push({ url, init });
		if (!state.proxyResponse) throw new Error('no proxy response stubbed');
		return state.proxyResponse();
	})
}));

import {
	DEFAULT_SPEECH_ENGINE,
	MISTRAL_TRANSCRIPTION_MODEL,
	MISTRAL_TRANSCRIPTION_URL,
	extensionForMimeType,
	getMistralApiKey,
	getMistralModel,
	getSpeechEngine,
	getSpeechLanguage,
	parseTranscriptionResponse,
	setMistralApiKey,
	setSpeechEngine,
	transcribeWithMistral
} from '#lib/services/speechService';

const clip = { blob: new Blob(['audio'], { type: 'audio/webm' }), fileName: 'speech.webm' };

beforeEach(() => {
	state.store.clear();
	state.proxyCalls = [];
	state.proxyResponse = null;
});

describe('engine settings', () => {
	it('defaults to the built-in engine', async () => {
		expect(await getSpeechEngine()).toBe(DEFAULT_SPEECH_ENGINE);
		expect(DEFAULT_SPEECH_ENGINE).toBe('builtin');
	});

	it('remembers the chosen engine', async () => {
		await setSpeechEngine('mistral');
		expect(await getSpeechEngine()).toBe('mistral');
	});

	it('falls back to the default language and model', async () => {
		expect(await getSpeechLanguage()).toBe('en-US');
		expect(await getMistralModel()).toBe(MISTRAL_TRANSCRIPTION_MODEL);
	});

	it('trims the stored API key', async () => {
		await setMistralApiKey('  key-123  ');
		expect(await getMistralApiKey()).toBe('key-123');
	});
});

describe('transcribeWithMistral', () => {
	it('posts the clip, model and language through the proxy with the key as a bearer token', async () => {
		state.store.set('speech.mistral.api-key', 'key-123');
		state.store.set('speech.language', 'de-DE');
		state.proxyResponse = async () =>
			new Response(JSON.stringify({ text: '  Paid 25 euros at Starbucks ' }), { status: 200 });

		const text = await transcribeWithMistral(clip);

		expect(text).toBe('Paid 25 euros at Starbucks');
		expect(state.proxyCalls).toHaveLength(1);
		const [{ url, init }] = state.proxyCalls;
		expect(url).toBe(MISTRAL_TRANSCRIPTION_URL);
		expect(init?.method).toBe('POST');
		expect(init?.upstreamBearer).toBe('key-123');
		const form = init?.body as FormData;
		expect(form.get('model')).toBe(MISTRAL_TRANSCRIPTION_MODEL);
		expect(form.get('language')).toBe('de-DE');
		expect(form.get('file')).toBeInstanceOf(Blob);
	});

	it('uses the overrides given by the configuration page test button', async () => {
		state.proxyResponse = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 });

		await transcribeWithMistral(clip, {
			apiKey: 'draft-key',
			model: 'voxtral-mini-2507',
			language: 'fr-FR'
		});

		const [{ init }] = state.proxyCalls;
		expect(init?.upstreamBearer).toBe('draft-key');
		const form = init?.body as FormData;
		expect(form.get('model')).toBe('voxtral-mini-2507');
		expect(form.get('language')).toBe('fr-FR');
	});

	it('refuses to call the API without a key', async () => {
		await expect(transcribeWithMistral(clip)).rejects.toThrow(/API key/);
		expect(state.proxyCalls).toHaveLength(0);
	});

	it('reports a rejected key', async () => {
		state.store.set('speech.mistral.api-key', 'bad');
		state.proxyResponse = async () => new Response('', { status: 401 });
		await expect(transcribeWithMistral(clip)).rejects.toThrow(/rejected the API key/);
	});

	it('includes the upstream error message on other failures', async () => {
		state.store.set('speech.mistral.api-key', 'key');
		state.proxyResponse = async () =>
			new Response(JSON.stringify({ message: 'model not found' }), { status: 422 });
		await expect(transcribeWithMistral(clip)).rejects.toThrow(/HTTP 422 — model not found/);
	});
});

describe('parseTranscriptionResponse', () => {
	it('reads the text field', () => {
		expect(parseTranscriptionResponse({ text: 'hello' })).toBe('hello');
	});

	it('throws on a changed shape', () => {
		expect(() => parseTranscriptionResponse({ result: 'hello' })).toThrow(/no transcription text/);
		expect(() => parseTranscriptionResponse('hello')).toThrow(/unexpected/);
	});
});

describe('extensionForMimeType', () => {
	it('maps recorder MIME types to file extensions', () => {
		expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm');
		expect(extensionForMimeType('audio/ogg;codecs=opus')).toBe('ogg');
		expect(extensionForMimeType('audio/mp4')).toBe('m4a');
		expect(extensionForMimeType('audio/mpeg')).toBe('mp3');
		expect(extensionForMimeType('audio/wav')).toBe('wav');
		expect(extensionForMimeType('application/octet-stream')).toBe('webm');
	});
});
