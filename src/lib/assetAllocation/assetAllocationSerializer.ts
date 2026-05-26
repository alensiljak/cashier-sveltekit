import { buildChildrenIndex } from './assetAllocationUtils.js';
import type { AssetClass } from './AssetClass.js';

function serializeNode(
	ac: AssetClass,
	childrenIndex: Map<string, AssetClass[]>,
	lines: string[]
): void {
	const tablePath = ac.fullname.replace(/:/g, '.');
	lines.push(`[${tablePath}]`);
	lines.push(`allocation = ${ac.allocation}`);
	if (ac.symbols?.length) {
		const syms = ac.symbols.map((s) => `"${s}"`).join(', ');
		lines.push(`symbols = [${syms}]`);
	}
	lines.push('');
	for (const child of childrenIndex.get(ac.fullname) ?? []) {
		serializeNode(child, childrenIndex, lines);
	}
}

export function serializeToToml(assetClasses: AssetClass[]): string {
	const childrenIndex = buildChildrenIndex(assetClasses);
	const roots = assetClasses.filter((ac) => ac.depth === 0);
	const lines: string[] = [];
	for (const root of roots) {
		serializeNode(root, childrenIndex, lines);
	}
	return lines.join('\n').trimEnd() + '\n';
}
