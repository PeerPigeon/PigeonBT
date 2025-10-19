import { defineStore } from 'pinia'
import { MeshNetwork, WebBluetoothAdapter, MockAdapter } from 'pigeon-bluetooth'
import type { MeshPayload, MeshAdapter } from 'pigeon-bluetooth'

export type UINode = { id: string; label?: string; online: boolean; lastSeen: number; neighbors: string[] }
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
    adapterKind: 'web' as 'web'|'mock',
    envError: '' as string,
    roomId: 'default-room' as string,
    serviceUUID: '' as string,
    txUUID: '' as string,
    rxUUID: '' as string,
    optionalServices: '' as string,
  }),
  actions: {
    // Non-reactive runtime holder
    _adapter: null as unknown as MeshAdapter,
    _net: null as unknown as MeshNetwork,

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

    async init() {
      if (this.initialized) return
      try {
        if (this.adapterKind === 'web') {
          if (!(navigator as any).bluetooth) {
            this.envError = 'WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.'
            return
          }
          const opts: any = { acceptAllDevices: true }
          if (this.serviceUUID) opts.serviceUUID = this.serviceUUID
          if (this.txUUID) opts.txCharacteristicUUID = this.txUUID
          if (this.rxUUID) opts.rxCharacteristicUUID = this.rxUUID
          if (this.optionalServices) {
            const arr = this.optionalServices.split(',').map(s => s.trim()).filter(Boolean)
            if (arr.length) opts.optionalServices = arr
          }
          this._adapter = new WebBluetoothAdapter(opts)
        } else {
          this._adapter = new MockAdapter()
        }
        this._net = new MeshNetwork(this._adapter, 'demo-local')

        // subscribe state updates
        this._net.events.on('state', ({ nodes, edges }) => {
          this.nodes = nodes as any
          this.edges = edges as any
        })
        // subscribe messages（转发到同房间的所有在线设备）
        this._net.events.on('message', (msg) => {
          const m: any = msg
          this.messages.unshift({ id: m.id, from: m.from, to: m.to, type: m.payload.type, data: m.payload.data, timestamp: m.timestamp, status: m.ack ? 'ack' : undefined })
          if (!m.ack && m.from !== 'local') {
            const targets = this.nodes.filter(n => n.online && n.id !== m.from).map(n => n.id)
            for (const id of targets) {
              this._net.send(id, { type: m.payload.type, data: m.payload.data }).catch(() => {})
            }
          }
        })
        this.initialized = true

        // 自动连接已授权设备（如果浏览器支持 getDevices）
        const bt = (navigator as any).bluetooth
        if (this.adapterKind === 'web' && bt?.getDevices) {
          try {
            const allowed = await bt.getDevices()
            for (const d of allowed) {
              try { await this._net.connect(d.id) } catch {}
            }
          } catch {}
        }
      } catch (e: any) {
        this.envError = e?.message || String(e)
      }
    },

    async startScan() {
      if (!this.initialized) await this.init()
      try {
        await this._adapter.startScan()
      } catch (e: any) {
        this.envError = e?.message || String(e)
      }
    },

    async connect(id: string) {
      if (!this.initialized) await this.init()
      this.connecting.add(id)
      try {
        await this._net.connect(id)
        // 入房间握手（可选，设备端按需处理）
        const payload: MeshPayload = { type: 'room.join', data: { roomId: this.roomId } }
        try { await this._net.send(id, payload) } catch {}
      } catch (e: any) {
        this.envError = e?.message || String(e)
      } finally {
        this.connecting.delete(id)
      }
    },

    async disconnect(id: string) {
      if (!this.initialized) await this.init()
      try {
        await this._net.disconnect(id)
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
              try { await this._net.connect(id) } catch (e:any) { this.envError = e?.message || String(e) }
            }
            const msg = await this._net.send(id, payload, (timeoutId) => {
              const m = this.messages.find(m => m.id === timeoutId)
              if (m) m.status = 'timeout'
            })
            this.messages.unshift({ id: (msg as any).id, from: 'local', to: id, type: payload.type, data: text, timestamp: Date.now(), status: 'sent' })
          }
        } else {
          const node = this.nodes.find(n => n.id === toId)
          if (node && !node.online) {
            try { await this._net.connect(toId) } catch (e:any) { this.envError = e?.message || String(e) }
          }
          const msg = await this._net.send(toId, payload, (timeoutId) => {
            const m = this.messages.find(m => m.id === timeoutId)
            if (m) m.status = 'timeout'
          })
          this.messages.unshift({ id: (msg as any).id, from: 'local', to: toId, type: payload.type, data: text, timestamp: Date.now(), status: 'sent' })
        }
      } catch (e:any) {
        this.envError = e?.message || String(e)
      }
    }
  }
})