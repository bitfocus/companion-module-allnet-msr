export async function resolve(specifier, context, next) {
	if (specifier === '@companion-module/base') {
		return { url: new URL('./mock-base.js', import.meta.url).href, shortCircuit: true }
	}
	return next(specifier, context)
}
