<script lang="ts">
	import { CopyIcon } from '@lucide/svelte';

	interface QueryError {
		message: string
		severity?: string
		line?: number
		column?: number
	}

	interface Props {
		columns: string[]
		rows: unknown[]
		errors: QueryError[]
		showRunningTotal?: boolean
	}

	let { columns, rows, errors, showRunningTotal = false }: Props = $props()

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

	// --- Running totals (computed client-side, matching qqrl behaviour) ---

	function extractPositionUnits(value: unknown): { number: number; currency: string }[] {
		if (typeof value !== 'object' || value === null) return []
		const v = value as Record<string, unknown>
		if (typeof v.units === 'object' && v.units !== null) {
			const u = v.units as Record<string, unknown>
			if (typeof u.number === 'string' && typeof u.currency === 'string') {
				const n = parseFloat(u.number)
				if (!isNaN(n)) return [{ number: n, currency: u.currency }]
			}
		}
		if (typeof v.number === 'string' && typeof v.currency === 'string') {
			const n = parseFloat(v.number)
			if (!isNaN(n)) return [{ number: n, currency: v.currency }]
		}
		if (Array.isArray(v.positions)) {
			return (v.positions as unknown[]).flatMap((p) => extractPositionUnits(p))
		}
		return []
	}

	function computeRunningTotals(): string[] {
		if (!showRunningTotal) return []
		const posIdx = columns.indexOf('position')
		if (posIdx === -1) return []
		const accumulated = new Map<string, number>()
		return rows.map((row) => {
			for (const { number: n, currency: cur } of extractPositionUnits((row as unknown[])[posIdx])) {
				accumulated.set(cur, (accumulated.get(cur) ?? 0) + n)
			}
			return [...accumulated.entries()]
				.map(([cur, amt]) => `${formatNumber(amt.toFixed(2))} ${cur}`)
				.sort()
				.join(' | ')
		})
	}

	let rowRunningTotals = $derived(computeRunningTotals())

	// --- Copy results ---

	let resultsCopied = $state(false)

	async function copyResults() {
		const hasRunning = rowRunningTotals.length > 0
		const allCols = hasRunning ? [...columns, 'Running Total'] : columns
		const header = allCols.join('\t')
		const body = rows.map((row, rowIdx) => {
			const cells = columns.map((_col, colIdx) =>
				formatCell((row as unknown[])[colIdx]).replace(/\t/g, ' ').replace(/\n/g, ' | ')
			)
			if (hasRunning) cells.push(rowRunningTotals[rowIdx] ?? '')
			return cells.join('\t')
		})
		await navigator.clipboard.writeText([header, ...body].join('\n'))
		resultsCopied = true
		setTimeout(() => (resultsCopied = false), 1500)
	}
</script>

{#if errors.length > 0}
	<div class="border border-error rounded-lg bg-error/10 p-3 flex flex-col gap-1">
		{#each errors as err}
			<div class="text-error text-sm font-mono">
				{#if err.line}<span class="opacity-60">{err.severity} {err.line}:{err.column} — </span>{/if}{err.message}
			</div>
		{/each}
	</div>
{/if}

{#if columns.length > 0}
	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between">
			<span class="text-sm text-base-content/60">
				{rows.length} row{rows.length !== 1 ? 's' : ''}
			</span>
			<button
				class="btn btn-ghost btn-xs gap-1"
				onclick={copyResults}
				title="Copy results to clipboard"
			>
				<CopyIcon size={14} />
				{#if resultsCopied}<span class="text-xs">Copied!</span>{/if}
			</button>
		</div>
		<div class="overflow-x-auto">
			<table class="table table-sm w-full">
				<thead>
					<tr>
						{#each columns as col}
							<th>{col}</th>
						{/each}
						{#if rowRunningTotals.length > 0}
							<th class="text-right">Running Total</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each rows as row, rowIdx}
						<tr class={rowIdx % 2 === 1 ? 'bg-base-300/60' : ''}>
							{#each columns as _col, colIdx}
								<td class="font-mono text-xs whitespace-pre-wrap">
									{formatCell((row as unknown[])[colIdx])}
								</td>
							{/each}
							{#if rowRunningTotals.length > 0}
								<td class="font-mono text-xs text-right whitespace-pre-wrap">
									{rowRunningTotals[rowIdx] ?? ''}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
