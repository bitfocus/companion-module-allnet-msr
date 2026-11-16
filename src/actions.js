import { CHANNELS, NAMED_COLOUR_CHOICES, clampPercent, colourToLampTarget, namedColourTarget } from './channels.js'

const CHANNEL_CHOICES = CHANNELS.map((c) => ({ id: c.id, label: c.label }))

function percentField(id, label, def) {
	return { type: 'number', id, label, default: def, min: 0, max: 100, step: 1, range: true, clampValues: true }
}

const fadeField = {
	type: 'number',
	id: 'fade',
	label: 'Fade time in seconds (0 = instant)',
	default: 0,
	min: 0,
	max: 60,
	step: 0.1,
	clampValues: true,
}

function fadeOf(options) {
	const n = Number(options.fade)
	return Number.isFinite(n) && n > 0 ? n : 0
}

export function UpdateActions(self) {
	const actorChoices = self.actorChoices()

	self.setActionDefinitions({
		named_colour: {
			name: 'Set colour',
			description: 'Set the lamp to a named colour',
			options: [
				{
					type: 'dropdown',
					id: 'colour',
					label: 'Colour',
					choices: NAMED_COLOUR_CHOICES,
					default: 'red',
				},
				percentField('brightness', 'Brightness (%)', 100),
				fadeField,
			],
			callback: async (event) => {
				await self.setChannels(namedColourTarget(event.options.colour, event.options.brightness), fadeOf(event.options))
			},
		},

		rgbw: {
			name: 'Set colour (RGBW %)',
			description: 'Set all four channels to exact levels',
			options: [
				percentField('red', 'Red (%)', 100),
				percentField('green', 'Green (%)', 0),
				percentField('blue', 'Blue (%)', 0),
				percentField('white', 'White (%)', 0),
				fadeField,
			],
			callback: async (event) => {
				const o = event.options
				await self.setChannels(
					{
						red: clampPercent(o.red),
						green: clampPercent(o.green),
						blue: clampPercent(o.blue),
						white: clampPercent(o.white),
					},
					fadeOf(o),
				)
			},
		},

		colour_picker: {
			name: 'Set colour (colour picker)',
			description: 'Pick any colour, for example from the palette',
			options: [
				{ type: 'colorpicker', id: 'colour', label: 'Colour', default: 0xff0000, returnType: 'number' },
				percentField('white', 'Extra white (%)', 0),
				percentField('brightness', 'Brightness (%)', 100),
				{
					type: 'checkbox',
					id: 'useWhite',
					label: 'Use the white LEDs for the grey part of the colour',
					default: true,
				},
				{
					type: 'checkbox',
					id: 'gamma',
					label: 'Match screen colours (gamma correction)',
					default: true,
				},
				fadeField,
			],
			callback: async (event) => {
				const o = event.options
				await self.setChannels(
					colourToLampTarget(o.colour, {
						gamma: o.gamma !== false,
						useWhite: o.useWhite !== false,
						brightness: o.brightness,
						white: o.white,
					}),
					fadeOf(o),
				)
			},
		},

		channel: {
			name: 'Set one channel',
			description: 'Set one colour channel and leave the others as they are',
			options: [
				{ type: 'dropdown', id: 'channel', label: 'Channel', choices: CHANNEL_CHOICES, default: 'red' },
				percentField('value', 'Level (%)', 100),
				fadeField,
			],
			callback: async (event) => {
				const o = event.options
				await self.setChannels({ [o.channel]: clampPercent(o.value) }, fadeOf(o))
			},
		},

		adjust_channel: {
			name: 'Adjust one channel',
			description: 'Raise or lower one channel, e.g. from a rotary encoder',
			options: [
				{ type: 'dropdown', id: 'channel', label: 'Channel', choices: CHANNEL_CHOICES, default: 'red' },
				{
					type: 'number',
					id: 'delta',
					label: 'Change (percentage points, negative to lower)',
					default: 10,
					min: -100,
					max: 100,
					step: 1,
					clampValues: true,
				},
				fadeField,
			],
			callback: async (event) => {
				const o = event.options
				await self.adjustChannel(o.channel, Number(o.delta), fadeOf(o))
			},
		},

		off: {
			name: 'Turn lamp off',
			options: [fadeField],
			callback: async (event) => {
				await self.setChannels({ red: 0, green: 0, blue: 0, white: 0 }, fadeOf(event.options))
			},
		},

		buzzer: {
			name: 'Buzzer',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Buzzer',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
					default: 'toggle',
				},
			],
			callback: async (event) => {
				await self.setBuzzer(event.options.mode)
			},
		},

		blink: {
			name: 'Blink',
			description: 'Blink a colour on and off. Any other colour action stops it.',
			options: [
				{
					type: 'dropdown',
					id: 'colour',
					label: 'Colour',
					choices: NAMED_COLOUR_CHOICES.filter((c) => c.id !== 'off'),
					default: 'red',
				},
				percentField('brightness', 'Brightness (%)', 100),
				{
					type: 'number',
					id: 'interval',
					label: 'Time on and off (ms)',
					default: 500,
					min: 250,
					max: 5000,
					step: 50,
					clampValues: true,
				},
				{
					type: 'number',
					id: 'count',
					label: 'Number of flashes (0 = until stopped)',
					default: 0,
					min: 0,
					max: 1000,
					asInteger: true,
					clampValues: true,
				},
				{
					type: 'dropdown',
					id: 'end',
					label: 'When finished',
					choices: [
						{ id: 'restore', label: 'Go back to the previous colour' },
						{ id: 'off', label: 'Turn off' },
						{ id: 'colour', label: 'Stay on the blink colour' },
					],
					default: 'restore',
				},
			],
			callback: async (event) => {
				const o = event.options
				self.startBlink({
					target: namedColourTarget(o.colour, o.brightness),
					interval: Number(o.interval),
					count: Number(o.count),
					end: o.end,
				})
			},
		},

		stop_blink: {
			name: 'Stop blinking',
			options: [
				{
					type: 'dropdown',
					id: 'end',
					label: 'Then',
					choices: [
						{ id: 'restore', label: 'Go back to the colour before blinking' },
						{ id: 'off', label: 'Turn off' },
						{ id: 'colour', label: 'Show the blink colour' },
						{ id: 'none', label: 'Leave the lamp as it is' },
					],
					default: 'restore',
				},
			],
			callback: async (event) => {
				await self.stopBlink(event.options.end)
			},
		},

		set_actor: {
			name: 'Set actor (advanced)',
			description: "Send a value to any actor, for example the lamp's own colour buttons",
			options: [
				{
					type: 'dropdown',
					id: 'actor',
					label: 'Actor (pick one, or type an id or name)',
					choices: actorChoices,
					default: actorChoices[0]?.id ?? '',
					allowCustom: true,
				},
				{
					type: 'textinput',
					id: 'value',
					label: 'Value (0, 1, toggle or a number)',
					default: '1',
					useVariables: true,
				},
				fadeField,
			],
			callback: async (event) => {
				const o = event.options
				const actor = String(o.actor ?? '').trim()
				if (!actor) throw new Error('Choose an actor')
				await self.setActorValue(actor, String(o.value ?? ''), fadeOf(o))
			},
		},
	})
}
