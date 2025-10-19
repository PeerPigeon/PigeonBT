import { EventBus } from "../index";
import type { MeshAdapter } from "../index";

export class MockAdapter implements MeshAdapter {
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
  private knownDevices = [
    { id: "mock-1", name: "Mock Device 1", rssi: -45 },
    { id: "mock-2", name: "Mock Device 2", rssi: -62 },
    { id: "mock-3", name: "Arduino BLE", rssi: -78 },
    { id: "mock-4", name: "ESP32-Scanner", rssi: -55 }
  ];
  private connected = new Set<string>();
  private scanning = false;

  async startScan(): Promise<void> {
    this.scanning = true;
    this.emit("scanStarted", {});
    
    // Simulate discovery with varying RSSI
    for (let i = 0; i < this.knownDevices.length; i++) {
      const d = this.knownDevices[i];
      setTimeout(() => {
        if (this.scanning) {
          // Add some RSSI variation
          const rssiVariation = Math.floor(Math.random() * 10) - 5;
          this.emit("deviceFound", { 
            id: d.id, 
            name: d.name, 
            rssi: d.rssi + rssiVariation,
            discovered: true 
          });
          this.emit("heartbeat", { id: d.id });
        }
      }, 200 + i * 300);
    }
    
    // Simulate topology info between discovered devices
    setTimeout(() => {
      if (this.scanning) {
        this.emit("topology", { edges: [["mock-1", "mock-2"], ["mock-3", "mock-4"]] });
      }
    }, 1500);
  }

  stopScan(): void {
    this.scanning = false;
    this.emit("scanStopped", {});
  }

  getDiscoveredDevices() {
    return this.knownDevices.map(d => ({
      id: d.id,
      name: d.name,
      rssi: d.rssi + Math.floor(Math.random() * 6) - 3, // Small RSSI variation
      lastSeen: Date.now() - Math.floor(Math.random() * 30000), // Random last seen within 30s
      connected: this.connected.has(d.id)
    }));
  }

  async connect(id: string): Promise<void> {
    if (!this.knownDevices.find(d => d.id === id)) throw new Error("Device not found");
    this.connected.add(id);
    this.emit("deviceConnected", { id });
  }

  async disconnect(id: string): Promise<void> {
    this.connected.delete(id);
    this.emit("deviceDisconnected", { id });
  }

  async send(toId: string, bytes: Uint8Array): Promise<void> {
    // Loopback simulation: emit data as if it came from the target device
    if (!this.connected.has(toId)) throw new Error("Target not connected");
    setTimeout(() => {
      this.emit("data", { from: toId, bytes });
    }, 100);
  }

  on<K extends keyof any>(event: any, listener: any): void {
    const set = this.listeners.get(event) || new Set();
    set.add(listener);
    this.listeners.set(event, set);
    // Bridge to internal bus
    this.bus.on(event as any, listener as any);
  }

  off<K extends keyof any>(event: any, listener: any): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit(event: any, payload: any) {
    this.bus.emit(event as any, payload);
  }
}

export default MockAdapter;