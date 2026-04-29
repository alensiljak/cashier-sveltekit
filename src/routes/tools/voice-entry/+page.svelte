<script lang="ts">
    import { goto } from '$app/navigation'
    import Toolbar from '$lib/components/Toolbar.svelte'
    import { Xact } from '$lib/data/model'
    import { xact as xactStore, xactSpan } from '$lib/data/mainStore'
    import { type ParseResult, parseTranscript, buildTransaction, formatBeancount } from '$lib/utils/voiceNlp'
    import fullLedgerService from '$lib/services/ledgerWorkerClient'

    // --- State ---

    let isListening = $state(false)
    let transcript = $state('')
    let interimTranscript = $state('')
    let parseResult = $state<ParseResult | null>(null)
    let transaction = $state<Xact | null>(null)
    let errorMsg = $state('')
    let supported = $state(true)
    let resolvingFrom = $state(false)

    function handleTranscript(text: string) {
        transcript = text
        if (!text.trim()) return
        parseResult = parseTranscript(text)
        transaction = buildTransaction(parseResult)
    }

    // --- Web Speech API ---

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let recognition: any = null

    function initRecognition() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
        if (!SR) {
            supported = false
            return null
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = new SR()
        r.continuous = false
        r.interimResults = true
        r.lang = 'en-US'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.onresult = (event: any) => {
            let interim = ''
            let final = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript
                if (event.results[i].isFinal) final += t
                else interim += t
            }
            interimTranscript = interim
            if (final) handleTranscript(final)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.onerror = (event: any) => {
            if (event.error === 'network') {
                errorMsg =
                    'Network error: Chrome sends audio to Google servers, which are unreachable. Use the text input below instead.'
            } else if (event.error === 'not-allowed') {
                errorMsg = 'Microphone permission denied. Allow access and try again.'
            } else {
                errorMsg = `Speech error: ${event.error}`
            }
            isListening = false
        }

        r.onend = () => {
            isListening = false
            interimTranscript = ''
        }

        return r
    }

    function toggleListening() {
        errorMsg = ''
        if (isListening) {
            recognition?.stop()
            isListening = false
            return
        }

        recognition = initRecognition()
        if (!recognition) return

        try {
            recognition.start()
            isListening = true
            transcript = ''
            parseResult = null
            transaction = null
        } catch (e) {
            errorMsg = String(e)
        }
    }

    let textInput = $state('')

    function submitTextInput() {
        if (!textInput.trim()) return
        handleTranscript(textInput.trim())
        transcript = textInput.trim()
    }

    function useExample(phrase: string) {
        textInput = phrase
        handleTranscript(phrase)
        transcript = phrase
    }

    function openInEditor() {
        if (!transaction) return
        xactStore.set(transaction)
        xactSpan.set(undefined)
        goto('/tx')
    }

    async function resolveFromAccount() {
        if (!parseResult?.fromAccount || parseResult.fromAccount.includes(':')) return
        resolvingFrom = true
        try {
            const raw = parseResult.fromAccount
            const result = await fullLedgerService.query(
                `SELECT account WHERE account ~ '(?i)${raw}' GROUP BY account ORDER BY account`
            )
            if (result.errors.length === 0 && result.rows.length > 0) {
                const accountIdx = result.columns.indexOf('account')
                parseResult.fromAccount = (result.rows[0] as unknown[])[accountIdx] as string
                transaction = buildTransaction(parseResult)
            }
        } finally {
            resolvingFrom = false
        }
    }

    function clearAll() {
        transcript = ''
        interimTranscript = ''
        textInput = ''
        parseResult = null
        transaction = null
        errorMsg = ''
    }
</script>

<article class="flex h-screen flex-col">
    <Toolbar title="Speech Entry" />

    <section class="flex flex-1 flex-col gap-4 overflow-y-auto p-4 touch-pan-y">
        {#if !supported}
            <div class="alert alert-error">
                Web Speech API is not supported in this browser. Try Chrome or Edge.
            </div>
        {/if}

        <!-- Mic button -->
        <div class="flex flex-col items-center gap-3 py-4">
            <button
                class="btn btn-circle h-24 w-24 text-4xl shadow-lg transition-all
                       {isListening ? 'btn-error animate-pulse' : 'btn-primary'}"
                onclick={toggleListening}
                disabled={!supported}
                aria-label={isListening ? 'Stop listening' : 'Start listening'}
            >
                🎤
            </button>
            <span class="text-sm opacity-60">
                {isListening ? 'Listening… tap to stop' : 'Tap to speak'}
            </span>
        </div>

        <!-- Text input fallback -->
        <form
            class="flex gap-2"
            onsubmit={(e) => { e.preventDefault(); submitTextInput() }}
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
                            <span class="text-xs opacity-60">from account "{parseResult.fromAccount}" not resolved</span>
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
                    <pre class="text-xs bg-base-300 rounded p-3 whitespace-pre-wrap font-mono">{formatBeancount(transaction)}</pre>
                </div>
            </div>
        {/if}

        {#if transaction}
            <button class="btn btn-primary self-center" onclick={openInEditor}>
                Open in Editor
            </button>
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
                        {#each [
                            'Paid 25 euros at Starbucks',
                            'Spent 12 dollars for lunch',
                            'Received 500 euros from salary',
                            'Transferred 100 euros from checking to savings',
                            'Bought groceries for 35 euros',
                        ] as phrase}
                            <li>
                                <button
                                    class="text-left opacity-70 hover:opacity-100 hover:underline"
                                    onclick={() => useExample(phrase)}
                                >"{phrase}"</button>
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
</article>
