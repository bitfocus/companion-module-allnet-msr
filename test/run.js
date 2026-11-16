import assert from 'node:assert/strict'
import { createFakeLamp } from './fake-lamp.js'
import Module, { UpgradeScripts } from '../src/main.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
async function step(name, fn) {
	try {
		await fn()
		passed++
		console.log(`✔ ${name}`)
	} catch (err) {
		console.log(`✘ ${name}\n   ${err.stack}`)
		process.exitCode = 1
	}
}
async function waitFor(fn, ms = 3000, label = 'condition') {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (fn()) return
		await sleep(20)
	}
	throw new Error(`timeout waiting for ${label}`)
}

// ---- definition validation, following the field schemas in companion-module-base host/src/schema/options.ts
function validateFields(where, fields) {
	const ids = new Set()
	for (const f of fields) {
		assert.ok(f.id && typeof f.id === 'string', `${where}: field without id`)
		assert.ok(!ids.has(f.id), `${where}: duplicate id ${f.id}`)
		ids.add(f.id)
		assert.ok(typeof f.label === 'string', `${where}.${f.id}: label`)
		switch (f.type) {
			case 'number':
				for (const k of ['default', 'min', 'max'])
					assert.equal(typeof f[k], 'number', `${where}.${f.id}: number needs ${k}`)
				assert.ok(f.default >= f.min && f.default <= f.max, `${where}.${f.id}: default out of range`)
				break
			case 'dropdown':
				assert.ok(Array.isArray(f.choices), `${where}.${f.id}: choices`)
				if (!f.allowCustom)
					assert.ok(
						f.choices.some((c) => c.id === f.default),
						`${where}.${f.id}: default ${f.default} not in choices`,
					)
				break
			case 'checkbox':
				assert.equal(typeof f.default, 'boolean', `${where}.${f.id}: checkbox default`)
				break
			case 'static-text':
				assert.equal(typeof f.value, 'string', `${where}.${f.id}: static-text value`)
				break
			case 'colorpicker':
				assert.ok(['number', 'string'].includes(typeof f.default), `${where}.${f.id}: colour default`)
				break
			case 'textinput':
			case 'secret-text':
				if (f.default !== undefined) assert.equal(typeof f.default, 'string')
				break
			default:
				throw new Error(`${where}.${f.id}: unexpected type ${f.type}`)
		}
		assert.equal(typeof f.isVisible, 'undefined', `${where}.${f.id}: isVisible functions are ignored in API 2`)
	}
	return ids
}

function validateDefinitions(m) {
	validateFields('config', m.getConfigFields())
	const actionOpts = {}
	for (const [id, a] of Object.entries(m.actionDefs)) {
		assert.ok(a.name, `action ${id} name`)
		assert.equal(typeof a.callback, 'function', `action ${id} callback`)
		actionOpts[id] = validateFields(`action ${id}`, a.options)
	}
	const fbOpts = {}
	for (const [id, f] of Object.entries(m.feedbackDefs)) {
		assert.ok(['boolean', 'advanced'].includes(f.type), `feedback ${id} type`)
		if (f.type === 'boolean') assert.ok(f.defaultStyle, `feedback ${id} defaultStyle`)
		assert.equal(typeof f.subscribe, 'undefined', `feedback ${id}: subscribe removed in API 2`)
		fbOpts[id] = validateFields(`feedback ${id}`, f.options)
	}
	const varIds = new Set(Object.keys(m.varDefs))
	const referenced = new Set()
	for (const section of m.presetStructure) {
		assert.ok(section.id && section.name, 'preset section id/name')
		for (const def of section.definitions) {
			const keys = typeof def === 'string' ? [def] : def.presets
			if (typeof def !== 'string') {
				assert.ok(def.id && def.name && def.type === 'simple', `group in ${section.id} needs id, name, type`)
				assert.ok(Array.isArray(def.presets), `group ${def.id} presets`)
			}
			for (const key of keys) {
				assert.ok(!referenced.has(key), `preset ${key} placed twice`)
				referenced.add(key)
				assert.ok(m.presets[key], `structure references missing preset ${key}`)
			}
		}
	}
	for (const [key, p] of Object.entries(m.presets)) {
		assert.ok(referenced.has(key), `preset ${key} not placed in structure`)
		assert.equal(p.type, 'simple', `preset ${key} type`)
		assert.equal(p.category, undefined, `preset ${key}: category removed in API 2`)
		for (const s of p.steps) {
			for (const a of [...s.down, ...s.up]) {
				assert.ok(actionOpts[a.actionId], `preset ${key}: unknown action ${a.actionId}`)
				for (const k of Object.keys(a.options))
					assert.ok(actionOpts[a.actionId].has(k), `preset ${key}: action ${a.actionId} has no option ${k}`)
			}
		}
		for (const f of p.feedbacks) {
			assert.ok(fbOpts[f.feedbackId], `preset ${key}: unknown feedback ${f.feedbackId}`)
			for (const k of Object.keys(f.options))
				assert.ok(fbOpts[f.feedbackId].has(k), `preset ${key}: feedback ${f.feedbackId} has no option ${k}`)
		}
		for (const [, v] of String(p.style.text).matchAll(/\$\(allnet:([^)]+)\)/g))
			assert.ok(varIds.has(v), `preset ${key} uses unknown variable ${v}`)
	}
	assert.deepEqual([...m.undefinedVariableWrites], [], 'variables written without definition')
}

function opts(m, actionId, overrides = {}) {
	const o = {}
	for (const f of m.actionDefs[actionId].options) if ('default' in f) o[f.id] = f.default
	return { ...o, ...overrides }
}
const run = (m, actionId, overrides) => m.actionDefs[actionId].callback({ options: opts(m, actionId, overrides) }, {})
const fb = (m, id, options = {}) => {
	const def = m.feedbackDefs[id]
	const o = {}
	for (const f of def.options) if ('default' in f) o[f.id] = f.default
	return def.callback({ options: { ...o, ...options } }, {})
}

// ---------------------------------------------------------------- tests
const lamp = createFakeLamp()
const port = await lamp.listen()
const baseConfig = {
	host: '127.0.0.1',
	protocol: 'http',
	port,
	username: 'remote',
	pollInterval: 200,
	insecure: true,
	redActor: '',
	greenActor: '',
	blueActor: '',
	whiteActor: '',
	buzzerActor: '',
}
const m = new Module({ label: 'allnet' })

await step('exports: default class and UpgradeScripts array', () => {
	assert.equal(typeof Module, 'function')
	assert.ok(Array.isArray(UpgradeScripts))
})

await step('init connects, discovers actors and maps channels (skips the "Knopf" buttons)', async () => {
	await m.init(baseConfig, true, { password: 'secret' })
	await waitFor(() => m.status === 'ok' && m.discovered, 3000, 'ok status')
	assert.deepEqual(m.channelMap, { red: '11', green: '12', blue: '13', white: '14', buzzer: '25' })
	assert.equal(m.variables.device_type, 'ALL-PoE-RGBW-LAMP')
	assert.equal(m.variables.firmware, '3.35.1095')
	assert.equal(m.variables.temperature, 21.5)
	assert.equal(m.variables.channel_map, '11,12,13,14,25')
	assert.ok(
		lamp.requests.some((r) => r === '/xml/json.php?mode=all&simple'),
		'polls with &simple flag',
	)
})

await step('definitions follow API 2 rules (fields, presets, variables)', () => {
	validateDefinitions(m)
	const actorDropdown = m.actionDefs.set_actor.options.find((o) => o.id === 'actor')
	assert.equal(actorDropdown.choices.length, 9)
	assert.ok(actorDropdown.choices.some((c) => c.label === 'Knopf ROT (id 21)'))
	assert.ok('id_25' in m.varDefs)
})

await step('Set colour: yellow sets red 100 and green 45, feedbacks follow', async () => {
	await run(m, 'named_colour', { colour: 'yellow' })
	assert.equal(lamp.get('Rot').value, 100)
	assert.equal(lamp.get('Grün').value, 45)
	assert.equal(lamp.get('Blau').value, 0)
	assert.equal(lamp.get('Weiss').value, 0)
	assert.equal(m.variables.red, 100)
	assert.equal(m.variables.green, 45)
	assert.equal(fb(m, 'colour_is', { colour: 'yellow' }), true)
	assert.equal(fb(m, 'colour_is', { colour: 'red' }), false)
	const style = fb(m, 'lamp_colour')
	const g = Math.round((1.055 * 0.45 ** (1 / 2.4) - 0.055) * 255)
	assert.equal(style.bgcolor, (255 << 16) | (g << 8) | 0)
	assert.equal(m.variables.hex, '#ff' + g.toString(16).padStart(2, '0') + '00')
})

await step('RGBW with fade sends the fading parameter', async () => {
	lamp.requests.length = 0
	await run(m, 'rgbw', { red: 10, green: 20, blue: 30, white: 40, fade: 1.5 })
	const writes = lamp.requests.filter((r) => r.startsWith('/xml/jsonswitch.php'))
	assert.equal(writes.length, 4)
	assert.ok(writes.includes('/xml/jsonswitch.php?id=11&set=10&fading=1.5'), writes.join('\n'))
	assert.equal(lamp.get('Weiss').value, 40)
})

await step('Colour picker with brightness 50 %', async () => {
	await run(m, 'colour_picker', { colour: 0x00ff00, white: 0, brightness: 50 })
	assert.equal(lamp.get('Rot').value, 0)
	assert.equal(lamp.get('Grün').value, 50)
	await run(m, 'colour_picker', { colour: 'rgba(255, 0, 255, 1)', white: 20, brightness: 100 })
	assert.equal(lamp.get('Rot').value, 100)
	assert.equal(lamp.get('Blau').value, 100)
	assert.equal(lamp.get('Weiss').value, 20)
	// grey goes to the white LEDs; mid grey 0x808080 is about 21.6 % linear light
	await run(m, 'colour_picker', { colour: 0x808080, white: 0, brightness: 100 })
	assert.equal(lamp.get('Rot').value, 0)
	assert.equal(lamp.get('Weiss').value, 21.59)
	// without white extraction and gamma the old behaviour remains
	await run(m, 'colour_picker', { colour: 0x808080, useWhite: false, gamma: false })
	assert.equal(lamp.get('Rot').value, 50.2)
	assert.equal(lamp.get('Weiss').value, 0)
})

await step('Palette presets: 6 groups × 20, pressing one sets the lamp and lights its feedback', async () => {
	const section = m.presetStructure.find((sct) => sct.id === 'palette')
	assert.equal(section.definitions.length, 6)
	assert.ok(section.definitions.every((g) => g.presets.length === 20))
	const p = m.presets.palette_red_bright
	assert.equal(p.style.bgcolor, 0xdd524c)
	const press = p.steps[0].down[0]
	await m.actionDefs[press.actionId].callback({ options: press.options }, {})
	// independent check: sRGB -> linear, the smallest component goes to the white LEDs
	const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
	const [lr, lg, lb] = [0xdd, 0x52, 0x4c].map(lin)
	const lw = Math.min(lr, lg, lb)
	const r2 = (v) => Math.round(v * 10000) / 100
	assert.equal(lamp.get('Rot').value, r2(lr - lw))
	assert.equal(lamp.get('Grün').value, r2(lg - lw))
	assert.equal(lamp.get('Blau').value, 0)
	assert.equal(lamp.get('Weiss').value, r2(lw))
	const f = p.feedbacks[0]
	assert.equal(m.feedbackDefs[f.feedbackId].callback({ options: f.options }, {}), true)
	const other = m.presets.palette_blue_bright.feedbacks[0]
	assert.equal(m.feedbackDefs[other.feedbackId].callback({ options: other.options }, {}), false)
	// the lamp-colour feedback shows (almost) the swatch colour
	const bg = fb(m, 'lamp_colour').bgcolor
	const diff = [16, 8, 0].map((sh) => Math.abs(((bg >> sh) & 255) - ((0xdd524c >> sh) & 255)))
	assert.ok(Math.max(...diff) <= 1, `lamp colour ${bg.toString(16)} vs dd524c`)
})

await step('Adjust one channel clamps at 0 and 100', async () => {
	await run(m, 'channel', { channel: 'red', value: 50 })
	await run(m, 'adjust_channel', { channel: 'red', delta: -30 })
	assert.equal(lamp.get('Rot').value, 20)
	await run(m, 'adjust_channel', { channel: 'red', delta: -30 })
	assert.equal(lamp.get('Rot').value, 0)
	await run(m, 'adjust_channel', { channel: 'red', delta: 150 })
	assert.equal(lamp.get('Rot').value, 100)
	assert.equal(fb(m, 'channel_level', { channel: 'red', op: 'gte', value: 100 }), true)
})

await step('Buzzer toggle and feedback', async () => {
	await run(m, 'buzzer', { mode: 'toggle' })
	assert.equal(lamp.get('Buzzer').value, 1)
	assert.equal(fb(m, 'buzzer_on'), true)
	assert.equal(m.variables.buzzer, 1)
	await run(m, 'buzzer', { mode: 'off' })
	assert.equal(lamp.get('Buzzer').value, 0)
	assert.equal(fb(m, 'buzzer_on'), false)
})

await step('Set actor by name (lamp’s own button) and by id', async () => {
	lamp.requests.length = 0
	await run(m, 'set_actor', { actor: 'Knopf ROT', value: '1' })
	assert.ok(lamp.requests.includes('/xml/jsonswitch.php?id=Knopf%20ROT&set=1'), lamp.requests.join('\n'))
	assert.equal(lamp.get('Knopf ROT').value, 1)
	assert.equal(fb(m, 'actor_on', { actor: '21' }), true)
	await run(m, 'set_actor', { actor: '21', value: 'toggle' })
	assert.equal(lamp.get('Knopf ROT').value, 0)
	await assert.rejects(run(m, 'set_actor', { actor: '21', value: 'banana' }), /not a valid value/)
	await assert.rejects(run(m, 'set_actor', { actor: '999', value: '1' }), /Parameter error/)
	assert.equal(m.status, 'ok', 'a bad actor id must not change the connection status')
})

await step('Changes made on the lamp itself show up after polling', async () => {
	lamp.get('Blau').value = 77
	await waitFor(() => m.variables.blue === 77, 2000, 'blue=77')
})

await step('Blink 2 times then restore the previous colour', async () => {
	await run(m, 'rgbw', { red: 0, green: 0, blue: 100, white: 0 })
	lamp.requests.length = 0
	await run(m, 'blink', { colour: 'red', count: 2, interval: 250, end: 'restore' })
	assert.equal(fb(m, 'blinking'), true)
	assert.equal(m.variables.blinking, 1)
	await waitFor(() => !m.isBlinking(), 3000, 'blink finished')
	await sleep(100)
	assert.equal(lamp.get('Blau').value, 100, 'restored blue')
	assert.equal(lamp.get('Rot').value, 0)
	const redOn = lamp.requests.filter((r) => r.startsWith('/xml/jsonswitch.php?id=11&set=100')).length
	assert.equal(redOn, 2, 'two flashes')
	assert.equal(m.variables.blinking, 0)
})

await step('Blink until stopped is cancelled by another colour action', async () => {
	await run(m, 'blink', { colour: 'green', count: 0, interval: 250, end: 'restore' })
	await sleep(600)
	assert.equal(m.isBlinking(), true)
	await run(m, 'named_colour', { colour: 'white' })
	assert.equal(m.isBlinking(), false)
	await sleep(600)
	assert.equal(lamp.get('Weiss').value, 100)
	assert.equal(lamp.get('Grün').value, 0)
})

await step('Stop blinking with "turn off"', async () => {
	await run(m, 'blink', { colour: 'magenta', count: 0, interval: 250 })
	await sleep(300)
	await run(m, 'stop_blink', { end: 'off' })
	await sleep(400)
	assert.equal(m.isBlinking(), false)
	for (const n of ['Rot', 'Grün', 'Blau', 'Weiss']) assert.equal(lamp.get(n).value, 0, n)
})

await step('Wrong password gives authentication failure', async () => {
	await m.configUpdated({ ...baseConfig }, { password: 'wrong' })
	await waitFor(() => m.status === 'authentication_failure', 3000, 'auth failure')
	await m.configUpdated({ ...baseConfig }, { password: 'secret' })
	await waitFor(() => m.status === 'ok', 3000, 'ok again')
})

await step('Remote control switched off on the lamp gives a clear bad_config status', async () => {
	lamp.remoteEnabled = false
	await waitFor(() => m.status === 'bad_config', 3000, 'bad_config')
	assert.match(m.statuses.at(-1)[1], /Remote control functionality not activated/)
	await assert.rejects(run(m, 'named_colour', { colour: 'red' }), /Remote control/)
	lamp.remoteEnabled = true
	await waitFor(() => m.status === 'ok', 7000, 'recovers')
})

await step('Lamp unreachable gives connection_failure and recovers', async () => {
	const savedPort = port
	await m.configUpdated({ ...baseConfig, port: 1 }, { password: 'secret' })
	await waitFor(() => m.status === 'connection_failure', 4000, 'connection failure')
	await assert.rejects(run(m, 'off', {}), /Not connected to the lamp: Cannot reach/)
	await assert.rejects(run(m, 'buzzer', { mode: 'on' }), /Not connected/)
	await m.configUpdated({ ...baseConfig, port: savedPort }, { password: 'secret' })
	await waitFor(() => m.status === 'ok', 3000, 'ok')
})

await step('Missing host gives bad_config without crashing', async () => {
	await m.configUpdated({ ...baseConfig, host: '' }, { password: 'secret' })
	assert.equal(m.status, 'bad_config')
	await assert.rejects(run(m, 'off', {}), /not configured/)
})

await step('URL pasted as host, and manual channel mapping by name', async () => {
	await m.configUpdated(
		{
			...baseConfig,
			host: `http://127.0.0.1:${port}/`,
			port: 0,
			redActor: 'Knopf ROT',
			buzzerActor: '22',
		},
		{ password: 'secret' },
	)
	await waitFor(() => m.status === 'ok' && m.discovered, 3000, 'ok')
	assert.equal(m.channelMap.red, '21')
	assert.equal(m.channelMap.buzzer, '22')
	assert.equal(m.channelMap.green, '12')
})

await step('Polling off (0) still reads once at start-up', async () => {
	await m.configUpdated({ ...baseConfig, pollInterval: 0 }, { password: 'secret' })
	await waitFor(() => m.status === 'ok' && m.discovered, 3000, 'ok')
	const count = lamp.requests.length
	await sleep(700)
	assert.equal(lamp.requests.length, count, 'no further polling')
})

await m.destroy()
await step('destroy clears timers and blink', () => {
	assert.equal(m.pollTimer, null)
	assert.equal(m.blinkState, null)
	assert.equal(m.client, null)
})

await step('Actors with a 0–255 range are scaled from percent', async () => {
	const lamp255 = createFakeLamp({ colourMax: 255 })
	const p = await lamp255.listen()
	const m2 = new Module({ label: 'allnet' })
	await m2.init({ ...baseConfig, port: p, pollInterval: 0 }, true, { password: 'secret' })
	await waitFor(() => m2.status === 'ok' && m2.discovered, 3000, 'ok')
	await run(m2, 'named_colour', { colour: 'red', brightness: 50 })
	assert.equal(lamp255.get('Rot').value, 127.5)
	assert.equal(m2.variables.red, 50)
	await m2.destroy()
	await lamp255.close()
})

await step('No auth configured and lamp without access control', async () => {
	const open = createFakeLamp({ user: '' })
	const p = await open.listen()
	const m3 = new Module({ label: 'allnet' })
	await m3.init({ ...baseConfig, port: p, username: '', pollInterval: 0 }, true, undefined)
	await waitFor(() => m3.status === 'ok', 3000, 'ok')
	await m3.destroy()
	await open.close()
})

await step('External sensor: auto-detected, variables, feedback and press count', async () => {
	const ext = createFakeLamp({ contact: true })
	const p = await ext.listen()
	const m4 = new Module({ label: 'allnet' })
	await m4.init({ ...baseConfig, port: p, pollInterval: 100 }, true, { password: 'secret' })
	await waitFor(() => m4.status === 'ok' && m4.discovered, 3000, 'ok')
	validateDefinitions(m4)
	assert.equal(m4.externalSensorId, '101', 'picks the contact input, not the internal temperature sensor')
	assert.equal(m4.variables.external_sensor, 0)
	assert.equal(m4.variables.external_sensor_status, 'ok')
	assert.equal(m4.variables.external_sensor_name, 'Eingang 1 (id 101)')
	assert.equal(m4.feedbackDefs.external_sensor_active.callback({ options: {} }), false)
	// break the circuit: the input reads 1
	ext.get('101').value = 1
	await waitFor(() => m4.variables.external_sensor === 1, 2000, 'active')
	assert.equal(m4.variables.external_sensor_count, 1)
	assert.equal(m4.feedbackDefs.external_sensor_active.callback({ options: {} }), true)
	ext.get('101').value = 0
	await waitFor(() => m4.variables.external_sensor === 0, 2000, 'idle')
	ext.get('101').value = 1
	await waitFor(() => m4.variables.external_sensor_count === 2, 2000, 'second press')
	// sensor fault shows up as status text
	ext.get('101').error = 777002
	await waitFor(() => m4.variables.external_sensor_status === 'No answer from chip', 2000, 'error status')
	assert.equal(m4.variables.external_sensor, '')
	ext.get('101').error = 0
	await waitFor(() => m4.variables.external_sensor_status === 'ok', 2000, 'ok again')
	await m4.destroy()

	// invert for a normally-open button, sensor chosen by name
	ext.get('101').value = 1
	const m5 = new Module({ label: 'allnet' })
	await m5.init(
		{ ...baseConfig, port: p, pollInterval: 100, externalSensor: 'eingang 1', externalInvert: true },
		true,
		{ password: 'secret' },
	)
	await waitFor(() => m5.status === 'ok' && m5.discovered, 3000, 'ok')
	assert.equal(m5.variables.external_sensor, 0)
	ext.get('101').value = 0
	await waitFor(() => m5.variables.external_sensor === 1, 2000, 'inverted active')
	await m5.destroy()

	// configured sensor that does not exist
	const m6 = new Module({ label: 'allnet' })
	await m6.init({ ...baseConfig, port: p, pollInterval: 0, externalSensor: 'Nope' }, true, { password: 'secret' })
	await waitFor(() => m6.status === 'ok' && m6.discovered, 3000, 'ok')
	assert.equal(m6.variables.external_sensor_status, 'not found')
	assert.ok(m6.logs.some(([lvl, msg]) => lvl === 'warn' && /External sensor "Nope" not found/.test(msg)))
	await m6.destroy()
	await ext.close()
})

await step('External sensor: lamp without one gives empty values', () => {
	// m (the main instance) ran against a lamp without a contact input
	assert.equal(m.externalSensorId, null)
})

await lamp.close()
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`)
await sleep(300)
const handles = process
	._getActiveHandles()
	.filter((h) => h.constructor?.name !== 'WriteStream' && h.constructor?.name !== 'ReadStream')
if (handles.length)
	console.log(
		'Open handles after destroy:',
		handles.map((h) => h.constructor?.name),
	)
