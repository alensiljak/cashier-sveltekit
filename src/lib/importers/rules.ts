/**
 * Rules that rewrite the payee and/or pick the counter-account of an imported
 * transaction. One ordered list; for each field the first enabled matching rule
 * that sets it wins, so a specific rule placed before a general one overrides it.
 */
export interface Rule {
	/** Regex (case-insensitive), tested against the source strings of the row, e.g. partner name and payment reference. */
	match: string;
	/** New payee. */
	payee?: string;
	/** Counter-account. */
	account?: string;
	/** Kept in the list but ignored. */
	disabled?: boolean;
}

/** Config fields shared by importers that use rules. The two tuple lists are the older format. */
export interface RuleConfig {
	rules?: Rule[];
	/** @deprecated Read as rules; replaced on the next rule save. */
	payeeRenames?: [string, string][];
	/** @deprecated Read as rules; replaced on the next rule save. */
	categories?: [string, string][];
}

/** The rules of a config: `rules`, followed by any older-format entries converted. */
export function allRules(config: RuleConfig): Rule[] {
	return [
		...(config.rules ?? []),
		...(config.payeeRenames ?? []).map(([match, payee]): Rule => ({ match, payee })),
		...(config.categories ?? []).map(([match, account]): Rule => ({ match, account }))
	];
}

/** The config with `rule` at the front of the list (so it takes precedence) and the older-format lists folded in. */
export function withRule<T extends RuleConfig>(config: T, rule: Rule): T {
	const { payeeRenames: _p, categories: _c, ...rest } = config;
	return { ...rest, rules: [rule, ...allRules(config)] } as T;
}

/** The config with exactly these rules (older-format lists dropped; `allRules` already folded them in). */
export function withRules<T extends RuleConfig>(config: T, rules: Rule[]): T {
	const { payeeRenames: _p, categories: _c, ...rest } = config;
	return { ...rest, rules } as T;
}

/**
 * The config with the rule at `index` of `allRules(config)` replaced, or removed
 * when `rule` is null. Older-format lists are folded into `rules` first, so the
 * index means the same thing here as when the rule was reported.
 */
export function replaceRule<T extends RuleConfig>(config: T, index: number, rule: Rule | null): T {
	const { payeeRenames: _p, categories: _c, ...rest } = config;
	const rules = allRules(config);
	if (rule) rules[index] = rule;
	else rules.splice(index, 1);
	return { ...rest, rules } as T;
}

export interface CompiledRule {
	rule: Rule;
	/** Position in the rule list, 0-based. */
	index: number;
	re: RegExp;
}

/** Skips disabled rules and patterns that are not valid regexes. */
export function compileRules(rules: Rule[]): CompiledRule[] {
	const compiled: CompiledRule[] = [];
	rules.forEach((rule, index) => {
		if (rule.disabled || !rule.match) return;
		try {
			compiled.push({ rule, index, re: new RegExp(rule.match, 'i') });
		} catch {
			// An invalid pattern is ignored rather than breaking the whole import.
		}
	});
	return compiled;
}

export interface RuleOutcome {
	payee?: string;
	payeeRule?: CompiledRule;
	account?: string;
	accountRule?: CompiledRule;
}

/** Applies compiled rules to a row's source strings. */
export function evaluateRules(rules: CompiledRule[], texts: string[]): RuleOutcome {
	const outcome: RuleOutcome = {};
	for (const compiled of rules) {
		if (outcome.payee !== undefined && outcome.account !== undefined) break;
		const { rule, re } = compiled;
		if (!texts.some((t) => re.test(t))) continue;
		if (outcome.payee === undefined && rule.payee) {
			outcome.payee = rule.payee;
			outcome.payeeRule = compiled;
		}
		if (outcome.account === undefined && rule.account) {
			outcome.account = rule.account;
			outcome.accountRule = compiled;
		}
	}
	return outcome;
}

/** How many of the rows a pattern would match; 0 for an empty or invalid pattern. */
export function countMatches(pattern: string, rowTexts: string[][]): number {
	if (!pattern) return 0;
	let re: RegExp;
	try {
		re = new RegExp(pattern, 'i');
	} catch {
		return 0;
	}
	return rowTexts.filter((texts) => texts.some((t) => re.test(t))).length;
}

export function isValidPattern(pattern: string): boolean {
	try {
		new RegExp(pattern, 'i');
		return pattern.length > 0;
	} catch {
		return false;
	}
}

export function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short description of a rule for the Details pane, e.g. `#3 "^hofer" → Hofer`. */
export function describeRule(compiled: CompiledRule, result: string): string {
	return `#${compiled.index + 1} "${compiled.rule.match}" → ${result}`;
}
