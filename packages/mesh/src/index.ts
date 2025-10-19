export type MeshNode = { id: string; label?: string; neighbors: Set<string>; lastSeen: number; online: boolean; rssi?: number; discovered?: boolean };
export type MeshPayload = { type: string; data: unknown };
export type MeshMessage = { id: string; from: string; to?: string; payload: MeshPayload; timestamp: number; seq: number; ack?: boolean; hops?: string[] };

export interface AdapterEventMap {
  deviceFound: { id: string; name?: string; rssi?: number; discovered?: boolean };
  deviceConnected: { id: string };
  deviceDisconnected: { id: string };
  data: { from: string; bytes: Uint8Array };
  heartbeat: { id: string };
  topology: { edges: Array<[string, string]> };
  scanStarted: {};
  scanStopped: {};
}

export type AdapterListener<K extends keyof AdapterEventMap> = (event: AdapterEventMap[K]) => void;

export interface MeshAdapter {
  startScan(): Promise<void>;
  stopScan?(): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  send(toId: string, bytes: Uint8Array): Promise<void>;
  getDiscoveredDevices?(): Array<{ id: string; name?: string; rssi?: number; lastSeen: number; connected: boolean }>;
  on<K extends keyof AdapterEventMap>(event: K, listener: AdapterListener<K>): void;
  off<K extends keyof AdapterEventMap>(event: K, listener: AdapterListener<K>): void;
}

export class EventBus<T extends Record<string, any>> {
  private listeners: Map<keyof T, Set<(e: any) => void>> = new Map();
  on<K extends keyof T>(event: K, listener: (e: T[K]) => void) {
    const set = this.listeners.get(event) || new Set();
    set.add(listener as any);
    this.listeners.set(event, set);
  }
  off<K extends keyof T>(event: K, listener: (e: T[K]) => void) {
    const set = this.listeners.get(event);
    if (set) set.delete(listener as any);
  }
  emit<K extends keyof T>(event: K, e: T[K]) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach(l => (l as any)(e));
  }
}

export class Topology {
  nodes: Map<string, MeshNode> = new Map();
  edges: Set<string> = new Set(); // key as `${a}|${b}` sorted
  addNode(id: string, label?: string, rssi?: number, discovered?: boolean) {
    const n = this.nodes.get(id) || { id, label, neighbors: new Set<string>(), lastSeen: Date.now(), online: true, rssi, discovered };
    n.label = label ?? n.label;
    n.online = true;
    n.lastSeen = Date.now();
    if (rssi !== undefined) n.rssi = rssi;
    if (discovered !== undefined) n.discovered = discovered;
    this.nodes.set(id, n);
    return n;
  }
  setOffline(id: string) {
    const n = this.nodes.get(id);
    if (n) n.online = false;
  }
  link(a: string, b: string) {
    if (a === b) return;
    const key = [a, b].sort().join("|");
    this.edges.add(key);
    this.addNode(a).neighbors.add(b);
    this.addNode(b).neighbors.add(a);
  }
  unlink(a: string, b: string) {
    const key = [a, b].sort().join("|");
    this.edges.delete(key);
    this.nodes.get(a)?.neighbors.delete(b);
    this.nodes.get(b)?.neighbors.delete(a);
  }
  snapshot() {
    return {
      nodes: Array.from(this.nodes.values()).map(n => ({ 
        id: n.id, 
        label: n.label, 
        online: n.online, 
        lastSeen: n.lastSeen, 
        neighbors: Array.from(n.neighbors),
        rssi: n.rssi,
        discovered: n.discovered
      })),
      edges: Array.from(this.edges).map(k => { const [a,b] = k.split("|"); return [a,b] as [string,string]; })
    };
  }
}

export class MessageRouter {
  private pending = new Map<string, { msg: MeshMessage; attempts: number; timer?: any }>();
  private seqMap = new Map<string, number>();
  constructor(private sendLowLevel: (toId: string, bytes: Uint8Array) => Promise<void>) {}
  private nextSeq(toId: string) { const s = (this.seqMap.get(toId) || 0) + 1; this.seqMap.set(toId, s); return s; }
  async sendReliable(toId: string, payload: MeshPayload, onTimeout: (id: string) => void) {
    const msg: MeshMessage = { id: crypto.randomUUID(), from: "local", to: toId, payload, timestamp: Date.now(), seq: this.nextSeq(toId), hops: [] };
    const bytes = this.encode(msg);
    await this.sendLowLevel(toId, bytes);
    this.track(msg, onTimeout);
    return msg;
  }
  track(msg: MeshMessage, onTimeout: (id: string) => void) {
    const key = msg.id;
    const entry = { msg, attempts: 1 } as { msg: MeshMessage; attempts: number; timer?: any };
    const schedule = () => {
      entry.timer = setTimeout(async () => {
        if (entry.attempts >= 3) { this.pending.delete(key); onTimeout(key); return; }
        entry.attempts++;
        await this.sendLowLevel(msg.to!, this.encode(msg));
        schedule();
      }, 2000);
    };
    schedule();
    this.pending.set(key, entry);
  }
  ack(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
  }
  encode(m: MeshMessage) { return new TextEncoder().encode(JSON.stringify(m)); }
  decode(bytes: Uint8Array): MeshMessage { return JSON.parse(new TextDecoder().decode(bytes)); }
}

export class MeshNetwork {
  readonly topology = new Topology();
  readonly events = new EventBus<{ 
    message: MeshMessage; 
    state: { nodes: ReturnType<Topology['snapshot']>['nodes']; edges: ReturnType<Topology['snapshot']>['edges'] };
    scanStarted: {};
    scanStopped: {};
  }>();
  private router: MessageRouter;
  constructor(private adapter: MeshAdapter, private localId: string = `local-${Math.random().toString(36).slice(2)}`) {
    this.router = new MessageRouter((to, bytes) => this.adapter.send(to, bytes));
    this.bindAdapter();
  }
  private bindAdapter() {
    this.adapter.on('deviceFound', ({ id, name, rssi, discovered }) => { 
      this.topology.addNode(id, name, rssi, discovered); 
      this.emitState(); 
    });
    this.adapter.on('deviceConnected', ({ id }) => { this.topology.addNode(id); this.topology.link(this.localId, id); this.emitState(); });
    this.adapter.on('deviceDisconnected', ({ id }) => { this.topology.setOffline(id); this.topology.unlink(this.localId, id); this.emitState(); });
    this.adapter.on('heartbeat', ({ id }) => { this.topology.addNode(id); this.emitState(); });
    this.adapter.on('topology', ({ edges }) => { for (const [a,b] of edges) this.topology.link(a,b); this.emitState(); });
    // Forward scan events
    if (this.adapter.on) {
      this.adapter.on('scanStarted', (e) => this.events.emit('scanStarted' as any, e));
      this.adapter.on('scanStopped', (e) => this.events.emit('scanStopped' as any, e));
    }
    this.adapter.on('data', ({ from, bytes }) => {
      const msg = this.router.decode(bytes);
      if (msg.ack) { this.router.ack(msg.id); return; }
      // emit message
      msg.hops = [...(msg.hops || []), from];
      this.events.emit('message', msg);
      // send ack
      const ack: MeshMessage = { id: msg.id, from: this.localId, to: from, payload: { type: 'ACK', data: null }, timestamp: Date.now(), seq: 0, ack: true };
      this.adapter.send(from, this.router.encode(ack));
    });
  }
  async start() { await this.adapter.startScan(); }
  async stop() { if (this.adapter.stopScan) this.adapter.stopScan(); }
  async connect(id: string) { await this.adapter.connect(id); }
  async disconnect(id: string) { await this.adapter.disconnect(id); }
  async send(toId: string, payload: MeshPayload, onTimeout?: (id: string) => void) {
    return this.router.sendReliable(toId, payload, id => { if (onTimeout) onTimeout(id); });
  }
  getDiscoveredDevices() { 
    return this.adapter.getDiscoveredDevices ? this.adapter.getDiscoveredDevices() : []; 
  }
  stateSnapshot() { return this.topology.snapshot(); }
  private emitState() { const s = this.stateSnapshot(); this.events.emit('state', { nodes: s.nodes, edges: s.edges }); }
}

export { MockAdapter } from './adapters/mock'
export { WebBluetoothAdapter } from './adapters/webbluetooth'