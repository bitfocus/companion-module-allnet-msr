## ALLNET PoE RGBW Lamp / MSR

Controls the ALLNET PoE RGBW signal lamp (ALL-PoE-RGBW-LAMP) over its built-in JSON API. Other ALLNET MSR devices that use the same API (CO2 lamp, ALL3418, ALL3500 and similar) also work through the generic actor action, feedback and variables.

### Prepare the lamp

1. Open the lamp's web page (the IP address is shown on the display on the back).
2. Go to **Configuration → Server and users → Access control** and switch on **remote control**. Access control for the web interface must be switched on too, with an administrator user.
3. Under **User settings**, create a user of type **Remote control** with rights to **view and switch**.

### Connection settings

- **IP address or hostname**: the lamp's address. You can also paste a URL such as `http://192.168.1.50`.
- **Protocol / Port**: HTTP on port 80 by default. With HTTPS the lamp's self-signed certificate is accepted unless you untick the option.
- **Username / Password**: the remote control user from the step above. Leave empty if access control is off.
- **Poll interval**: how often the lamp is read (default 250 ms). Set 0 to read only at start-up.
- **Channel mapping**: leave empty. The module finds the red, green, blue, white and buzzer actors from their names (Rot, Grün, Blau, Weiss, Buzzer, or the English names). If you have renamed them, enter the actor ID or name here. The detected IDs are written to the log and to the `channel_map` variable.

### External sensor (switch)

You can connect a switch to the lamp's sensor port through an ALLNET contact input such as the ALL4440. After **Sensor/Actuator search** on the lamp, the input shows up as a sensor, and the module reads it like the colours.

- The input reads 1 when the circuit is open and 0 when it is closed. A switch that breaks the circuit is therefore active when pressed. Tick **Invert** for a normally-open button.
- Leave **External sensor** empty to use the first sensor that is not one of the lamp's own, or enter its ID or name.
- Set **Poll interval** to about 250 ms for a quick response. The lamp does not push changes, so the module has to ask.
- To run actions when the switch is pressed, make a trigger on the variable `external_sensor_count` (it goes up by one per press) or on `external_sensor` changing to 1.

### Actions

- **Set colour**: red, orange, yellow, green, cyan, blue, magenta, white or off, with brightness and fade time.
- **Set colour (RGBW %)**: exact levels for all four channels.
- **Set colour (colour picker)**: pick any colour, plus extra white and brightness. By default the grey part of the colour goes to the white LEDs, and the colour is gamma-corrected so it looks like it does on screen. Untick both options to send the raw RGB values.
- **Set one channel** / **Adjust one channel**: one channel at a time, or up/down in steps (good for rotary encoders).
- **Turn lamp off**
- **Buzzer**: on, off or toggle.
- **Blink**: blink a colour a number of times or until stopped, then go back to the previous colour, turn off or stay on.
- **Stop blinking**
- **Set actor (advanced)**: send 0, 1, `toggle` or a number to any actor, for example the lamp's own colour buttons.

Fade time is sent as the lamp's `fading` parameter and only works on dimmable channels.

### Feedbacks

- **Button shows the lamp colour**: the button background follows the lamp.
- **Lamp shows a named colour**
- **Lamp shows colour (colour picker)**: used by the palette presets to mark the active colour with a dot.
- **Channel level**: compare one channel with a value.
- **Actor is on** / **Buzzer is on** / **Lamp is blinking**
- **External sensor is active**

### Presets

- **Colours**: the named colours.
- **Palette**: the 120 colours from the Buttons colour picker (20 colour families in 6 shades). Each button has its own colour, and a dot shows which one the lamp has. The darkest shades are very dim on the lamp.
- **Blink and buzzer**, **Status** (lamp colour and external sensor) and **Fine control**.

### Variables

`red`, `green`, `blue`, `white` (0–100 %), `hex`, `buzzer`, `blinking`, `temperature`, `channel_map`, `device_type`, `device_name`, `firmware`, and one variable per sensor and actor named `id_<id>`.

For the external sensor: `external_sensor` (1 = active, 0 = idle), `external_sensor_count` (activations since the connection started), `external_sensor_raw`, `external_sensor_status` (ok, not found, or the lamp's error such as _No answer from chip_) and `external_sensor_name`.

### Troubleshooting

- **Authentication failed**: check the username and password, and that the user is of type Remote control.
- **Remote control functionality not activated / disabled**: switch on remote control on the lamp (see above).
- **No actor found for a channel**: enter the actor ID or name under Channel mapping.
- Yellow and orange are mixed from red and green. If they look wrong on your lamp, use **Set colour (RGBW %)** to fine-tune.
