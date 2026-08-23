# BC+ (Bondage Club Plus)

An extension for the web game *Bondage Club*, providing additional features and quality-of-life improvements. BC+ runs standalone or in tandem with [BCX](https://github.com/Jomshir98/bondage-club-extended) when it is installed.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. Install the BC+ loader userscript:
   - **Stable**: `https://seles84.github.io/bc-plus/bcplusLoader.user.js`
3. Open the club — BC+ loads automatically.

## Update checks & anonymous usage count

BC+ checks for new releases by fetching a small version manifest at login and periodically afterwards (interval configurable on the General page). The request carries only the BC+ version you are running and whether it is a login or interval check — **no member number, no account data, nothing identifying**. The endpoint's request count is used as an anonymous "how many people use BC+" figure; no per-user information is stored.

You can switch this off completely with the "Check for updates online" checkbox on the BC+ General page — BC+ then makes no update requests at all (you also stop hearing about new versions).

## Development

```bash
npm install
npm run build      # production bundle -> dist/bcplus.js
npm run build:dev  # development bundle (unminified, sourcemaps)
npm run serve      # watch + serve dist/ on http://localhost:3045
npm run typecheck  # TypeScript type checking
npm run lint       # ESLint
```

For local testing, install `static-dev/bcplusLoader.user.js` in Tampermonkey and run `npm run serve` — the club will load your local build on every refresh.

## License

MIT
