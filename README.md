# Pigeon Bluetooth (WebBluetooth Mesh)

[中文文档 / Chinese Version](README.zh-CN.md)

## Overview

Pigeon Bluetooth is a TypeScript library and demo that enables a lightweight Bluetooth-based messaging mesh in the browser using WebBluetooth. It focuses on a "click-free after authorization" experience: once devices are authorized, the app automatically connects and broadcasts messages to all online devices in a public room by default.

- Library: `packages/mesh` – WebBluetooth adapter and utilities.
- Demo: `apps/demo` – Vite app showcasing device discovery, UUID configuration, and public-room broadcast.

Inspired by the native `bitchat` concept, this project adapts similar behavior to the web, acknowledging WebBluetooth constraints (user gesture required for initial authorization, limited background scanning, and typically one device selection per prompt).

## Key Features

- Automatic connection to previously authorized devices on page load.
- An "Authorize devices" button appears when no devices are present (initial user gesture).
- Default public-room broadcast: send to `ALL` forwards to every online device.
- Robust TX/RX resolution across services with support for:
  - TX: `write` or `writeWithoutResponse`
  - RX: `notify` or `indicate`
- UUID configuration via demo UI for precise compatibility with custom firmware.
- Safe send path: ensure connection before sending; re-parse TX/RX if missing.

## Quick Start

### Requirements
- Chrome or Chromium with WebBluetooth enabled.
- Bluetooth turned on at the OS level.
- Use `localhost` (allowed) or HTTPS for WebBluetooth.

### Install and Run
```bash
# From repository root
npm install

# Build the mesh library
npm run build -w packages/mesh

# Start the demo app
npm run dev -w apps/demo
```
Open `http://localhost:5173/`.

### Demo Usage
1. Optional: Fill in `Service UUID`, `TX Char UUID (write)`, `RX Char UUID (notify/indicate)`, and `Optional Services` at the top; click "Apply UUIDs".
2. Click "Authorize devices" (first-time gesture) to select your device. Authorized devices will auto-connect and show up in the Devices list.
3. Send a message to `ALL` or pick a specific device. The app ensures the target is connected and uses the best available TX/RX characteristics.

### Multiple Devices
WebBluetooth prompts typically allow choosing one device per authorization. To add more devices, click "Authorize devices" again and select another device. Previously authorized devices reconnect automatically on subsequent visits.

## Library Usage (Concept)
The library centers around a WebBluetooth adapter that:
- Initializes with optional UUID configuration.
- Discovers/uses previously authorized devices.
- Ensures GATT connection and resolves TX/RX characteristics before sending.
- Listens for incoming messages via `notify/indicate`.

Conceptual example:
```ts
import { WebBluetoothAdapter } from "@your-scope/mesh"; // adapt to your setup

const adapter = new WebBluetoothAdapter({
  serviceUUID: "0000xxxx-0000-1000-8000-00805f9b34fb",
  txCharacteristicUUID: "0000yyyy-0000-1000-8000-00805f9b34fb",
  rxCharacteristicUUID: "0000zzzz-0000-1000-8000-00805f9b34fb",
  optionalServices: ["..."],
});

await adapter.init();           // prepare WebBluetooth
// await adapter.startScan();   // user gesture to pick a device (demo provides a button)

// Example send
const data = new TextEncoder().encode("Hello");
await adapter.send("ALL", data); // broadcast; the app forwards to all online devices

// Receive
adapter.onMessage(({ from, data }) => {
  console.log("from", from, new TextDecoder().decode(data));
});
```
Note: API surface may vary depending on your bundling/export setup. The demo store (`apps/demo/src/stores/mesh.ts`) shows how UUIDs and adapter lifecycle are wired.

## How It Works

### WebBluetooth constraints
- Initial device selection requires a user gesture (security model).
- Browsers cannot silently scan/connect in the background.
- Prompts typically allow selecting only one device; multi-device requires repeated authorization.

### GATT resolution
- TX characteristic: any with `write` or `writeWithoutResponse`.
- RX characteristic: any with `notify` or `indicate`.
- Characteristics can reside in different services. The adapter searches across all primary services and prioritizes configured UUIDs when provided.

### Reliability path
- Before sending, the adapter calls an `ensureConnected`-like flow to guarantee a live GATT connection.
- If TX/RX are missing or stale, it re-resolves them (`resolveTxRx`-like logic) across services, including `indicate` support for RX.
- If a device lacks a writable RX/notifiable TX as expected, the demo prompts you to provide explicit UUIDs.

### Broadcast to ALL
- Sending to `ALL` iterates over online devices and forwards the message to each, emulating a public room.
- Devices receiving a message can rebroadcast to others in the demo app, forming a simple mesh.

### Differences vs native `bitchat`
- Native apps can keep scanning and connect more reliably, with multi-device selection in a single system dialog.
- The web adapts behavior with UUID configuration and automatic reconnection of authorized devices.

## Troubleshooting
- "No writable characteristic found":
  - Confirm your TX characteristic supports `write` or `writeWithoutResponse`.
  - Provide `TX Char UUID` in the demo UI and click "Apply UUIDs".
- "Target not connected or TX characteristic missing":
  - Ensure the device is powered and in range; click "Authorize devices" again if needed.
  - The adapter auto-reconnects authorized devices and re-parses TX/RX; explicit UUIDs help stability.
- Inspect with Chrome: `chrome://bluetooth-internals` → select your device → GATT Services → check characteristic properties.
- Multiple devices: authorize each one separately.

## Contributing
PRs and feature requests are welcome. If you have device-specific UUIDs or protocol details, sharing them helps improve compatibility.