// src/adapters/mock.ts
var MockAdapter = class {
  constructor() {
    this.bus = new EventBus();
    this.listeners = /* @__PURE__ */ new Map();
    this.knownDevices = [
      { id: "mock-1", name: "Mock Device 1" },
      { id: "mock-2", name: "Mock Device 2" }
    ];
    this.connected = /* @__PURE__ */ new Set();
  }
  async startScan() {
    for (const d of this.knownDevices) {
      setTimeout(() => {
        this.emit("deviceFound", { id: d.id, name: d.name });
        this.emit("heartbeat", { id: d.id });
      }, 200);
    }
    setTimeout(() => {
      this.emit("topology", { edges: [["mock-1", "mock-2"]] });
    }, 500);
  }
  async connect(id) {
    if (!this.knownDevices.find((d) => d.id === id))
      throw new Error("Device not found");
    this.connected.add(id);
    this.emit("deviceConnected", { id });
  }
  async disconnect(id) {
    this.connected.delete(id);
    this.emit("deviceDisconnected", { id });
  }
  async send(toId, bytes) {
    if (!this.connected.has(toId))
      throw new Error("Target not connected");
    setTimeout(() => {
      this.emit("data", { from: toId, bytes });
    }, 100);
  }
  on(event, listener) {
    const set = this.listeners.get(event) || /* @__PURE__ */ new Set();
    set.add(listener);
    this.listeners.set(event, set);
    this.bus.on(event, listener);
  }
  off(event, listener) {
    const set = this.listeners.get(event);
    if (set)
      set.delete(listener);
  }
  emit(event, payload) {
    this.bus.emit(event, payload);
  }
};

// src/adapters/webbluetooth.ts
var WebBluetoothAdapter = class {
  constructor(options = { acceptAllDevices: true }) {
    this.options = options;
    this.bus = new EventBus();
    this.listeners = /* @__PURE__ */ new Map();
    this.knownDevices = /* @__PURE__ */ new Map();
    this.connections = /* @__PURE__ */ new Map();
  }
  async startScan() {
    const bt = navigator.bluetooth;
    if (!bt) {
      throw new Error("WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.");
    }
    if (bt.getDevices) {
      try {
        const allowed = await bt.getDevices();
        for (const d of allowed) {
          this.knownDevices.set(d.id, d);
          this.emit("deviceFound", { id: d.id, name: d.name ?? void 0 });
          this.emit("heartbeat", { id: d.id });
          try {
            await this.connect(d.id);
          } catch {
          }
        }
      } catch {
      }
    }
    let device = null;
    const { serviceUUID, optionalServices, acceptAllDevices } = this.options;
    try {
      if (serviceUUID) {
        device = await bt.requestDevice({
          filters: [{ services: [serviceUUID] }],
          optionalServices: optionalServices ?? [serviceUUID]
        });
      } else {
        device = await bt.requestDevice({
          acceptAllDevices: acceptAllDevices ?? true,
          optionalServices: optionalServices ?? []
        });
      }
    } catch {
    }
    if (device) {
      this.knownDevices.set(device.id, device);
      this.emit("deviceFound", { id: device.id, name: device.name ?? void 0 });
      this.emit("heartbeat", { id: device.id });
      try {
        await this.connect(device.id);
      } catch {
      }
    }
    if (bt.requestLEScan) {
      try {
        const scan = await bt.requestLEScan({
          keepRepeatedDevices: true
        });
        navigator.bluetooth.addEventListener("advertisementreceived", (ev) => {
          const dev = ev.device;
          if (!dev || !dev.id)
            return;
          if (!this.knownDevices.has(dev.id)) {
            this.knownDevices.set(dev.id, dev);
            this.emit("deviceFound", { id: dev.id, name: dev.name ?? void 0 });
          }
          this.emit("heartbeat", { id: dev.id });
        });
      } catch {
      }
    }
  }
  async resolveTxRx(server) {
    const { serviceUUID, txCharacteristicUUID, rxCharacteristicUUID } = this.options;
    let service;
    let tx;
    let rx;
    if (serviceUUID) {
      try {
        service = await server.getPrimaryService(serviceUUID);
        if (txCharacteristicUUID) {
          try {
            tx = await service.getCharacteristic(txCharacteristicUUID);
          } catch {
          }
        }
        if (rxCharacteristicUUID) {
          try {
            rx = await service.getCharacteristic(rxCharacteristicUUID);
          } catch {
          }
        }
      } catch {
      }
    }
    if (!tx || !rx) {
      try {
        const services = await server.getPrimaryServices();
        let foundTx;
        let foundRx;
        let txService;
        for (const s of services) {
          const chars = await s.getCharacteristics();
          for (const c of chars) {
            const props = c.properties;
            if (!foundTx && (props.write || props.writeWithoutResponse)) {
              foundTx = c;
              txService = s;
            }
            if (!foundRx && (props.notify || props.indicate)) {
              foundRx = c;
            }
            if (foundTx && foundRx)
              break;
          }
          if (foundTx && foundRx)
            break;
        }
        tx = tx ?? foundTx;
        rx = rx ?? foundRx;
        service = service ?? txService;
      } catch (e) {
        throw new Error("Unable to discover GATT services/characteristics. Provide service/characteristic UUIDs in adapter options.");
      }
    }
    return { service, tx, rx };
  }
  async ensureConnected(id) {
    const existing = this.connections.get(id);
    if (!existing || !existing.server?.connected) {
      await this.connect(id);
      return;
    }
    if (!existing.tx || !existing.rx) {
      const resolved = await this.resolveTxRx(existing.server);
      if (resolved.service)
        existing.service = resolved.service;
      if (resolved.tx)
        existing.tx = resolved.tx;
      if (resolved.rx)
        existing.rx = resolved.rx;
      this.connections.set(id, existing);
    }
  }
  async connect(id) {
    let device = this.knownDevices.get(id);
    const bt = navigator.bluetooth;
    if (!device && bt?.getDevices) {
      const allowed = await bt.getDevices();
      const match = allowed.find((d) => d.id === id);
      if (match) {
        device = match;
        this.knownDevices.set(id, match);
      }
    }
    if (!device)
      throw new Error("Device not found or not granted by user");
    const server = await device.gatt.connect();
    const { service, tx, rx } = await this.resolveTxRx(server);
    if (!tx)
      throw new Error("No writable characteristic found (set txCharacteristicUUID)");
    if (!rx)
      throw new Error("No notifiable/indicatable characteristic found (set rxCharacteristicUUID)");
    const conn = { device, server, service, tx, rx };
    this.connections.set(id, conn);
    await rx.startNotifications();
    rx.addEventListener("characteristicvaluechanged", (ev) => {
      const ch = ev.target;
      const dv = ch.value;
      const bytes = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      this.emit("data", { from: id, bytes });
    });
    device.addEventListener("gattserverdisconnected", () => {
      this.emit("deviceDisconnected", { id });
    });
    this.emit("deviceConnected", { id });
  }
  async disconnect(id) {
    const conn = this.connections.get(id);
    if (!conn)
      return;
    try {
      conn.server.disconnect();
    } catch {
    }
    this.connections.delete(id);
    this.emit("deviceDisconnected", { id });
  }
  async send(toId, bytes) {
    await this.ensureConnected(toId);
    const conn = this.connections.get(toId);
    if (!conn || !conn.tx)
      throw new Error("Target not connected or TX characteristic missing");
    const tx = conn.tx;
    const props = tx.properties;
    if (props.writeWithoutResponse && tx.writeValueWithoutResponse) {
      await tx.writeValueWithoutResponse(bytes);
    } else {
      await tx.writeValue(bytes);
    }
  }
  on(event, listener) {
    const set = this.listeners.get(event) || /* @__PURE__ */ new Set();
    set.add(listener);
    this.listeners.set(event, set);
    this.bus.on(event, listener);
  }
  off(event, listener) {
    const set = this.listeners.get(event);
    if (set)
      set.delete(listener);
  }
  emit(event, payload) {
    this.bus.emit(event, payload);
  }
};

// src/index.ts
var EventBus = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, listener) {
    const set = this.listeners.get(event) || /* @__PURE__ */ new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event, listener) {
    const set = this.listeners.get(event);
    if (set)
      set.delete(listener);
  }
  emit(event, e) {
    const set = this.listeners.get(event);
    if (!set)
      return;
    for (const l of set)
      l(e);
  }
};
var Topology = class {
  constructor() {
    this.nodes = /* @__PURE__ */ new Map();
    this.edges = /* @__PURE__ */ new Set();
  }
  // key as `${a}|${b}` sorted
  addNode(id, label) {
    const n = this.nodes.get(id) || { id, label, neighbors: /* @__PURE__ */ new Set(), lastSeen: Date.now(), online: true };
    n.label = label ?? n.label;
    n.online = true;
    n.lastSeen = Date.now();
    this.nodes.set(id, n);
    return n;
  }
  setOffline(id) {
    const n = this.nodes.get(id);
    if (n)
      n.online = false;
  }
  link(a, b) {
    if (a === b)
      return;
    const key = [a, b].sort().join("|");
    this.edges.add(key);
    this.addNode(a).neighbors.add(b);
    this.addNode(b).neighbors.add(a);
  }
  unlink(a, b) {
    const key = [a, b].sort().join("|");
    this.edges.delete(key);
    this.nodes.get(a)?.neighbors.delete(b);
    this.nodes.get(b)?.neighbors.delete(a);
  }
  snapshot() {
    return {
      nodes: Array.from(this.nodes.values()).map((n) => ({ id: n.id, label: n.label, online: n.online, lastSeen: n.lastSeen, neighbors: Array.from(n.neighbors) })),
      edges: Array.from(this.edges).map((k) => {
        const [a, b] = k.split("|");
        return [a, b];
      })
    };
  }
};
var MessageRouter = class {
  constructor(sendLowLevel) {
    this.sendLowLevel = sendLowLevel;
    this.pending = /* @__PURE__ */ new Map();
    this.seqMap = /* @__PURE__ */ new Map();
  }
  nextSeq(toId) {
    const s = (this.seqMap.get(toId) || 0) + 1;
    this.seqMap.set(toId, s);
    return s;
  }
  async sendReliable(toId, payload, onTimeout) {
    const msg = { id: crypto.randomUUID(), from: "local", to: toId, payload, timestamp: Date.now(), seq: this.nextSeq(toId), hops: [] };
    const bytes = this.encode(msg);
    await this.sendLowLevel(toId, bytes);
    this.track(msg, onTimeout);
    return msg;
  }
  track(msg, onTimeout) {
    const key = msg.id;
    const entry = { msg, attempts: 1 };
    const schedule = () => {
      entry.timer = setTimeout(async () => {
        if (entry.attempts >= 3) {
          this.pending.delete(key);
          onTimeout(key);
          return;
        }
        entry.attempts++;
        await this.sendLowLevel(msg.to, this.encode(msg));
        schedule();
      }, 2e3);
    };
    schedule();
    this.pending.set(key, entry);
  }
  ack(id) {
    const p = this.pending.get(id);
    if (!p)
      return;
    clearTimeout(p.timer);
    this.pending.delete(id);
  }
  encode(m) {
    return new TextEncoder().encode(JSON.stringify(m));
  }
  decode(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
};
var MeshNetwork = class {
  constructor(adapter, localId = `local-${Math.random().toString(36).slice(2)}`) {
    this.adapter = adapter;
    this.localId = localId;
    this.topology = new Topology();
    this.events = new EventBus();
    this.router = new MessageRouter((to, bytes) => this.adapter.send(to, bytes));
    this.bindAdapter();
  }
  bindAdapter() {
    this.adapter.on("deviceFound", ({ id, name }) => {
      this.topology.addNode(id, name);
      this.emitState();
    });
    this.adapter.on("deviceConnected", ({ id }) => {
      this.topology.addNode(id);
      this.topology.link(this.localId, id);
      this.emitState();
    });
    this.adapter.on("deviceDisconnected", ({ id }) => {
      this.topology.setOffline(id);
      this.topology.unlink(this.localId, id);
      this.emitState();
    });
    this.adapter.on("heartbeat", ({ id }) => {
      this.topology.addNode(id);
      this.emitState();
    });
    this.adapter.on("topology", ({ edges }) => {
      for (const [a, b] of edges)
        this.topology.link(a, b);
      this.emitState();
    });
    this.adapter.on("data", ({ from, bytes }) => {
      const msg = this.router.decode(bytes);
      if (msg.ack) {
        this.router.ack(msg.id);
        return;
      }
      msg.hops = [...msg.hops || [], from];
      this.events.emit("message", msg);
      const ack = { id: msg.id, from: this.localId, to: from, payload: { type: "ACK", data: null }, timestamp: Date.now(), seq: 0, ack: true };
      this.adapter.send(from, this.router.encode(ack));
    });
  }
  async start() {
    await this.adapter.startScan();
  }
  async connect(id) {
    await this.adapter.connect(id);
  }
  async disconnect(id) {
    await this.adapter.disconnect(id);
  }
  async send(toId, payload, onTimeout) {
    return this.router.sendReliable(toId, payload, (id) => {
      if (onTimeout)
        onTimeout(id);
    });
  }
  stateSnapshot() {
    return this.topology.snapshot();
  }
  emitState() {
    const s = this.stateSnapshot();
    this.events.emit("state", { nodes: s.nodes, edges: s.edges });
  }
};
export {
  EventBus,
  MeshNetwork,
  MessageRouter,
  MockAdapter,
  Topology,
  WebBluetoothAdapter
};
//# sourceMappingURL=index.js.map