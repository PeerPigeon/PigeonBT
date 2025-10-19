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
  autoDiscovery?: boolean;
  scanDuration?: number; // in seconds
  rssiThreshold?: number; // minimum RSSI to consider device
  nameFilters?: string[]; // device name patterns to include
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
    deviceFound: { id: string; name?: string; rssi?: number; discovered?: boolean };
    deviceConnected: { id: string };
    deviceDisconnected: { id: string };
    data: { from: string; bytes: Uint8Array };
    heartbeat: { id: string };
    topology: { edges: Array<[string, string]> };
    scanStarted: {};
    scanStopped: {};
  }>();

  private listeners: Map<string, Set<(e: any) => void>> = new Map();
  private knownDevices: Map<string, BluetoothDevice> = new Map();
  private discoveredDevices: Map<string, { device: BluetoothDevice; rssi?: number; lastSeen: number }> = new Map();
  private connections: Map<string, BLEConn> = new Map();
  private scanController: AbortController | null = null;
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(private options: WebBluetoothOptions = { acceptAllDevices: true, autoDiscovery: true, scanDuration: 30 }) {}

  async startScan(): Promise<void> {
    const bt = (navigator as any).bluetooth;
    if (!bt) {
      throw new Error("WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.");
    }

    this.emit("scanStarted", {});

    // 1) Auto-connect previously authorized devices (zero interaction)
    if (bt.getDevices) {
      try {
        const allowed: BluetoothDevice[] = await bt.getDevices();
        for (const d of allowed) {
          this.knownDevices.set(d.id, d);
          this.emit("deviceFound", { id: d.id, name: d.name ?? undefined, discovered: false });
          this.emit("heartbeat", { id: d.id });
          try { await this.connect(d.id); } catch {/* ignore single connect error */}
        }
      } catch {/* ignore */}
    }

    // 2) Try experimental continuous scanning first, then fall back to manual selection
    let scanSuccessful = false;
    if (this.options.autoDiscovery) {
      scanSuccessful = await this.tryExperimentalScanning();
    }

    // 3) If experimental scanning failed or is disabled, use manual device selection
    if (!scanSuccessful) {
      console.log("Falling back to manual device selection...");
      await this.promptDeviceSelection();
    }
  }

  private async tryExperimentalScanning(): Promise<boolean> {
    const bt = (navigator as any).bluetooth;
    if (!bt.requestLEScan) {
      console.warn("requestLEScan not available - falling back to manual selection");
      return false;
    }

    try {
      // Stop any existing scan
      if (this.scanController) {
        this.scanController.abort();
      }
      
      this.scanController = new AbortController();
      
      const scanOptions: any = {
        keepRepeatedDevices: true,
        acceptAllAdvertisements: true
      };

      // Add service filters if specified
      if (this.options.serviceUUID) {
        scanOptions.filters = [{ services: [this.options.serviceUUID] }];
        scanOptions.acceptAllAdvertisements = false;
      }

      console.log("Starting experimental BLE scanning...", scanOptions);
      const scan = await bt.requestLEScan(scanOptions);
      
      const advertisementHandler = (ev: any) => {
        const device = ev.device as BluetoothDevice;
        const rssi = ev.rssi as number;
        
        if (!device || !device.id) return;
        
        console.log(`Discovered device: ${device.name || device.id} (${rssi}dBm)`);
        
        // Apply RSSI filtering if threshold is set
        if (this.options.rssiThreshold !== undefined && rssi < this.options.rssiThreshold) {
          return;
        }
        
        // Apply name filtering if patterns are set
        if (this.options.nameFilters && this.options.nameFilters.length > 0) {
          const deviceName = device.name?.toLowerCase() || '';
          const matchesFilter = this.options.nameFilters.some(filter => 
            deviceName.includes(filter.toLowerCase())
          );
          if (!matchesFilter) return;
        }
        
        // Store or update discovered device
        const existing = this.discoveredDevices.get(device.id);
        this.discoveredDevices.set(device.id, {
          device,
          rssi,
          lastSeen: Date.now()
        });
        
        // Emit device found event only for new discoveries or significant RSSI changes
        if (!existing || Math.abs((existing.rssi || 0) - rssi) > 10) {
          this.emit("deviceFound", { 
            id: device.id, 
            name: device.name ?? undefined, 
            rssi,
            discovered: true 
          });
        }
        
        this.emit("heartbeat", { id: device.id });
      };

      bt.addEventListener("advertisementreceived", advertisementHandler, {
        signal: this.scanController.signal
      });

      // Set scan duration if specified
      if (this.options.scanDuration && this.options.scanDuration > 0) {
        this.scanTimer = setTimeout(() => {
          this.stopScan();
        }, this.options.scanDuration * 1000);
      }

      console.log("Experimental BLE scanning started successfully");
      return true;

    } catch (error) {
      console.warn("Experimental scanning failed:", error);
      this.stopScan();
      return false;
    }
  }

  private async promptDeviceSelection(): Promise<void> {
    const bt = (navigator as any).bluetooth;
    let device: BluetoothDevice | null = null;
    const { serviceUUID, optionalServices, acceptAllDevices } = this.options;

    try {
      console.log("Prompting user for device selection...");
      
      if (serviceUUID) {
        console.log(`Looking for devices with service: ${serviceUUID}`);
        device = await bt.requestDevice({
          filters: [{ services: [serviceUUID] }],
          optionalServices: optionalServices ?? [serviceUUID],
        });
      } else {
        console.log("Looking for any available devices...");
        device = await bt.requestDevice({
          acceptAllDevices: acceptAllDevices ?? true,
          optionalServices: optionalServices ?? [],
        });
      }
    } catch (error: any) {
      console.log("User cancelled device selection or no devices available:", error.message);
      this.emit("scanStopped", {});
      return;
    }

    if (device) {
      console.log(`User selected device: ${device.name || device.id}`);
      this.knownDevices.set(device.id, device);
      this.emit("deviceFound", { id: device.id, name: device.name ?? undefined, discovered: false });
      this.emit("heartbeat", { id: device.id });
      // auto-connect newly authorized device
      try { 
        await this.connect(device.id); 
        console.log(`Successfully connected to ${device.name || device.id}`);
      } catch (error) {
        console.error("Failed to connect to selected device:", error);
      }
    }
    
    this.emit("scanStopped", {});
  }

  stopScan(): void {
    console.log("Stopping BLE scan...");
    
    if (this.scanController) {
      this.scanController.abort();
      this.scanController = null;
    }
    
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    
    this.emit("scanStopped", {});
    console.log("BLE scan stopped");
  }

  // Get discovered devices with their signal strength and last seen info
  getDiscoveredDevices(): Array<{ id: string; name?: string; rssi?: number; lastSeen: number; connected: boolean }> {
    return Array.from(this.discoveredDevices.entries()).map(([id, info]) => ({
      id,
      name: info.device.name || undefined,
      rssi: info.rssi,
      lastSeen: info.lastSeen,
      connected: this.connections.has(id)
    }));
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
    let device = this.knownDevices.get(id) || this.discoveredDevices.get(id)?.device;

    const bt = (navigator as any).bluetooth;
    if (!device && bt?.getDevices) {
      const allowed: BluetoothDevice[] = await bt.getDevices();
      const match = allowed.find((d: BluetoothDevice) => d.id === id);
      if (match) {
        device = match;
        this.knownDevices.set(id, match);
      }
    }

    // If device was discovered but not authorized, we need to request permission
    if (!device && this.discoveredDevices.has(id)) {
      try {
        const discoveredInfo = this.discoveredDevices.get(id)!;
        // Try to connect to the discovered device by requesting it specifically
        if (this.options.serviceUUID) {
          device = await bt.requestDevice({
            filters: [{ services: [this.options.serviceUUID] }],
            optionalServices: this.options.optionalServices ?? [this.options.serviceUUID],
          });
        } else {
          // For discovered devices, we might need to use name filtering
          const deviceName = discoveredInfo.device.name;
          if (deviceName) {
            device = await bt.requestDevice({
              filters: [{ name: deviceName }],
              optionalServices: this.options.optionalServices ?? [],
            });
          } else {
            device = await bt.requestDevice({
              acceptAllDevices: true,
              optionalServices: this.options.optionalServices ?? [],
            });
          }
        }
        if (device) {
          this.knownDevices.set(id, device);
        }
      } catch (error) {
        throw new Error(`Failed to authorize discovered device: ${error}`);
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