/**
 * Svelte outro transition: the element shatters into small shards that burst
 * outward from its centre and fall, then its height collapses so the siblings
 * below slide up.
 *
 * The particles live on a temporary fixed-position canvas over the element
 * (no snapshot library, no state outside the transition). Svelte's own frame
 * loop drives `tick`, so many rows leaving at once share one loop. Does nothing
 * under `prefers-reduced-motion`.
 *
 * Usage: `<li out:disintegrate|global>` (use `|global` so the last row of a
 * list that is removed together with its parent still plays).
 */

const DURATION = 900;
const MAX_PARTICLES = 600;
/** Room around the element for particles that fly outside it. */
const MARGIN = { left: 80, right: 80, y: 60 };
/** Theme token mixed in sparingly; everything else is the row's own text colour. */
const ACCENT_VAR = '--color-primary';
/** Share of particles (out of `TEXT_WEIGHT + 1`) that use the accent colour. */
const TEXT_WEIGHT = 7;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	/** Seconds into the animation before this particle starts moving. */
	delay: number;
	color: string;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function palette(node: HTMLElement): string[] {
	const style = getComputedStyle(node);
	const colors = Array<string>(TEXT_WEIGHT).fill(style.color);
	const accent = style.getPropertyValue(ACCENT_VAR).trim();
	if (accent) colors.push(accent);
	return colors;
}

export function disintegrate(node: HTMLElement) {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return { duration: 0 };
	}

	const rect = node.getBoundingClientRect();
	const style = getComputedStyle(node);
	const height = rect.height;
	const padding = parseFloat(style.paddingTop) || 0;

	// ── Canvas overlay ─────────────────────────────────────────────────────
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const width = rect.width + MARGIN.left + MARGIN.right;
	const canvasHeight = rect.height + MARGIN.y * 2;
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(width * dpr);
	canvas.height = Math.ceil(canvasHeight * dpr);
	canvas.setAttribute('aria-hidden', 'true');
	Object.assign(canvas.style, {
		position: 'fixed',
		left: `${rect.left - MARGIN.left}px`,
		top: `${rect.top - MARGIN.y}px`,
		width: `${width}px`,
		height: `${canvasHeight}px`,
		pointerEvents: 'none',
		zIndex: '1000'
	});
	document.body.appendChild(canvas);
	const ctx = canvas.getContext('2d');
	ctx?.scale(dpr, dpr);
	// Safety net: never leave a canvas behind if the transition is interrupted.
	const cleanup = window.setTimeout(() => canvas.remove(), DURATION + 200);

	// ── Particles ──────────────────────────────────────────────────────────
	const colors = palette(node);
	const cell = Math.max(4, Math.sqrt((rect.width * rect.height) / MAX_PARTICLES));
	const particles: Particle[] = [];
	const cx = rect.width / 2;
	const cy = rect.height / 2;
	for (let gx = 0; gx < rect.width; gx += cell) {
		for (let gy = 0; gy < rect.height; gy += cell) {
			const x = gx + rand(0, cell);
			const y = gy + rand(0, cell);
			// Burst outward from the centre with some scatter. The row is much wider
			// than tall, so scale the vertical offset up to keep the spread round
			// rather than a flat horizontal fan.
			const angle = Math.atan2((y - cy) * 6, x - cx) + rand(-0.5, 0.5);
			const speed = rand(25, 130);
			particles.push({
				x: x + MARGIN.left,
				y: y + MARGIN.y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 20,
				size: rand(1, 2.4),
				// Shards let go almost together, like glass cracking.
				delay: rand(0, 0.07),
				color: colors[Math.floor(Math.random() * colors.length)]
			});
		}
	}

	const seconds = DURATION / 1000;
	const GRAVITY = 220;

	return {
		duration: DURATION,
		easing: (t: number) => t,
		css: (_t: number, u: number) => {
			// The row itself fades in the first half; its height collapses in the second.
			const fade = Math.max(0, 1 - u * 2.2);
			const collapse = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
			return (
				`overflow:hidden;opacity:${fade};` +
				`height:${height * collapse}px;padding-block:${padding * collapse}px;`
			);
		},
		tick: (t: number, u: number) => {
			if (!ctx) return;
			const time = u * seconds;
			ctx.clearRect(0, 0, width, canvasHeight);
			for (const p of particles) {
				const age = time - p.delay;
				if (age < 0) {
					// Not released yet: still part of the row.
					ctx.globalAlpha = Math.max(0, 1 - u * 2.2);
					ctx.fillStyle = p.color;
					ctx.fillRect(p.x, p.y, p.size, p.size);
					continue;
				}
				const x = p.x + p.vx * age;
				const y = p.y + p.vy * age + 0.5 * GRAVITY * age * age;
				ctx.globalAlpha = Math.max(0, 1 - age / (seconds - p.delay));
				ctx.fillStyle = p.color;
				ctx.fillRect(x, y, p.size, p.size);
			}
			if (t === 0) {
				window.clearTimeout(cleanup);
				canvas.remove();
			}
		}
	};
}
