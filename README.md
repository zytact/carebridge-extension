# Carebridge Chrome Extension

This extension reports currently open browser URLs to the local Carebridge desktop app.

## Install dependencies

```bash
bun install
```

## Build extension

```bash
bun run build
```

The built extension is written to `dist/`.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select the `dist/` folder.

## Bridge settings

- Endpoint: `http://127.0.0.1:17333/extension/open-urls`
- Header token: `x-carebridge-token: carebridge-local-token`

To change the token, update:

- Electron env: `CAREBRIDGE_EXTENSION_TOKEN`
- Extension constant: `BRIDGE_TOKEN` in `src/background.ts`
