import { CHANNELS, mixToRgb, rgbToHex } from './channels.js'
import { externalStatusText } from './external.js'

/** Variable ids must be simple: letters, digits, underscore and dash. */
export function itemVariableId(id) {
	return `id_${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export function UpdateVariableDefinitions(self) {
	const defs = {
		red: { name: 'Red level (%)' },
		green: { name: 'Green level (%)' },
		blue: { name: 'Blue level (%)' },
		white: { name: 'White level (%)' },
		hex: { name: 'Approximate lamp colour (#rrggbb)' },
		buzzer: { name: 'Buzzer on (1) or off (0)' },
		blinking: { name: 'Blinking (1) or not (0)' },
		temperature: { name: 'Internal temperature' },
		channel_map: { name: 'Actor ids used for red, green, blue, white, buzzer' },
		external_sensor: { name: 'External sensor: 1 = active, 0 = idle' },
		external_sensor_count: { name: 'External sensor: number of activations since the connection started' },
		external_sensor_raw: { name: 'External sensor: raw value from the lamp' },
		external_sensor_status: { name: 'External sensor: status (ok, not found or the error from the lamp)' },
		external_sensor_name: { name: 'External sensor: name and id on the lamp' },
		device_type: { name: 'Device type' },
		device_name: { name: 'Device name' },
		firmware: { name: 'Firmware version' },
	}
	for (const item of self.items.values()) {
		const kind = item.type === '2' ? 'Actor' : item.type === '1' ? 'Sensor' : 'Item'
		const unit = item.unit ? ` (${item.unit})` : ''
		defs[itemVariableId(item.id)] = { name: `${kind} ${item.id}: ${item.name}${unit}` }
	}
	self.setVariableDefinitions(defs)
}

function round(value, decimals = 1) {
	if (value === null || value === undefined) return ''
	const f = 10 ** decimals
	return Math.round(value * f) / f
}

export function buildVariableValues(self) {
	const mix = self.currentMix()
	const known = CHANNELS.every((c) => mix[c.id] !== null)
	const buzzerItem = self.resolveItem(self.channelMap.buzzer)
	const temperature = self.sensors().find((s) => /°?c$/i.test(s.unit.trim()) || /intern|temp/i.test(s.name))
	const info = self.deviceInfo ?? {}
	const externalItem = self.externalSensorId ? self.items.get(self.externalSensorId) : undefined

	const values = {
		red: round(mix.red),
		green: round(mix.green),
		blue: round(mix.blue),
		white: round(mix.white),
		hex: known ? rgbToHex(mixToRgb(mix)) : '',
		buzzer: buzzerItem && buzzerItem.value !== null ? (buzzerItem.value > 0 ? 1 : 0) : '',
		blinking: self.isBlinking() ? 1 : 0,
		temperature: temperature ? round(temperature.value, 2) : '',
		channel_map: ['red', 'green', 'blue', 'white', 'buzzer'].map((k) => self.channelMap[k] ?? '-').join(','),
		external_sensor: self.external.active === null ? '' : self.external.active ? 1 : 0,
		external_sensor_count: self.external.count,
		external_sensor_raw: self.external.raw ?? '',
		external_sensor_status: externalStatusText(externalItem, String(self.config.externalSensor ?? '').trim() !== ''),
		external_sensor_name: externalItem ? `${externalItem.name} (id ${externalItem.id})` : '',
		device_type: String(info.devicetype ?? ''),
		device_name: String(info.devicename ?? ''),
		firmware: [info.softversion, info.patchlevel].filter(Boolean).join('.'),
	}
	for (const item of self.items.values()) {
		values[itemVariableId(item.id)] = item.value === null ? (item.error ? `error ${item.error}` : '') : item.value
	}
	return values
}
