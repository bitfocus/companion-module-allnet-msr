// A small HTTP server that behaves like the ALLNET JSON API described in
// json_read_description 3.207 and msr_api_switch_description 3.25.
import http from 'node:http'

export function createFakeLamp({ user = 'remote', pass = 'secret', colourMax = 100, contact = false } = {}) {
	const items = [
		{ id: '1', name: 'Intern', type: '1', unit: '°C', value: 21.5, min: -55, max: 150 },
		{ id: '11', name: 'Rot', type: '2', unit: '', value: 0, min: 0, max: colourMax, analog: true },
		{ id: '12', name: 'Grün', type: '2', unit: '', value: 0, min: 0, max: colourMax, analog: true },
		{ id: '13', name: 'Blau', type: '2', unit: '', value: 0, min: 0, max: colourMax, analog: true },
		{ id: '14', name: 'Weiss', type: '2', unit: '', value: 0, min: 0, max: colourMax, analog: true },
		{ id: '21', name: 'Knopf ROT', type: '2', unit: '', value: 0, min: 0, max: 1 },
		{ id: '22', name: 'Knopf GELB', type: '2', unit: '', value: 0, min: 0, max: 1 },
		{ id: '23', name: 'Knopf GRUEN', type: '2', unit: '', value: 0, min: 0, max: 1 },
		{ id: '24', name: 'Knopf AUS', type: '2', unit: '', value: 0, min: 0, max: 1 },
		{ id: '25', name: 'Buzzer', type: '2', unit: '', value: 0, min: 0, max: 1 },
	]
	if (contact) items.push({ id: '101', name: 'Eingang 1', type: '1', unit: '', value: 0, min: 0, max: 1, error: 0 })
	const lamp = {
		items,
		requests: [],
		remoteEnabled: true,
		user,
		pass,
		down: false,
		get(name) {
			return items.find((i) => i.name === name || i.id === name)
		},
	}

	const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

	// delaySwitchMs: hold switch requests back, to test what happens while one is in flight
	lamp.delaySwitchMs = 0
	lamp.server = http.createServer((req, res) => {
		if (lamp.delaySwitchMs && req.url.startsWith('/xml/jsonswitch.php')) {
			setTimeout(() => handle(req, res), lamp.delaySwitchMs)
		} else handle(req, res)
	})
	const handle = (req, res) => {
		const url = new URL(req.url, 'http://x')
		lamp.requests.push(url.pathname + url.search)
		const send = (code, body) => {
			res.writeHead(code, { 'Content-Type': 'application/json' })
			res.end(typeof body === 'string' ? body : JSON.stringify(body))
		}
		if (lamp.user) {
			const expected = 'Basic ' + Buffer.from(`${lamp.user}:${lamp.pass}`).toString('base64')
			if (req.headers.authorization !== expected) return send(401, 'Authentication needed!')
		}
		if (url.pathname === '/xml/json.php') {
			if (!lamp.remoteEnabled) return send(200, { error: '777994' })
			const mode = url.searchParams.get('mode')
			if (mode === 'infomin') {
				return send(200, {
					devicetype: 'ALL-PoE-RGBW-LAMP',
					devicename: 'Studio lamp',
					softversion: '3.35',
					patchlevel: '1095',
					revision: '0.03',
				})
			}
			const simple = url.searchParams.has('simple')
			const list = items.map((i) =>
				simple
					? {
							error: i.error ?? 0,
							id: i.id,
							name: i.name,
							type: i.type,
							unit: i.unit,
							value: i.error ? '' : fmt(i.value),
						}
					: {
							id: i.id,
							name: i.name,
							description: i.type === '1' ? 'Temperatursensor' : 'Aktor',
							error: '0',
							value: fmt(i.value),
							config: { icon: null, display: { min: String(i.min), max: String(i.max) } },
							info: { activ: '1', enabled: '1', unit: i.unit, type: i.type },
						},
			)
			return send(200, list)
		}
		if (url.pathname === '/xml/jsonswitch.php') {
			if (!lamp.remoteEnabled) return send(200, { result: { id: url.searchParams.get('id'), error: '777994' } })
			const id = url.searchParams.get('id')
			const item = lamp.get(id)
			if (!item || item.type !== '2') return send(200, { result: { id, error: '777999' } })
			const status = item.value
			const set = url.searchParams.get('set')
			if (set === null) return send(200, { result: { id: item.id, status } })
			if (set === 'toggle') item.value = item.value ? 0 : 1
			else {
				const n = Number(set)
				if (!Number.isFinite(n)) return send(200, { result: { id, error: '777999' } })
				item.value = item.analog ? n : n ? 1 : 0
			}
			const result = { id: item.id, status, set }
			if (url.searchParams.has('fading')) result.fading = url.searchParams.get('fading')
			return send(200, { result })
		}
		send(404, 'not found')
	}

	lamp.listen = () =>
		new Promise((resolve) => lamp.server.listen(0, '127.0.0.1', () => resolve(lamp.server.address().port)))
	lamp.close = () =>
		new Promise((resolve) => {
			lamp.server.closeAllConnections?.()
			lamp.server.close(() => resolve())
		})
	return lamp
}
