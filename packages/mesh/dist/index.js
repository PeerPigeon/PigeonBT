// src/adapters/mock.ts
var MockAdapter = class {
  constructor() {
    this.bus = new EventBus();
    this.listeners = /* @__PURE__ */ new Map();
    this.knownDevices = [
      { id: "mock-1", name: "Mock Device 1", rssi: -45 },
      { id: "mock-2", name: "Mock Device 2", rssi: -62 },
      { id: "mock-3", name: "Arduino BLE", rssi: -78 },
      { id: "mock-4", name: "ESP32-Scanner", rssi: -55 }
    ];
    this.connected = /* @__PURE__ */ new Set();
    this.scanning = false;
  }
  async startScan() {
    this.scanning = true;
    this.emit("scanStarted", {});
    for (let i = 0; i < this.knownDevices.length; i++) {
      const d = this.knownDevices[i];
      setTimeout(() => {
        if (this.scanning) {
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
    setTimeout(() => {
      if (this.scanning) {
        this.emit("topology", { edges: [["mock-1", "mock-2"], ["mock-3", "mock-4"]] });
      }
    }, 1500);
  }
  stopScan() {
    this.scanning = false;
    this.emit("scanStopped", {});
  }
  getDiscoveredDevices() {
    return this.knownDevices.map((d) => ({
      id: d.id,
      name: d.name,
      rssi: d.rssi + Math.floor(Math.random() * 6) - 3,
      // Small RSSI variation
      lastSeen: Date.now() - Math.floor(Math.random() * 3e4),
      // Random last seen within 30s
      connected: this.connected.has(d.id)
    }));
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
  constructor(options = { acceptAllDevices: true, autoDiscovery: true, scanDuration: 30 }) {
    this.options = options;
    this.bus = new EventBus();
    this.listeners = /* @__PURE__ */ new Map();
    this.knownDevices = /* @__PURE__ */ new Map();
    this.discoveredDevices = /* @__PURE__ */ new Map();
    this.connections = /* @__PURE__ */ new Map();
    this.scanController = null;
    this.scanTimer = null;
  }
  async startScan() {
    const bt = navigator.bluetooth;
    if (!bt) {
      throw new Error("WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.");
    }
    this.emit("scanStarted", {});
    if (bt.getDevices) {
      try {
        const allowed = await bt.getDevices();
        for (const d of allowed) {
          this.knownDevices.set(d.id, d);
          this.emit("deviceFound", { id: d.id, name: d.name ?? void 0, discovered: false });
          this.emit("heartbeat", { id: d.id });
          try {
            await this.connect(d.id);
          } catch {
          }
        }
      } catch {
      }
    }
    let scanSuccessful = false;
    if (this.options.autoDiscovery) {
      scanSuccessful = await this.tryExperimentalScanning();
    }
    if (!scanSuccessful) {
      console.log("Falling back to manual device selection...");
      await this.promptDeviceSelection();
    }
  }
  async tryExperimentalScanning() {
    const bt = navigator.bluetooth;
    if (!bt.requestLEScan) {
      console.warn("requestLEScan not available - falling back to manual selection");
      return false;
    }
    try {
      if (this.scanController) {
        this.scanController.abort();
      }
      this.scanController = new AbortController();
      const scanOptions = {
        keepRepeatedDevices: true,
        acceptAllAdvertisements: true
      };
      if (this.options.serviceUUID) {
        scanOptions.filters = [{ services: [this.options.serviceUUID] }];
        scanOptions.acceptAllAdvertisements = false;
      }
      console.log("Starting experimental BLE scanning...", scanOptions);
      const scan = await bt.requestLEScan(scanOptions);
      const advertisementHandler = (ev) => {
        const device = ev.device;
        const rssi = ev.rssi;
        if (!device || !device.id)
          return;
        console.log(`Discovered device: ${device.name || device.id} (${rssi}dBm)`);
        if (this.options.rssiThreshold !== void 0 && rssi < this.options.rssiThreshold) {
          return;
        }
        if (this.options.nameFilters && this.options.nameFilters.length > 0) {
          const deviceName = device.name?.toLowerCase() || "";
          const matchesFilter = this.options.nameFilters.some(
            (filter) => deviceName.includes(filter.toLowerCase())
          );
          if (!matchesFilter)
            return;
        }
        const existing = this.discoveredDevices.get(device.id);
        this.discoveredDevices.set(device.id, {
          device,
          rssi,
          lastSeen: Date.now()
        });
        if (!existing || Math.abs((existing.rssi || 0) - rssi) > 10) {
          this.emit("deviceFound", {
            id: device.id,
            name: device.name ?? void 0,
            rssi,
            discovered: true
          });
        }
        this.emit("heartbeat", { id: device.id });
      };
      bt.addEventListener("advertisementreceived", advertisementHandler, {
        signal: this.scanController.signal
      });
      if (this.options.scanDuration && this.options.scanDuration > 0) {
        this.scanTimer = setTimeout(() => {
          this.stopScan();
        }, this.options.scanDuration * 1e3);
      }
      console.log("Experimental BLE scanning started successfully");
      return true;
    } catch (error) {
      console.warn("Experimental scanning failed:", error);
      this.stopScan();
      return false;
    }
  }
  async promptDeviceSelection() {
    const bt = navigator.bluetooth;
    let device = null;
    const { serviceUUID, optionalServices, acceptAllDevices } = this.options;
    try {
      console.log("Prompting user for device selection...");
      if (serviceUUID) {
        console.log(`Looking for devices with service: ${serviceUUID}`);
        device = await bt.requestDevice({
          filters: [{ services: [serviceUUID] }],
          optionalServices: optionalServices ?? [serviceUUID]
        });
      } else {
        console.log("Looking for any available devices...");
        device = await bt.requestDevice({
          acceptAllDevices: acceptAllDevices ?? true,
          optionalServices: optionalServices ?? []
        });
      }
    } catch (error) {
      console.log("User cancelled device selection or no devices available:", error.message);
      this.emit("scanStopped", {});
      return;
    }
    if (device) {
      console.log(`User selected device: ${device.name || device.id}`);
      this.knownDevices.set(device.id, device);
      this.emit("deviceFound", { id: device.id, name: device.name ?? void 0, discovered: false });
      this.emit("heartbeat", { id: device.id });
      try {
        await this.connect(device.id);
        console.log(`Successfully connected to ${device.name || device.id}`);
      } catch (error) {
        console.error("Failed to connect to selected device:", error);
      }
    }
    this.emit("scanStopped", {});
  }
  stopScan() {
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
  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.entries()).map(([id, info]) => ({
      id,
      name: info.device.name || void 0,
      rssi: info.rssi,
      lastSeen: info.lastSeen,
      connected: this.connections.has(id)
    }));
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
    let device = this.knownDevices.get(id) || this.discoveredDevices.get(id)?.device;
    const bt = navigator.bluetooth;
    if (!device && bt?.getDevices) {
      const allowed = await bt.getDevices();
      const match = allowed.find((d) => d.id === id);
      if (match) {
        device = match;
        this.knownDevices.set(id, match);
      }
    }
    if (!device && this.discoveredDevices.has(id)) {
      try {
        const discoveredInfo = this.discoveredDevices.get(id);
        if (this.options.serviceUUID) {
          device = await bt.requestDevice({
            filters: [{ services: [this.options.serviceUUID] }],
            optionalServices: this.options.optionalServices ?? [this.options.serviceUUID]
          });
        } else {
          const deviceName = discoveredInfo.device.name;
          if (deviceName) {
            device = await bt.requestDevice({
              filters: [{ name: deviceName }],
              optionalServices: this.options.optionalServices ?? []
            });
          } else {
            device = await bt.requestDevice({
              acceptAllDevices: true,
              optionalServices: this.options.optionalServices ?? []
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
    set.forEach((l) => l(e));
  }
};
var Topology = class {
  constructor() {
    this.nodes = /* @__PURE__ */ new Map();
    this.edges = /* @__PURE__ */ new Set();
  }
  // key as `${a}|${b}` sorted
  addNode(id, label, rssi, discovered) {
    const n = this.nodes.get(id) || { id, label, neighbors: /* @__PURE__ */ new Set(), lastSeen: Date.now(), online: true, rssi, discovered };
    n.label = label ?? n.label;
    n.online = true;
    n.lastSeen = Date.now();
    if (rssi !== void 0)
      n.rssi = rssi;
    if (discovered !== void 0)
      n.discovered = discovered;
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
      nodes: Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        label: n.label,
        online: n.online,
        lastSeen: n.lastSeen,
        neighbors: Array.from(n.neighbors),
        rssi: n.rssi,
        discovered: n.discovered
      })),
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
    this.adapter.on("deviceFound", ({ id, name, rssi, discovered }) => {
      this.topology.addNode(id, name, rssi, discovered);
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
    if (this.adapter.on) {
      this.adapter.on("scanStarted", (e) => this.events.emit("scanStarted", e));
      this.adapter.on("scanStopped", (e) => this.events.emit("scanStopped", e));
    }
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
  async stop() {
    if (this.adapter.stopScan)
      this.adapter.stopScan();
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
  getDiscoveredDevices() {
    return this.adapter.getDiscoveredDevices ? this.adapter.getDiscoveredDevices() : [];
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