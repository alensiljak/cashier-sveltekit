// One-off migration: rewrite `import { A, B as C } from '@lucide/svelte'`
// into per-icon deep imports (`import A from '@lucide/svelte/icons/a'`).
// Usage: node scripts/migrate-lucide-imports.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dry = process.argv.includes('--dry');
const root = process.cwd();
const dist = path.join(root, 'node_modules', '@lucide', 'svelte', 'dist');

// Build exportName -> icon file basename map from the package's own barrels.
const map = new Map();
const re =
	/default\s+as\s+(\w+)\s*\}\s*from\s*['"](?:\.\.\/icons\/|\.\/)([\w-]+)\.(?:js|svelte)['"]/g;
for (const f of [
	'icons/index.js',
	'aliases/aliases.js',
	'aliases/prefixed.js',
	'aliases/suffixed.js'
]) {
	const text = readFileSync(path.join(dist, f), 'utf8');
	for (const m of text.matchAll(re)) map.set(m[1], m[2]);
}
console.log(`Resolved ${map.size} icon export names`);

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.svelte-kit' || name.startsWith('.')) continue;
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) yield* walk(full);
		else if (/\.(svelte|ts|js)$/.test(name)) yield full;
	}
}

const importRe = /^([ \t]*)import\s*(type\s*)?\{([^}]*)\}\s*from\s*(['"])@lucide\/svelte\4;?/gm;
let files = 0;
let statements = 0;
const missing = [];

for (const file of walk(path.join(root, 'src'))) {
	const src = readFileSync(file, 'utf8');
	if (!src.includes("@lucide/svelte'") && !src.includes('@lucide/svelte"')) continue;
	const eol = src.includes('\r\n') ? '\r\n' : '\n';
	const out = src.replace(importRe, (whole, indent, typeKw, body) => {
		if (typeKw) return whole; // type-only imports are erased; leave alone
		const lines = [];
		for (const raw of body.split(',')) {
			const spec = raw.trim();
			if (!spec) continue;
			const [name, local = name] = spec.split(/\s+as\s+/).map((s) => s.trim());
			const iconFile = map.get(name);
			if (!iconFile) {
				missing.push(`${path.relative(root, file)}: ${name}`);
				return whole;
			}
			lines.push(`${indent}import ${local} from '@lucide/svelte/icons/${iconFile}';`);
		}
		statements++;
		return lines.join(eol);
	});
	if (out !== src) {
		files++;
		if (!dry) writeFileSync(file, out);
	}
}

console.log(`${dry ? '[dry] ' : ''}Rewrote ${statements} statements in ${files} files`);
if (missing.length) {
	console.error('Unresolved names (statement left untouched):\n' + missing.join('\n'));
	process.exitCode = 1;
}
