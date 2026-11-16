import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdateVariableDefinitions, buildVariableValues } from './variables.js'
import { UpdatePresets } from './presets.js'
import { getConfigFields } from './config.js'
import { AllnetClient, normaliseHost } from './allnet.js'
import { CHANNEL_IDS, clampPercent, detectChannelActors } from './channels.js'
import { ExternalSensorState, detectExternalSensor } from './external.js'

export { UpgradeScripts }

/** Feedbacks that depend on the lamp state and must be rechecked when it changes. */
const STATE_FEEDBACKS = [
	'lamp_colour',
	'colour_is',
	'colour_matches',
	'channel_level',
	'actor_on',
	'buzzer_on',
	'external_sensor_active',
]

const ZERO = { red: 0, green: 0, blue: 0, white: 0 }

function parseNumber(value) {
	if (value === undefined || value === null || value === '') return null
	const n = Number(String(value).replace(',', '.'))
	return Number.isFinite(n) ? n : null
}

function parseRange(display) {
	const min = parseNumber(display?.min)
	const max = parseNumber(display?.max)
	// Only trust a real slider range; on/off actors and missing data fall back to 0–100.
	if (min === null || max === null || max - min < 10) return null
	return { min, max }
}

export default class AllnetInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.config = {}
		this.secrets = {}
		this.client = null
		this.generation = 0
		this.pollTimer = null
		this.polling = false
		this.statusKey = null
		this.statusMessage = ''
		this.resetState()
	}

	resetState() {
		/** @type {Map<string, {id: string, name: string, type: string, unit: string, value: number|null, raw: any, error: number, range: {min: number, max: number}|null}>} */
		this.items = new Map()
		this.actorIds = []
		this.channelMap = { red: null, green: null, blue: null, white: null, buzzer: null }
		this.externalSensorId = null
		this.external = new ExternalSensorState()
		this.discovered = false
		this.lastPollOk = false
		this.deviceInfo = {}
		this.writeStamps = new Map()
		this.blinkState = null
		this.definitionSignature = ''
	}

	// ---------------------------------------------------------------- lifecycle

	async init(config, _isFirstInit, secrets) {
		this.config = config ?? {}
		this.secrets = secrets ?? {}
		this.updateDefinitions()
		this.start()
	}

	async configUpdated(config, secrets) {
		this.stop()
		this.config = config ?? {}
		if (secrets !== undefined) this.secrets = secrets ?? {}
		this.resetState()
		this.updateDefinitions()
		this.start()
	}

	async destroy() {
		this.stop()
	}

	getConfigFields() {
		return getConfigFields()
	}

	start() {
		const parsed = normaliseHost(this.config.host)
		if (!parsed.host) {
			this.setStatus(InstanceStatus.BadConfig, 'Enter the IP address of the lamp')
			return
		}
		const protocol = parsed.protocol ?? (this.config.protocol === 'https' ? 'https' : 'http')
		const port = Number(this.config.port) > 0 ? Number(this.config.port) : parsed.port
		this.client = new AllnetClient({
			host: parsed.host,
			port,
			protocol,
			insecure: this.config.insecure !== false,
			username: String(this.config.username ?? ''),
			password: String(this.secrets?.password ?? this.config.password ?? ''),
		})
		this.generation++
		this.setStatus(InstanceStatus.Connecting)
		void this.poll(this.generation)
	}

	stop() {
		this.generation++
		if (this.pollTimer) clearTimeout(this.pollTimer)
		this.pollTimer = null
		// Drop any blink without pushing variables or feedbacks: the instance may be going away.
		if (this.blinkState?.timer) clearTimeout(this.blinkState.timer)
		this.blinkState = null
		this.client?.destroy()
		this.client = null
		this.polling = false
	}

	// ---------------------------------------------------------------- definitions

	updateDefinitions() {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdateVariableDefinitions(this)
		UpdatePresets(this)
		this.definitionSignature = this.itemSignature()
		this.pushVariables()
	}

	itemSignature() {
		return [...this.items.values()].map((i) => `${i.id}:${i.type}:${i.name}:${i.unit}`).join('|')
	}

	// ---------------------------------------------------------------- polling

	async poll(gen) {
		if (gen !== this.generation || !this.client || this.polling) return
		this.polling = true
		const started = Date.now()
		try {
			if (!this.discovered) await this.discover(gen)
			if (gen !== this.generation) return
			const list = await this.client.readAll(true)
			if (gen !== this.generation) return
			this.applyItems(list, started)
			this.lastPollOk = true
			this.setStatus(InstanceStatus.Ok)
		} catch (err) {
			if (gen === this.generation) this.handleError(err)
		} finally {
			if (gen === this.generation) {
				this.polling = false
				this.scheduleNext(gen)
			}
		}
	}

	scheduleNext(gen) {
		const interval = Number(this.config.pollInterval) || 0
		let delay = interval > 0 ? Math.max(200, interval) : null
		// Keep retrying while the lamp cannot be reached, but not faster than every 5 s.
		if (!this.lastPollOk) delay = Math.max(delay ?? 0, 5000)
		if (delay === null) return
		this.pollTimer = setTimeout(() => {
			this.pollTimer = null
			void this.poll(gen)
		}, delay)
	}

	/** Read the full sensor/actor list once, find the colour channels and refresh the definitions. */
	async discover(gen) {
		const full = await this.client.readAll(false)
		let info = {}
		try {
			info = (await this.client.info()) ?? {}
		} catch (err) {
			this.log('debug', `Device info not available: ${err.message}`)
		}
		if (gen !== this.generation) return

		this.deviceInfo = info && typeof info === 'object' && !Array.isArray(info) ? info : {}
		this.items = new Map()
		this.actorIds = []
		for (const raw of full) this.upsertItem(raw, true)

		this.channelMap = detectChannelActors(this.actors(), {
			red: this.config.redActor,
			green: this.config.greenActor,
			blue: this.config.blueActor,
			white: this.config.whiteActor,
			buzzer: this.config.buzzerActor,
		})
		this.externalSensorId = detectExternalSensor(this.sensors(), this.config.externalSensor)
		this.discovered = true
		this.logMapping()
		this.updateExternalSensor()

		if (this.itemSignature() !== this.definitionSignature) this.updateDefinitions()
		else this.pushVariables()
	}

	upsertItem(raw, full) {
		if (!raw || typeof raw !== 'object') return
		const id = String(raw.id ?? '')
		if (!id) return
		const existing = this.items.get(id)
		const item = existing ?? { id, range: null }
		item.name = String(raw.name ?? existing?.name ?? id)
		item.type = String(raw.type ?? raw.info?.type ?? existing?.type ?? '')
		item.unit = String(raw.unit ?? raw.info?.unit ?? existing?.unit ?? '')
		item.error = Number(raw.error) || 0
		item.raw = raw.value
		item.value = item.error ? null : parseNumber(raw.value)
		if (full) item.range = parseRange(raw.config?.display)
		this.items.set(id, item)
		if (!existing && item.type === '2') this.actorIds.push(id)
	}

	applyItems(list, started) {
		let changed = false
		for (const raw of list) {
			const id = String(raw?.id ?? '')
			if (!id) continue
			const item = this.items.get(id)
			if (!item || (raw.name !== undefined && String(raw.name) !== item.name)) {
				// Something was added or renamed on the device: read the full list again next time.
				this.discovered = false
				this.upsertItem(raw, false)
				changed = true
				continue
			}
			const stamp = this.writeStamps.get(id)
			if (stamp && stamp >= started) continue // keep the value we just wrote
			const before = `${item.value}|${item.error}`
			this.upsertItem(raw, false)
			if (`${item.value}|${item.error}` !== before) changed = true
		}
		const externalChanged = this.updateExternalSensor()
		if (changed || externalChanged) {
			this.pushVariables()
			this.checkStateFeedbacks()
		}
	}

	/** Read the external switch from the current items. Returns true when its state changed. */
	updateExternalSensor() {
		const item = this.externalSensorId ? this.items.get(this.externalSensorId) : undefined
		const raw = item && !item.error ? item.value : null
		const before = this.external.active
		const changed = this.external.update(raw, this.config.externalInvert === true)
		if (changed && before !== this.external.active && this.external.active !== null) {
			this.log('debug', `External sensor ${this.external.active ? 'active' : 'idle'} (raw ${raw})`)
		}
		return changed
	}

	// ---------------------------------------------------------------- state helpers

	actors() {
		return this.actorIds.map((id) => this.items.get(id)).filter(Boolean)
	}

	sensors() {
		return [...this.items.values()].filter((i) => i.type === '1')
	}

	actorChoices() {
		return this.actors().map((a) => ({ id: a.id, label: `${a.name} (id ${a.id})` }))
	}

	resolveItem(idOrName) {
		if (idOrName === undefined || idOrName === null || idOrName === '') return undefined
		const key = String(idOrName)
		return this.items.get(key) ?? [...this.items.values()].find((i) => i.name.toLowerCase() === key.toLowerCase())
	}

	channelPercent(channel) {
		const item = this.resolveItem(this.channelMap[channel])
		if (!item || item.value === null || item.value === undefined) return null
		const { min, max } = item.range ?? { min: 0, max: 100 }
		return Math.round(clampPercent(((item.value - min) / (max - min)) * 100) * 100) / 100
	}

	currentMix() {
		return {
			red: this.channelPercent('red'),
			green: this.channelPercent('green'),
			blue: this.channelPercent('blue'),
			white: this.channelPercent('white'),
		}
	}

	toDeviceValue(actor, percent) {
		const item = this.resolveItem(actor)
		const { min, max } = item?.range ?? { min: 0, max: 100 }
		return Math.round((min + (clampPercent(percent) / 100) * (max - min)) * 100) / 100
	}

	recordWrite(actor, value) {
		const item = this.resolveItem(actor)
		if (!item || value === 'toggle') return
		item.value = Number(value)
		item.error = 0
		this.writeStamps.set(item.id, Date.now())
	}

	pushVariables() {
		this.setVariableValues(buildVariableValues(this))
	}

	checkStateFeedbacks() {
		this.checkFeedbacks(...STATE_FEEDBACKS)
	}

	logMapping() {
		const parts = ['red', 'green', 'blue', 'white', 'buzzer'].map((k) => `${k}=${this.channelMap[k] ?? '–'}`)
		this.log('info', `Found ${this.actorIds.length} actors. Channel mapping: ${parts.join(', ')}`)
		const ext = this.externalSensorId ? this.items.get(this.externalSensorId) : undefined
		if (ext) this.log('info', `External sensor: ${ext.name} (id ${ext.id})`)
		else if (String(this.config.externalSensor ?? '').trim())
			this.log('warn', `External sensor "${this.config.externalSensor}" not found on the lamp`)
		const missing = CHANNEL_IDS.filter((k) => !this.channelMap[k])
		if (missing.length) {
			this.log('warn', `No actor found for: ${missing.join(', ')}. Set the channel mapping in the connection settings.`)
		}
	}

	setStatus(status, message) {
		const key = `${status}|${message ?? ''}`
		if (key === this.statusKey) return
		this.statusKey = key
		this.statusMessage = message ?? ''
		this.updateStatus(status, message ?? null)
		if (status !== InstanceStatus.Ok && status !== InstanceStatus.Connecting && message) {
			this.log('warn', message)
		}
	}

	handleError(err) {
		const message = err?.message ?? String(err)
		switch (err?.kind) {
			case 'auth':
				this.lastPollOk = false
				this.setStatus(InstanceStatus.AuthenticationFailure, message)
				break
			case 'remote_disabled':
				this.lastPollOk = false
				this.setStatus(InstanceStatus.BadConfig, `${message}: switch on remote control on the lamp`)
				break
			case 'network':
				this.lastPollOk = false
				this.discovered = false
				this.setStatus(InstanceStatus.ConnectionFailure, message)
				break
			default:
				this.lastPollOk = false
				this.setStatus(InstanceStatus.UnknownWarning, message)
		}
	}

	requireClient() {
		if (!this.client) throw new Error('The connection is not configured yet')
		return this.client
	}

	/** Run a batch of writes, update state and surface connection problems. */
	async runWrites(jobs, gen = this.generation) {
		const results = await Promise.allSettled(jobs)
		// The connection was restarted or destroyed while the writes were in flight: report nothing.
		if (gen !== this.generation) {
			const failed = results.find((r) => r.status === 'rejected')
			if (failed) throw failed.reason
			return
		}
		this.pushVariables()
		this.checkStateFeedbacks()
		const failed = results.find((r) => r.status === 'rejected')
		if (failed) {
			const kind = failed.reason?.kind
			if (kind === 'auth' || kind === 'remote_disabled' || kind === 'network') this.handleError(failed.reason)
			throw failed.reason
		}
	}

	// ---------------------------------------------------------------- commands

	/**
	 * Set one or more colour channels (percent). Channels that are undefined are left alone.
	 * @param {{red?: number, green?: number, blue?: number, white?: number}} target
	 * @param {number} [fade] seconds
	 */
	async setChannels(target, fade = 0, { fromBlink = false } = {}) {
		if (!fromBlink) this.cancelBlink()
		const client = this.requireClient()
		const gen = this.generation
		const jobs = []
		for (const channel of CHANNEL_IDS) {
			if (target[channel] === undefined || target[channel] === null) continue
			const actor = this.channelMap[channel]
			if (!actor && !this.discovered) {
				throw new Error(`Not connected to the lamp${this.statusMessage ? `: ${this.statusMessage}` : ''}`)
			}
			if (!actor) {
				throw new Error(
					`No actor found for the ${channel} channel. Set it under "Channel mapping" in the connection settings.`,
				)
			}
			const value = this.toDeviceValue(actor, target[channel])
			jobs.push(
				client.setActor(actor, value, fade).then(() => gen === this.generation && this.recordWrite(actor, value)),
			)
		}
		await this.runWrites(jobs, gen)
	}

	async adjustChannel(channel, delta, fade = 0) {
		const current = this.channelPercent(channel) ?? 0
		await this.setChannels({ [channel]: clampPercent(current + Number(delta || 0)) }, fade)
	}

	/** Send a raw value (0, 1, 'toggle' or a number) to any actor. */
	async setActorValue(actor, value, fade = 0) {
		const client = this.requireClient()
		let sendValue = value
		if (typeof value === 'string') {
			const trimmed = value.trim()
			if (trimmed.toLowerCase() === 'toggle') sendValue = 'toggle'
			else if (parseNumber(trimmed) !== null) sendValue = parseNumber(trimmed)
			else throw new Error(`"${value}" is not a valid value. Use 0, 1, toggle or a number.`)
		}
		const item = this.resolveItem(actor)
		const optimistic = sendValue === 'toggle' ? (item?.value ? 0 : 1) : sendValue
		const gen = this.generation
		await this.runWrites(
			[
				client
					.setActor(actor, sendValue, fade)
					.then(() => gen === this.generation && this.recordWrite(actor, optimistic)),
			],
			gen,
		)
	}

	async setBuzzer(mode) {
		const actor = this.channelMap.buzzer
		if (!actor && !this.discovered) {
			throw new Error(`Not connected to the lamp${this.statusMessage ? `: ${this.statusMessage}` : ''}`)
		}
		if (!actor) {
			throw new Error('No buzzer actor found. Set it under "Channel mapping" in the connection settings.')
		}
		const value = mode === 'on' ? 1 : mode === 'off' ? 0 : 'toggle'
		await this.setActorValue(actor, value)
	}

	isBlinking() {
		return this.blinkState !== null
	}

	/**
	 * Blink between a colour and off.
	 * @param {{target: object, interval: number, count: number, end: 'off'|'restore'|'colour'}} options
	 */
	startBlink({ target, interval, count, end }) {
		this.requireClient()
		this.cancelBlink()
		const previous = this.currentMix()
		const state = {
			timer: null,
			on: false,
			flashes: 0,
			target,
			interval: Math.max(250, Number(interval) || 500),
			count: Math.max(0, Math.floor(Number(count) || 0)),
			end,
			previous,
		}
		this.blinkState = state
		this.pushVariables()
		this.checkFeedbacks('blinking')

		const step = async () => {
			if (this.blinkState !== state) return
			const turningOn = !state.on
			if (turningOn && state.count > 0 && state.flashes >= state.count) {
				await this.finishBlink(state, state.end)
				return
			}
			try {
				await this.setChannels(turningOn ? state.target : ZERO, 0, { fromBlink: true })
			} catch (err) {
				// Stopped meanwhile (config change, destroy, another colour command): nothing to report.
				if (this.blinkState !== state) return
				this.log('warn', `Blinking stopped: ${err.message}`)
				this.clearBlink(state)
				return
			}
			if (this.blinkState !== state) return
			state.on = turningOn
			if (turningOn) state.flashes++
			state.timer = setTimeout(() => void step(), state.interval)
		}
		void step()
	}

	clearBlink(state) {
		if (state.timer) clearTimeout(state.timer)
		state.timer = null
		if (this.blinkState === state) {
			this.blinkState = null
			this.pushVariables()
			this.checkFeedbacks('blinking')
		}
	}

	/** Stop blinking without touching the lamp (used when another colour command takes over). */
	cancelBlink() {
		if (this.blinkState) this.clearBlink(this.blinkState)
	}

	async finishBlink(state, end) {
		this.clearBlink(state)
		let target = null
		if (end === 'off') target = ZERO
		else if (end === 'colour') target = state.target
		else if (end === 'restore') {
			const prev = state.previous
			target = CHANNEL_IDS.some((c) => prev[c] === null) ? ZERO : prev
		}
		if (!target) return
		try {
			await this.setChannels(target, 0, { fromBlink: true })
		} catch (err) {
			this.log('warn', `Could not set the colour after blinking: ${err.message}`)
		}
	}

	async stopBlink(end = 'restore') {
		const state = this.blinkState
		if (!state) return
		await this.finishBlink(state, end)
	}
}
