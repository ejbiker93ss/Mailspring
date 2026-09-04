# Contributing to SummerMail

Thank you for helping improve SummerMail.

## Before you start

- Search existing issues before opening a new one.
- Keep changes focused and include tests for behavior changes.
- Do not include credentials, private messages, or production account data in bug reports or fixtures.
- Follow `CODE_OF_CONDUCT.md` in all project spaces.

## Local setup

```sh
git clone <your-summermail-repository-url>
cd SummerMail
npm install
npm start
```

Run the relevant checks before submitting a change:

```sh
npm test
npm run lint
npm run build
```

The application package is under `app/`; internal plugins are under `app/internal_packages/`. Keep user-interface changes consistent with nearby components and avoid committing generated output.

## Pull requests

Explain the problem, the chosen solution, and how you verified it. Include screenshots for visible interface changes and call out any migration or compatibility implications.
