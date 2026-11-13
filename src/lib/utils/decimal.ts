/**
 * Exact decimal arithmetic for importers, so that summing and scaling amounts read from a
 * statement does not pick up binary floating-point noise (0.1 + 0.2 !== 0.3).
 *
 * A value is an integer mantissa and a scale: `n / 10^scale`. Instances are immutable.
 * Numbers stay as text until the very end; `toNumber()` is the only place a float appears.
 * Rounding is half-even (banker's), the same as Python's `Decimal.quantize` default.
 */

const TEN = 10n;
const pow10 = (k: number): bigint => TEN ** BigInt(k);

/** Integer division rounded half to even. */
function divRound(num: bigint, den: bigint): bigint {
	if (den === 0n) throw new RangeError('Division by zero');
	const negative = num < 0n !== den < 0n;
	const a = num < 0n ? -num : num;
	const b = den < 0n ? -den : den;
	let q = a / b;
	const twiceRemainder = 2n * (a % b);
	if (twiceRemainder > b || (twiceRemainder === b && q % 2n === 1n)) q += 1n;
	return negative ? -q : q;
}

const NUMBER_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export class Dec {
	private constructor(
		/** The value times 10^scale. */
		readonly n: bigint,
		/** Number of decimal places carried (never negative). */
		readonly scale: number
	) {}

	static readonly ZERO = new Dec(0n, 0);

	/** Parses plain or exponent notation: `-12.50`, `.5`, `1E-7`. Throws on anything else. */
	static parse(text: string): Dec {
		const m = NUMBER_RE.exec(text.trim());
		const int = m?.[2] ?? '';
		const frac = m?.[3] ?? '';
		if (!m || int + frac === '') throw new SyntaxError(`Not a decimal number: "${text}"`);

		const exponent = m[4] ? Number(m[4]) : 0;
		let n = BigInt(int + frac);
		if (m[1] === '-') n = -n;
		const scale = frac.length - exponent;
		return scale >= 0 ? new Dec(n, scale) : new Dec(n * pow10(-scale), 0);
	}

	/** From a JS number, through its shortest round-trip text. For literals in code and tests. */
	static of(value: number): Dec {
		return Dec.parse(String(value));
	}

	private static aligned(a: Dec, b: Dec): [bigint, bigint, number] {
		const scale = Math.max(a.scale, b.scale);
		return [a.n * pow10(scale - a.scale), b.n * pow10(scale - b.scale), scale];
	}

	add(other: Dec): Dec {
		const [x, y, scale] = Dec.aligned(this, other);
		return new Dec(x + y, scale);
	}

	sub(other: Dec): Dec {
		const [x, y, scale] = Dec.aligned(this, other);
		return new Dec(x - y, scale);
	}

	neg(): Dec {
		return new Dec(-this.n, this.scale);
	}

	abs(): Dec {
		return this.n < 0n ? this.neg() : this;
	}

	mul(other: Dec): Dec {
		return new Dec(this.n * other.n, this.scale + other.scale);
	}

	/** Division, rounded half-even to `scale` decimal places. */
	div(other: Dec, scale: number): Dec {
		// (a/10^sa) / (b/10^sb) * 10^scale = a * 10^(scale + sb) / (b * 10^sa)
		const num = this.n * pow10(scale + other.scale);
		const den = other.n * pow10(this.scale);
		return new Dec(divRound(num, den), scale);
	}

	/** Rounds half-even (or pads with zeros) to exactly `scale` decimal places. */
	quantize(scale: number): Dec {
		if (scale >= this.scale) return new Dec(this.n * pow10(scale - this.scale), scale);
		return new Dec(divRound(this.n, pow10(this.scale - scale)), scale);
	}

	/** -1, 0 or 1. */
	cmp(other: Dec): -1 | 0 | 1 {
		const [x, y] = Dec.aligned(this, other);
		return x < y ? -1 : x > y ? 1 : 0;
	}

	get sign(): -1 | 0 | 1 {
		return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
	}

	isZero(): boolean {
		return this.n === 0n;
	}

	/** Number of decimal places once trailing zeros are dropped. */
	get precision(): number {
		let { n, scale } = this;
		while (scale > 0 && n % TEN === 0n) {
			n /= TEN;
			scale--;
		}
		return scale;
	}

	/** Plain decimal text without trailing zeros: `0.30`, not `3E-1`. */
	toString(): string {
		const negative = this.n < 0n;
		const digits = (negative ? -this.n : this.n).toString().padStart(this.scale + 1, '0');
		const int = digits.slice(0, digits.length - this.scale);
		const frac = digits.slice(digits.length - this.scale).replace(/0+$/, '');
		return (negative ? '-' : '') + int + (frac ? '.' + frac : '');
	}

	toNumber(): number {
		return Number(this.toString());
	}
}

/** Sum of decimals; zero for none. */
export function sumDec(values: Iterable<Dec>): Dec {
	let total = Dec.ZERO;
	for (const v of values) total = total.add(v);
	return total;
}
