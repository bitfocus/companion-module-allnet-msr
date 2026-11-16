import https from 'node:https'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import Module from '../src/main.js'
import { AllnetClient } from '../src/allnet.js'

// HTTPS with a self-signed certificate, made on the fly with openssl.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allnet-test-'))
const keyFile = path.join(dir, 'k.pem')
const certFile = path.join(dir, 'c.pem')
try {
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			keyFile,
			'-out',
			certFile,
			'-days',
			'1',
			'-subj',
			'/CN=127.0.0.1',
		],
		{ stdio: 'ignore' },
	)
} catch {
	console.log('openssl not found: HTTPS test skipped')
	process.exit(0)
}
const srv = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
	if (req.url.startsWith('/xml/jsonswitch.php')) {
		res.end('Remote control functionality not activated!')
		return
	}
	res.setHeader('Content-Type', 'application/json')
	if (req.url.includes('infomin')) return res.end('{"devicetype":"ALL-PoE-RGBW-LAMP"}')
	res.end(
		'﻿[{"error":0,"id":"11","name":"Red","type":"2","unit":"","value":"40"},{"error":0,"id":"12","name":"Green","type":"2","unit":"","value":"0"},{"error":0,"id":"13","name":"Blue","type":"2","unit":"","value":"0"},{"error":0,"id":"14","name":"White","type":"2","unit":"","value":"0"},{"error":"777008","id":"1","name":"Intern","type":"1","unit":"°C","value":""}]',
	)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const m = new Module({ label: 'allnet' })
await m.init({ host: '127.0.0.1', protocol: 'https', port, insecure: true, pollInterval: 0 }, true, {})
for (let i = 0; i < 100 && m.status !== 'ok'; i++) await new Promise((r) => setTimeout(r, 20))
assert.equal(m.status, 'ok')
assert.deepEqual(m.channelMap, { red: '11', green: '12', blue: '13', white: '14', buzzer: null })
assert.equal(m.variables.red, 40)
assert.equal(m.variables.id_1, 'error 777008')
assert.equal(m.variables.temperature, '')
await assert.rejects(
	m.actionDefs.named_colour.callback({ options: { colour: 'red', brightness: 100, fade: 0 } }),
	/Remote control functionality not activated/,
)
assert.equal(m.status, 'bad_config')
await assert.rejects(m.actionDefs.buzzer.callback({ options: { mode: 'on' } }), /No buzzer actor/)
await m.destroy()
// strict certificate check refuses the self-signed cert
const strict = new AllnetClient({ host: '127.0.0.1', port, protocol: 'https', insecure: false })
await assert.rejects(strict.readAll(), /Cannot reach/)
strict.destroy()
srv.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log('https + text error + item error checks passed')
