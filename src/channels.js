/** The four colour channels of the lamp, in the order R, G, B, W. */
export const CHANNELS = [
	{ id: 'red', label: 'Red' },
	{ id: 'green', label: 'Green' },
	{ id: 'blue', label: 'Blue' },
	{ id: 'white', label: 'White' },
]

export const CHANNEL_IDS = CHANNELS.map((c) => c.id)

/**
 * Name patterns used to find the right actor for each channel.
 * The lamp's web UI uses German names by default (Rot, Grün, Blau, Weiss, Buzzer).
 * `exact` must match the whole name; `loose` may match part of it.
 */
const PATTERNS = {
	red: { exact: /^(rot|red|rouge|rojo|rosso|r)$/i, loose: /\b(rot|red|rouge|rojo|rosso)\b/i },
	green: { exact: /^(gr(ü|ue|u)n|green|vert|verde|g)$/i, loose: /(gr(ü|ue|u)n|green|vert|verde)/i },
	blue: { exact: /^(blau|blue|bleu|azul|blu|b)$/i, loose: /(blau|blue|bleu|azul)/i },
	white: { exact: /^(wei(ss|ß)|white|blanc|blanco|bianco|w)$/i, loose: /(wei(ss|ß)|white|blanc|bianco)/i },
	buzzer: { exact: /^(buzzer|summer|piezo|beeper)$/i, loose: /(buzzer|summer|piezo|beep)/i },
}

/** Button-style actors on the lamp ("Knopf ROT" etc.) must not be mistaken for colour channels. */
const NOT_A_CHANNEL = /(knopf|button|taster|schalter|ampel|preset)/i

/**
 * Work out which actor id drives each channel.
 * @param {Array<{id: string, name: string}>} actors Actors (type 2) read from the device
 * @param {Record<string, string>} overrides User-entered id or name per channel (empty = auto)
 * @returns {Record<'red'|'green'|'blue'|'white'|'buzzer', string|null>}
 */
export function detectChannelActors(actors, overrides = {}) {
	const result = {}
	const used = new Set()

	for (const key of [...CHANNEL_IDS, 'buzzer']) {
		const override = String(overrides[key] ?? '').trim()
		if (override) {
			const match =
				actors.find((a) => String(a.id) === override) ??
				actors.find((a) => String(a.name ?? '').toLowerCase() === override.toLowerCase())
			// The API accepts a name as id, so keep the raw value if it is not in the list.
			result[key] = match ? String(match.id) : override
			used.add(result[key])
		}
	}

	for (const key of [...CHANNEL_IDS, 'buzzer']) {
		if (result[key]) continue
		const pattern = PATTERNS[key]
		const free = actors.filter((a) => !used.has(String(a.id)))
		const name = (a) => String(a.name ?? '').trim()
		const found =
			free.find((a) => pattern.exact.test(name(a))) ??
			free.find((a) => pattern.loose.test(name(a)) && !NOT_A_CHANNEL.test(name(a)))
		result[key] = found ? String(found.id) : null
		if (found) used.add(String(found.id))
	}
	return result
}

/**
 * Named colours as R, G, B, W percentages.
 * Yellow and orange are mixed from red and green; the green LEDs are about twice as bright
 * as the red ones, so green is kept lower. Adjust with "Set colour (RGBW)" if needed.
 */
export const NAMED_COLOURS = {
	red: { label: 'Red', rgbw: [100, 0, 0, 0], display: 0xff0000 },
	orange: { label: 'Orange', rgbw: [100, 15, 0, 0], display: 0xff7a00 },
	yellow: { label: 'Yellow', rgbw: [100, 45, 0, 0], display: 0xffd400 },
	green: { label: 'Green', rgbw: [0, 100, 0, 0], display: 0x00c853 },
	cyan: { label: 'Cyan', rgbw: [0, 100, 100, 0], display: 0x00e5ff },
	blue: { label: 'Blue', rgbw: [0, 0, 100, 0], display: 0x2962ff },
	magenta: { label: 'Magenta', rgbw: [100, 0, 100, 0], display: 0xd500f9 },
	white: { label: 'White', rgbw: [0, 0, 0, 100], display: 0xffffff },
	off: { label: 'Off', rgbw: [0, 0, 0, 0], display: 0x000000 },
}

export const NAMED_COLOUR_CHOICES = Object.entries(NAMED_COLOURS).map(([id, c]) => ({ id, label: c.label }))

export function clampPercent(value) {
	const n = Number(value)
	if (!Number.isFinite(n)) return 0
	return Math.min(100, Math.max(0, n))
}

/** Scale a named colour by a brightness percentage. Returns { red, green, blue, white }. */
export function namedColourTarget(colourId, brightness = 100) {
	const colour = NAMED_COLOURS[colourId] ?? NAMED_COLOURS.off
	const factor = clampPercent(brightness) / 100
	const [r, g, b, w] = colour.rgbw.map((v) => Math.round(v * factor * 100) / 100)
	return { red: r, green: g, blue: b, white: w }
}

/**
 * Convert a Companion colour (number 0xRRGGBB or a CSS string) to R, G, B percentages.
 */
export function colourToPercent(colour) {
	let r = 0
	let g = 0
	let b = 0
	if (typeof colour === 'number' && Number.isFinite(colour)) {
		r = (colour >> 16) & 0xff
		g = (colour >> 8) & 0xff
		b = colour & 0xff
	} else if (typeof colour === 'string') {
		const s = colour.trim()
		const hex = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
		const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s)
		if (hex) {
			const n = parseInt(hex[1], 16)
			r = (n >> 16) & 0xff
			g = (n >> 8) & 0xff
			b = n & 0xff
		} else if (rgb) {
			r = Number(rgb[1])
			g = Number(rgb[2])
			b = Number(rgb[3])
		} else if (/^\d+$/.test(s)) {
			return colourToPercent(Number(s))
		}
	}
	const pct = (v) => (v / 255) * 100
	return { red: pct(r), green: pct(g), blue: pct(b) }
}

/** sRGB component (0–1) to linear light (0–1). */
export function srgbToLinear(c) {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Linear light (0–1) to sRGB component (0–1). */
export function linearToSrgb(c) {
	const v = Math.min(1, Math.max(0, c))
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

/**
 * Turn a screen colour into lamp levels (percent).
 * - gamma: screen colours are gamma-encoded, LED levels are linear. Converting makes dark and
 *   mid colours look like they do on screen instead of washed out.
 * - useWhite: the grey part of the colour (equal R, G and B) is taken by the white LEDs.
 * @param {number|string} colour Companion colour number or CSS colour
 * @param {{ gamma?: boolean, useWhite?: boolean, brightness?: number, white?: number }} [options]
 */
export function colourToLampTarget(colour, { gamma = true, useWhite = true, brightness = 100, white = 0 } = {}) {
	const pct = colourToPercent(colour)
	let [r, g, b] = [pct.red, pct.green, pct.blue].map((v) => v / 100)
	if (gamma) [r, g, b] = [r, g, b].map(srgbToLinear)
	let w = 0
	if (useWhite) {
		w = Math.min(r, g, b)
		r -= w
		g -= w
		b -= w
	}
	const factor = clampPercent(brightness) / 100
	const out = (v) => Math.round(Math.min(100, v * 100 * factor) * 100) / 100
	return {
		red: out(r),
		green: out(g),
		blue: out(b),
		white: out(Math.min(1, w + clampPercent(white) / 100)),
	}
}

/**
 * Approximate how the lamp looks as a 24-bit screen colour, for button backgrounds and the hex
 * variable. The white channel lifts all three components; levels are treated as linear light.
 */
export function mixToRgb({ red, green, blue, white }) {
	const w = clampPercent(white ?? 0) / 100
	const comp = (c) => Math.round(linearToSrgb(clampPercent(c ?? 0) / 100 + w) * 255)
	return { r: comp(red), g: comp(green), b: comp(blue) }
}

export function rgbToNumber({ r, g, b }) {
	return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

export function rgbToHex({ r, g, b }) {
	return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Black or white text, whichever reads better on the given background. */
export function textColourFor(bg) {
	const r = (bg >> 16) & 0xff
	const g = (bg >> 8) & 0xff
	const b = bg & 0xff
	const luminance = 0.299 * r + 0.587 * g + 0.114 * b
	return luminance > 150 ? 0x000000 : 0xffffff
}

/** True when the current mix matches a target within a tolerance (percentage points). */
export function mixMatches(current, target, tolerance = 3) {
	return CHANNEL_IDS.every((ch) => {
		const value = current[ch]
		if (value === null || value === undefined) return false
		return Math.abs(value - (target[ch] ?? 0)) <= tolerance
	})
}
