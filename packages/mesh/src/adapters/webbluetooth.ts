import { EventBus } from "../index";
import type { MeshAdapter } from "../index";

// Fallback type aliases to avoid requiring lib.dom web bluetooth typings
type BluetoothServiceUUID = any;
type BluetoothCharacteristicUUID = any;
type BluetoothDevice = any;
type BluetoothRemoteGATTServer = any;
type BluetoothRemoteGATTService = any;
type BluetoothRemoteGATTCharacteristic = any;

export type WebBluetoothOptions = {
  serviceUUID?: BluetoothServiceUUID;
  txCharacteristicUUID?: BluetoothCharacteristicUUID;
  rxCharacteristicUUID?: BluetoothCharacteristicUUID;
  optionalServices?: BluetoothServiceUUID[];
  acceptAllDevices?: boolean;
};

type BLEConn = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service?: BluetoothRemoteGATTService;
  tx?: BluetoothRemoteGATTCharacteristic;
  rx?: BluetoothRemoteGATTCharacteristic;
};

export class WebBluetoothAdapter implements MeshAdapter {
  private bus = new EventBus<{
    deviceFound: { id: string; name?: string };
    deviceConnected: { id: string };
    deviceDisconnected: { id: string };
    data: { from: string; bytes: Uint8Array };
    heartbeat: { id: string };
    topology: { edges: Array<[string, string]> };
  }>();

  private listeners: Map<string, Set<(e: any) => void>> = new Map();
  private knownDevices: Map<string, BluetoothDevice> = new Map();
  private connections: Map<string, BLEConn> = new Map();

  constructor(private options: WebBluetoothOptions = { acceptAllDevices: true }) {}

  async startScan(): Promise<void> {
    const bt = (navigator as any).bluetooth;
    if (!bt) {
      throw new Error("WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.");
    }

    // 1) 自动连接已授权设备（零交互）
    if (bt.getDevices) {
      try {
        const allowed: BluetoothDevice[] = await bt.getDevices();
        for (const d of allowed) {
          this.knownDevices.set(d.id, d);
          this.emit("deviceFound", { id: d.id, name: d.name ?? undefined });
          this.emit("heartbeat", { id: d.id });
          try { await this.connect(d.id); } catch {/* ignore single connect error */}
        }
      } catch {/* ignore */}
    }

    // 2) 如需新增设备，发起一次用户授权的选择
    let device: BluetoothDevice | null = null;
    const { serviceUUID, optionalServices, acceptAllDevices } = this.options;

    try {
      if (serviceUUID) {
        device = await bt.requestDevice({
          filters: [{ services: [serviceUUID] }],
          optionalServices: optionalServices ?? [serviceUUID],
        });
      } else {
        device = await bt.requestDevice({
          acceptAllDevices: acceptAllDevices ?? true,
          optionalServices: optionalServices ?? [],
        });
      }
    } catch {/* user canceled or error; continue */}

    if (device) {
      this.knownDevices.set(device.id, device);
      this.emit("deviceFound", { id: device.id, name: device.name ?? undefined });
      this.emit("heartbeat", { id: device.id });
      // auto-connect newly authorized device
      try { await this.connect(device.id); } catch {/* ignore connect error */}
    }

    // 3) 可用时开启持续扫描（实验特性）
    if (bt.requestLEScan) {
      try {
        const scan = await bt.requestLEScan({
          keepRepeatedDevices: true,
        });
        (navigator as any).bluetooth.addEventListener("advertisementreceived", (ev: any) => {
          const dev = ev.device as BluetoothDevice;
          if (!dev || !dev.id) return;
          if (!this.knownDevices.has(dev.id)) {
            this.knownDevices.set(dev.id, dev);
            this.emit("deviceFound", { id: dev.id, name: dev.name ?? undefined });
          }
          this.emit("heartbeat", { id: dev.id });
        });
      } catch {/* scanning may require flags; ignore */}
    }
  }

  private async resolveTxRx(server: BluetoothRemoteGATTServer): Promise<{ service?: BluetoothRemoteGATTService, tx?: BluetoothRemoteGATTCharacteristic, rx?: BluetoothRemoteGATTCharacteristic }> {
    const { serviceUUID, txCharacteristicUUID, rxCharacteristicUUID } = this.options;
    let service: BluetoothRemoteGATTService | undefined;
    let tx: BluetoothRemoteGATTCharacteristic | undefined;
    let rx: BluetoothRemoteGATTCharacteristic | undefined;

    // 优先使用配置的 UUID 定位
    if (serviceUUID) {
      try {
        service = await server.getPrimaryService(serviceUUID);
        if (txCharacteristicUUID) { try { tx = await service.getCharacteristic(txCharacteristicUUID); } catch {} }
        if (rxCharacteristicUUID) { try { rx = await service.getCharacteristic(rxCharacteristicUUID); } catch {} }
      } catch {}
    }

    // 跨服务匹配：在所有服务中分别寻找任意可写和可通知/指示的特征
    if (!tx || !rx) {
      try {
        const services = await server.getPrimaryServices();
        let foundTx: BluetoothRemoteGATTCharacteristic | undefined;
        let foundRx: BluetoothRemoteGATTCharacteristic | undefined;
        let txService: BluetoothRemoteGATTService | undefined;
        for (const s of services) {
          const chars = await s.getCharacteristics();
          for (const c of chars) {
            const props = c.properties as any;
            if (!foundTx && (props.write || props.writeWithoutResponse)) { foundTx = c; txService = s; }
            if (!foundRx && (props.notify || props.indicate)) { foundRx = c; }
            if (foundTx && foundRx) break;
          }
          if (foundTx && foundRx) break;
        }
        tx = tx ?? foundTx;
        rx = rx ?? foundRx;
        service = service ?? txService;
      } catch (e:any) {
        throw new Error("Unable to discover GATT services/characteristics. Provide service/characteristic UUIDs in adapter options.")
      }
    }

    return { service, tx, rx };
  }

  private async ensureConnected(id: string): Promise<void> {
    const existing = this.connections.get(id);
    if (!existing || !(existing.server as any)?.connected) {
      await this.connect(id);
      return;
    }
    if (!existing.tx || !existing.rx) {
      const resolved = await this.resolveTxRx(existing.server);
      if (resolved.service) existing.service = resolved.service;
      if (resolved.tx) existing.tx = resolved.tx;
      if (resolved.rx) existing.rx = resolved.rx;
      this.connections.set(id, existing);
    }
  }

  async connect(id: string): Promise<void> {
    let device = this.knownDevices.get(id);

    const bt = (navigator as any).bluetooth;
    if (!device && bt?.getDevices) {
      const allowed: BluetoothDevice[] = await bt.getDevices();
      const match = allowed.find((d: BluetoothDevice) => d.id === id);
      if (match) {
        device = match;
        this.knownDevices.set(id, match);
      }
    }

    if (!device) throw new Error("Device not found or not granted by user");

    const server: BluetoothRemoteGATTServer = await device.gatt.connect();
    const { service, tx, rx } = await this.resolveTxRx(server);

    if (!tx) throw new Error("No writable characteristic found (set txCharacteristicUUID)");
    if (!rx) throw new Error("No notifiable/indicatable characteristic found (set rxCharacteristicUUID)");

    const conn: BLEConn = { device, server, service, tx, rx };
    this.connections.set(id, conn);

    await rx.startNotifications();
    rx.addEventListener("characteristicvaluechanged", (ev: Event) => {
      const ch = ev.target as BluetoothRemoteGATTCharacteristic;
      const dv = ch.value as DataView;
      const bytes = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      this.emit("data", { from: id, bytes });
    });

    device.addEventListener("gattserverdisconnected", () => {
      this.emit("deviceDisconnected", { id });
    });

    this.emit("deviceConnected", { id });
  }

  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    try { conn.server.disconnect(); } catch {}
    this.connections.delete(id);
    this.emit("deviceDisconnected", { id });
  }

  async send(toId: string, bytes: Uint8Array): Promise<void> {
    await this.ensureConnected(toId);
    const conn = this.connections.get(toId);
    if (!conn || !conn.tx) throw new Error("Target not connected or TX characteristic missing");
    const tx = conn.tx as any;
    const props = tx.properties as any;
    if (props.writeWithoutResponse && tx.writeValueWithoutResponse) {
      await tx.writeValueWithoutResponse(bytes);
    } else {
      await tx.writeValue(bytes);
    }
  }

  on(event: any, listener: any): void {
    const set = this.listeners.get(event) || new Set();
    set.add(listener);
    this.listeners.set(event, set);
    this.bus.on(event as any, listener as any);
  }

  off(event: any, listener: any): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: any, payload: any) {
    this.bus.emit(event as any, payload);
  }
}

export default WebBluetoothAdapter;