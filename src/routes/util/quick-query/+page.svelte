<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import { CopyIcon } from '@lucide/svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import {
		buildQuery,
		type Command,
		type CommonOptions,
		type LotsOptions
	} from '$lib/services/quickQueryBuilder';

	// --- Command ---
	let command = $state<Command>('balance')
	let filtersExpanded = $state(false)

	const commands: { value: Command; label: string }[] = [
		{ value: 'balance', label: 'Balance' },
		{ value: 'register', label: 'Register' },
		{ value: 'lots', label: 'Lots' },
		{ value: 'assert', label: 'Assert' },
		{ value: 'price', label: 'Price' }
	]

	// --- Pattern (shared text input, space-separated tokens) ---
	let pattern = $state('')

	// --- Common options ---
	let begin = $state('')
	let end = $state('')
	let dateRange = $state('')
	let currency = $state('')
	let exchange = $state('')
	let sort = $state('')
	let limitStr = $state('')
	let total = $state(false)

	// Balance-specific
	let hierarchy = $state(false)
	let depth = $state('')
	let zero = $state(false)
	let closedAccounts = $state(false)

	// Lots-specific
	let lotsMode = $state<'active' | 'all' | 'closed'>('active')
	let average = $state(false)
	let sortBy = $state<'date' | 'price' | 'symbol' | ''>('')

	// --- Derived options ---
	let accountTokens = $derived(pattern.trim() ? pattern.trim().split(/\s+/) : [])

	let commonOpts = $derived<CommonOptions>({
		account: accountTokens,
		begin: begin || undefined,
		end: end || undefined,
		dateRange: dateRange || undefined,
		currency: currency ? currency.split(',').map((s) => s.trim()).filter(Boolean) : [],
		exchange: exchange || undefined,
		sort: sort || undefined,
		limit: limitStr ? parseInt(limitStr) : undefined,
		total,
		hierarchy,
		depth: depth ? parseInt(depth) : undefined,
		zero,
		closedAccounts
	})

	let lotsOpts = $derived<LotsOptions>({
		account: accountTokens,
		begin: begin || undefined,
		end: end || undefined,
		dateRange: dateRange || undefined,
		currency: currency ? currency.split(',').map((s) => s.trim()).filter(Boolean) : [],
		exchange: exchange || undefined,
		sort: sort || undefined,
		limit: limitStr ? parseInt(limitStr) : undefined,
		sortBy: (sortBy as 'date' | 'price' | 'symbol') || undefined,
		average,
		active: lotsMode === 'active',
		showAll: lotsMode === 'all',
		closed: lotsMode === 'closed'
	})

	// --- Live BQL preview ---
	let bql = $derived(buildQuery(command, commonOpts, lotsOpts))

	// --- Results ---
	interface QueryError {
		message: string
		severity?: string
		line?: number
		column?: number
	}

	let columns = $state<string[]>([])
	let rows = $state<unknown[]>([])
	let errors = $state<QueryError[]>([])
	let isRunning = $state(false)

	function formatNumber(numStr: string): string {
		const n = parseFloat(numStr)
		if (isNaN(n)) return numStr
		const abs = Math.abs(n)
		const sign = n < 0 ? '-' : ''
		const [intRaw, fracRaw] = abs.toFixed(2).split('.')
		const intFormatted = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
		return `${sign}${intFormatted}.${fracRaw}`
	}

	function formatAmountParts(number: string, currency: string): string {
		return `${formatNumber(number)} ${currency}`
	}

	// Handles inventory {positions:[{units:{number,currency}}]},
	// single amount {number,currency}, and position {units:{number,currency}}.
	// Returns null when the value doesn't match any known financial shape.
	function formatFinancialValue(value: unknown): string | null {
		if (typeof value !== 'object' || value === null) return null
		const v = value as Record<string, unknown>

		// Single amount: { number, currency }
		if (typeof v.number === 'string' && typeof v.currency === 'string') {
			return formatAmountParts(v.number, v.currency)
		}

		// Position with units: { units: { number, currency }, cost?: ... }
		if (typeof v.units === 'object' && v.units !== null) {
			const units = v.units as Record<string, unknown>
			if (typeof units.number === 'string' && typeof units.currency === 'string') {
				return formatAmountParts(units.number, units.currency)
			}
		}

		// Inventory: { positions: [ { units: { number, currency } } | { number, currency } ] }
		if (Array.isArray(v.positions)) {
			const parts = (v.positions as unknown[])
				.map((pos) => {
					if (typeof pos !== 'object' || pos === null) return null
					const p = pos as Record<string, unknown>
					if (typeof p.units === 'object' && p.units !== null) {
						const u = p.units as Record<string, unknown>
						if (typeof u.number === 'string' && typeof u.currency === 'string') {
							return formatAmountParts(u.number, u.currency)
						}
					}
					if (typeof p.number === 'string' && typeof p.currency === 'string') {
						return formatAmountParts(p.number, p.currency)
					}
					return null
				})
				.filter((s): s is string => s !== null)
			if (parts.length > 0) return parts.join('\n')
		}

		return null
	}

	function formatCell(value: unknown): string {
		if (value == null) return ''
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return String(value)
		}
		return formatFinancialValue(value) ?? JSON.stringify(value, null, 1)
	}

	async function runQuery() {
		isRunning = true
		errors = []
		try {
			await fullLedgerService.ensureLoaded()
			const result = await fullLedgerService.query(bql)
			errors = (result?.errors ?? []) as QueryError[]
			if (errors.length === 0) {
				columns = result?.columns ?? []
				rows = result?.rows ?? []
			} else {
				columns = []
				rows = []
			}
		} catch (e: unknown) {
			columns = []
			rows = []
			const msg = e instanceof Error ? e.message : String(e)
			errors = [{ message: msg, severity: 'error' }]
		}
		isRunning = false
	}

	let copied = $state(false)

	async function copyBql() {
		await navigator.clipboard.writeText(bql)
		copied = true
		setTimeout(() => (copied = false), 1500)
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.ctrlKey) runQuery()
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="flex flex-col flex-1">
	<Toolbar title="Quick Query" />

	<div class="flex flex-col gap-4 p-4">
		<!-- Command selector -->
		<div class="flex flex-wrap gap-1">
			{#each commands as cmd}
				<button
					class="btn btn-sm {command === cmd.value ? 'btn-primary' : 'btn-ghost'}"
					onclick={() => (command = cmd.value)}
				>
					{cmd.label}
				</button>
			{/each}
		</div>

		<!-- Pattern input -->
		<label class="form-control w-full">
			<div class="label py-1">
				<span class="label-text text-xs text-base-content/60">
					{command === 'price' ? 'Commodity (e.g. EUR USD)' : 'Account pattern (e.g. Assets not Bank @Payee)'}
				</span>
			</div>
			<input
				type="text"
				class="input input-bordered input-sm w-full font-mono"
				placeholder={command === 'price' ? 'EUR' : 'Assets'}
				bind:value={pattern}
			/>
		</label>

		<!-- Filter accordion -->
		<AccordionSection
			title="Filters"
			expanded={filtersExpanded}
			onToggle={() => (filtersExpanded = !filtersExpanded)}
		>
			<div class="flex flex-col gap-3">
				<!-- Date filters -->
				<div class="grid grid-cols-2 gap-2">
					<label class="form-control">
						<div class="label py-0.5"><span class="label-text text-xs">Begin</span></div>
						<input
							type="text"
							class="input input-bordered input-sm font-mono"
							placeholder="2025-01"
							bind:value={begin}
						/>
					</label>
					<label class="form-control">
						<div class="label py-0.5"><span class="label-text text-xs">End</span></div>
						<input
							type="text"
							class="input input-bordered input-sm font-mono"
							placeholder="2025-12"
							bind:value={end}
						/>
					</label>
				</div>
				<label class="form-control">
					<div class="label py-0.5">
						<span class="label-text text-xs">Date range</span>
						<span class="label-text-alt text-xs opacity-60">e.g. 2025-01..2025-06 or 2025</span>
					</div>
					<input
						type="text"
						class="input input-bordered input-sm font-mono"
						placeholder="2025-01..2025-06"
						bind:value={dateRange}
					/>
				</label>

				<!-- Currency / exchange -->
				<div class="grid grid-cols-2 gap-2">
					<label class="form-control">
						<div class="label py-0.5"><span class="label-text text-xs">Currency filter</span></div>
						<input
							type="text"
							class="input input-bordered input-sm font-mono"
							placeholder="EUR,USD"
							bind:value={currency}
						/>
					</label>
					<label class="form-control">
						<div class="label py-0.5"><span class="label-text text-xs">Exchange (convert to)</span></div>
						<input
							type="text"
							class="input input-bordered input-sm font-mono"
							placeholder="EUR"
							bind:value={exchange}
						/>
					</label>
				</div>

				<!-- Sort / limit -->
				<div class="grid grid-cols-2 gap-2">
					<label class="form-control">
						<div class="label py-0.5">
							<span class="label-text text-xs">Sort</span>
							<span class="label-text-alt text-xs opacity-60">prefix - for desc</span>
						</div>
						<input
							type="text"
							class="input input-bordered input-sm font-mono"
							placeholder="-date"
							bind:value={sort}
						/>
					</label>
					<label class="form-control">
						<div class="label py-0.5"><span class="label-text text-xs">Limit</span></div>
						<input
							type="number"
							class="input input-bordered input-sm font-mono"
							placeholder="100"
							bind:value={limitStr}
						/>
					</label>
				</div>

				<label class="label cursor-pointer justify-start gap-2 py-0">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={total} />
					<span class="label-text text-sm">Show total / running total</span>
				</label>

				<!-- Balance-specific options -->
				{#if command === 'balance'}
					<div class="divider my-1 text-xs opacity-50">Balance options</div>
					<div class="flex flex-wrap gap-4">
						<label class="label cursor-pointer gap-2 py-0">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={hierarchy} />
							<span class="label-text text-sm">Hierarchy</span>
						</label>
						<label class="label cursor-pointer gap-2 py-0">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={zero} />
							<span class="label-text text-sm">Exclude zero balances</span>
						</label>
						<label class="label cursor-pointer gap-2 py-0">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={closedAccounts} />
							<span class="label-text text-sm">Include closed accounts</span>
						</label>
					</div>
					<label class="form-control w-32">
						<div class="label py-0.5"><span class="label-text text-xs">Depth</span></div>
						<input
							type="number"
							class="input input-bordered input-sm font-mono"
							placeholder="2"
							bind:value={depth}
						/>
					</label>
				{/if}

				<!-- Lots-specific options -->
				{#if command === 'lots'}
					<div class="divider my-1 text-xs opacity-50">Lots options</div>
					<div class="flex flex-wrap gap-4 items-center">
						<span class="text-sm font-medium">Show:</span>
						{#each [['active', 'Active'], ['all', 'All'], ['closed', 'Closed']] as [val, label]}
							<label class="label cursor-pointer gap-1.5 py-0">
								<input
									type="radio"
									class="radio radio-sm"
									name="lotsMode"
									value={val}
									bind:group={lotsMode}
								/>
								<span class="label-text text-sm">{label}</span>
							</label>
						{/each}
					</div>
					<div class="flex flex-wrap gap-4 items-center">
						<label class="label cursor-pointer gap-2 py-0">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={average} />
							<span class="label-text text-sm">Average cost</span>
						</label>
						<label class="form-control">
							<div class="label py-0.5"><span class="label-text text-xs">Sort by</span></div>
							<select class="select select-bordered select-sm" bind:value={sortBy}>
								<option value="">Default (date)</option>
								<option value="date">Date</option>
								<option value="price">Price</option>
								<option value="symbol">Symbol</option>
							</select>
						</label>
					</div>
				{/if}
			</div>
		</AccordionSection>

		<!-- BQL preview -->
		<div class="form-control w-full">
			<div class="label py-1">
				<span class="label-text text-xs text-base-content/60">Generated BQL</span>
				<button
					class="btn btn-ghost btn-xs gap-1"
					onclick={copyBql}
					title="Copy BQL to clipboard"
				>
					<CopyIcon size={14} />
					{#if copied}<span class="text-xs">Copied!</span>{/if}
				</button>
			</div>
			<textarea
				class="textarea textarea-bordered w-full font-mono text-xs h-20 resize-none"
				readonly
				value={bql}
			></textarea>
		</div>

		<!-- Run button -->
		<div>
			<button class="btn btn-primary btn-sm" onclick={runQuery} disabled={isRunning}>
				{#if isRunning}
					<span class="loading loading-spinner loading-xs"></span> Running…
				{:else}
					Run
				{/if}
			</button>
			<span class="text-xs text-base-content/40 ml-2">Ctrl+Enter</span>
		</div>

		<!-- Errors -->
		{#if errors.length > 0}
			<div class="border border-error rounded-lg bg-error/10 p-3 flex flex-col gap-1">
				{#each errors as err}
					<div class="text-error text-sm font-mono">
						{#if err.line}<span class="opacity-60">{err.severity} {err.line}:{err.column} — </span>{/if}{err.message}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Results -->
		{#if columns.length > 0}
			<div class="flex flex-col gap-2">
				<span class="text-sm text-base-content/60">
					{rows.length} row{rows.length !== 1 ? 's' : ''}
				</span>
				<div class="overflow-x-auto">
					<table class="table table-sm table-zebra w-full">
						<thead>
							<tr>
								{#each columns as col}
									<th>{col}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each rows as row}
								<tr>
									{#each columns as _col, i}
										<td class="font-mono text-xs whitespace-pre-wrap">
											{formatCell((row as unknown[])[i])}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
</main>
