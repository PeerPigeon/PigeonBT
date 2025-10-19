import { defineStore } from 'pinia'
import { MeshNetwork, WebBluetoothAdapter, MockAdapter } from 'pigeon-bluetooth'
import type { MeshPayload, MeshAdapter } from 'pigeon-bluetooth'

export type UINode = { id: string; label?: string; online: boolean; lastSeen: number; neighbors: string[]; rssi?: number; discovered?: boolean; connecting?: boolean }
export type UIEdge = [string, string]
export type UIMessage = { id: string; from: string; to?: string; type: string; data: unknown; timestamp: number; status?: 'sent'|'ack'|'timeout' }

const ALL_ID = 'ALL'

export const useMeshStore = defineStore('mesh', {
  state: () => ({
    nodes: [] as UINode[],
    edges: [] as UIEdge[],
    messages: [] as UIMessage[],
    initialized: false as boolean,
    connecting: new Set<string>() as Set<string>,
    scanning: false as boolean,
    adapterKind: 'web' as 'web'|'mock',
    envError: '' as string,
    roomId: 'default-room' as string,
    serviceUUID: '' as string,
    txUUID: '' as string,
    rxUUID: '' as string,
    optionalServices: '' as string,
    autoDiscovery: true as boolean,
    scanDuration: 30 as number,
    rssiThreshold: -80 as number,
    nameFilters: [] as string[],
    // Move adapter and network to state instead of actions
    adapter: null as MeshAdapter | null,
    network: null as MeshNetwork | null,
  }),
  actions: {
    setAdapterKind(kind: 'web'|'mock'){
      this.adapterKind = kind
      this.initialized = false
      this.envError = ''
    },
    clearError(){ this.envError = '' },
    setRoomId(id: string){ this.roomId = id },
    setAdapterUUIDs(opts: { serviceUUID?: string; txUUID?: string; rxUUID?: string; optionalServices?: string }){
      this.serviceUUID = opts.serviceUUID ?? this.serviceUUID
      this.txUUID = opts.txUUID ?? this.txUUID
      this.rxUUID = opts.rxUUID ?? this.rxUUID
      this.optionalServices = opts.optionalServices ?? this.optionalServices
      this.initialized = false
      this.envError = ''
    },
    
    setDiscoveryOptions(opts: { autoDiscovery?: boolean; scanDuration?: number; rssiThreshold?: number; nameFilters?: string[] }) {
      this.autoDiscovery = opts.autoDiscovery ?? this.autoDiscovery
      this.scanDuration = opts.scanDuration ?? this.scanDuration
      this.rssiThreshold = opts.rssiThreshold ?? this.rssiThreshold
      this.nameFilters = opts.nameFilters ?? this.nameFilters
      this.initialized = false
      this.envError = ''
    },

    async init() {
      console.log('init called, initialized:', this.initialized)
      if (this.initialized) return
      try {
        console.log('Creating adapter, kind:', this.adapterKind)
        if (this.adapterKind === 'web') {
          if (!(navigator as any).bluetooth) {
            this.envError = 'WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.'
            return
          }
          const opts: any = { 
            acceptAllDevices: true,
            autoDiscovery: this.autoDiscovery,
            scanDuration: this.scanDuration,
            rssiThreshold: this.rssiThreshold
          }
          if (this.serviceUUID) opts.serviceUUID = this.serviceUUID
          if (this.txUUID) opts.txCharacteristicUUID = this.txUUID
          if (this.rxUUID) opts.rxCharacteristicUUID = this.rxUUID
          if (this.optionalServices) {
            const arr = this.optionalServices.split(',').map(s => s.trim()).filter(Boolean)
            if (arr.length) opts.optionalServices = arr
          }
          if (this.nameFilters.length > 0) {
            opts.nameFilters = this.nameFilters
          }
          this.adapter = new WebBluetoothAdapter(opts)
        } else {
          this.adapter = new MockAdapter()
        }
        
        console.log('Creating MeshNetwork with adapter:', !!this.adapter)
        this.network = new MeshNetwork(this.adapter, 'demo-local')
        console.log('MeshNetwork created:', !!this.network, 'start method:', typeof this.network?.start)

        // subscribe state updates
        this.network.events.on('state', ({ nodes, edges }: any) => {
          this.nodes = nodes as any
          this.edges = edges as any
        })
        
        // Handle scanning state from network events
        ;(this.network.events as any).on('scanStarted', () => {
          this.scanning = true
        })
        
        ;(this.network.events as any).on('scanStopped', () => {
          this.scanning = false
        })
        // subscribe messages（转发到同房间的所有在线设备）
        this.network.events.on('message', (msg: any) => {
          const m: any = msg
          this.messages.unshift({ id: m.id, from: m.from, to: m.to, type: m.payload.type, data: m.payload.data, timestamp: m.timestamp, status: m.ack ? 'ack' : undefined })
          if (!m.ack && m.from !== 'local') {
            const targets = this.nodes.filter(n => n.online && n.id !== m.from).map(n => n.id)
            for (const id of targets) {
              this.network?.send(id, { type: m.payload.type, data: m.payload.data }).catch(() => {})
            }
          }
        })
        this.initialized = true
        console.log('init completed successfully, network:', !!this.network, 'start method:', typeof this.network?.start)

        // 自动连接已授权设备（如果浏览器支持 getDevices）
        const bt = (navigator as any).bluetooth
        if (this.adapterKind === 'web' && bt?.getDevices) {
          try {
            const allowed = await bt.getDevices()
            for (const d of allowed) {
              try { await this.network?.connect(d.id) } catch {}
            }
          } catch {}
        }
      } catch (e: any) {
        console.error('init failed:', e)
        this.envError = e?.message || String(e)
      }
    },

    async startScan() {
      console.log('startScan called, initialized:', this.initialized, 'network:', !!this.network)
      if (!this.initialized) {
        console.log('Not initialized, calling init...')
        await this.init()
      }
      
      if (!this.network) {
        console.error('network is still null after init')
        this.envError = 'Network not properly initialized'
        return
      }
      
      if (typeof this.network.start !== 'function') {
        console.error('network.start is not a function, network type:', typeof this.network, 'network:', this.network)
        this.envError = 'Network start method not available'
        return
      }
      
      try {
        console.log('Starting device scan...')
        await this.network.start()
      } catch (e: any) {
        console.error('Scan failed:', e)
        this.envError = e?.message || String(e)
        this.scanning = false
      }
    },

    async stopScan() {
      if (!this.initialized) return
      try {
        console.log('Stopping device scan...')
        if (this.network?.stop) await this.network.stop()
      } catch (e: any) {
        console.error('Stop scan failed:', e)
        this.envError = e?.message || String(e)
      }
    },

    getDiscoveredDevices() {
      if (!this.initialized || !this.network?.getDiscoveredDevices) return []
      return this.network.getDiscoveredDevices()
    },

    async connect(id: string) {
      if (!this.initialized) await this.init()
      this.connecting.add(id)
      try {
        await this.network?.connect(id)
        // 入房间握手（可选，设备端按需处理）
        const payload: MeshPayload = { type: 'room.join', data: { roomId: this.roomId } }
        try { await this.network?.send(id, payload) } catch {}
      } catch (e: any) {
        this.envError = e?.message || String(e)
      } finally {
        this.connecting.delete(id)
      }
    },

    async disconnect(id: string) {
      if (!this.initialized) await this.init()
      try {
        await this.network?.disconnect(id)
      } catch (e: any) {
        this.envError = e?.message || String(e)
      }
    },

    async sendText(toId: string, text: string) {
      if (!this.initialized) await this.init()
      const payload: MeshPayload = { type: 'text', data: text }
      try {
        if (toId === ALL_ID) {
          const targets = this.nodes.filter(n => n.online).map(n => n.id)
          for (const id of targets) {
            const node = this.nodes.find(n => n.id === id)
            if (node && !node.online) {
              try { await this.network?.connect(id) } catch (e:any) { this.envError = e?.message || String(e) }
            }
            const msg = await this.network?.send(id, payload, (timeoutId) => {
              const m = this.messages.find(m => m.id === timeoutId)
              if (m) m.status = 'timeout'
            })
            if (msg) {
              this.messages.unshift({ id: (msg as any).id, from: 'local', to: id, type: payload.type, data: text, timestamp: Date.now(), status: 'sent' })
            }
          }
        } else {
          const node = this.nodes.find(n => n.id === toId)
          if (node && !node.online) {
            try { await this.network?.connect(toId) } catch (e:any) { this.envError = e?.message || String(e) }
          }
          const msg = await this.network?.send(toId, payload, (timeoutId) => {
            const m = this.messages.find(m => m.id === timeoutId)
            if (m) m.status = 'timeout'
          })
          if (msg) {
            this.messages.unshift({ id: (msg as any).id, from: 'local', to: toId, type: payload.type, data: text, timestamp: Date.now(), status: 'sent' })
          }
        }
      } catch (e:any) {
        this.envError = e?.message || String(e)
      }
    }
  }
})