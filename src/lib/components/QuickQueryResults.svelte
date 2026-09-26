<script lang="ts">
	import { CopyIcon } from '@lucide/svelte';
	import { formatCellValue as formatCell, formatNumber } from '$lib/utils/queryValueFormatter';

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
