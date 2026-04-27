<script lang="ts">
    import Toolbar from '$lib/components/Toolbar.svelte'
    import { Xact, Posting } from '$lib/data/model'

    // --- Types ---

    interface ParseResult {
        payee?: string
        amount?: number
        currency?: string
        fromAccount?: string
        toAccount?: string
        note?: string
        confidence: number
        matched: string[]
    }

    // --- State ---

    let isListening = $state(false)
    let transcript = $state('')
    let interimTranscript = $state('')
    let parseResult = $state<ParseResult | null>(null)
    let transaction = $state<Xact | null>(null)
    let errorMsg = $state('')
    let supported = $state(true)

    // --- NLP Rule Engine ---

    const CURRENCY_MAP: Record<string, string> = {
        euro: 'EUR',
        euros: 'EUR',
        dollar: 'USD',
        dollars: 'USD',
        pound: 'GBP',
        pounds: 'GBP',
        yen: 'JPY',
        franc: 'CHF',
        francs: 'CHF',
        kuna: 'HRK',
        kune: 'HRK',
    }

    const ACCOUNT_KEYWORDS: Array<{ words: string[]; account: string }> = [
        { words: ['checking', 'bank account', 'current account'], account: 'Assets:Checking' },
        { words: ['savings', 'saving'], account: 'Assets:Savings' },
        { words: ['cash', 'wallet', 'pocket'], account: 'Assets:Cash' },
        {
            words: ['credit card', 'visa', 'mastercard', 'amex', 'american express'],
            account: 'Liabilities:CreditCard',
        },
        { words: ['paypal'], account: 'Assets:PayPal' },
        { words: ['grocery', 'groceries', 'supermarket', 'market'], account: 'Expenses:Groceries' },
        { words: ['restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'food', 'eat'], account: 'Expenses:Food' },
        { words: ['transport', 'bus', 'train', 'metro', 'taxi', 'uber', 'fuel', 'gas', 'petrol'], account: 'Expenses:Transport' },
        { words: ['rent', 'mortgage', 'housing'], account: 'Expenses:Housing' },
        { words: ['utilities', 'electricity', 'water', 'internet', 'phone', 'mobile'], account: 'Expenses:Utilities' },
        { words: ['entertainment', 'cinema', 'movie', 'netflix', 'spotify', 'game'], account: 'Expenses:Entertainment' },
        { words: ['health', 'pharmacy', 'doctor', 'medicine', 'medical'], account: 'Expenses:Health' },
        { words: ['clothes', 'clothing', 'shoes', 'fashion'], account: 'Expenses:Clothing' },
        { words: ['salary', 'income', 'paycheck', 'wage', 'wages', 'payroll'], account: 'Income:Salary' },
    ]

    function guessAccount(text: string): string | undefined {
        const lower = text.toLowerCase()
        for (const { words, account } of ACCOUNT_KEYWORDS) {
            if (words.some((w) => lower.includes(w))) return account
        }
        return undefined
    }

    function parseCurrency(text: string): { amount?: number; currency: string } {
        // Match patterns like "25 euros", "€25", "$30.50", "100 USD"
        const patterns = [
            /([€$£¥])\s*(\d+(?:[.,]\d+)?)/,
            /(\d+(?:[.,]\d+)?)\s*([€$£¥])/,
            /(\d+(?:[.,]\d+)?)\s+(euros?|dollars?|pounds?|yen|francs?|kunas?|kune|usd|eur|gbp|chf|hrk)/i,
        ]

        for (const re of patterns) {
            const m = text.match(re)
            if (!m) continue

            let rawAmount: string
            let rawCurrency: string

            if (re === patterns[0]) {
                rawCurrency = m[1]
                rawAmount = m[2]
            } else if (re === patterns[1]) {
                rawAmount = m[1]
                rawCurrency = m[2]
            } else {
                rawAmount = m[1]
                rawCurrency = m[2]
            }

            const amount = parseFloat(rawAmount.replace(',', '.'))
            const symbolMap: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY' }
            const currency =
                symbolMap[rawCurrency] ??
                CURRENCY_MAP[rawCurrency.toLowerCase()] ??
                rawCurrency.toUpperCase()

            return { amount, currency }
        }

        // Plain number with no currency — assume EUR by default
        const numMatch = text.match(/(\d+(?:[.,]\d+)?)/)
        if (numMatch) {
            return { amount: parseFloat(numMatch[1].replace(',', '.')), currency: 'EUR' }
        }

        return { currency: 'EUR' }
    }

    function extractPayee(text: string): string | undefined {
        // Patterns: "paid/spent/bought ... at/to/from [Payee]"
        const patterns = [
            /(?:at|to|for|from|@)\s+([A-Z][a-zA-Z\s'&-]{1,30})/,
            /(?:paid|spent|bought|purchased)\s+(?:\d[\d.,]*\s+\w+\s+)?(?:at|to|for)\s+([A-Z][a-zA-Z\s'&-]{1,30})/i,
            /^([A-Z][a-zA-Z\s'&-]{1,20})\s+\d/,
        ]

        for (const re of patterns) {
            const m = text.match(re)
            if (m) return m[1].trim()
        }

        // Capitalize first word that isn't a verb/article as fallback
        const stopWords = new Set([
            'paid', 'spent', 'bought', 'received', 'transferred', 'charged',
            'the', 'a', 'an', 'i', 'me', 'my', 'at', 'to', 'for', 'from',
        ])
        const words = text.split(/\s+/)
        for (const w of words) {
            if (!stopWords.has(w.toLowerCase()) && /^[a-zA-Z]/.test(w)) {
                return w.charAt(0).toUpperCase() + w.slice(1)
            }
        }

        return undefined
    }

    function parseTranscript(text: string): ParseResult {
        const lower = text.toLowerCase()
        const matched: string[] = []
        let confidence = 0

        const { amount, currency } = parseCurrency(text)
        if (amount !== undefined) {
            matched.push(`amount: ${amount} ${currency}`)
            confidence += 40
        }

        const payee = extractPayee(text)
        if (payee) {
            matched.push(`payee: ${payee}`)
            confidence += 20
        }

        // Detect transfer intent
        const isTransfer = /transfer|move|send/i.test(lower)
        const isIncome = /receive|received|income|salary|paycheck|wage/i.test(lower)

        // Extract "from" account
        let fromAccount: string | undefined
        const fromMatch = text.match(/from\s+(?:my\s+)?([a-zA-Z\s]+?)(?:\s+to|\s+account|$)/i)
        if (fromMatch) {
            fromAccount = guessAccount(fromMatch[1]) ?? fromMatch[1].trim()
            matched.push(`from: ${fromAccount}`)
            confidence += 20
        }

        // Extract "to" account
        let toAccount: string | undefined
        const toMatch = text.match(/to\s+(?:my\s+)?([a-zA-Z\s]+?)(?:\s+from|\s+account|$)/i)
        if (toMatch && isTransfer) {
            toAccount = guessAccount(toMatch[1]) ?? toMatch[1].trim()
            matched.push(`to: ${toAccount}`)
            confidence += 20
        }

        // Guess accounts from context words if not found explicitly
        if (!fromAccount) {
            if (isIncome) {
                fromAccount = guessAccount(text) ?? 'Income:Other'
                toAccount = toAccount ?? 'Assets:Checking'
            } else {
                fromAccount = guessAccount(text) ?? 'Assets:Checking'
            }
        }

        // Infer expense account from payee/context
        if (!toAccount && !isTransfer && !isIncome) {
            toAccount = guessAccount(text) ?? 'Expenses:General'
        }

        return { payee, amount, currency, fromAccount, toAccount, confidence: Math.min(confidence, 100), matched }
    }

    function buildTransaction(result: ParseResult): Xact {
        const xact = new Xact()
        xact.date = new Date().toISOString().substring(0, 10)
        xact.payee = result.payee ?? 'Unknown'
        xact.flag = '*'

        const posting1 = new Posting()
        posting1.account = result.toAccount ?? 'Expenses:General'
        posting1.amount = result.amount
        posting1.currency = result.currency ?? 'EUR'

        const posting2 = new Posting()
        posting2.account = result.fromAccount ?? 'Assets:Checking'
        // leave amount empty — Beancount will infer it

        xact.postings = [posting1, posting2]
        return xact
    }

    function formatBeancount(xact: Xact): string {
        const lines: string[] = []
        lines.push(`${xact.date} ${xact.flag} "${xact.payee}" "${xact.note ?? ''}"`)
        for (const p of xact.postings) {
            const amtStr =
                p.amount !== undefined ? `  ${p.amount.toFixed(2)} ${p.currency}` : ''
            lines.push(`  ${p.account}${amtStr}`)
        }
        return lines.join('\n')
    }

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

    <section class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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
