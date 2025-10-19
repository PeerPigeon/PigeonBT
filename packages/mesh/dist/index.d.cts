declare class MockAdapter implements MeshAdapter {
    private bus;
    private listeners;
    private knownDevices;
    private connected;
    startScan(): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    send(toId: string, bytes: Uint8Array): Promise<void>;
    on<K extends keyof any>(event: any, listener: any): void;
    off<K extends keyof any>(event: any, listener: any): void;
    private emit;
}

type BluetoothServiceUUID = any;
type BluetoothCharacteristicUUID = any;
type WebBluetoothOptions = {
    serviceUUID?: BluetoothServiceUUID;
    txCharacteristicUUID?: BluetoothCharacteristicUUID;
    rxCharacteristicUUID?: BluetoothCharacteristicUUID;
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
};
declare class WebBluetoothAdapter implements MeshAdapter {
    private options;
    private bus;
    private listeners;
    private knownDevices;
    private connections;
    constructor(options?: WebBluetoothOptions);
    startScan(): Promise<void>;
    private resolveTxRx;
    private ensureConnected;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    send(toId: string, bytes: Uint8Array): Promise<void>;
    on(event: any, listener: any): void;
    off(event: any, listener: any): void;
    private emit;
}

type MeshNode = {
    id: string;
    label?: string;
    neighbors: Set<string>;
    lastSeen: number;
    online: boolean;
};
type MeshPayload = {
    type: string;
    data: unknown;
};
type MeshMessage = {
    id: string;
    from: string;
    to?: string;
    payload: MeshPayload;
    timestamp: number;
    seq: number;
    ack?: boolean;
    hops?: string[];
};
interface AdapterEventMap {
    deviceFound: {
        id: string;
        name?: string;
    };
    deviceConnected: {
        id: string;
    };
    deviceDisconnected: {
        id: string;
    };
    data: {
        from: string;
        bytes: Uint8Array;
    };
    heartbeat: {
        id: string;
    };
    topology: {
        edges: Array<[string, string]>;
    };
}
type AdapterListener<K extends keyof AdapterEventMap> = (event: AdapterEventMap[K]) => void;
interface MeshAdapter {
    startScan(): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    send(toId: string, bytes: Uint8Array): Promise<void>;
    on<K extends keyof AdapterEventMap>(event: K, listener: AdapterListener<K>): void;
    off<K extends keyof AdapterEventMap>(event: K, listener: AdapterListener<K>): void;
}
declare class EventBus<T extends Record<string, any>> {
    private listeners;
    on<K extends keyof T>(event: K, listener: (e: T[K]) => void): void;
    off<K extends keyof T>(event: K, listener: (e: T[K]) => void): void;
    emit<K extends keyof T>(event: K, e: T[K]): void;
}
declare class Topology {
    nodes: Map<string, MeshNode>;
    edges: Set<string>;
    addNode(id: string, label?: string): MeshNode;
    setOffline(id: string): void;
    link(a: string, b: string): void;
    unlink(a: string, b: string): void;
    snapshot(): {
        nodes: {
            id: string;
            label: string | undefined;
            online: boolean;
            lastSeen: number;
            neighbors: string[];
        }[];
        edges: [string, string][];
    };
}
declare class MessageRouter {
    private sendLowLevel;
    private pending;
    private seqMap;
    constructor(sendLowLevel: (toId: string, bytes: Uint8Array) => Promise<void>);
    private nextSeq;
    sendReliable(toId: string, payload: MeshPayload, onTimeout: (id: string) => void): Promise<MeshMessage>;
    track(msg: MeshMessage, onTimeout: (id: string) => void): void;
    ack(id: string): void;
    encode(m: MeshMessage): Uint8Array<ArrayBuffer>;
    decode(bytes: Uint8Array): MeshMessage;
}
declare class MeshNetwork {
    private adapter;
    private localId;
    readonly topology: Topology;
    readonly events: EventBus<{
        message: MeshMessage;
        state: {
            nodes: ReturnType<Topology["snapshot"]>["nodes"];
            edges: ReturnType<Topology["snapshot"]>["edges"];
        };
    }>;
    private router;
    constructor(adapter: MeshAdapter, localId?: string);
    private bindAdapter;
    start(): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    send(toId: string, payload: MeshPayload, onTimeout?: (id: string) => void): Promise<MeshMessage>;
    stateSnapshot(): {
        nodes: {
            id: string;
            label: string | undefined;
            online: boolean;
            lastSeen: number;
            neighbors: string[];
        }[];
        edges: [string, string][];
    };
    private emitState;
}

export { AdapterEventMap, AdapterListener, EventBus, MeshAdapter, MeshMessage, MeshNetwork, MeshNode, MeshPayload, MessageRouter, MockAdapter, Topology, WebBluetoothAdapter };
