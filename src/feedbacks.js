import {
	CHANNELS,
	NAMED_COLOURS,
	NAMED_COLOUR_CHOICES,
	colourToLampTarget,
	mixMatches,
	mixToRgb,
	namedColourTarget,
	rgbToNumber,
	textColourFor,
} from './channels.js'

const CHANNEL_CHOICES = CHANNELS.map((c) => ({ id: c.id, label: c.label }))

export function UpdateFeedbacks(self) {
	const actorChoices = self.actorChoices()

	self.setFeedbackDefinitions({
		lamp_colour: {
			type: 'advanced',
			name: 'Button shows the lamp colour',
			description: 'Colours the button background like the lamp',
			options: [
				{
					type: 'checkbox',
					id: 'textColour',
					label: 'Switch text between black and white for readability',
					default: true,
				},
			],
			affectedProperties: ['bgcolor', 'color'],
			callback: (event) => {
				const mix = self.currentMix()
				if (CHANNELS.some((c) => mix[c.id] === null)) return {}
				const bgcolor = rgbToNumber(mixToRgb(mix))
				return event.options.textColour ? { bgcolor, color: textColourFor(bgcolor) } : { bgcolor }
			},
		},

		colour_is: {
			type: 'boolean',
			name: 'Lamp shows a named colour',
			defaultStyle: { bgcolor: 0xff0000, color: 0xffffff },
			options: [
				{
					type: 'dropdown',
					id: 'colour',
					label: 'Colour',
					choices: NAMED_COLOUR_CHOICES,
					default: 'red',
				},
				{
					type: 'number',
					id: 'brightness',
					label: 'Brightness (%)',
					default: 100,
					min: 0,
					max: 100,
					clampValues: true,
				},
				{
					type: 'number',
					id: 'tolerance',
					label: 'Tolerance (percentage points)',
					default: 3,
					min: 0,
					max: 50,
					clampValues: true,
				},
			],
			callback: (feedback) => {
				const o = feedback.options
				if (!NAMED_COLOURS[o.colour]) return false
				return mixMatches(self.currentMix(), namedColourTarget(o.colour, o.brightness), Number(o.tolerance))
			},
		},

		colour_matches: {
			type: 'boolean',
			name: 'Lamp shows colour (colour picker)',
			description: 'True when the lamp shows the colour set by "Set colour (colour picker)"',
			defaultStyle: { text: '●', color: 0xffffff },
			options: [
				{ type: 'colorpicker', id: 'colour', label: 'Colour', default: 0xff0000, returnType: 'number' },
				{
					type: 'number',
					id: 'brightness',
					label: 'Brightness (%)',
					default: 100,
					min: 0,
					max: 100,
					clampValues: true,
				},
				{
					type: 'checkbox',
					id: 'useWhite',
					label: 'Use the white LEDs for the grey part of the colour',
					default: true,
				},
				{ type: 'checkbox', id: 'gamma', label: 'Match screen colours (gamma correction)', default: true },
				{
					type: 'number',
					id: 'tolerance',
					label: 'Tolerance (percentage points)',
					default: 1,
					min: 0,
					max: 50,
					step: 0.1,
					clampValues: true,
				},
			],
			callback: (feedback) => {
				const o = feedback.options
				const target = colourToLampTarget(o.colour, {
					gamma: o.gamma !== false,
					useWhite: o.useWhite !== false,
					brightness: o.brightness,
				})
				return mixMatches(self.currentMix(), target, Number(o.tolerance))
			},
		},

		channel_level: {
			type: 'boolean',
			name: 'Channel level',
			description: 'Compare one colour channel with a value',
			defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 },
			options: [
				{ type: 'dropdown', id: 'channel', label: 'Channel', choices: CHANNEL_CHOICES, default: 'red' },
				{
					type: 'dropdown',
					id: 'op',
					label: 'Is',
					choices: [
						{ id: 'gt', label: 'Above' },
						{ id: 'gte', label: 'At or above' },
						{ id: 'eq', label: 'Equal to' },
						{ id: 'lte', label: 'At or below' },
						{ id: 'lt', label: 'Below' },
					],
					default: 'gt',
				},
				{ type: 'number', id: 'value', label: 'Level (%)', default: 0, min: 0, max: 100, clampValues: true },
			],
			callback: (feedback) => {
				const o = feedback.options
				const level = self.channelPercent(o.channel)
				if (level === null) return false
				const value = Number(o.value)
				switch (o.op) {
					case 'gt':
						return level > value
					case 'gte':
						return level >= value
					case 'eq':
						return Math.abs(level - value) < 0.5
					case 'lte':
						return level <= value
					case 'lt':
						return level < value
					default:
						return false
				}
			},
		},

		actor_on: {
			type: 'boolean',
			name: 'Actor is on',
			description: 'True when the actor value is above 0',
			defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 },
			options: [
				{
					type: 'dropdown',
					id: 'actor',
					label: 'Actor (pick one, or type an id or name)',
					choices: actorChoices,
					default: actorChoices[0]?.id ?? '',
					allowCustom: true,
				},
			],
			callback: (feedback) => {
				const item = self.resolveItem(feedback.options.actor)
				return !!item && item.value !== null && item.value > 0
			},
		},

		buzzer_on: {
			type: 'boolean',
			name: 'Buzzer is on',
			defaultStyle: { bgcolor: 0xff0000, color: 0xffffff },
			options: [],
			callback: () => {
				const item = self.resolveItem(self.channelMap.buzzer)
				return !!item && item.value !== null && item.value > 0
			},
		},

		external_sensor_active: {
			type: 'boolean',
			name: 'External sensor is active',
			description: 'True while the switch on the sensor port is active',
			defaultStyle: { bgcolor: 0xff0000, color: 0xffffff },
			options: [],
			callback: () => self.external.active === true,
		},

		blinking: {
			type: 'boolean',
			name: 'Lamp is blinking',
			defaultStyle: { bgcolor: 0xff7a00, color: 0x000000 },
			options: [],
			callback: () => self.isBlinking(),
		},
	})
}
