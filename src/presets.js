import { CHANNELS, NAMED_COLOURS, textColourFor } from './channels.js'
import { PALETTE, PALETTE_FAMILIES, PALETTE_SHADES } from './palette.js'

const DARK = 0x000000
const WHITE = 0xffffff

export function UpdatePresets(self) {
	const label = self.label || 'allnet'
	const presets = {}

	// Colours: one button per named colour, lit in that colour while the lamp shows it.
	const colourKeys = []
	for (const [id, colour] of Object.entries(NAMED_COLOURS)) {
		const key = `colour_${id}`
		colourKeys.push(key)
		const lit = id === 'off' ? 0x404040 : colour.display
		presets[key] = {
			type: 'simple',
			name: colour.label,
			style: { text: colour.label.toUpperCase(), size: '18', color: WHITE, bgcolor: DARK },
			steps: [
				{
					down: [{ actionId: 'named_colour', options: { colour: id, brightness: 100, fade: 0 } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'colour_is',
					options: { colour: id, brightness: 100, tolerance: 3 },
					style: { bgcolor: lit, color: textColourFor(lit) },
				},
			],
		}
	}

	// Effects
	presets.blink_red = {
		type: 'simple',
		name: 'Blink red',
		style: { text: 'BLINK\\nRED', size: '18', color: WHITE, bgcolor: DARK },
		steps: [
			{
				down: [
					{
						actionId: 'blink',
						options: { colour: 'red', brightness: 100, interval: 500, count: 0, end: 'restore' },
					},
				],
				up: [],
			},
		],
		feedbacks: [{ feedbackId: 'blinking', options: {}, style: { bgcolor: 0xff0000, color: WHITE } }],
	}
	presets.stop_blink = {
		type: 'simple',
		name: 'Stop blinking',
		style: { text: 'STOP\\nBLINK', size: '18', color: WHITE, bgcolor: DARK },
		steps: [{ down: [{ actionId: 'stop_blink', options: { end: 'restore' } }], up: [] }],
		feedbacks: [{ feedbackId: 'blinking', options: {}, style: { bgcolor: 0xff7a00, color: DARK } }],
	}
	presets.buzzer_toggle = {
		type: 'simple',
		name: 'Buzzer on/off',
		style: { text: 'BUZZER', size: '18', color: WHITE, bgcolor: DARK },
		steps: [{ down: [{ actionId: 'buzzer', options: { mode: 'toggle' } }], up: [] }],
		feedbacks: [{ feedbackId: 'buzzer_on', options: {}, style: { bgcolor: 0xff0000, color: WHITE } }],
	}
	presets.buzzer_hold = {
		type: 'simple',
		name: 'Buzzer while held',
		style: { text: 'BUZZ\\n(hold)', size: '18', color: WHITE, bgcolor: DARK },
		steps: [
			{
				down: [{ actionId: 'buzzer', options: { mode: 'on' } }],
				up: [{ actionId: 'buzzer', options: { mode: 'off' } }],
			},
		],
		feedbacks: [{ feedbackId: 'buzzer_on', options: {}, style: { bgcolor: 0xff0000, color: WHITE } }],
	}

	// Status
	presets.lamp_status = {
		type: 'simple',
		name: 'Lamp colour',
		style: { text: `LAMP\\n$(${label}:hex)`, size: '14', color: WHITE, bgcolor: DARK },
		steps: [{ down: [], up: [] }],
		feedbacks: [{ feedbackId: 'lamp_colour', options: { textColour: true } }],
	}

	presets.external_sensor = {
		type: 'simple',
		name: 'External sensor',
		style: {
			text: `EXT\\n$(${label}:external_sensor_count)`,
			size: '18',
			color: WHITE,
			bgcolor: DARK,
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [{ feedbackId: 'external_sensor_active', options: {}, style: { bgcolor: 0xff0000, color: WHITE } }],
	}

	// Fine control: +/- 10 % per channel
	const fineKeys = []
	for (const channel of CHANNELS) {
		for (const [suffix, delta, sign] of [
			['up', 10, '+'],
			['down', -10, '−'],
		]) {
			const key = `${channel.id}_${suffix}`
			fineKeys.push(key)
			presets[key] = {
				type: 'simple',
				name: `${channel.label} ${sign}10 %`,
				style: {
					text: `${channel.label.toUpperCase()}\\n${sign}10\\n$(${label}:${channel.id})%`,
					size: '14',
					color: WHITE,
					bgcolor: DARK,
				},
				steps: [
					{
						down: [{ actionId: 'adjust_channel', options: { channel: channel.id, delta, fade: 0 } }],
						up: [],
					},
				],
				feedbacks: [],
			}
		}
	}

	// Palette: the 20 × 6 colours from the Buttons colour picker, one group per shade.
	const paletteGroups = PALETTE.map((row, r) => {
		const keys = row.map((colour, c) => {
			const family = PALETTE_FAMILIES[c]
			const shade = PALETTE_SHADES[r]
			const key = `palette_${family.toLowerCase()}_${shade.toLowerCase()}`
			presets[key] = {
				type: 'simple',
				name: `${family} (${shade.toLowerCase()})`,
				style: { text: '', size: '18', color: textColourFor(colour), bgcolor: colour },
				steps: [
					{
						down: [
							{
								actionId: 'colour_picker',
								options: { colour, white: 0, brightness: 100, useWhite: true, gamma: true, fade: 0 },
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'colour_matches',
						options: { colour, brightness: 100, useWhite: true, gamma: true, tolerance: 1 },
						style: { text: '●', color: textColourFor(colour) },
					},
				],
			}
			return key
		})
		return { id: `palette_${PALETTE_SHADES[r].toLowerCase()}`, type: 'simple', name: PALETTE_SHADES[r], presets: keys }
	})

	const structure = [
		{ id: 'colours', name: 'Colours', definitions: colourKeys },
		{
			id: 'palette',
			name: 'Palette',
			description: 'The colours from the Buttons colour picker. The dot shows which one the lamp has.',
			definitions: paletteGroups,
		},
		{
			id: 'effects',
			name: 'Blink and buzzer',
			definitions: ['blink_red', 'stop_blink', 'buzzer_toggle', 'buzzer_hold'],
		},
		{ id: 'status', name: 'Status', definitions: ['lamp_status', 'external_sensor'] },
		{ id: 'fine', name: 'Fine control', definitions: fineKeys },
	]

	self.setPresetDefinitions(structure, presets)
}
