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

onMounted(() => {
  store.init()
  roomIdInput.value = store.roomId
  serviceUUID.value = store.serviceUUID
  txUUID.value = store.txUUID
  rxUUID.value = store.rxUUID
  optionalServices.value = store.optionalServices
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

function connect(id:string){ store.connect(id) }
function disconnect(id:string){ store.disconnect(id) }
async function send(){ if(toId.value && text.value){ await store.sendText(toId.value, text.value); text.value='' } }
function setAdapter(kind: 'web'|'mock'){ store.setAdapterKind(kind); store.init() }
function updateRoom(){ store.setRoomId(roomIdInput.value) }
function authorize(){ store.startScan() }
function applyUUIDs(){ store.setAdapterUUIDs({ serviceUUID: serviceUUID.value, txUUID: txUUID.value, rxUUID: rxUUID.value, optionalServices: optionalServices.value }); store.init() }

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

    <section class="panel">
      <h3>{{ tt('devices') }}</h3>
      <ul class="nodes">
        <li v-for="n in nodes" :key="n.id">
          <span class="dot" :class="{ online: n.online }"></span>
          <strong>{{ n.label || n.id }}</strong>
          <small>{{ tt('lastHeartbeat') }} {{ new Date(n.lastSeen).toLocaleTimeString() }}</small>
          <div class="ops">
            <button v-if="!n.online" @click="connect(n.id)">{{ tt('connect') }}</button>
            <button v-else @click="disconnect(n.id)">{{ tt('disconnect') }}</button>
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
.panel{ background:#f7f7f9; padding:12px; border-radius:8px; margin-bottom:12px; }
.nodes{ list-style:none; padding:0; margin:0; }
.nodes li{ display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom: 1px dashed #e0e0e0; }
.nodes .dot{ width:8px; height:8px; border-radius:50%; background:#ccc; }
.nodes .dot.online{ background:#42b883; }
.nodes .ops button{ margin-left:auto; }
.send{ display:flex; gap:8px; align-items:center; }
.send select, .send input{ padding:6px; }
.messages{ list-style:none; padding:0; margin:0; }
.messages li{ display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom: 1px dashed #e0e0e0; }
.messages .status{ color:#646cff; margin-left:auto; }
.topology{ display:flex; justify-content:center; }
</style>
