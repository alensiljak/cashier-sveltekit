# Speech Entry

Speak a transaction instead of typing it. The page turns your speech into text, parses the amount, payee and accounts out of it, and shows a Beancount preview you can open in the transaction editor.

## Engines

Two transcription engines are available; choose one on the **configuration** page (toolbar menu → **Configuration**, or `/tools/voice-entry/config`).

| Engine                 | How it works                                                                                                 | Needs               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| **Built-in (browser)** | The browser's own speech recognition transcribes live while you speak. It is the default.                    | A supported browser |
| **Mistral Voxtral**    | The page records the microphone and uploads the clip to Mistral's transcription API when you stop recording. | A Mistral API key   |

- **Built-in** works with no setup in Chrome, Edge and Safari. Chrome sends the audio to Google's servers, so it needs a network connection; in a browser without the Web Speech API the page says so and you can switch engines.
- **Mistral Voxtral** works in any browser that can record audio. Nothing is transcribed until you stop the recording, so the transcript appears a moment later.

The engine choice and the language are stored on this device.

## Configuration page

- **Transcription engine** — built-in or Mistral Voxtral.
- **Language** — the language you speak, used by both engines. The built-in engine gets the full tag (`en-US`); Mistral gets only the two-letter ISO 639-1 code (`en`), because its API rejects anything else with HTTP 422. Each engine lists its own languages in full: the browser's list for the built-in engine, and every language the selected Voxtral model supports for Mistral. Switching engines keeps the language where the two lists overlap (`sl-SI` becomes `sl`).
- **API key** — your Mistral API key. It is stored on this device only and is never exported or synced. Create one in the [Mistral console](https://console.mistral.ai/api-keys).
- **Model** — the Voxtral transcription model, picked from a list: `voxtral-mini-transcribe-3-0` (the default) or `voxtral-small-transcribe-3-0` (higher quality, slightly more expensive). Only file-transcription models work here; the TTS and realtime models answer on other endpoints. Tick **Enter the model id manually** to type an id instead — the language list is only known for the listed models, so a manual id uses the default model's list. The supported languages were taken from [Mistral's language page](https://docs.mistral.ai/studio/audio/specs-and-limits/languages) on 2026-11-19.
- **Proxy key** — the app's own proxy carries the request to Mistral, because Mistral's API sends no CORS headers for the app's origin. Set this only when the server requires it; it is the same key used by [Price Download](/help/price-download).
- **Test transcription** — records a short clip and transcribes it with the settings currently on the page, without saving them first.

Tap **Save** to keep the changes.

## Using the page

1. Tap the microphone button and speak, e.g. "Paid 25 euros at Starbucks".
2. With the built-in engine, tap again to stop; with Mistral, tap the stop button and wait for the transcription.
3. Check the parsed fields and the transaction preview, then **Open in Editor** to adjust and save it.

You can also type a phrase into the text field and tap **Parse** — useful when the microphone is unavailable. The example phrases fill the field for you.

If the "from" account is only a partial name, tap **Resolve** to look it up in the ledger.
