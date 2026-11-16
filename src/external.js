import { ERROR_CODES } from './allnet.js'

/** Names that suggest a contact input (ALL4440 / ALL4442 and similar). */
const CONTACT_NAME =
	/(kontakt|contact|eingang|input|t(ü|ue)r|door|fenster|window|taster|button|schalter|switch|kn(o|ö)pf)/i

/** Units of measuring sensors, which are never a switch. */
const MEASURING_UNIT = /(°|%|ppm|lux|lx|hpa|mbar|bar|kwh|wh|w$|v$|a$|db|m\/s|km\/h|mm|l\/h)/i

/**
 * Pick the sensor that the external switch is connected to.
 * @param {Array<{id: string, name: string, unit: string, value: number|null}>} sensors Sensors (type 1)
 * @param {string} override Sensor id or name from the config (empty = automatic)
 * @returns {string|null} sensor id
 */
export function detectExternalSensor(sensors, override) {
	const wanted = String(override ?? '').trim()
	if (wanted) {
		const match =
			sensors.find((s) => String(s.id) === wanted) ??
			sensors.find((s) => String(s.name ?? '').toLowerCase() === wanted.toLowerCase())
		return match ? String(match.id) : null
	}
	// Leave out the lamp's own sensors (internal temperature, CO2 on the CO2 lamp) and measuring sensors.
	const candidates = sensors.filter(
		(s) =>
			!/^(intern|internal|co2)\b/i.test(String(s.name ?? '').trim()) &&
			!MEASURING_UNIT.test(String(s.unit ?? '').trim()),
	)
	const byName = candidates.find((s) => CONTACT_NAME.test(String(s.name ?? '')))
	return byName ? String(byName.id) : candidates[0] ? String(candidates[0].id) : null
}

/** Human-readable status for the external sensor. */
export function externalStatusText(item, configured) {
	if (!item) return configured ? 'not found' : 'no sensor'
	if (item.error) return ERROR_CODES[item.error] ?? `error ${item.error}`
	if (item.value === null || item.value === undefined) return 'no value'
	return 'ok'
}

/**
 * Track the external switch. ALLNET contact inputs read 1 when the circuit is open and 0 when it
 * is closed. With a switch that breaks the circuit, 1 means "active". `invert` swaps that for
 * normally-open buttons. Counter inputs (values above 1) count up instead.
 */
export class ExternalSensorState {
	constructor() {
		this.reset()
	}

	reset() {
		this.raw = null
		this.active = null
		this.count = 0
	}

	/**
	 * Feed a new reading. Returns true when the state or count changed.
	 * @param {number|null} raw
	 * @param {boolean} invert
	 */
	update(raw, invert) {
		const before = `${this.active}|${this.count}|${this.raw}`
		if (raw === null || raw === undefined || !Number.isFinite(raw)) {
			this.raw = null
			this.active = null
			return before !== `${this.active}|${this.count}|${this.raw}`
		}
		const previousRaw = this.raw
		const previousActive = this.active
		const isCounter = raw > 1 || (previousRaw !== null && previousRaw > 1)
		if (isCounter) {
			if (previousRaw !== null && raw > previousRaw) this.count += raw - previousRaw
			this.active = raw > 0
		} else {
			this.active = invert ? raw === 0 : raw > 0
			if (previousActive === false && this.active === true) this.count++
		}
		this.raw = raw
		return before !== `${this.active}|${this.count}|${this.raw}`
	}
}
