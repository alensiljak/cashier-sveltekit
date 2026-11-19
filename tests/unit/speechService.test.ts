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
	VOXTRAL_MODELS,
	extensionForMimeType,
	getMistralApiKey,
	getMistralModel,
	getSpeechEngine,
	getSpeechLanguage,
	isKnownVoxtralModel,
	isLanguageSupportedByModel,
	languagesForModel,
	mistralLanguageCode,
	parseTranscriptionResponse,
	setMistralApiKey,
	setSpeechEngine,
	speechLanguageOptions,
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

describe('Voxtral models and their languages', () => {
	it('offers only file-transcription models', () => {
		expect(VOXTRAL_MODELS.map((model) => model.id)).toEqual([
			'voxtral-mini-transcribe-3-0',
			'voxtral-small-transcribe-3-0'
		]);
		expect(MISTRAL_TRANSCRIPTION_MODEL).toBe('voxtral-mini-transcribe-3-0');
	});

	it('lists the 53 languages Voxtral 3 file transcription supports', () => {
		for (const model of VOXTRAL_MODELS) {
			expect(model.languages).toHaveLength(53);
			expect(model.languages.map((language) => language.code)).toContain('sl');
			expect(model.languages.map((language) => language.code)).toContain('sr');
			// Croatian is a TTS language only; the STT API rejects it.
			expect(model.languages.map((language) => language.code)).not.toContain('hr');
		}
	});

	it('recognises known model ids and falls back for manual ones', () => {
		expect(isKnownVoxtralModel('voxtral-small-transcribe-3-0')).toBe(true);
		expect(isKnownVoxtralModel(' voxtral-mini-transcribe-3-0 ')).toBe(true);
		expect(isKnownVoxtralModel('voxtral-mini-tts-3-0')).toBe(false);
		expect(languagesForModel('some-future-model')).toBe(VOXTRAL_MODELS[0]!.languages);
	});

	it('offers the full built-in list for the browser engine', () => {
		const options = speechLanguageOptions('builtin', MISTRAL_TRANSCRIPTION_MODEL);
		expect(options.map((option) => option.tag)).toContain('hr-HR');
		expect(options.map((option) => option.tag)).toContain('sl-SI');
	});

	it('offers every language the Voxtral model supports', () => {
		const options = speechLanguageOptions('mistral', MISTRAL_TRANSCRIPTION_MODEL);
		const tags = options.map((option) => option.tag);
		// The whole model list, not a subset of the browser's list.
		expect(tags).toHaveLength(53);
		expect(tags).toEqual(languagesForModel(MISTRAL_TRANSCRIPTION_MODEL).map((l) => l.code));
		// Voxtral-only languages are reachable…
		expect(tags).toContain('ar');
		expect(tags).toContain('zh');
		expect(tags).toContain('pl');
		// …and the browser-only one is gone.
		expect(tags).not.toContain('hr');
		expect(tags).not.toContain('hr-HR');
	});

	it('uses the same list for both Voxtral models', () => {
		const mini = speechLanguageOptions('mistral', 'voxtral-mini-transcribe-3-0');
		const small = speechLanguageOptions('mistral', 'voxtral-small-transcribe-3-0');
		expect(small).toEqual(mini);
	});

	it('checks a tag against the model', () => {
		expect(isLanguageSupportedByModel('sl-SI', MISTRAL_TRANSCRIPTION_MODEL)).toBe(true);
		expect(isLanguageSupportedByModel('hr-HR', MISTRAL_TRANSCRIPTION_MODEL)).toBe(false);
		// No two-letter subtag: the field is omitted and Voxtral detects the language.
		expect(isLanguageSupportedByModel('not-a-code!', MISTRAL_TRANSCRIPTION_MODEL)).toBe(true);
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
		// Mistral expects a two-letter ISO 639-1 code, not the BCP-47 tag.
		expect(form.get('language')).toBe('de');
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
		expect(form.get('language')).toBe('fr');
	});

	it('omits the language field when the tag has no two-letter code', async () => {
		state.proxyResponse = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 });

		await transcribeWithMistral(clip, { apiKey: 'key', language: 'not-a-code!' });

		const [{ init }] = state.proxyCalls;
		const form = init?.body as FormData;
		expect(form.get('language')).toBeNull();
	});

	it('refuses a language the model does not support, before calling the API', async () => {
		state.store.set('speech.mistral.api-key', 'key');
		state.store.set('speech.language', 'hr-HR');

		await expect(transcribeWithMistral(clip)).rejects.toThrow(/does not support the language/);
		expect(state.proxyCalls).toHaveLength(0);
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

describe('mistralLanguageCode', () => {
	it('shortens BCP-47 tags to the ISO 639-1 alpha-2 code', () => {
		expect(mistralLanguageCode('en-US')).toBe('en');
		expect(mistralLanguageCode('de-DE')).toBe('de');
		expect(mistralLanguageCode('sl-SI')).toBe('sl');
		expect(mistralLanguageCode('zh-Hans-CN')).toBe('zh');
		expect(mistralLanguageCode('en')).toBe('en');
		expect(mistralLanguageCode('  FR-fr ')).toBe('fr');
	});

	it('returns an empty string when there is no two-letter primary subtag', () => {
		expect(mistralLanguageCode('')).toBe('');
		expect(mistralLanguageCode('eng')).toBe('');
		expect(mistralLanguageCode('not-a-code!')).toBe('');
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
