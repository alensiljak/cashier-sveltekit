# Voice Entry Improvements

## Context

Found the key files. Let me look at the voice entry page, the NLP parser, and the speech service.
Now let me read the voice-entry page and how it wires parsing to the UI, plus the entity search service that uses the NLP module.
Let me check the entity search service, the tests, and docs/TODO for context on where this is headed.
The NLP helpers are also used by a quick-entry page. Let me look at that integration and the help doc to complete the picture.
Let me read the quick-entry page to see how the NLP pipeline is used there — that looks like where the feature is heading.
I have a good picture of the pipeline. Let me quickly check recent git history and the proxy to understand the direction of travel.
I've reviewed the whole voice-entry pipeline. Here's the picture and where I'd take it next.

## How it works today

- **Transcription** — `src/lib/services/speechService.ts`: two engines, built-in Web Speech API (live) or Mistral Voxtral (`MediaRecorder` clip uploaded on stop via the same-origin allowlisted proxy in `worker/proxy.ts:36`, API key device-only). Config lives at `/tools/voice-entry/config`.
- **NLP parsing** — `src/lib/utils/nlpEntry.ts:281` `parseTranscript()`: regex/keyword pipeline that extracts amount/currency, payee (via `at/to/from/@` vs `for`-narration split), accounts (hardcoded `ACCOUNT_KEYWORDS` map at `nlpEntry.ts:85`), transfer/income detection, plus a confidence score, `needsReview` flag, and leftover-words-as-note. `refineFromMatches()` (`nlpEntry.ts:447`) backfills payee/accounts from historical transactions by frequency.
- **UI** — `src/routes/tools/voice-entry/+page.svelte` (mic button, text fallback, confidence badge, Beancount preview, editor handoff) and `src/routes/tx/quick-entry/+page.svelte:77`, which runs the same parser over live loose-search results.

It's well built: clean separation of transcription/parsing/UI, solid unit tests (`tests/unit/nlpEntry.test.ts`, `speechService.test.ts`), and privacy-conscious handling of the API key.

## Gaps and next-project ideas, roughly by impact

1. **Ledger-aware entity resolution on the voice page (biggest win).** The parser's `ACCOUNT_KEYWORDS` maps to generic accounts (`Expenses:Groceries`) in English only, and the voice page never calls `refineFromMatches` — only quick-entry does, and only via a manual "Resolve" button for a partial from-account (`voice-entry/+page.svelte:213`). Auto-running the loose BQL search after each transcript and fuzzy-matching spoken words against real payees/accounts would fix most `needsReview` cases. The infrastructure (`buildLooseTransactionConditions`, `entitySearchService.ts:83`) already exists.
2. **Multilingual parsing.** Transcription supports 53 Voxtral languages and 12 built-in tags, but `STOP_WORDS`, `CURRENCY_MAP`, and prepositions are English-only — "25 Euro bei Rewe" won't parse. Localized keyword tables keyed off the configured speech language would close that.
3. ✅ **Number words and locale-aware amounts.** Only digit tokens are parsed (`nlpEntry.ts:158`); "twenty-five euros" from Voxtral yields no amount. Also "1.500,50" style thousands separators get misread as decimals by `\d+(?:[.,]\d+)?`.
4. ❌ **Date/time expressions.** `buildTransaction` always stamps today (`nlpEntry.ts:493`). "yesterday", "last Friday" are natural voice input and currently land in the note.
5. ✅ **Editable transcript + re-parse, and live interim parsing.** The built-in engine only parses the final result (`voice-entry/+page.svelte:104`), and once parsed the transcript can't be corrected before "Open in Editor" — a misheard word forces a full redo. Making the transcript editable with re-parse (and parsing interim results) would smooth the loop.
6. **Split/multi-transaction utterances.** "60 euros at Lidl and 20 at the pharmacy" parses as one garbled transaction; detecting conjunctions and offering multiple entries is a natural voice feature.
7. **Correction learning.** When the user edits a parsed transaction in the editor, recording the correction (spoken fragment → actual payee/account) would let `refineFromMatches` improve over time.
8. **On-device STT option.** The built-in engine sends audio to Google servers; a local Whisper/WASM engine would be the privacy play if that matters to you.

My recommendation for the next project: **#1 (ledger-aware resolution auto-applied on the voice page) + #2/#3 for the configured language** — they're the highest-friction gaps today and reuse the search/refine machinery that already exists in quick-entry. #4 is small and high-value on top of that.
