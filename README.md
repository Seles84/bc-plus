# BC+ (Bondage Club Plus)

An extension for the web game *Bondage Club*, providing additional features and quality-of-life improvements. BC+ runs standalone or in tandem with [BCX](https://github.com/Jomshir98/bondage-club-extended) when it is installed.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. Install the BC+ loader userscript:
   - **Stable**: `https://seles84.github.io/bc-plus/bcplusLoader.user.js`
3. Open the club — BC+ loads automatically.

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
