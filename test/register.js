// Loads the module against a test double of @companion-module/base (see mock-base.js).
// Usage: node --import ./test/register.js test/run.js
import * as nodeModule from 'node:module'

const mock = new URL('./mock-base.js', import.meta.url).href

if (typeof nodeModule.registerHooks === 'function') {
	nodeModule.registerHooks({
		resolve(specifier, context, next) {
			if (specifier === '@companion-module/base') return { url: mock, shortCircuit: true }
			return next(specifier, context)
		},
	})
} else {
	nodeModule.register('./resolve-hook.js', import.meta.url)
}
