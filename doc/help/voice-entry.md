# Speech Settings

Speak a transaction instead of typing it. Turn on **Voice mode** in the [Quick Entry](/help/quick-entry) menu to get a microphone button next to the text box; what you say is transcribed into that box and handled exactly like typed text.

## Engines

Two transcription engines are available; choose one on the **configuration** page (Settings → **Speech Settings**, or Quick Entry's menu → **Speech settings**).

| Engine                 | How it works                                                                                                 | Needs               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| **Built-in (browser)** | The browser's own speech recognition transcribes live while you speak. It is the default.                    | A supported browser |
| **Mistral Voxtral**    | The page records the microphone and uploads the clip to Mistral's transcription API when you stop recording. | A Mistral API key   |

- **Built-in** works with no setup in Chrome, Edge and Safari. Chrome sends the audio to Google's servers, so it needs a network connection; in a browser without the Web Speech API the page says so and you can switch engines.
- **Mistral Voxtral** works in any browser that can record audio. Nothing is transcribed until you stop the recording, so the transcript appears a moment later.

The engine choice and the language are stored on this device.

## Configuration page

- **Transcription engine** — built-in or Mistral Voxtral.
- **Language** — the language you speak, used by both engines. The built-in engine gets the full tag (`en-US`); Mistral gets only the two-letter ISO 639-1 code (`en`), because its API rejects anything else with HTTP 422. Each engine lists its own languages in full: the browser's list for the built-in engine, and every language the selected Voxtral model supports for Mistral — plus **Auto-detect**, which omits the language so the model detects it itself. Use it for languages the model does not officially list (e.g. Bosnian); a pinned language is still more reliable on short recordings. Switching engines keeps the language where the two lists overlap (`sl-SI` becomes `sl`).
- **API key** — your Mistral API key. It is stored on this device only and is never exported or synced. Create one in the [Mistral console](https://console.mistral.ai/api-keys).
- **Model** — the Voxtral transcription model, picked from a list: `voxtral-mini-transcribe-3` (the default) or `voxtral-small-transcribe-3` (higher quality, slightly more expensive). Only file-transcription models work here; the TTS and realtime models answer on other endpoints. Tick **Enter the model id manually** to type an id instead — the language list is only known for the listed models, so a manual id uses the default model's list. The supported languages were taken from [Mistral's language page](https://docs.mistral.ai/studio/audio/specs-and-limits/languages) on 2026-11-19.
- **Proxy key** — the app's own proxy carries the request to Mistral, because Mistral's API sends no CORS headers for the app's origin. Set this only when the server requires it; it is the same key used by [Price Download](/help/price-download).
- **Test transcription** — records a short clip and transcribes it with the settings currently on the page, without saving them first.

Tap **Save** to keep the changes.

## Using voice mode

1. In Quick Entry, open the menu (⋮) and switch **Voice mode** on. The choice is remembered on this device.
2. Tap the microphone button and speak, e.g. "Paid 25 euros at Starbucks".
3. With the built-in engine, tap again to stop; with Mistral, tap the stop button and wait for the transcription.

The transcript lands in the text box, where you can correct it; the suggestion updates as you edit.

## Amounts

Amounts are read in either decimal convention, so both "25,50" and "25.50" mean twenty-five fifty. Thousands separators are understood too: "1.500,50" and "1,500.50" both parse as 1500.50, and a lone group of three digits ("1.500") is read as 1500 rather than 1.5.

Amounts can also be spoken as words: "twenty-five euros", "a hundred dollars", "two thousand five hundred". A digit amount with a currency wins over spoken numbers, so "12 euros for two coffees" takes 12. A spoken amount with a currency word beats a bare digit quantity, so "2 coffees for twenty euros" takes 20.

Cents can follow the currency word, in words or digits: "twenty-five euros fifty", "twenty euros and fifty cents" and "12 euros 50" all give the expected decimal amount. A number after the currency that looks like a quantity ("20 euros 2 coffees") is not treated as cents. A scale word after a digit amount multiplies it: "2 thousand euros" is 2000.

Because number words are also ordinary words, a spoken number only counts as the amount when it is unambiguous — when a currency word follows it ("twenty-five euros") or when it is the only thing in the phrase ("twenty-five at Billa"). A number word that describes something else is left alone: "one coffee" and "two tickets" are quantities, and "at One Stop" is part of the payee.

When the phrase names no currency ("50 at Billa"), the amount uses the book's operating currency — the `operating_currency` option in your Beancount file. Naming a currency ("50 euros", "$50") always overrides it.
