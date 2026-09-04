# SummerMail

SummerMail is a fast, extensible desktop email client built with Electron, React, and TypeScript. Its native sync engine runs locally, and the interface is organized around a plugin architecture.

## Development

Install the supported Node.js and npm versions, then run:

```sh
npm install
npm start
```

Useful commands:

```sh
npm test
npm run lint
npm run build
```

Application code lives in `app/src`, bundled packages live in `app/internal_packages`, and packaging resources live in `app/build`.

## Extensions and localization

- See `PLUGIN_SYSTEM_ARCHITECTURE.md` for the plugin model.
- See `LOCALIZATION.md` to update translations.
- See `CONTRIBUTING.md` before submitting changes.

## License

SummerMail is distributed under GPL-3.0. See `LICENSE.md` and the bundled third-party notices for copyright and attribution details.
