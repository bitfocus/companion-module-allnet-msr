export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'setup_info',
			label: 'Before you start',
			value:
				'On the lamp, open Configuration → Server and users → Access control and switch on remote control. ' +
				'Then create a user of type "Remote control" with view and switch rights, and enter it below.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'IP address or hostname',
			default: '',
			minLength: 1,
		},
		{
			type: 'dropdown',
			id: 'protocol',
			label: 'Protocol',
			choices: [
				{ id: 'http', label: 'HTTP' },
				{ id: 'https', label: 'HTTPS' },
			],
			default: 'http',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port (0 = default for the protocol)',
			default: 0,
			min: 0,
			max: 65535,
			asInteger: true,
		},
		{
			type: 'checkbox',
			id: 'insecure',
			label: 'Accept the lamp’s self-signed certificate',
			default: true,
			isVisibleExpression: `$(options:protocol) == 'https'`,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username (remote control user)',
			default: '',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			default: '',
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval in ms (0 = only read at start-up). 250 ms gives a quick response from the external sensor',
			default: 250,
			min: 0,
			max: 60000,
			asInteger: true,
		},
		{
			type: 'static-text',
			id: 'mapping_info',
			label: 'Channel mapping (optional)',
			value:
				'Leave these empty to find the actors from their names (Rot/Red, Grün/Green, Blau/Blue, Weiss/White, Buzzer). ' +
				'Enter an actor ID or name to override. The detected IDs are shown in the log and in the variables.',
		},
		{ type: 'textinput', id: 'redActor', label: 'Red actor', default: '' },
		{ type: 'textinput', id: 'greenActor', label: 'Green actor', default: '' },
		{ type: 'textinput', id: 'blueActor', label: 'Blue actor', default: '' },
		{ type: 'textinput', id: 'whiteActor', label: 'White actor', default: '' },
		{ type: 'textinput', id: 'buzzerActor', label: 'Buzzer actor', default: '' },
		{
			type: 'static-text',
			id: 'external_info',
			label: 'External sensor (switch on the sensor port)',
			value:
				'For a switch connected through a contact input such as ALLNET ALL4440. The input reads 1 when the circuit ' +
				'is open and 0 when it is closed, so a switch that breaks the circuit is active when pressed. ' +
				'Leave the field empty to use the first sensor that is not one of the lamp’s own.',
		},
		{ type: 'textinput', id: 'externalSensor', label: 'External sensor (ID or name, empty = automatic)', default: '' },
		{
			type: 'checkbox',
			id: 'externalInvert',
			label: 'Invert: active when the circuit is closed (normally-open buttons)',
			default: false,
		},
	]
}
