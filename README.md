# companion-module-allnet-msr

Bitfocus Companion / Buttons module for the ALLNET PoE RGBW signal lamp (ALL-PoE-RGBW-LAMP) and other ALLNET MSR devices, using the ALLNET JSON API (`/xml/json.php` to read, `/xml/jsonswitch.php` to switch).

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE).

## Build

Requires Node 26 and Yarn 4 (module API 2.1).

```sh
yarn install
yarn package   # builds pkg/allnet-msr and allnet-msr-<version>.tgz
```

- Buttons: import the folder `pkg/allnet-msr`.
- Companion: import the `.tgz` on the Modules page.

## Test

```sh
yarn test
```

The tests run the module against a simulated lamp (`test/fake-lamp.js`, written from the ALLNET API documentation) and a test double of `@companion-module/base` (`test/mock-base.js`). They need no network and no hardware. The HTTPS test makes a self-signed certificate with `openssl` and is skipped when `openssl` is missing.
