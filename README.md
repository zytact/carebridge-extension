# Carebridge Chrome Extension

This extension reports currently open browser URLs to the local Carebridge desktop app.

## Prerequisites

### Install Bun (if not installed)

Bun is a fast JavaScript runtime. Install it via:

**macOS/Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (PowerShell):**
```powershell
irm https://bun.sh/install | iex
```

Or via npm:
```bash
npm install -g bun
```

Verify installation:
```bash
bun --version
```

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
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `dist/` folder.

## Bridge settings

- Endpoint: `http://127.0.0.1:17333/extension/open-urls`
- Header token: `x-carebridge-token: carebridge-local-token`

To change the token, update:

- Electron env: `CAREBRIDGE_EXTENSION_TOKEN`
- Extension constant: `BRIDGE_TOKEN` in `src/background.ts`