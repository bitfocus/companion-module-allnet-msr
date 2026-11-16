// Test double for @companion-module/base (API 2.x shapes). Records calls and enforces v2 rules.
export const InstanceStatus = {
	Ok: 'ok',
	Connecting: 'connecting',
	Disconnected: 'disconnected',
	ConnectionFailure: 'connection_failure',
	BadConfig: 'bad_config',
	UnknownError: 'unknown_error',
	UnknownWarning: 'unknown_warning',
	AuthenticationFailure: 'authentication_failure',
	InsufficientPermissions: 'insufficient_permissions',
}

export class InstanceBase {
	constructor(internal) {
		this.label = internal?.label ?? 'allnet'
		this.variables = {}
		this.statuses = []
		this.logs = []
		this.undefinedVariableWrites = new Set()
		this.feedbackCheckCount = 0
		this.definitionCalls = { actions: 0, feedbacks: 0, variables: 0, presets: 0 }
	}
	log(level, message) {
		this.logs.push([level, message])
		if (process.env.VERBOSE) console.log(`  [${level}] ${message}`)
	}
	updateStatus(status, message) {
		if (!Object.values(InstanceStatus).includes(status)) throw new Error(`bad status ${status}`)
		this.statuses.push([status, message])
	}
	get status() {
		return this.statuses.at(-1)?.[0]
	}
	setActionDefinitions(defs) {
		if (Array.isArray(defs) || typeof defs !== 'object') throw new Error('actions must be an object')
		this.actionDefs = defs
		this.definitionCalls.actions++
	}
	setFeedbackDefinitions(defs) {
		if (Array.isArray(defs) || typeof defs !== 'object') throw new Error('feedbacks must be an object')
		this.feedbackDefs = defs
		this.definitionCalls.feedbacks++
	}
	setVariableDefinitions(defs) {
		if (Array.isArray(defs)) throw new Error('API 2.0: setVariableDefinitions takes an object, not an array')
		this.varDefs = defs
		this.definitionCalls.variables++
	}
	setVariableValues(values) {
		for (const [k, v] of Object.entries(values)) {
			if (!this.varDefs || !(k in this.varDefs)) this.undefinedVariableWrites.add(k)
			if (v !== undefined && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
				throw new Error(`variable ${k} has non-primitive value`)
			this.variables[k] = v
		}
	}
	setPresetDefinitions(structure, presets) {
		if (!Array.isArray(structure)) throw new Error('API 2.0: setPresetDefinitions(structure, presets)')
		if (typeof presets !== 'object' || Array.isArray(presets)) throw new Error('presets must be an object')
		this.presetStructure = structure
		this.presets = presets
		this.definitionCalls.presets++
	}
	checkFeedbacks(...ids) {
		if (ids.length === 0) throw new Error('API 2.0: checkFeedbacks() without arguments throws')
		for (const id of ids) if (!this.feedbackDefs?.[id]) throw new Error(`checkFeedbacks unknown id ${id}`)
		this.feedbackCheckCount++
	}
	checkAllFeedbacks() {
		this.feedbackCheckCount++
	}
}

export function combineRgb(r, g, b) {
	return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}
