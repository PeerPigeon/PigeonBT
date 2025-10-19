<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMeshStore } from './stores/mesh'

const store = useMeshStore()
const toId = ref('ALL')
const text = ref('')
const roomIdInput = ref('default-room')
const serviceUUID = ref('')
const txUUID = ref('')
const rxUUID = ref('')
const optionalServices = ref('')
const autoDiscovery = ref(true)
const scanDuration = ref(30)
const rssiThreshold = ref(-80)
const nameFiltersInput = ref('')

onMounted(() => {
  store.init()
  roomIdInput.value = store.roomId
  serviceUUID.value = store.serviceUUID
  txUUID.value = store.txUUID
  rxUUID.value = store.rxUUID
  optionalServices.value = store.optionalServices
  autoDiscovery.value = store.autoDiscovery
  scanDuration.value = store.scanDuration
  rssiThreshold.value = store.rssiThreshold
  nameFiltersInput.value = store.nameFilters.join(',')
})

const nodes = computed(() => store.nodes)
const edges = computed(() => store.edges)
const messages = computed(() => store.messages)
const envError = computed(() => store.envError)
const adapterKind = computed(() => store.adapterKind)

// i18n: default English, toggle to Chinese
const lang = ref<'en'|'zh'>('en')
const i18n = {
  title: { en: 'Pigeon Bluetooth Mesh Demo', zh: 'Pigeon 蓝牙 Mesh 演示' },
  devices: { en: 'Devices', zh: '设备列表' },
  sendMessage: { en: 'Send Message', zh: '消息发送' },
  selectTarget: { en: 'Select target device', zh: '选择目标设备' },
  inputText: { en: 'Enter text message', zh: '输入文本消息' },
  send: { en: 'Send', zh: '发送' },
  messages: { en: 'Messages', zh: '消息记录' },
  lastHeartbeat: { en: 'Last heartbeat:', zh: '最后心跳：' },
  connect: { en: 'Connect', zh: '连接' },
  disconnect: { en: 'Disconnect', zh: '断开' },
  networkTopology: { en: 'Network Topology', zh: '网络拓扑' },
  language: { en: 'Language', zh: '语言' },
  adapter: { en: 'Adapter', zh: '适配器' },
  web: { en: 'WebBluetooth (real device)', zh: 'WebBluetooth（真实设备）' },
  mock: { en: 'Mock (simulation)', zh: 'Mock（模拟）' },
  envNotSupported: { en: 'WebBluetooth not supported. Use Chrome/Edge with HTTPS or localhost.', zh: '当前环境不支持 WebBluetooth。请使用 Chrome/Edge 并在 HTTPS 或 localhost 打开。' },
  room: { en: 'Room', zh: '房间' },
  allDevices: { en: 'All devices', zh: '全部设备' },
  authorize: { en: 'Authorize devices', zh: '授权设备' },
  authorizeHint: { en: 'Click to authorize devices once; then they auto-connect next time.', zh: '首次需要点击授权设备；之后将自动连接。' },
  serviceUUID: { en: 'Service UUID', zh: '服务 UUID' },
  txUUID: { en: 'TX Char UUID (write)', zh: 'TX 特征 UUID（write）' },
  rxUUID: { en: 'RX Char UUID (notify/indicate)', zh: 'RX 特征 UUID（notify/indicate）' },
  optionalServices: { en: 'Optional Services (comma-separated)', zh: '可选服务（逗号分隔）' },
  applyUUIDs: { en: 'Apply UUIDs', zh: '应用 UUID' }
} as const
const tt = (k: keyof typeof i18n) => i18n[k][lang.value]
const statusLabel = (s?: 'sent'|'ack'|'timeout') => {
  if (!s) return ''
  return {
    sent: { en: 'sent', zh: '已发送' },
    ack: { en: 'ack', zh: '已确认' },
    timeout: { en: 'timeout', zh: '超时' }
  }[s][lang.value]
}

function connect(id:string){ 
  const node = store.nodes.find(n => n.id === id)
  if (node) node.connecting = true
  store.connect(id).finally(() => {
    if (node) node.connecting = false
  })
}
function disconnect(id:string){ store.disconnect(id) }
async function send(){ if(toId.value && text.value){ await store.sendText(toId.value, text.value); text.value='' } }
function setAdapter(kind: 'web'|'mock'){ store.setAdapterKind(kind); store.init() }
function updateRoom(){ store.setRoomId(roomIdInput.value) }
function authorize(){ store.startScan() }
function applyUUIDs(){ store.setAdapterUUIDs({ serviceUUID: serviceUUID.value, txUUID: txUUID.value, rxUUID: rxUUID.value, optionalServices: optionalServices.value }); store.init() }
function updateDiscoverySettings(){ 
  const nameFilters = nameFiltersInput.value.split(',').map(s => s.trim()).filter(Boolean)
  store.setDiscoveryOptions({ 
    autoDiscovery: autoDiscovery.value, 
    scanDuration: scanDuration.value, 
    rssiThreshold: rssiThreshold.value, 
    nameFilters 
  })
  store.init() 
}

function getRSSIClass(rssi: number): string {
  if (rssi >= -50) return 'rssi-excellent'
  if (rssi >= -60) return 'rssi-good'  
  if (rssi >= -70) return 'rssi-fair'
  return 'rssi-poor'
}

const positions = computed(() => {
  const N = nodes.value.length || 1
  const cx = 160, cy = 160, r = 120
  const map = new Map<string, {x:number;y:number}>()
  nodes.value.forEach((n, i) => {
    const ang = (2*Math.PI*i)/N
    map.set(n.id, { x: cx + r*Math.cos(ang), y: cy + r*Math.sin(ang) })
  })
  return map
})
function pos(id:string){ return positions.value.get(id) }
</script>

<template>
  <div class="container">
    <header>
      <h2>{{ tt('title') }}</h2>
      <div class="actions">
        <div class="lang">
          <label>{{ tt('language') }}</label>
          <select v-model="lang">
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
        </div>
        <div class="adapter">
          <label>{{ tt('adapter') }}</label>
          <select :value="adapterKind" @change="setAdapter(($event.target as HTMLSelectElement).value as any)">
            <option value="web">{{ tt('web') }}</option>
            <option value="mock">{{ tt('mock') }}</option>
          </select>
        </div>
        <div class="room">
          <label>{{ tt('room') }}</label>
          <input v-model="roomIdInput" @change="updateRoom" />
        </div>
      </div>
    </header>

    <div v-if="envError" class="env-error">
      <strong>⚠️</strong>
      <span>{{ envError || tt('envNotSupported') }}</span>
    </div>

    <div class="uuid-config" v-if="adapterKind === 'web'">
      <div class="row">
        <label>{{ tt('serviceUUID') }}</label>
        <input v-model="serviceUUID" placeholder="e.g. 0000180D-0000-1000-8000-00805f9b34fb" />
      </div>
      <div class="row">
        <label>{{ tt('txUUID') }}</label>
        <input v-model="txUUID" placeholder="write/writeWithoutResponse characteristic UUID" />
      </div>
      <div class="row">
        <label>{{ tt('rxUUID') }}</label>
        <input v-model="rxUUID" placeholder="notify/indicate characteristic UUID" />
      </div>
      <div class="row">
        <label>{{ tt('optionalServices') }}</label>
        <input v-model="optionalServices" placeholder="service1,service2,..." />
      </div>
      <button @click="applyUUIDs">{{ tt('applyUUIDs') }}</button>
      <div class="env-hint">
        <span>{{ tt('authorizeHint') }}</span>
        <button @click="authorize">{{ tt('authorize') }}</button>
      </div>
    </div>

    <div class="discovery-config" v-if="adapterKind === 'web'">
      <h4>Discovery Settings</h4>
      <div class="config-grid">
        <div class="config-item">
          <label>
            <input type="checkbox" v-model="autoDiscovery" @change="updateDiscoverySettings" />
            Auto Discovery
          </label>
        </div>
        <div class="config-item">
          <label>Scan Duration (seconds)</label>
          <input type="number" v-model.number="scanDuration" @change="updateDiscoverySettings" min="5" max="300" />
        </div>
        <div class="config-item">
          <label>RSSI Threshold (dBm)</label>
          <input type="number" v-model.number="rssiThreshold" @change="updateDiscoverySettings" min="-100" max="-30" />
        </div>
        <div class="config-item">
          <label>Name Filters (comma-separated)</label>
          <input v-model="nameFiltersInput" @change="updateDiscoverySettings" placeholder="e.g. Arduino,ESP32,Nordic" />
        </div>
      </div>
    </div>

    <section class="panel">
      <h3>{{ tt('devices') }} 
        <span v-if="store.scanning" class="scanning-indicator">🔍 Scanning...</span>
        <span v-else-if="store.adapterKind === 'web'" class="scan-controls">
          <button @click="store.startScan()" :disabled="store.scanning">Start Scan</button>
          <button @click="store.stopScan()" :disabled="!store.scanning">Stop Scan</button>
        </span>
      </h3>
      
      <div v-if="!store.scanning && nodes.length === 0" class="no-devices-message">
        <p>📱 No devices found</p>
        <p><small>
          Try clicking "Start Scan" to discover nearby Bluetooth devices, or use "Authorize devices" to manually select a device.
          <br>Make sure Bluetooth is enabled and you're using Chrome/Edge with HTTPS or localhost.
        </small></p>
      </div>
      
      <ul class="nodes" v-if="nodes.length > 0">
        <li v-for="n in nodes" :key="n.id" class="device-item">
          <div class="device-status">
            <span class="dot" :class="{ 
              online: n.online, 
              discovered: n.discovered && !n.online,
              connecting: n.connecting 
            }"></span>
            <span class="discovery-badge" v-if="n.discovered && !n.online">📡</span>
            <span class="connecting-badge" v-if="n.connecting">⏳</span>
          </div>
          <div class="device-info">
            <strong>{{ n.label || n.id }}</strong>
            <div class="device-details">
              <small>{{ tt('lastHeartbeat') }} {{ new Date(n.lastSeen).toLocaleTimeString() }}</small>
              <span v-if="n.rssi" class="rssi" :class="getRSSIClass(n.rssi)">
                📶 {{ n.rssi }}dBm
              </span>
              <span v-if="n.discovered" class="discovered-tag">Discovered</span>
            </div>
          </div>
          <div class="ops">
            <button v-if="!n.online && !n.connecting" @click="connect(n.id)">{{ tt('connect') }}</button>
            <button v-else-if="n.online" @click="disconnect(n.id)">{{ tt('disconnect') }}</button>
            <span v-else-if="n.connecting" class="connecting-text">Connecting...</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel">
      <h3>{{ tt('sendMessage') }}</h3>
      <div class="send">
        <select v-model="toId">
          <option value="" disabled>{{ tt('selectTarget') }}</option>
          <option value="ALL">{{ tt('allDevices') }}</option>
          <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.label || n.id }}</option>
        </select>
        <input v-model="text" :placeholder="tt('inputText')" />
        <button :disabled="!toId || !text" @click="send">{{ tt('send') }}</button>
      </div>
    </section>

    <section class="panel">
      <h3>{{ tt('messages') }}</h3>
      <ul class="messages">
        <li v-for="m in messages" :key="m.id">
          <strong>[{{ m.type }}]</strong>
          <span> {{ m.from }} → {{ m.to || '-' }} ：{{ m.data }}</span>
          <small> {{ new Date(m.timestamp).toLocaleTimeString() }} </small>
          <em v-if="m.status" class="status">{{ statusLabel(m.status) }}</em>
        </li>
      </ul>
    </section>

    <section class="panel">
      <h3>{{ tt('networkTopology') }}</h3>
      <div class="topology">
        <svg width="320" height="320" viewBox="0 0 320 320">
          <line v-for="(e, i) in edges" :key="i"
                :x1="pos(e[0])?.x" :y1="pos(e[0])?.y"
                :x2="pos(e[1])?.x" :y2="pos(e[1])?.y"
                stroke="#999" stroke-width="1" />
          <g v-for="n in nodes" :key="n.id" :transform="`translate(${pos(n.id)?.x || 0}, ${pos(n.id)?.y || 0})`">
            <circle r="18" :fill="n.online ? '#42b883' : '#ccc'" stroke="#333" />
            <text x="0" y="5" text-anchor="middle" font-size="10" fill="#000">{{ n.label || n.id }}</text>
          </g>
        </svg>
      </div>
    </section>
  </div>
</template>

<style scoped>
.container{ max-width: 980px; margin: 0 auto; padding: 24px; }
header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.actions{ display:flex; align-items:center; gap:8px; }
.actions .lang, .actions .adapter, .actions .room{ display:flex; align-items:center; gap:6px; }
.actions .lang select, .actions .adapter select{ padding:6px; }
.actions .room input{ padding:6px; width: 160px; }
.actions button{ padding:6px 12px; }
.env-error{ display:flex; align-items:center; gap:8px; padding:8px; margin:8px 0; background:#fff3cd; color:#7c6500; border:1px solid #ffe69c; border-radius:6px; }
.env-hint{ display:flex; align-items:center; gap:8px; padding:8px; margin:8px 0; background:#e7f1ff; color:#084298; border:1px solid #9ec5fe; border-radius:6px; }
.uuid-config{ display:flex; gap:8px; align-items:flex-end; margin:8px 0; flex-wrap:wrap; }
.uuid-config .row{ display:flex; flex-direction:column; gap:4px; }
.uuid-config .row input{ padding:6px; width: 280px; }

/* Discovery configuration styles */
.discovery-config{ 
  background:#f0f8ff; 
  padding:12px; 
  border-radius:8px; 
  margin:8px 0; 
  border:1px solid #e1f5fe;
}
.discovery-config h4{ margin:0 0 12px 0; color:#1976d2; }
.config-grid{ 
  display:grid; 
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
  gap:12px; 
}
.config-item{ display:flex; flex-direction:column; gap:4px; }
.config-item label{ font-size:12px; font-weight:bold; color:#555; }
.config-item input[type="checkbox"]{ margin-right:6px; }
.config-item input[type="number"], .config-item input[type="text"]{ padding:6px; border:1px solid #ddd; border-radius:4px; }
.panel{ background:#f7f7f9; padding:12px; border-radius:8px; margin-bottom:12px; }
.panel h3{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }

/* Scanning indicator styles */
.scanning-indicator{ 
  color:#646cff; 
  font-size:14px; 
  animation: pulse 1.5s ease-in-out infinite; 
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.scan-controls{ display:flex; gap:8px; }
.scan-controls button{ padding:4px 8px; font-size:12px; }

/* Enhanced device list styles */
.nodes{ list-style:none; padding:0; margin:0; }
.no-devices-message{ 
  text-align:center; 
  padding:20px; 
  color:#666; 
  background:#f9f9f9; 
  border-radius:8px; 
  border:2px dashed #ddd; 
}
.no-devices-message p{ margin:8px 0; }
.device-item{ 
  display:flex; 
  align-items:center; 
  gap:12px; 
  padding:8px 0; 
  border-bottom: 1px dashed #e0e0e0; 
}
.device-status{ display:flex; align-items:center; gap:4px; }
.device-info{ flex:1; }
.device-details{ display:flex; align-items:center; gap:8px; margin-top:2px; }

/* Device status dots */
.dot{ 
  width:10px; 
  height:10px; 
  border-radius:50%; 
  background:#ccc; 
  position:relative;
}
.dot.online{ background:#42b883; }
.dot.discovered{ background:#ffa500; animation: blink 2s infinite; }
.dot.connecting{ background:#646cff; animation: pulse 1s infinite; }
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0.3; }
}

/* Badges */
.discovery-badge, .connecting-badge{ font-size:12px; }
.discovered-tag{ 
  background:#ffa500; 
  color:white; 
  padding:2px 6px; 
  border-radius:10px; 
  font-size:10px; 
  font-weight:bold;
}

/* RSSI signal strength indicators */
.rssi{ 
  font-size:11px; 
  padding:2px 6px; 
  border-radius:4px; 
  font-weight:bold;
}
.rssi-excellent{ background:#42b883; color:white; }
.rssi-good{ background:#52c41a; color:white; }
.rssi-fair{ background:#faad14; color:white; }
.rssi-poor{ background:#ff4d4f; color:white; }

/* Button and operation styles */
.ops{ margin-left:auto; }
.ops button{ padding:4px 8px; }
.connecting-text{ color:#646cff; font-size:12px; }

/* Legacy styles */
.send{ display:flex; gap:8px; align-items:center; }
.send select, .send input{ padding:6px; }
.messages{ list-style:none; padding:0; margin:0; }
.messages li{ display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom: 1px dashed #e0e0e0; }
.messages .status{ color:#646cff; margin-left:auto; }
.topology{ display:flex; justify-content:center; }
</style>
