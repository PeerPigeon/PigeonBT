import { EventBus } from "../index";
import type { MeshAdapter } from "../index";

export class MockAdapter implements MeshAdapter {
  private bus = new EventBus<{
    deviceFound: { id: string; name?: string };
    deviceConnected: { id: string };
    deviceDisconnected: { id: string };
    data: { from: string; bytes: Uint8Array };
    heartbeat: { id: string };
    topology: { edges: Array<[string, string]> };
  }>();

  private listeners: Map<string, Set<(e: any) => void>> = new Map();
  private knownDevices = [
    { id: "mock-1", name: "Mock Device 1" },
    { id: "mock-2", name: "Mock Device 2" }
  ];
  private connected = new Set<string>();

  async startScan(): Promise<void> {
    // Simulate discovery
    for (const d of this.knownDevices) {
      setTimeout(() => {
        this.emit("deviceFound", { id: d.id, name: d.name });
        this.emit("heartbeat", { id: d.id });
      }, 200);
    }
    // Simulate topology info between discovered devices
    setTimeout(() => {
      this.emit("topology", { edges: [["mock-1", "mock-2"]] });
    }, 500);
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