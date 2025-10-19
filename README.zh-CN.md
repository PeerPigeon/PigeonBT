# Pigeon Bluetooth（WebBluetooth Mesh）

[English Version / 英文文档](README.md)

## 概述

Pigeon Bluetooth 是一个在浏览器中使用 WebBluetooth 实现的轻量级蓝牙消息 Mesh 的 TypeScript 库与演示应用。核心目标是“首次授权后即点击免打扰”：只要设备已授权，页面加载时即可自动连接，并默认在公共房间向所有在线设备广播消息。

- 库：`packages/mesh` – WebBluetooth 适配器与工具。
- 演示：`apps/demo` – 展示设备发现、UUID 配置与公共房间广播的 Vite 应用。

项目受原生 `bitchat` 启发，并在 Web 端适配相似行为，同时遵循 WebBluetooth 的限制（首次授权需要用户手势、无后台扫描、通常一次弹窗只能选择一个设备）。

## 主要特性

- 页面加载后自动连接已授权设备。
- 当没有设备时显示“Authorize devices”按钮（首次授权需要点击）。
- 默认公共房间广播：发送到 `ALL` 即转发到所有在线设备。
- 跨服务解析 TX/RX，支持：
  - TX：`write` 或 `writeWithoutResponse`
  - RX：`notify` 或 `indicate`
- 通过演示 UI 配置 UUID，精确兼容自定义固件。
- 发送前保证连接；若 TX/RX 缺失会自动重新解析并兜底。

## 快速开始

### 环境要求
- 使用支持 WebBluetooth 的 Chrome/Chromium。
- 操作系统层面开启蓝牙。
- 使用 `localhost`（允许）或 HTTPS 以启用 WebBluetooth。

### 安装与运行
```bash
# 仓库根目录执行
npm install

# 构建 mesh 库
npm run build -w packages/mesh

# 启动演示应用
npm run dev -w apps/demo
```
打开 `http://localhost:5173/`。

### 演示使用流程
1. 可选：在页面顶部填写 `Service UUID`、`TX Char UUID (write)`、`RX Char UUID (notify/indicate)` 与 `Optional Services`，点击 "Apply UUIDs"。
2. 点击 "Authorize devices"（首次授权），选择你的设备。授权后的设备会自动连接并显示在设备列表中。
3. 在输入框中发送消息到 `ALL` 或选择指定设备。适配器会确保目标已连接，并使用最合适的 TX/RX 特征。

### 多设备授权
WebBluetooth 弹窗通常一次只能选择一个设备。若需添加更多设备，请再次点击 "Authorize devices" 并选择另一个设备。已授权设备在下次访问时会自动连接。

## 库用法（概念示例）
库以 WebBluetooth 适配器为核心：
- 支持可选的 UUID 配置进行初始化。
- 使用并管理已授权的设备。
- 在发送前确保 GATT 连接，并解析 TX/RX 特征。
- 通过 `notify/indicate` 接收消息。

概念代码示例：
```ts
import { WebBluetoothAdapter } from "@your-scope/mesh"; // 根据你的工程调整导入

const adapter = new WebBluetoothAdapter({
  serviceUUID: "0000xxxx-0000-1000-8000-00805f9b34fb",
  txCharacteristicUUID: "0000yyyy-0000-1000-8000-00805f9b34fb",
  rxCharacteristicUUID: "0000zzzz-0000-1000-8000-00805f9b34fb",
  optionalServices: ["..."],
});

await adapter.init();           // 初始化 WebBluetooth
// await adapter.startScan();   // 浏览器授权弹窗（演示页面已提供按钮）

// 发送示例
const data = new TextEncoder().encode("Hello");
await adapter.send("ALL", data); // 广播，应用层会转发到所有在线设备

// 接收示例
adapter.onMessage(({ from, data }) => {
  console.log("from", from, new TextDecoder().decode(data));
});
```
注：API 细节可能随打包与导出配置有所差异。演示的 store（`apps/demo/src/stores/mesh.ts`）展示了如何将 UUID 与适配器生命周期串联起来。

## 原理说明

### WebBluetooth 限制
- 首次选择设备必须由用户手势触发（安全模型）。
- 浏览器无法在后台静默扫描/连接设备。
- 弹窗一般一次只能选一个设备；多设备需多次授权。

### GATT 解析策略
- TX 特征：具备 `write` 或 `writeWithoutResponse` 的任意特征。
- RX 特征：具备 `notify` 或 `indicate` 的任意特征。
- 特征可能位于不同服务，适配器会在所有 `PrimaryService` 中搜索，并在提供 UUID 配置时优先使用配置值。

### 可靠性路径
- 在发送前执行类似 `ensureConnected` 的流程，确保 GATT 连接有效。
- 若 TX/RX 缺失或失效，执行类似 `resolveTxRx` 的跨服务解析，并支持 RX 的 `indicate`。
- 若设备本身缺少可写或可通知/可指示的特征，演示会提示设置准确 UUID。

### 广播到 ALL
- 发送到 `ALL` 会对所有在线设备进行逐个转发，模拟公共房间广播。
- 设备收到消息后也可以在演示中转发给其他设备，形成简单的 Mesh。

### 与原生 `bitchat` 的差异
- 原生应用可持续扫描、批量选择设备并维持更稳定连接。
- Web 端通过 UUID 配置与授权设备的自动重连进行适配。

## 常见问题排查
- “No writable characteristic found”：
  - 确认 TX 特征具备 `write` 或 `writeWithoutResponse`。
  - 在演示 UI 中填写 `TX Char UUID` 并点击 "Apply UUIDs"。
- “Target not connected or TX characteristic missing”：
  - 确认设备已开机且在范围内；必要时再次点击 "Authorize devices"。
  - 适配器会自动重连并重新解析 TX/RX；提供准确的 UUID 能显著提升稳定性。
- 使用 Chrome 检查：`chrome://bluetooth-internals` → 选择设备 → GATT Services → 查看各特征的 Properties。
- 多设备：分别授权多个设备。

## 参与贡献
欢迎 PR 与需求建议。若你有设备的具体 UUID 或协议细节，分享将有助于提升兼容性与稳定性。