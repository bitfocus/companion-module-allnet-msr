import http from 'node:http'
import https from 'node:https'

/**
 * Error codes from the ALLNET JSON API documentation (json_read_description 3.207).
 */
export const ERROR_CODES = {
	777000: 'Collecting data...',
	777001: 'Sensor not initialized',
	777002: 'No answer from chip',
	777003: 'Could not read /proc/stat',
	777004: 'Could not find the first source sensor',
	777005: 'Could not find the second source sensor',
	777006: 'One of the source sensors is invalid',
	777007: 'Division by zero',
	777008: 'Timeout: sensor provides invalid or no data',
	777009: 'No answer from slave',
	777010: 'No answer or incorrect answer from the MRT machine',
	777011: 'HTTP download address for the sensor could not be reached',
	777012: 'HTTP command for the actuator returns nothing',
	777013: 'Authentication needed',
	777014: 'Sensor not found in the import file',
	777015: 'Server response was not interpretable',
	777994: 'Remote control functionality not activated',
	777995: 'Error',
	777996: 'Undefined error',
	777997: 'Given sensor is not a counter',
	777998: 'Remote control disabled',
	777999: 'Parameter error',
}

/** Classify an ALLNET error code so the module can show the right connection status. */
function kindForCode(code) {
	if (code === 777013) return 'auth'
	if (code === 777994 || code === 777998) return 'remote_disabled'
	if (code === 777999) return 'param'
	return 'device'
}

export class AllnetError extends Error {
	/**
	 * @param {string} message
	 * @param {{ kind?: 'auth'|'remote_disabled'|'param'|'device'|'network'|'protocol', code?: number, httpStatus?: number }} [info]
	 */
	constructor(message, info = {}) {
		super(message)
		this.name = 'AllnetError'
		this.kind = info.kind ?? 'device'
		this.code = info.code
		this.httpStatus = info.httpStatus
	}
}

function errorFromCode(code, context) {
	const num = Number(code)
	const text = ERROR_CODES[num] ?? `Error ${code}`
	return new AllnetError(context ? `${text} (${context})` : text, { kind: kindForCode(num), code: num })
}

/** A non-zero `error` value means the request failed. */
function isErrorValue(value) {
	if (value === undefined || value === null || value === '' || value === false) return false
	return String(value) !== '0'
}

/**
 * Split "http://10.0.0.5:8080/" style input into host and port, so users can paste a URL.
 */
export function normaliseHost(input) {
	let host = String(input ?? '').trim()
	let port
	let protocol
	const proto = /^(https?):\/\//i.exec(host)
	if (proto) {
		protocol = proto[1].toLowerCase()
		host = host.slice(proto[0].length)
	}
	host = host.replace(/\/.*$/, '')
	const withPort = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(host)
	if (withPort) {
		host = withPort[1]
		port = Number(withPort[2])
	}
	host = host.replace(/^\[|\]$/g, '')
	return { host, port, protocol }
}

/** Format a number the way the API expects ("." as decimal separator, no exponent). */
export function formatValue(value) {
	if (typeof value === 'string') return value
	const rounded = Math.round(Number(value) * 100) / 100
	return String(rounded)
}

export class AllnetClient {
	/**
	 * @param {{ host: string, port?: number, protocol?: 'http'|'https', insecure?: boolean, username?: string, password?: string, timeout?: number }} options
	 */
	constructor(options) {
		this.host = options.host
		this.protocol = options.protocol === 'https' ? 'https' : 'http'
		this.port = options.port && options.port > 0 ? options.port : this.protocol === 'https' ? 443 : 80
		this.insecure = options.insecure !== false
		this.username = options.username ?? ''
		this.password = options.password ?? ''
		this.timeout = options.timeout ?? 2500
		this.agent =
			this.protocol === 'https'
				? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: !this.insecure })
				: new http.Agent({ keepAlive: true, maxSockets: 4 })
	}

	destroy() {
		this.agent.destroy()
	}

	/**
	 * Build a query string. Entries are [key, value] pairs, or a bare string for a flag such as "simple".
	 */
	static buildQuery(parts) {
		const out = []
		for (const part of parts) {
			if (part === undefined || part === null) continue
			if (Array.isArray(part)) {
				const [key, value] = part
				if (value === undefined || value === null) continue
				out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
			} else {
				out.push(encodeURIComponent(part))
			}
		}
		return out.length ? `?${out.join('&')}` : ''
	}

	/**
	 * Perform a GET request and return the parsed JSON body.
	 * @param {string} path
	 * @param {Array} queryParts
	 * @param {AbortSignal} [signal]
	 */
	request(path, queryParts = [], signal) {
		const lib = this.protocol === 'https' ? https : http
		const requestPath = path + AllnetClient.buildQuery(queryParts)
		const auth = this.username || this.password ? `${this.username}:${this.password}` : undefined

		return new Promise((resolve, reject) => {
			let settled = false
			const finish = (fn, value) => {
				if (settled) return
				settled = true
				signal?.removeEventListener?.('abort', onAbort)
				fn(value)
			}

			const req = lib.request(
				{
					host: this.host,
					port: this.port,
					path: requestPath,
					method: 'GET',
					agent: this.agent,
					auth,
					headers: { Accept: 'application/json' },
				},
				(res) => {
					const chunks = []
					res.on('data', (chunk) => chunks.push(chunk))
					res.on('error', (err) =>
						finish(reject, new AllnetError(`Response error: ${err.message}`, { kind: 'network' })),
					)
					res.on('end', () => {
						const body = Buffer.concat(chunks).toString('utf8')
						const status = res.statusCode ?? 0
						if (status === 401 || status === 403) {
							return finish(
								reject,
								new AllnetError('Authentication failed (check username and password)', {
									kind: 'auth',
									httpStatus: status,
								}),
							)
						}
						if (status < 200 || status >= 300) {
							return finish(
								reject,
								new AllnetError(`HTTP ${status} from ${path}`, { kind: 'protocol', httpStatus: status }),
							)
						}
						try {
							finish(resolve, AllnetClient.parseBody(body, path))
						} catch (err) {
							finish(reject, err)
						}
					})
				},
			)

			const onAbort = () => {
				req.destroy(new AllnetError('Request aborted', { kind: 'network' }))
			}
			if (signal) {
				if (signal.aborted) return onAbort()
				signal.addEventListener('abort', onAbort, { once: true })
			}

			req.setTimeout(this.timeout, () => {
				req.destroy(new AllnetError(`No answer from ${this.host} (timeout)`, { kind: 'network' }))
			})
			req.on('error', (err) => {
				if (err instanceof AllnetError) return finish(reject, err)
				finish(reject, new AllnetError(`Cannot reach ${this.host}: ${err.message}`, { kind: 'network' }))
			})
			req.end()
		})
	}

	/**
	 * Parse a response body, turning ALLNET error codes into AllnetErrors.
	 */
	static parseBody(body, path) {
		const text = body.replace(/^﻿/, '').trim()
		let data
		try {
			data = JSON.parse(text)
		} catch {
			const code = /7770\d\d|7779\d\d/.exec(text)
			if (code) throw errorFromCode(code[0])
			if (/remote control/i.test(text)) {
				throw new AllnetError(text.slice(0, 120), { kind: 'remote_disabled' })
			}
			if (/auth/i.test(text)) {
				throw new AllnetError(text.slice(0, 120), { kind: 'auth' })
			}
			throw new AllnetError(`Unexpected answer from ${path}: ${text.slice(0, 80) || '(empty)'}`, {
				kind: 'protocol',
			})
		}

		if (data && typeof data === 'object' && !Array.isArray(data)) {
			if (isErrorValue(data.error)) throw errorFromCode(data.error)
			if (data.result && typeof data.result === 'object' && isErrorValue(data.result.error)) {
				throw errorFromCode(data.result.error, `actor ${data.result.id ?? '?'}`)
			}
		}
		return data
	}

	/**
	 * Read all sensors and actors.
	 * @param {boolean} simple Reduced output (id, name, type, unit, value, error)
	 * @returns {Promise<Array<object>>}
	 */
	async readAll(simple = true, signal) {
		const data = await this.request('/xml/json.php', [['mode', 'all'], simple ? 'simple' : undefined], signal)
		if (Array.isArray(data)) return data
		if (data && typeof data === 'object') {
			// Some firmware versions return an object keyed by id instead of an array.
			return Object.entries(data).map(([id, item]) => ({ id, ...(typeof item === 'object' ? item : {}) }))
		}
		throw new AllnetError('Unexpected sensor list from the device', { kind: 'protocol' })
	}

	/** Minimal device info (type, name, firmware). */
	async info(signal) {
		return this.request('/xml/json.php', [['mode', 'infomin']], signal)
	}

	/**
	 * Switch or set an actor.
	 * @param {string|number} id Actor id or name
	 * @param {number|string} value 0, 1, 'toggle' or an analog value
	 * @param {number} [fading] Fade time in seconds (analog actors only)
	 */
	async setActor(id, value, fading, signal) {
		const parts = [
			['id', id],
			['set', formatValue(value)],
		]
		if (fading !== undefined && fading !== null && Number(fading) > 0) parts.push(['fading', formatValue(fading)])
		const data = await this.request('/xml/jsonswitch.php', parts, signal)
		return data?.result ?? data
	}
}
