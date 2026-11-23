import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  TopologyCanvas,
  TopologyDiscoveredDevice,
  TopologyDocPage,
  TopologyGitSyncConfig,
  TopologyHealthCheckMethod,
  TopologyLink,
  TopologyLinkKind,
  TopologyNode,
  TopologyNodeKind,
  TopologyPatchCable,
  TopologyRack,
  TopologyRackSlotItem,
  TopologyServicePort,
  TopologyState,
  TopologySwitchMetadata,
  SwitchModelPreset,
  OverviewResponse,
} from '../../../shared/types.js';
import { eq } from 'drizzle-orm';
import type { ConfigStore } from '../store/configStore.js';
import type { TursoDatabase } from '../db/tursoDb.js';
import {
  topologyCanvases,
  topologyDiscoveries,
  topologyDocs,
  topologyLinks,
  topologyMeta,
  topologyNodes,
  topologyRackItems,
  topologyRackPatches,
  topologyRacks,
} from '../db/schema.js';
import {
  buildSwitchMetadataFromPreset,
  fingerprintSwitchHttpBanner,
  probeManagedSwitch,
  SWITCH_MODEL_SPECS,
  type SwitchProbeRequest,
  type SwitchProbeResult,
} from './switchInspector.js';
import {
  parseRoutingAndConfigTranscript,
  type RoutingAnalysisResult,
} from './routingAnalyzer.js';
import { resolveScanTargets } from './deviceScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDataDir(): string {
  if (process.env.RACK_PANEL_DATA_DIR) {
    return path.resolve(process.env.RACK_PANEL_DATA_DIR);
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return path.join(dir, 'data');
    }
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const TOPOLOGY_FILE = path.join(DATA_DIR, 'topology.json');

interface PersistedTopologyData extends TopologyState {
  sharePasswordHash?: string;
}

// Well-known Topology service port fingerprint dictionary
const PORT_FINGERPRINTS: Array<{
  port: number;
  serviceName: string;
  guessedKind: TopologyNodeKind;
  scheme?: 'http' | 'https';
}> = [
  { port: 22, serviceName: 'SSH / Switch CLI', guessedKind: 'server' },
  { port: 23, serviceName: 'Telnet Switch CLI', guessedKind: 'switch' },
  { port: 53, serviceName: 'DNS', guessedKind: 'router' },
  { port: 80, serviceName: 'HTTP Web UI', guessedKind: 'generic', scheme: 'http' },
  { port: 161, serviceName: 'SNMP Switch Agent', guessedKind: 'switch' },
  { port: 443, serviceName: 'HTTPS Web UI', guessedKind: 'generic', scheme: 'https' },
  { port: 445, serviceName: 'SMB / NAS File Share', guessedKind: 'nas' },
  { port: 554, serviceName: 'RTSP Video Stream', guessedKind: 'nvr' },
  { port: 1883, serviceName: 'MQTT Broker', guessedKind: 'iot' },
  { port: 2049, serviceName: 'NFS Storage', guessedKind: 'nas' },
  { port: 2375, serviceName: 'Docker Engine API', guessedKind: 'docker', scheme: 'http' },
  { port: 3000, serviceName: 'Grafana / Web App', guessedKind: 'server', scheme: 'http' },
  { port: 3840, serviceName: 'Rack Panel', guessedKind: 'server', scheme: 'http' },
  { port: 5000, serviceName: 'Synology DSM / Frigate', guessedKind: 'nas', scheme: 'http' },
  { port: 5001, serviceName: 'Synology DSM HTTPS', guessedKind: 'nas', scheme: 'https' },
  { port: 8000, serviceName: 'Hikvision SDK / Portainer', guessedKind: 'nvr' },
  { port: 8006, serviceName: 'Proxmox VE Web UI', guessedKind: 'proxmox', scheme: 'https' },
  { port: 8080, serviceName: 'Zigbee2MQTT / Web Portal', guessedKind: 'zigbee', scheme: 'http' },
  { port: 8091, serviceName: 'Z-Wave JS UI', guessedKind: 'zwave', scheme: 'http' },
  { port: 8096, serviceName: 'Jellyfin Media Server', guessedKind: 'server', scheme: 'http' },
  { port: 8123, serviceName: 'Home Assistant', guessedKind: 'iot', scheme: 'http' },
  { port: 8443, serviceName: 'UniFi Network Controller', guessedKind: 'ap', scheme: 'https' },
  { port: 9000, serviceName: 'Portainer', guessedKind: 'docker', scheme: 'http' },
  { port: 9090, serviceName: 'Prometheus / Cockpit', guessedKind: 'server', scheme: 'http' },
  { port: 9100, serviceName: 'Prometheus Node Exporter', guessedKind: 'server', scheme: 'http' },
  { port: 11434, serviceName: 'Ollama AI / LLM Server', guessedKind: 'ai', scheme: 'http' },
  { port: 32400, serviceName: 'Plex Media Server', guessedKind: 'server', scheme: 'http' },
];

const OUI_VENDORS: Record<string, string> = {
  'BC:24:11': 'Proxmox Server Solutions',
  '00:11:32': 'Synology Inc.',
  '24:5A:4C': 'Ubiquiti Inc.',
  '74:AC:B9': 'Ubiquiti Inc.',
  'F0:9F:C2': 'Ubiquiti Inc.',
  'B4:FB:E4': 'Ubiquiti Inc.',
  '00:0A:EB': 'TP-Link JetStream',
  '14:CC:20': 'TP-Link JetStream',
  '18:D6:C7': 'TP-Link JetStream',
  '30:B5:C2': 'TP-Link JetStream',
  '50:C7:BF': 'TP-Link JetStream',
  '54:AF:97': 'TP-Link JetStream',
  '60:32:B1': 'TP-Link JetStream',
  '70:4F:57': 'TP-Link JetStream',
  '74:DA:88': 'TP-Link JetStream',
  '98:DA:C4': 'TP-Link JetStream',
  'A8:42:A1': 'TP-Link JetStream',
  'AC:84:C6': 'TP-Link JetStream',
  'B0:95:75': 'TP-Link JetStream',
  'B0:BE:76': 'TP-Link JetStream',
  'C0:06:C3': 'TP-Link JetStream',
  'D8:07:B6': 'TP-Link JetStream',
  'E8:94:F6': 'TP-Link JetStream',
  'EC:08:6B': 'TP-Link JetStream',
  'F4:F2:6D': 'TP-Link JetStream',
  '00:1E:BD': 'Cisco Systems',
  '00:24:14': 'Cisco Systems',
  'B0:7D:47': 'Cisco Systems',
  '4C:5E:0C': 'MikroTik',
  '64:D1:54': 'MikroTik',
  'DC:2C:6E': 'MikroTik',
  '28:C6:8E': 'Netgear ProSAFE',
  'C0:56:E3': 'Hikvision Digital Technology',
  '44:19:B6': 'Hikvision Digital Technology',
  'BC:AD:28': 'Hikvision Digital Technology',
  '28:57:BE': 'Hikvision Digital Technology',
  '00:0C:29': 'VMware Inc.',
  'D8:3A:DD': 'Raspberry Pi Trading',
  'B8:27:EB': 'Raspberry Pi Foundation',
  'DC:A6:32': 'Raspberry Pi Trading',
  '00:E0:67': 'Protectli / Netgate Appliance',
  '00:08:A2': 'Netgate / Deciso OPNsense',
};

function lookupMacVendor(mac: string): string {
  const clean = String(mac || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, ':');
  if (clean.length >= 8) {
    const prefix = clean.slice(0, 8);
    if (OUI_VENDORS[prefix]) return OUI_VENDORS[prefix];
  }
  return '';
}

function slugify(input: string): string {
  return (
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page'
  );
}

function parseRackUnitSlot(rawUnit: string | undefined, fallbackU: number, totalU: number): number {
  if (rawUnit) {
    const m = String(rawUnit).match(/(\d{1,2})/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (parsed >= 1 && parsed <= totalU) return parsed;
    }
  }
  return Math.max(1, Math.min(totalU, fallbackU));
}

function buildDefaultTopologyState(store?: ConfigStore): PersistedTopologyData {
  const nowIso = new Date().toISOString();
  const nowTs = Date.now();
  const mainCanvasId = 'canvas-main';
  const totalU = 24;
  const mainRackId = 'rack-primary';

  const canvases: TopologyCanvas[] = [
    {
      id: mainCanvasId,
      name: 'Main Network Topology',
      description: 'Live topology map of devices configured in RACK//PANEL',
      isDefault: true,
      createdAt: nowIso,
    },
  ];

  const nodes: TopologyNode[] = [];
  const links: TopologyLink[] = [];
  const rackItems: TopologyRackSlotItem[] = [];
  const rackPatches: TopologyPatchCable[] = [];

  const realOpnsense = store ? store.listOpnsense() : [];
  const realProxmox = store ? store.listProxmox() : [];
  const realServers = store ? store.listServers() : [];
  const realHikvision = store ? store.listHikvision() : [];

  let nextU = totalU;
  const seenHosts = new Set<string>();

  // 1) Configured OPNsense Firewalls
  realOpnsense.forEach((opn, idx) => {
    const hostKey = opn.host.trim().toLowerCase();
    seenHosts.add(hostKey);
    const nodeId = `node-opn-${opn.id}`;
    const uSlot = Math.max(1, nextU);
    nextU = Math.max(1, nextU - 2);

    nodes.push({
      id: nodeId,
      canvasId: mainCanvasId,
      name: opn.name,
      kind: 'firewall',
      x: 440 + idx * 340,
      y: 55,
      ipAddress: opn.host,
      macAddress: '',
      hostname: opn.host,
      linkedSourceKind: 'opnsense',
      linkedSourceId: opn.id,
      tags: ['opnsense', 'firewall'],
      services: [
        {
          port: opn.port || 443,
          protocol: 'tcp',
          serviceName: 'OPNsense API / WebGUI',
          url: `${opn.protocol}://${opn.host}:${opn.port}`,
          status: 'online',
        },
      ],
      healthCheck: {
        method: opn.protocol === 'https' ? 'https' : 'http',
        target: `${opn.protocol}://${opn.host}:${opn.port}`,
        intervalSec: 30,
      },
      status: 'online',
      latencyMs: 1,
      lastCheckedAt: nowTs,
      rackPlacement: { rackId: mainRackId, startU: uSlot, heightU: 1, face: 'front' },
      createdAt: nowIso,
    });

    rackItems.push({
      id: `ritem-opn-${opn.id}`,
      nodeId,
      name: opn.name,
      kind: 'firewall',
      startU: uSlot,
      heightU: 1,
      face: 'front',
      ipAddress: opn.host,
      portCount: 8,
      sfpPortCount: 2,
      status: 'online',
      color: '#ea580c',
    });
  });

  // 2) Configured Proxmox VE Hosts
  realProxmox.forEach((pve, idx) => {
    const hostKey = pve.host.trim().toLowerCase();
    seenHosts.add(hostKey);
    const nodeId = `node-pve-${pve.id}`;
    const uSlot = Math.max(1, nextU - 1);
    nextU = Math.max(1, uSlot - 2);

    nodes.push({
      id: nodeId,
      canvasId: mainCanvasId,
      name: pve.name,
      kind: 'proxmox',
      x: 110 + idx * 360,
      y: 265,
      ipAddress: pve.host,
      macAddress: '',
      hostname: pve.host,
      linkedSourceKind: 'proxmox',
      linkedSourceId: pve.id,
      tags: ['proxmox', 'hypervisor'],
      services: [
        {
          port: pve.port || 8006,
          protocol: 'tcp',
          serviceName: 'Proxmox VE API',
          url: `https://${pve.host}:${pve.port || 8006}`,
          status: 'online',
        },
      ],
      healthCheck: { method: 'tcp', target: String(pve.port || 8006), intervalSec: 30 },
      status: 'online',
      latencyMs: 2,
      lastCheckedAt: nowTs,
      rackPlacement: { rackId: mainRackId, startU: uSlot, heightU: 2, face: 'front' },
      createdAt: nowIso,
    });

    rackItems.push({
      id: `ritem-pve-${pve.id}`,
      nodeId,
      name: pve.name,
      kind: 'proxmox',
      startU: uSlot,
      heightU: 2,
      face: 'front',
      ipAddress: pve.host,
      portCount: 4,
      sfpPortCount: 2,
      driveBays: 4,
      status: 'online',
      color: '#22c55e',
    });
  });

  // 3) Configured SSH Servers (skipping any duplicate host IP or name already mounted via Proxmox/OPNsense)
  realServers.forEach((srv, idx) => {
    const hostKey = srv.host.trim().toLowerCase();
    const nameKey = srv.name.trim().toLowerCase();
    const existingHigherPriorityNode = nodes.find(
      (n) =>
        (n.ipAddress && n.ipAddress.trim().toLowerCase() === hostKey) ||
        (n.kind === 'proxmox' && n.name.trim().toLowerCase() === nameKey),
    );

    // If this SSH server points to the same physical machine as a Proxmox / OPNsense node,
    // favor the Proxmox/OPNsense node and merge the SSH service port + tags into it instead of creating a duplicate node.
    if (existingHigherPriorityNode) {
      if (!existingHigherPriorityNode.services.some((s) => s.port === (srv.port || 22))) {
        existingHigherPriorityNode.services.push({
          port: srv.port || 22,
          protocol: 'tcp',
          serviceName: 'SSH',
          status: 'online',
        });
      }
      for (const tag of ['ssh', ...(srv.tags || [])]) {
        if (tag && !existingHigherPriorityNode.tags.includes(tag)) {
          existingHigherPriorityNode.tags.push(tag);
        }
      }
      return;
    }

    const nodeId = `node-ssh-${srv.id}`;
    seenHosts.add(hostKey);

    const uSlot = parseRackUnitSlot(srv.rackUnit, Math.max(1, nextU), totalU);
    nextU = Math.max(1, uSlot - 2);

    nodes.push({
      id: nodeId,
      canvasId: mainCanvasId,
      name: srv.name,
      kind: 'server',
      x: 470 + (idx % 3) * 340,
      y: 265 + Math.floor(idx / 3) * 215,
      ipAddress: srv.host,
      macAddress: '',
      hostname: srv.host,
      linkedSourceKind: 'ssh',
      linkedSourceId: srv.id,
      tags: ['ssh', ...(srv.tags || [])],
      services: [{ port: srv.port || 22, protocol: 'tcp', serviceName: 'SSH', status: 'online' }],
      healthCheck: { method: 'ssh', target: String(srv.port || 22), intervalSec: 60 },
      status: 'online',
      latencyMs: 2,
      lastCheckedAt: nowTs,
      rackPlacement: { rackId: mainRackId, startU: uSlot, heightU: 1, face: 'front' },
      createdAt: nowIso,
    });

    rackItems.push({
      id: `ritem-ssh-${srv.id}`,
      nodeId,
      name: srv.name,
      kind: 'server',
      startU: uSlot,
      heightU: 1,
      face: 'front',
      ipAddress: srv.host,
      portCount: 2,
      driveBays: 4,
      status: 'online',
      color: '#0284c7',
    });
  });

  // 4) Configured Hikvision NVRs / DVRs / Cameras
  realHikvision.forEach((hik, idx) => {
    const hostKey = hik.host.trim().toLowerCase();
    seenHosts.add(hostKey);
    const nodeId = `node-hik-${hik.id}`;
    const isCam = hik.deviceKind === 'camera';
    const heightU = isCam ? 1 : 2;
    const uSlot = Math.max(1, nextU - (heightU - 1));
    nextU = Math.max(1, uSlot - 2);

    nodes.push({
      id: nodeId,
      canvasId: mainCanvasId,
      name: hik.name,
      kind: isCam ? 'camera' : 'nvr',
      x: 810 + idx * 340,
      y: 265,
      ipAddress: hik.host,
      macAddress: '',
      hostname: hik.host,
      linkedSourceKind: 'hikvision',
      linkedSourceId: hik.id,
      tags: ['hikvision', hik.deviceKind],
      services: [
        { port: hik.port || 80, protocol: 'tcp', serviceName: 'Hikvision ISAPI', status: 'online' },
        { port: hik.rtspPort || 554, protocol: 'tcp', serviceName: 'RTSP Stream', status: 'online' },
      ],
      healthCheck: { method: 'tcp', target: String(hik.port || 80), intervalSec: 30 },
      status: 'online',
      latencyMs: 2,
      lastCheckedAt: nowTs,
      rackPlacement: !isCam
        ? { rackId: mainRackId, startU: uSlot, heightU: 2, face: 'front' }
        : undefined,
      createdAt: nowIso,
    });

    if (!isCam) {
      rackItems.push({
        id: `ritem-hik-${hik.id}`,
        nodeId,
        name: hik.name,
        kind: 'nvr',
        startU: uSlot,
        heightU: 2,
        face: 'front',
        ipAddress: hik.host,
        portCount: 16,
        sfpPortCount: 2,
        driveBays: 4,
        status: 'online',
        color: '#a855f7',
      });
    }
  });

  // Connect non-firewall nodes to the first configured OPNsense firewall (if present).
  // If switches are present, only wire switches directly to the firewall so end devices hang off their switch ports.
  const primaryFwNode = nodes.find((n) => n.kind === 'firewall');
  const primaryFwRackItem = rackItems.find((i) => i.kind === 'firewall');
  const hasSwitches = nodes.some((n) => n.kind === 'switch');
  if (primaryFwNode) {
    let portCounter = 1;
    for (const n of nodes) {
      if (n.id === primaryFwNode.id) continue;
      if (hasSwitches && n.kind !== 'switch') continue;
      links.push({
        id: `link-${primaryFwNode.id}-${n.id}`,
        canvasId: mainCanvasId,
        sourceId: primaryFwNode.id,
        targetId: n.id,
        kind: n.kind === 'proxmox' ? 'dac' : 'ethernet',
        label: n.kind === 'proxmox' ? '10G Trunk' : 'LAN Uplink',
        animated: true,
      });
    }
    if (primaryFwRackItem) {
      for (const rItem of rackItems) {
        if (rItem.id === primaryFwRackItem.id) continue;
        if (hasSwitches && rItem.kind !== 'switch') continue;
        rackPatches.push({
          id: `patch-${primaryFwRackItem.id}-${rItem.id}`,
          rackId: mainRackId,
          fromRackId: mainRackId,
          fromItemId: primaryFwRackItem.id,
          fromPort: String(portCounter++),
          toRackId: mainRackId,
          toItemId: rItem.id,
          toPort: '1',
          label: rItem.name,
          cableKind: rItem.kind === 'proxmox' ? 'dac-sfp+' : 'cat6a',
          color: rItem.kind === 'proxmox' ? '#38bdf8' : '#22c55e',
        });
      }
    }
  }

  const racks: TopologyRack[] = [
    {
      id: mainRackId,
      name: 'Primary Rack',
      widthInches: 19,
      totalU,
      location: 'Server Rack',
      createdAt: nowIso,
      items: rackItems,
      patches: rackPatches,
    },
  ];

  const deviceBullets =
    nodes.length > 0
      ? nodes.map((n) => `- [[${n.name}]] — \`${n.ipAddress}\` (${n.kind.toUpperCase()})`).join('\n')
      : '- No devices added yet. Add SSH servers, Proxmox VE, OPNsense, or Hikvision devices in Settings.';

  const docs: TopologyDocPage[] = [
    {
      id: 'doc-home',
      title: 'Rack Architecture & Runbook',
      slug: 'rack-architecture-runbook',
      icon: '[HOME]',
      isHome: true,
      tags: ['architecture', 'overview'],
      updatedAt: nowTs,
      content: `# Rack Architecture & Runbook\n\nLive documentation for devices configured in **RACK//PANEL**.\n\n## Configured Devices\n${deviceBullets}`,
      revisions: [
        {
          id: 'rev-init-home',
          timestamp: nowTs,
          summary: 'Generated from configured RACK//PANEL devices',
          content: `# Rack Architecture & Runbook\n\n${deviceBullets}`,
        },
      ],
    },
  ];

  return {
    canvases,
    nodes,
    links,
    racks,
    discoveryQueue: [],
    docs,
    gitSync: {
      repoPathOrUrl: '/Users/ashley/Developer/rack-panel',
      branch: 'main',
      autoCommit: false,
      lastSyncedAt: null,
      lastSyncMessage: 'Ready to export topology & wiki to Git',
    },
    shareEnabled: true,
    sharePasswordProtected: false,
  };
}

export class TopologyService {
  private data: PersistedTopologyData;
  private healthTimer: NodeJS.Timeout | null = null;
  private checkingHealth = false;
  private dbReady = false;
  private saveScheduled = false;
  private persistInFlight = false;
  private persistQueued = false;

  constructor(private readonly store?: ConfigStore, private readonly db?: TursoDatabase) {
    this.data = this.db ? buildDefaultTopologyState(this.store) : this.load();
    if (!this.db && this.deduplicateAndNormalizeNodes()) {
      this.save();
    }
  }

  async init(): Promise<void> {
    if (!this.db) return;
    await this.db.init();

    const [canvasRows, rackRows] = await Promise.all([
      this.db.drizzle.select({ id: topologyCanvases.id }).from(topologyCanvases).limit(1),
      this.db.drizzle.select({ id: topologyRacks.id }).from(topologyRacks).limit(1),
    ]);
    const hasRowsInDb = canvasRows.length > 0 || rackRows.length > 0;

    if (!hasRowsInDb && fs.existsSync(TOPOLOGY_FILE)) {
      this.data = this.load();
      this.deduplicateAndNormalizeNodes();
      this.autoWireAllSwitches();
      await this.persistToDb();
    } else if (hasRowsInDb) {
      this.data = await this.loadFromDb();
      const normChanged = this.deduplicateAndNormalizeNodes();
      const wiredCount = this.autoWireAllSwitches();
      if (normChanged || wiredCount > 0) {
        await this.persistToDb();
      }
    } else {
      this.data = buildDefaultTopologyState(this.store);
      this.deduplicateAndNormalizeNodes();
      this.autoWireAllSwitches();
      await this.persistToDb();
    }
    this.dbReady = true;
  }

  private async loadFromDb(): Promise<PersistedTopologyData> {
    if (!this.db) return buildDefaultTopologyState(this.store);
    const def = buildDefaultTopologyState(this.store);
    const dz = this.db.drizzle;

    const canvasRows = await dz.select().from(topologyCanvases);
    const canvases: TopologyCanvas[] =
      canvasRows.length > 0
        ? canvasRows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description || '',
            isDefault: Boolean(r.isDefault),
            createdAt: r.createdAt,
          }))
        : def.canvases;

    const nodeRows = await dz.select().from(topologyNodes);
    const nodes: TopologyNode[] = nodeRows.map((r) => ({
      id: r.id,
      canvasId: r.canvasId,
      name: r.name,
      kind: r.kind as TopologyNodeKind,
      x: Number(r.x),
      y: Number(r.y),
      ipAddress: r.ipAddress || '',
      macAddress: r.macAddress || '',
      hostname: r.hostname || '',
      vlan: r.vlan ?? null,
      subnet: r.subnet || '',
      manufacturer: r.manufacturer || '',
      osOrFirmware: r.osOrFirmware || '',
      parentId: r.parentId || undefined,
      linkedSourceKind: (r.linkedSourceKind || undefined) as TopologyNode['linkedSourceKind'],
      linkedSourceId: r.linkedSourceId || undefined,
      customIconUrl: r.customIconUrl || undefined,
      tags: JSON.parse(r.tagsJson || '[]'),
      services: JSON.parse(r.servicesJson || '[]'),
      healthCheck: JSON.parse(r.healthCheckJson || '{"method":"auto","intervalSec":60}'),
      status: (r.status || 'unknown') as TopologyNode['status'],
      latencyMs: r.latencyMs ?? null,
      lastCheckedAt: r.lastCheckedAt ?? null,
      statusDetail: r.statusDetail || undefined,
      rackPlacement: r.rackPlacementJson ? JSON.parse(r.rackPlacementJson) : undefined,
      meshInfo: r.meshInfoJson ? JSON.parse(r.meshInfoJson) : undefined,
      switchMeta: r.switchMetaJson ? JSON.parse(r.switchMetaJson) : undefined,
      docId: r.docId || undefined,
      createdAt: r.createdAt,
    }));

    const linkRows = await dz.select().from(topologyLinks);
    const links: TopologyLink[] = linkRows.map((r) => ({
      id: r.id,
      canvasId: r.canvasId,
      sourceId: r.sourceId,
      targetId: r.targetId,
      kind: r.kind as TopologyLinkKind,
      label: r.label || '',
      speedGbps: r.speedGbps || '',
      sourcePort: r.sourcePort || '',
      targetPort: r.targetPort || '',
      vlan: r.vlan ?? null,
      lqi: r.lqi ?? null,
      animated: Boolean(r.animated),
      linkedRackPatchId: r.linkedRackPatchId || undefined,
    }));

    const [rackRows, rackItemRows, rackPatchRows] = await Promise.all([
      dz.select().from(topologyRacks),
      dz.select().from(topologyRackItems),
      dz.select().from(topologyRackPatches),
    ]);

    const itemsByRack = new Map<string, TopologyRackSlotItem[]>();
    for (const r of rackItemRows) {
      const rackId = r.rackId;
      const list = itemsByRack.get(rackId) ?? [];
      list.push({
        id: r.id,
        nodeId: r.nodeId || undefined,
        name: r.name,
        kind: r.kind as TopologyRackSlotItem['kind'],
        startU: Number(r.startU),
        heightU: Number(r.heightU),
        face: r.face === 'rear' ? 'rear' : 'front',
        slotIndex: r.slotIndex ?? undefined,
        slotsTotal: r.slotsTotal ?? undefined,
        status: (r.status || 'online') as TopologyRackSlotItem['status'],
        ipAddress: r.ipAddress || '',
        portCount: r.portCount ?? undefined,
        sfpPortCount: r.sfpPortCount ?? undefined,
        driveBays: r.driveBays ?? undefined,
        outletCount: r.outletCount ?? undefined,
        color: r.color || '#0284c7',
        switchMeta: r.switchMetaJson ? JSON.parse(r.switchMetaJson) : undefined,
      });
      itemsByRack.set(rackId, list);
    }

    const patchesByRack = new Map<string, TopologyPatchCable[]>();
    for (const r of rackPatchRows) {
      const rackId = r.rackId;
      const list = patchesByRack.get(rackId) ?? [];
      list.push({
        id: r.id,
        rackId,
        fromRackId: r.fromRackId || rackId,
        fromItemId: r.fromItemId,
        fromPort: r.fromPort,
        toRackId: r.toRackId || rackId,
        toItemId: r.toItemId,
        toPort: r.toPort,
        label: r.label || '',
        cableKind: r.cableKind as TopologyPatchCable['cableKind'],
        color: r.color || '#22c55e',
        linkedTopologyLinkId: r.linkedTopologyLinkId || undefined,
      });
      patchesByRack.set(rackId, list);
    }

    const racks: TopologyRack[] =
      rackRows.length > 0
        ? rackRows.map((r) => ({
            id: r.id,
            name: r.name,
            widthInches: Number(r.widthInches) === 10 ? 10 : 19,
            totalU: Number(r.totalU),
            location: r.location || 'Server Rack',
            x: r.x ?? undefined,
            y: r.y ?? undefined,
            items: itemsByRack.get(r.id) ?? [],
            patches: patchesByRack.get(r.id) ?? [],
            createdAt: r.createdAt,
          }))
        : def.racks;

    const discRows = await dz.select().from(topologyDiscoveries);
    const discoveryQueue: TopologyDiscoveredDevice[] = discRows.map((r) => ({
      id: r.id,
      ipAddress: r.ipAddress,
      hostname: r.hostname,
      macAddress: r.macAddress || '',
      vendor: r.vendor || '',
      guessedKind: r.guessedKind as TopologyNodeKind,
      openPorts: JSON.parse(r.openPortsJson || '[]'),
      latencyMs: r.latencyMs ?? null,
      source: r.source as TopologyDiscoveredDevice['source'],
      switchModel: r.switchModel || undefined,
      discoveredAt: Number(r.discoveredAt),
      approved: Boolean(r.approved),
    }));

    const docRows = await dz.select().from(topologyDocs);
    const docs: TopologyDocPage[] =
      docRows.length > 0
        ? docRows.map((r) => ({
            id: r.id,
            title: r.title,
            slug: r.slug,
            icon: r.icon || '[DOC]',
            nodeId: r.nodeId || undefined,
            canvasId: r.canvasId || undefined,
            isHome: Boolean(r.isHome),
            content: r.content || '',
            tags: JSON.parse(r.tagsJson || '[]'),
            updatedAt: Number(r.updatedAt),
            revisions: JSON.parse(r.revisionsJson || '[]'),
          }))
        : def.docs;

    const metaRows = await dz.select().from(topologyMeta);
    const metaMap = new Map<string, string>();
    for (const r of metaRows) {
      metaMap.set(r.key, r.valueJson);
    }
    const gitSync = metaMap.has('gitSync') ? JSON.parse(metaMap.get('gitSync')!) : def.gitSync;
    const shareEnabled = metaMap.has('shareEnabled') ? Boolean(JSON.parse(metaMap.get('shareEnabled')!)) : true;
    const sharePasswordHash = metaMap.has('sharePasswordHash')
      ? String(JSON.parse(metaMap.get('sharePasswordHash')!))
      : undefined;

    return {
      canvases,
      nodes,
      links,
      racks,
      discoveryQueue,
      docs,
      gitSync,
      shareEnabled,
      sharePasswordProtected: Boolean(sharePasswordHash),
      sharePasswordHash,
    };
  }

  private persistToDb(): Promise<void> {
    if (!this.db) return Promise.resolve();
    const snap = JSON.parse(JSON.stringify(this.data)) as PersistedTopologyData;

    return this.db.runDrizzleTransaction(async (tx) => {
      await tx
        .insert(topologyMeta)
        .values({ key: 'gitSync', valueJson: JSON.stringify(snap.gitSync) })
        .onConflictDoUpdate({ target: topologyMeta.key, set: { valueJson: JSON.stringify(snap.gitSync) } });
      await tx
        .insert(topologyMeta)
        .values({ key: 'shareEnabled', valueJson: JSON.stringify(snap.shareEnabled) })
        .onConflictDoUpdate({ target: topologyMeta.key, set: { valueJson: JSON.stringify(snap.shareEnabled) } });
      if (snap.sharePasswordHash) {
        await tx
          .insert(topologyMeta)
          .values({ key: 'sharePasswordHash', valueJson: JSON.stringify(snap.sharePasswordHash) })
          .onConflictDoUpdate({ target: topologyMeta.key, set: { valueJson: JSON.stringify(snap.sharePasswordHash) } });
      } else {
        await tx.delete(topologyMeta).where(eq(topologyMeta.key, 'sharePasswordHash'));
      }

      await tx.delete(topologyCanvases);
      if (snap.canvases.length > 0) {
        await tx
          .insert(topologyCanvases)
          .values(
            snap.canvases.map((c) => ({
              id: c.id,
              name: c.name || 'Canvas',
              description: c.description || '',
              isDefault: c.isDefault ? 1 : 0,
              createdAt: c.createdAt || new Date().toISOString(),
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(topologyNodes);
      if (snap.nodes.length > 0) {
        await tx
          .insert(topologyNodes)
          .values(
            snap.nodes.map((n) => ({
              id: n.id,
              canvasId: n.canvasId || 'canvas-main',
              name: n.name || n.ipAddress || n.id,
              kind: n.kind || 'generic',
              x: Number(n.x || 0),
              y: Number(n.y || 0),
              ipAddress: n.ipAddress || '',
              macAddress: n.macAddress || '',
              hostname: n.hostname || '',
              vlan: n.vlan ?? null,
              subnet: n.subnet || '',
              manufacturer: n.manufacturer || '',
              osOrFirmware: n.osOrFirmware || '',
              parentId: n.parentId || null,
              linkedSourceKind: n.linkedSourceKind || null,
              linkedSourceId: n.linkedSourceId || null,
              customIconUrl: n.customIconUrl || null,
              tagsJson: JSON.stringify(n.tags || []),
              servicesJson: JSON.stringify(n.services || []),
              healthCheckJson: JSON.stringify(n.healthCheck || { method: 'auto', intervalSec: 60 }),
              status: n.status || 'unknown',
              latencyMs: n.latencyMs ?? null,
              lastCheckedAt: n.lastCheckedAt ?? null,
              statusDetail: n.statusDetail || null,
              rackPlacementJson: n.rackPlacement ? JSON.stringify(n.rackPlacement) : null,
              meshInfoJson: n.meshInfo ? JSON.stringify(n.meshInfo) : null,
              switchMetaJson: n.switchMeta ? JSON.stringify(n.switchMeta) : null,
              docId: n.docId || null,
              createdAt: n.createdAt || new Date().toISOString(),
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(topologyLinks);
      if (snap.links.length > 0) {
        await tx
          .insert(topologyLinks)
          .values(
            snap.links.map((l) => ({
              id: l.id,
              canvasId: l.canvasId || 'canvas-main',
              sourceId: l.sourceId,
              targetId: l.targetId,
              kind: l.kind || 'ethernet',
              label: l.label || '',
              speedGbps: l.speedGbps || '',
              sourcePort: l.sourcePort || '',
              targetPort: l.targetPort || '',
              vlan: l.vlan ?? null,
              lqi: l.lqi ?? null,
              animated: l.animated ? 1 : 0,
              linkedRackPatchId: l.linkedRackPatchId || null,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(topologyRackPatches);
      await tx.delete(topologyRackItems);
      await tx.delete(topologyRacks);
      if (snap.racks.length > 0) {
        await tx
          .insert(topologyRacks)
          .values(
            snap.racks.map((r) => ({
              id: r.id,
              name: r.name || 'Rack',
              widthInches: r.widthInches || 19,
              totalU: r.totalU || 42,
              location: r.location || '',
              x: r.x ?? null,
              y: r.y ?? null,
              createdAt: r.createdAt || new Date().toISOString(),
            })),
          )
          .onConflictDoNothing();

        const allItems = snap.racks.flatMap((r) =>
          r.items.map((it) => ({
            id: it.id,
            rackId: r.id,
            nodeId: it.nodeId || null,
            name: it.name || 'Device',
            kind: it.kind || 'generic',
            startU: Number(it.startU || 1),
            heightU: Number(it.heightU || 1),
            face: it.face === 'rear' ? 'rear' : 'front',
            slotIndex: it.slotIndex ?? null,
            slotsTotal: it.slotsTotal ?? null,
            status: it.status || 'online',
            ipAddress: it.ipAddress || '',
            portCount: it.portCount ?? null,
            sfpPortCount: it.sfpPortCount ?? null,
            driveBays: it.driveBays ?? null,
            outletCount: it.outletCount ?? null,
            color: it.color || '#0284c7',
            switchMetaJson: it.switchMeta ? JSON.stringify(it.switchMeta) : null,
          })),
        );
        if (allItems.length > 0) {
          await tx.insert(topologyRackItems).values(allItems).onConflictDoNothing();
        }

        const allPatches = snap.racks.flatMap((r) =>
          r.patches.map((p) => ({
            id: p.id,
            rackId: r.id,
            fromRackId: p.fromRackId || r.id,
            fromItemId: p.fromItemId,
            fromPort: p.fromPort || '',
            toRackId: p.toRackId || r.id,
            toItemId: p.toItemId,
            toPort: p.toPort || '',
            label: p.label || '',
            cableKind: p.cableKind || 'ethernet',
            color: p.color || '#22c55e',
            linkedTopologyLinkId: p.linkedTopologyLinkId || null,
          })),
        );
        if (allPatches.length > 0) {
          await tx.insert(topologyRackPatches).values(allPatches).onConflictDoNothing();
        }
      }

      await tx.delete(topologyDiscoveries);
      if (snap.discoveryQueue.length > 0) {
        await tx
          .insert(topologyDiscoveries)
          .values(
            snap.discoveryQueue.map((d) => ({
              id: d.id,
              ipAddress: d.ipAddress || '',
              hostname: d.hostname || d.ipAddress || '',
              macAddress: d.macAddress || '',
              vendor: d.vendor || '',
              guessedKind: d.guessedKind || 'generic',
              openPortsJson: JSON.stringify(d.openPorts || []),
              latencyMs: d.latencyMs ?? null,
              source: d.source || 'scan',
              switchModel: d.switchModel || null,
              discoveredAt: Number(d.discoveredAt || Date.now()),
              approved: d.approved ? 1 : 0,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(topologyDocs);
      if (snap.docs.length > 0) {
        await tx
          .insert(topologyDocs)
          .values(
            snap.docs.map((d) => ({
              id: d.id,
              title: d.title || 'Untitled',
              slug: d.slug || d.id,
              icon: d.icon || '[DOC]',
              nodeId: d.nodeId || null,
              canvasId: d.canvasId || null,
              isHome: d.isHome ? 1 : 0,
              content: d.content || '',
              tagsJson: JSON.stringify(d.tags || []),
              updatedAt: Number(d.updatedAt || Date.now()),
              revisionsJson: JSON.stringify(d.revisions || []),
            })),
          )
          .onConflictDoNothing();
      }
    });
  }

  /**
   * Deduplicates nodes on each canvas that refer to the same physical machine (e.g. a Proxmox VE node
   * and an SSH server entry pointing to the same IP/host), always favoring `proxmox` over `server`,
   * and removes redundant virtual links between a Proxmox host and its nested guests.
   */
  private deduplicateAndNormalizeNodes(): boolean {
    let changed = false;
    const configuredProxmox = this.store ? this.store.listProxmox() : [];
    const proxmoxByHost = new Map<string, (typeof configuredProxmox)[number]>();
    const proxmoxByName = new Map<string, (typeof configuredProxmox)[number]>();
    for (const p of configuredProxmox) {
      if (p.host) proxmoxByHost.set(p.host.trim().toLowerCase(), p);
      if (p.name) proxmoxByName.set(p.name.trim().toLowerCase(), p);
    }

    // 1. Restore any Proxmox host node whose kind was accidentally overwritten to 'server' by an SSH sync
    for (const node of this.data.nodes) {
      if (node.macAddress && !node.macAddress.startsWith('standalone:')) {
        const normMac = this.normalizeMac(node.macAddress);
        if (normMac && normMac !== node.macAddress) {
          node.macAddress = normMac;
          changed = true;
        }
      }
      if (node.parentId || node.kind === 'lxc' || node.kind === 'vm' || node.kind === 'docker') continue;
      const ipKey = (node.ipAddress || '').trim().toLowerCase();
      const nameKey = (node.name || '').trim().toLowerCase();
      const matchedPve =
        (ipKey && proxmoxByHost.get(ipKey)) ||
        proxmoxByName.get(nameKey) ||
        (node.id.startsWith('node-pve-') ? configuredProxmox[0] : undefined);
      const looksLikeProxmoxHost =
        Boolean(matchedPve) ||
        node.id.startsWith('node-pve-') ||
        node.services.some((s) => s.port === 8006) ||
        this.data.nodes.some((child) => child.parentId === node.id && (child.kind === 'lxc' || child.kind === 'vm'));

      if (looksLikeProxmoxHost && node.kind !== 'proxmox') {
        node.kind = 'proxmox';
        node.linkedSourceKind = 'proxmox';
        if (matchedPve) {
          node.linkedSourceId = matchedPve.id;
        }
        changed = true;
      }
      if (looksLikeProxmoxHost && matchedPve && node.linkedSourceKind !== 'proxmox') {
        node.linkedSourceKind = 'proxmox';
        node.linkedSourceId = matchedPve.id;
        changed = true;
      }
    }

    // 2. Deduplicate top-level physical host nodes on the same canvas that share the same IP (or same name for Proxmox + Server)
    const kindPriority: Record<string, number> = {
      proxmox: 100,
      firewall: 95,
      nvr: 90,
      nas: 85,
      switch: 80,
      router: 75,
      ai: 70,
      ap: 65,
      server: 40,
      generic: 10,
    };

    const redirectMap = new Map<string, string>(); // loserNodeId -> winnerNodeId
    const keptTopLevelByCanvasAndIp = new Map<string, TopologyNode>();
    const keptProxmoxByCanvasAndName = new Map<string, TopologyNode>();

    // Sort candidate top-level nodes so higher-priority kinds (e.g., proxmox) are evaluated first
    const topLevelNodes = this.data.nodes
      .filter((n) => !n.parentId && n.kind !== 'lxc' && n.kind !== 'vm' && n.kind !== 'docker' && n.kind !== 'camera')
      .sort((a, b) => {
        const pa = (kindPriority[a.kind] || 20) + (a.id.startsWith('node-pve-') ? 5 : 0);
        const pb = (kindPriority[b.kind] || 20) + (b.id.startsWith('node-pve-') ? 5 : 0);
        return pb - pa;
      });

    for (const node of topLevelNodes) {
      const ipKey = (node.ipAddress || '').trim().toLowerCase();
      const nameKey = (node.name || '').trim().toLowerCase();
      const canvasIpKey = ipKey ? `${node.canvasId}::ip::${ipKey}` : '';
      const canvasNameKey = nameKey ? `${node.canvasId}::name::${nameKey}` : '';

      const existingWinner =
        (canvasIpKey && keptTopLevelByCanvasAndIp.get(canvasIpKey)) ||
        (canvasNameKey && keptProxmoxByCanvasAndName.get(canvasNameKey));

      if (existingWinner && existingWinner.id !== node.id) {
        // Merge node into existingWinner
        redirectMap.set(node.id, existingWinner.id);
        for (const srv of node.services) {
          if (!existingWinner.services.some((s) => s.port === srv.port)) {
            existingWinner.services.push(srv);
          }
        }
        for (const tag of node.tags) {
          if (tag && !existingWinner.tags.includes(tag)) {
            existingWinner.tags.push(tag);
          }
        }
        if (!existingWinner.rackPlacement && node.rackPlacement) {
          existingWinner.rackPlacement = node.rackPlacement;
        }
        if (!existingWinner.docId && node.docId) {
          existingWinner.docId = node.docId;
        }
        if (!existingWinner.osOrFirmware && node.osOrFirmware) {
          existingWinner.osOrFirmware = node.osOrFirmware;
        }
        changed = true;
      } else {
        if (canvasIpKey) keptTopLevelByCanvasAndIp.set(canvasIpKey, node);
        if (canvasNameKey && (node.kind === 'proxmox' || node.kind === 'server')) {
          keptProxmoxByCanvasAndName.set(canvasNameKey, node);
        }
      }
    }

    if (redirectMap.size > 0) {
      this.data.nodes = this.data.nodes.filter((n) => !redirectMap.has(n.id));
      for (const n of this.data.nodes) {
        if (n.parentId && redirectMap.has(n.parentId)) {
          n.parentId = redirectMap.get(n.parentId);
        }
      }
      for (const l of this.data.links) {
        if (redirectMap.has(l.sourceId)) l.sourceId = redirectMap.get(l.sourceId)!;
        if (redirectMap.has(l.targetId)) l.targetId = redirectMap.get(l.targetId)!;
      }
      for (const d of this.data.docs) {
        if (d.nodeId && redirectMap.has(d.nodeId)) d.nodeId = redirectMap.get(d.nodeId);
      }
      for (const r of this.data.racks) {
        const seenWinnerInRack = new Set<string>();
        const dedupedItems: TopologyRackSlotItem[] = [];
        for (const it of r.items) {
          if (it.nodeId && redirectMap.has(it.nodeId)) {
            it.nodeId = redirectMap.get(it.nodeId);
          }
          const winnerNode = it.nodeId ? this.data.nodes.find((n) => n.id === it.nodeId) : undefined;
          if (winnerNode && winnerNode.kind === 'proxmox' && it.kind === 'server') {
            it.kind = 'proxmox';
            it.heightU = Math.max(2, it.heightU);
            it.driveBays = Math.max(4, it.driveBays || 4);
          }
          if (it.nodeId) {
            if (seenWinnerInRack.has(it.nodeId)) {
              continue;
            }
            seenWinnerInRack.add(it.nodeId);
          }
          dedupedItems.push(it);
        }
        r.items = dedupedItems;
      }
    }

    // 3. Remove virtual links between Proxmox/NVR hosts and their nested VM/LXC/Camera children, plus any self-links or duplicate links
    const proxmoxHostIds = new Set(this.data.nodes.filter((n) => n.kind === 'proxmox').map((n) => n.id));
    const nvrHostIds = new Set(this.data.nodes.filter((n) => n.kind === 'nvr').map((n) => n.id));
    const nestedChildIds = new Set(
      this.data.nodes
        .filter(
          (n) =>
            ((n.kind === 'lxc' || n.kind === 'vm') && n.parentId && proxmoxHostIds.has(n.parentId)) ||
            (n.kind === 'camera' && n.parentId && nvrHostIds.has(n.parentId)),
        )
        .map((n) => n.id),
    );

    const seenLinkPairs = new Set<string>();
    const beforeLinks = this.data.links.length;
    this.data.links = this.data.links.filter((l) => {
      if (l.sourceId === l.targetId) return false;
      if (nestedChildIds.has(l.sourceId) || nestedChildIds.has(l.targetId)) {
        return false;
      }
      const pairKey =
        l.sourceId < l.targetId
          ? `${l.canvasId}::${l.sourceId}::${l.targetId}::${l.sourcePort || ''}::${l.targetPort || ''}`
          : `${l.canvasId}::${l.targetId}::${l.sourceId}::${l.targetPort || ''}::${l.sourcePort || ''}`;
      if (seenLinkPairs.has(pairKey)) return false;
      seenLinkPairs.add(pairKey);
      return true;
    });
    if (this.data.links.length !== beforeLinks) {
      changed = true;
    }

    // 4. Normalize known non-PoE switch models (e.g. T1600G-28TS) that were previously misclassified as PoE
    const normalizeNonPoeSwitchMeta = (meta: TopologySwitchMetadata | undefined): boolean => {
      if (!meta?.model) return false;
      const spec = SWITCH_MODEL_SPECS[meta.model.toUpperCase()];
      if (!spec || spec.poeSupported) return false;
      let metaChanged = false;
      if (meta.poeSupported) {
        meta.poeSupported = false;
        metaChanged = true;
      }
      if (meta.poeBudgetWatts !== undefined) {
        delete meta.poeBudgetWatts;
        metaChanged = true;
      }
      if (meta.poeUsedWatts !== undefined) {
        delete meta.poeUsedWatts;
        metaChanged = true;
      }
      if (Array.isArray(meta.ports)) {
        for (const port of meta.ports) {
          if (port.poeSupported || port.poeActive || (port.poeWatts ?? 0) > 0) {
            port.poeSupported = false;
            port.poeActive = false;
            port.poeWatts = 0;
            metaChanged = true;
          }
        }
      }
      return metaChanged;
    };

    for (const node of this.data.nodes) {
      if (node.kind !== 'switch' || !node.switchMeta?.model) continue;
      const spec = SWITCH_MODEL_SPECS[node.switchMeta.model.toUpperCase()];
      if (!spec || spec.poeSupported) continue;
      if (normalizeNonPoeSwitchMeta(node.switchMeta)) {
        changed = true;
      }
      if (Array.isArray(node.tags) && node.tags.some((t) => t === 'poe+' || t === 'poe')) {
        node.tags = node.tags.filter((t) => t !== 'poe+' && t !== 'poe');
        changed = true;
      }
      if (node.statusDetail && /\s*·\s*PoE\s+[\d.]+W\/[\d.]+W/i.test(node.statusDetail)) {
        node.statusDetail = node.statusDetail.replace(/\s*·\s*PoE\s+[\d.]+W\/[\d.]+W/i, '');
        changed = true;
      }
    }

    for (const rack of this.data.racks) {
      for (const item of rack.items) {
        if (item.kind === 'switch' && normalizeNonPoeSwitchMeta(item.switchMeta)) {
          changed = true;
        }
      }
    }

    return changed;
  }

  private load(): PersistedTopologyData {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(TOPOLOGY_FILE)) {
      const initial = buildDefaultTopologyState(this.store);
      this.saveRaw(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(TOPOLOGY_FILE, 'utf8')) as Partial<PersistedTopologyData>;
      const def = buildDefaultTopologyState(this.store);
      return {
        canvases: Array.isArray(parsed.canvases) && parsed.canvases.length > 0 ? parsed.canvases : def.canvases,
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : def.nodes,
        links: Array.isArray(parsed.links) ? parsed.links : def.links,
        racks: Array.isArray(parsed.racks) && parsed.racks.length > 0 ? parsed.racks : def.racks,
        discoveryQueue: Array.isArray(parsed.discoveryQueue) ? parsed.discoveryQueue : [],
        docs: Array.isArray(parsed.docs) && parsed.docs.length > 0 ? parsed.docs : def.docs,
        gitSync: parsed.gitSync ?? def.gitSync,
        shareEnabled: parsed.shareEnabled ?? true,
        sharePasswordProtected: Boolean(parsed.sharePasswordHash),
        sharePasswordHash: parsed.sharePasswordHash,
      };
    } catch {
      return buildDefaultTopologyState(this.store);
    }
  }

  private saveRaw(data: PersistedTopologyData): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(TOPOLOGY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  private flushDbSave(): void {
    if (this.persistInFlight) {
      this.persistQueued = true;
      return;
    }
    this.persistInFlight = true;
    void this.persistToDb()
      .catch((err) => {
        console.error('[turso] topologyService persist error:', err);
      })
      .finally(() => {
        this.persistInFlight = false;
        if (this.persistQueued) {
          this.persistQueued = false;
          this.flushDbSave();
        }
      });
  }

  private save(): void {
    this.data.sharePasswordProtected = Boolean(this.data.sharePasswordHash);
    if (this.db) {
      if (this.dbReady) {
        if (!this.saveScheduled) {
          this.saveScheduled = true;
          queueMicrotask(() => {
            this.saveScheduled = false;
            this.flushDbSave();
          });
        }
      }
      return;
    }
    this.saveRaw(this.data);
  }

  getState(): TopologyState {
    if (this.deduplicateAndNormalizeNodes()) {
      this.save();
    }
    const { sharePasswordHash: _omit, ...publicState } = this.data;
    return {
      ...publicState,
      sharePasswordProtected: Boolean(this.data.sharePasswordHash),
    };
  }

  /**
   * Resets the topology canvas (wires, custom nodes, all nodes, or discovery queue),
   * resets the physical rack builder, or resets both back to the clean default.
   */
  resetState(
    scope: 'all' | 'canvas' | 'racks' = 'all',
    canvasOptions?: {
      resetWires?: boolean;
      resetCustomNodes?: boolean;
      resetAllNodes?: boolean;
      resetDiscovery?: boolean;
      canvasId?: string;
    },
  ): TopologyState {
    if (scope === 'canvas') {
      const targetCanvasId = canvasOptions?.canvasId;
      const hasExplicitOpts =
        canvasOptions &&
        (canvasOptions.resetWires !== undefined ||
          canvasOptions.resetCustomNodes !== undefined ||
          canvasOptions.resetAllNodes !== undefined ||
          canvasOptions.resetDiscovery !== undefined);
      const doWires = hasExplicitOpts ? Boolean(canvasOptions?.resetWires) : true;
      const doCustomNodes = Boolean(canvasOptions?.resetCustomNodes);
      const doAllNodes = Boolean(canvasOptions?.resetAllNodes);
      const doDiscovery = Boolean(canvasOptions?.resetDiscovery);

      if (doAllNodes) {
        const fresh = buildDefaultTopologyState(this.store);
        const mainCanvasId = targetCanvasId || fresh.canvases[0]?.id || 'canvas-main';
        const rackNodeIds = new Set<string>();
        for (const r of this.data.racks) {
          for (const it of r.items) {
            if (it.nodeId) rackNodeIds.add(it.nodeId);
          }
        }
        const preservedSwitchesAndRack = this.data.nodes.filter(
          (n) => n.kind === 'switch' || Boolean(n.switchMeta) || rackNodeIds.has(n.id) || Boolean(n.rackPlacement),
        );
        const mergedNodes = [...fresh.nodes];
        for (const pn of preservedSwitchesAndRack) {
          const exists = mergedNodes.some(
            (fn) => fn.id === pn.id || (pn.ipAddress && fn.ipAddress && fn.ipAddress.toLowerCase() === pn.ipAddress.toLowerCase()),
          );
          if (!exists) mergedNodes.push({ ...pn, canvasId: mainCanvasId });
        }
        this.data.nodes = mergedNodes;
      } else if (doCustomNodes) {
        const rackNodeIds = new Set<string>();
        for (const r of this.data.racks) {
          for (const it of r.items) {
            if (it.nodeId) rackNodeIds.add(it.nodeId);
          }
        }
        this.data.nodes = this.data.nodes.filter((n) => {
          if (targetCanvasId && n.canvasId !== targetCanvasId) return true;
          return (
            Boolean(n.linkedSourceKind) ||
            n.kind === 'switch' ||
            Boolean(n.switchMeta) ||
            rackNodeIds.has(n.id) ||
            Boolean(n.rackPlacement)
          );
        });
      }

      if (doWires) {
        if (targetCanvasId) {
          this.data.links = this.data.links.filter((l) => l.canvasId !== targetCanvasId);
        } else {
          this.data.links = [];
        }
      } else if (doCustomNodes || doAllNodes) {
        const remainingIds = new Set(this.data.nodes.map((n) => n.id));
        this.data.links = this.data.links.filter((l) => remainingIds.has(l.sourceId) && remainingIds.has(l.targetId));
      }

      if (doDiscovery) {
        this.data.discoveryQueue = [];
      }

      this.save();
      return this.getState();
    }
    const fresh = buildDefaultTopologyState(this.store);
    if (scope === 'racks') {
      this.data.racks = fresh.racks;
    } else {
      this.data.canvases = fresh.canvases;
      this.data.nodes = fresh.nodes;
      this.data.links = fresh.links;
      this.data.racks = fresh.racks;
      this.data.discoveryQueue = [];
      this.data.docs = fresh.docs;
    }
    this.save();
    return this.getState();
  }

  startBackgroundHealthChecks(onUpdate?: () => void): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    setTimeout(() => {
      void this.reprobeCanvasSwitches(undefined, true).then((cnt) => {
        if (cnt > 0 && onUpdate) onUpdate();
      });
    }, 4000);
    this.healthTimer = setInterval(() => {
      void this.runHealthChecks().then(() => {
        if (onUpdate) onUpdate();
      });
    }, 45000);
  }

  stopBackgroundHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  // ---- Canvases CRUD ----

  createCanvas(input: { name: string; description?: string }): TopologyCanvas {
    const canvas: TopologyCanvas = {
      id: `canvas-${crypto.randomBytes(4).toString('hex')}`,
      name: String(input.name || 'New Topology Canvas').trim(),
      description: String(input.description || '').trim(),
      isDefault: this.data.canvases.length === 0,
      createdAt: new Date().toISOString(),
    };
    this.data.canvases.push(canvas);
    this.save();
    return canvas;
  }

  deleteCanvas(canvasId: string): boolean {
    if (this.data.canvases.length <= 1) {
      throw new Error('Cannot delete the last topology canvas');
    }
    const before = this.data.canvases.length;
    this.data.canvases = this.data.canvases.filter((c) => c.id !== canvasId);
    if (this.data.canvases.length !== before) {
      this.data.nodes = this.data.nodes.filter((n) => n.canvasId !== canvasId);
      this.data.links = this.data.links.filter((l) => l.canvasId !== canvasId);
      this.save();
      return true;
    }
    return false;
  }

  // ---- Nodes & Links CRUD ----

  upsertNode(input: Partial<TopologyNode> & { name: string }): TopologyNode {
    const existing = input.id ? this.data.nodes.find((n) => n.id === input.id) : undefined;
    const defaultCanvasId = this.data.canvases[0]?.id || 'canvas-main';
    const record: TopologyNode = {
      id: existing?.id ?? `node-${crypto.randomBytes(4).toString('hex')}`,
      canvasId: input.canvasId || existing?.canvasId || defaultCanvasId,
      name: String(input.name || 'Unnamed Device').trim(),
      kind: input.kind || existing?.kind || 'generic',
      x: typeof input.x === 'number' ? Math.round(input.x) : existing?.x ?? 240,
      y: typeof input.y === 'number' ? Math.round(input.y) : existing?.y ?? 200,
      ipAddress: String(input.ipAddress ?? existing?.ipAddress ?? '').trim(),
      macAddress: String(input.macAddress ?? existing?.macAddress ?? '').trim(),
      hostname: String(input.hostname ?? existing?.hostname ?? '').trim(),
      vlan: input.vlan !== undefined ? input.vlan : existing?.vlan ?? null,
      subnet: input.subnet ?? existing?.subnet ?? '',
      manufacturer:
        input.manufacturer ??
        existing?.manufacturer ??
        lookupMacVendor(input.macAddress || existing?.macAddress || ''),
      osOrFirmware: input.osOrFirmware ?? existing?.osOrFirmware ?? '',
      parentId: input.parentId !== undefined ? input.parentId : existing?.parentId,
      linkedSourceKind: input.linkedSourceKind ?? existing?.linkedSourceKind,
      linkedSourceId: input.linkedSourceId ?? existing?.linkedSourceId,
      customIconUrl: input.customIconUrl ?? existing?.customIconUrl,
      tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags ?? [],
      services: Array.isArray(input.services) ? input.services : existing?.services ?? [],
      healthCheck: input.healthCheck ??
        existing?.healthCheck ?? {
          method: 'auto',
          target: '',
          intervalSec: 60,
        },
      status: input.status ?? existing?.status ?? 'unknown',
      latencyMs: input.latencyMs !== undefined ? input.latencyMs : existing?.latencyMs ?? null,
      lastCheckedAt: input.lastCheckedAt !== undefined ? input.lastCheckedAt : existing?.lastCheckedAt ?? null,
      statusDetail: input.statusDetail ?? existing?.statusDetail,
      rackPlacement: input.rackPlacement !== undefined ? input.rackPlacement : existing?.rackPlacement,
      meshInfo: input.meshInfo !== undefined ? input.meshInfo : existing?.meshInfo,
      switchMeta: input.switchMeta !== undefined ? input.switchMeta : existing?.switchMeta,
      docId: input.docId ?? existing?.docId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    // If this is a switch node and has no switchMeta yet, initialize from any detected model name in its title/OS
    if (record.kind === 'switch' && !record.switchMeta) {
      const m = `${record.name} ${record.osOrFirmware || ''}`.match(
        /\b(T1600G-28PS|T1600G-28TS|T2600G-28TS|TL-SG3428|TL-SG2428P|CRS326|CISCO-28P|UBIQUITI-24P)\b/i,
      );
      if (m) {
        const key = m[1].toUpperCase().startsWith('CRS326') ? 'MIKROTIK-CRS326' : m[1].toUpperCase();
        record.switchMeta = buildSwitchMetadataFromPreset(key);
      }
    }

    if (existing) {
      const idx = this.data.nodes.findIndex((n) => n.id === existing.id);
      this.data.nodes[idx] = record;
    } else {
      this.data.nodes.push(record);
    }
    if (record.macAddress) {
      this.autoWireAllSwitches(record.canvasId);
    }
    this.save();
    return record;
  }

  updateNodePositions(positions: Array<{ id: string; x: number; y: number }>): void {
    for (const pos of positions) {
      const node = this.data.nodes.find((n) => n.id === pos.id);
      if (node && typeof pos.x === 'number' && typeof pos.y === 'number') {
        node.x = Math.round(pos.x);
        node.y = Math.round(pos.y);
      }
    }
    this.save();
  }

  deleteNode(nodeId: string): boolean {
    const before = this.data.nodes.length;
    this.data.nodes = this.data.nodes.filter((n) => n.id !== nodeId);
    if (this.data.nodes.length !== before) {
      const removedLinkIds = new Set(
        this.data.links.filter((l) => l.sourceId === nodeId || l.targetId === nodeId).map((l) => l.id),
      );
      this.data.links = this.data.links.filter((l) => l.sourceId !== nodeId && l.targetId !== nodeId);
      for (const n of this.data.nodes) {
        if (n.parentId === nodeId) n.parentId = undefined;
      }
      for (const r of this.data.racks) {
        for (const it of r.items) {
          if (it.nodeId === nodeId) it.nodeId = undefined;
        }
        if (removedLinkIds.size > 0) {
          r.patches = r.patches.filter(
            (p) => !p.linkedTopologyLinkId || !removedLinkIds.has(p.linkedTopologyLinkId),
          );
        }
      }
      this.save();
      return true;
    }
    return false;
  }

  private mapRackKindToNodeKind(kind: TopologyRackSlotItem['kind']): TopologyNodeKind {
    if (kind === 'patch-panel' || kind === 'fiber-patch' || kind === 'switch') return 'switch';
    if (kind === 'pdu' || kind === 'ups') return 'electric';
    if (kind === 'mini-pc') return 'server';
    if (kind === 'blank' || kind === 'cable-manager' || kind === 'shelf') return 'generic';
    return kind as TopologyNodeKind;
  }

  private mapCableKindToLinkKind(cableKind: TopologyPatchCable['cableKind']): TopologyLinkKind {
    if (cableKind === 'dac-sfp+') return 'dac';
    if (cableKind === 'fiber-om4') return 'fiber';
    if (cableKind === 'poe') return 'poe';
    if (cableKind === 'power') return 'power';
    return 'ethernet';
  }

  private mapLinkKindToCableStyle(linkKind: TopologyLinkKind): {
    cableKind: TopologyPatchCable['cableKind'];
    color: string;
  } {
    if (linkKind === 'dac') return { cableKind: 'dac-sfp+', color: '#38bdf8' };
    if (linkKind === 'fiber') return { cableKind: 'fiber-om4', color: '#f59e0b' };
    if (linkKind === 'poe') return { cableKind: 'poe', color: '#a855f7' };
    if (linkKind === 'power') return { cableKind: 'power', color: '#ef4444' };
    return { cableKind: 'cat6a', color: '#22c55e' };
  }

  private findRackItemAcrossRacks(itemId: string): { rack: TopologyRack; item: TopologyRackSlotItem } | null {
    for (const rack of this.data.racks) {
      const item = rack.items.find((i) => i.id === itemId);
      if (item) return { rack, item };
    }
    return null;
  }

  private findRackItemForNode(node: TopologyNode): { rack: TopologyRack; item: TopologyRackSlotItem } | null {
    for (const rack of this.data.racks) {
      const byNodeId = rack.items.find((i) => i.nodeId && i.nodeId === node.id);
      if (byNodeId) return { rack, item: byNodeId };
    }
    if (node.ipAddress) {
      const ipLower = node.ipAddress.toLowerCase();
      for (const rack of this.data.racks) {
        const byIp = rack.items.find((i) => i.ipAddress && i.ipAddress.toLowerCase() === ipLower);
        if (byIp) {
          byIp.nodeId = node.id;
          return { rack, item: byIp };
        }
      }
    }
    const nameLower = node.name.toLowerCase();
    for (const rack of this.data.racks) {
      const byName = rack.items.find(
        (i) =>
          i.kind !== 'blank' &&
          i.kind !== 'cable-manager' &&
          i.kind !== 'shelf' &&
          i.name.toLowerCase() === nameLower,
      );
      if (byName) {
        byName.nodeId = node.id;
        return { rack, item: byName };
      }
    }
    return null;
  }

  private ensureNodeForRackItem(
    rackId: string,
    item: TopologyRackSlotItem,
    createIfMissing = true,
  ): TopologyNode | null {
    const isPassive = item.kind === 'blank' || item.kind === 'cable-manager' || item.kind === 'shelf';
    if (isPassive) return null;

    let node: TopologyNode | undefined;
    if (item.nodeId) {
      node = this.data.nodes.find((n) => n.id === item.nodeId);
    }
    if (!node && item.ipAddress) {
      const ipLower = item.ipAddress.toLowerCase();
      node = this.data.nodes.find((n) => n.ipAddress && n.ipAddress.toLowerCase() === ipLower);
    }
    if (!node) {
      const nameLower = item.name.toLowerCase();
      node = this.data.nodes.find((n) => n.name.toLowerCase() === nameLower);
    }

    if (node) {
      item.nodeId = node.id;
      node.rackPlacement = {
        rackId,
        startU: item.startU,
        heightU: item.heightU,
        face: item.face === 'rear' ? 'rear' : 'front',
      };
      if (item.ipAddress && !node.ipAddress) {
        node.ipAddress = item.ipAddress;
      }
      return node;
    }

    if (!createIfMissing) return null;

    const defaultCanvasId = this.data.canvases[0]?.id || 'canvas-main';
    const count = this.data.nodes.filter((n) => n.canvasId === defaultCanvasId).length;
    const col = count % 4;
    const row = Math.floor(count / 4);
    const created: TopologyNode = {
      id: `node-${crypto.randomBytes(4).toString('hex')}`,
      canvasId: defaultCanvasId,
      name: item.name,
      kind: this.mapRackKindToNodeKind(item.kind),
      x: 160 + col * 340,
      y: 120 + row * 220,
      ipAddress: item.ipAddress || '',
      macAddress: '',
      hostname: slugify(item.name),
      vlan: null,
      subnet: item.ipAddress && item.ipAddress.includes('.') ? `${item.ipAddress.split('.').slice(0, 3).join('.')}.0/24` : '',
      manufacturer: 'Rack Mounted',
      osOrFirmware: item.kind.toUpperCase(),
      tags: ['rack-mounted', item.face === 'rear' ? 'rear-rail' : 'front-rail'],
      services: [],
      healthCheck: {
        method: item.ipAddress ? 'ping' : 'none',
        target: item.ipAddress || '',
        intervalSec: 60,
      },
      status: item.status || 'online',
      latencyMs: null,
      lastCheckedAt: Date.now(),
      rackPlacement: {
        rackId,
        startU: item.startU,
        heightU: item.heightU,
        face: item.face === 'rear' ? 'rear' : 'front',
      },
      createdAt: new Date().toISOString(),
    };
    this.data.nodes.push(created);
    item.nodeId = created.id;
    return created;
  }

  private findNextFreePortOnRackItem(rack: TopologyRack, item: TopologyRackSlotItem): string {
    const used = new Set<string>();
    for (const r of this.data.racks) {
      for (const p of r.patches) {
        if (p.fromItemId === item.id) used.add(String(p.fromPort));
        if (p.toItemId === item.id) used.add(String(p.toPort));
      }
    }
    const maxPorts = Math.max(1, (Number(item.portCount) || 2) + (Number(item.sfpPortCount) || 0));
    for (let i = 1; i <= maxPorts; i++) {
      if (!used.has(String(i))) return String(i);
    }
    return '1';
  }

  upsertLink(input: Partial<TopologyLink> & { sourceId: string; targetId: string }): TopologyLink {
    const existing = input.id ? this.data.links.find((l) => l.id === input.id) : undefined;
    const srcNode = this.data.nodes.find((n) => n.id === input.sourceId);
    const dstNode = this.data.nodes.find((n) => n.id === input.targetId);
    const defaultCanvasId = srcNode?.canvasId || this.data.canvases[0]?.id || 'canvas-main';
    const record: TopologyLink = {
      id: existing?.id ?? `link-${crypto.randomBytes(4).toString('hex')}`,
      canvasId: input.canvasId || existing?.canvasId || defaultCanvasId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      kind: (input.kind || existing?.kind || 'ethernet') as TopologyLinkKind,
      label: String(input.label ?? existing?.label ?? '1GbE Link').trim(),
      speedGbps: input.speedGbps ?? existing?.speedGbps ?? '1G',
      sourcePort: input.sourcePort ?? existing?.sourcePort ?? '',
      targetPort: input.targetPort ?? existing?.targetPort ?? '',
      vlan: input.vlan !== undefined ? input.vlan : existing?.vlan ?? null,
      lqi: input.lqi !== undefined ? input.lqi : existing?.lqi ?? null,
      animated: input.animated ?? existing?.animated ?? false,
      linkedRackPatchId: input.linkedRackPatchId ?? existing?.linkedRackPatchId,
    };

    if (existing) {
      const idx = this.data.links.findIndex((l) => l.id === existing.id);
      this.data.links[idx] = record;
    } else {
      this.data.links.push(record);
    }

    // Bi-directional sync: if both endpoints correspond to mounted rack devices, create/update the physical rack patch cable
    if (srcNode && dstNode) {
      const srcRackHit = this.findRackItemForNode(srcNode);
      const dstRackHit = this.findRackItemForNode(dstNode);
      if (srcRackHit && dstRackHit && srcRackHit.item.id !== dstRackHit.item.id) {
        const style = this.mapLinkKindToCableStyle(record.kind);
        let existingPatch: { rack: TopologyRack; patch: TopologyPatchCable } | null = null;
        for (const r of this.data.racks) {
          const found = r.patches.find(
            (p) =>
              p.id === record.linkedRackPatchId ||
              p.linkedTopologyLinkId === record.id ||
              (p.fromItemId === srcRackHit.item.id &&
                p.toItemId === dstRackHit.item.id &&
                (!record.sourcePort || p.fromPort === record.sourcePort) &&
                (!record.targetPort || p.toPort === record.targetPort)) ||
              (p.fromItemId === dstRackHit.item.id &&
                p.toItemId === srcRackHit.item.id &&
                (!record.sourcePort || p.toPort === record.sourcePort) &&
                (!record.targetPort || p.fromPort === record.targetPort)),
          );
          if (found) {
            existingPatch = { rack: r, patch: found };
            break;
          }
        }

        const fromPort =
          record.sourcePort ||
          existingPatch?.patch.fromPort ||
          this.findNextFreePortOnRackItem(srcRackHit.rack, srcRackHit.item);
        const toPort =
          record.targetPort ||
          existingPatch?.patch.toPort ||
          this.findNextFreePortOnRackItem(dstRackHit.rack, dstRackHit.item);

        if (!record.sourcePort) record.sourcePort = fromPort;
        if (!record.targetPort) record.targetPort = toPort;

        if (existingPatch) {
          existingPatch.patch.fromRackId = srcRackHit.rack.id;
          existingPatch.patch.fromItemId = srcRackHit.item.id;
          existingPatch.patch.fromPort = fromPort;
          existingPatch.patch.toRackId = dstRackHit.rack.id;
          existingPatch.patch.toItemId = dstRackHit.item.id;
          existingPatch.patch.toPort = toPort;
          existingPatch.patch.label = record.label || existingPatch.patch.label;
          existingPatch.patch.cableKind = style.cableKind;
          existingPatch.patch.color = existingPatch.patch.color || style.color;
          existingPatch.patch.linkedTopologyLinkId = record.id;
          record.linkedRackPatchId = existingPatch.patch.id;
        } else {
          const patchId = `patch-${crypto.randomBytes(4).toString('hex')}`;
          const newPatch: TopologyPatchCable = {
            id: patchId,
            rackId: srcRackHit.rack.id,
            fromRackId: srcRackHit.rack.id,
            fromItemId: srcRackHit.item.id,
            fromPort,
            toRackId: dstRackHit.rack.id,
            toItemId: dstRackHit.item.id,
            toPort,
            label: record.label || '',
            cableKind: style.cableKind,
            color: style.color,
            linkedTopologyLinkId: record.id,
          };
          srcRackHit.rack.patches.push(newPatch);
          record.linkedRackPatchId = patchId;
        }
      }
    }

    this.save();
    return record;
  }

  deleteLink(linkId: string): boolean {
    const targetLink = this.data.links.find((l) => l.id === linkId);
    const before = this.data.links.length;
    this.data.links = this.data.links.filter((l) => l.id !== linkId);
    if (this.data.links.length !== before) {
      // Bi-directional sync: also remove the linked rack patch cable
      const srcNode = targetLink ? this.data.nodes.find((n) => n.id === targetLink.sourceId) : undefined;
      const dstNode = targetLink ? this.data.nodes.find((n) => n.id === targetLink.targetId) : undefined;
      const srcItem = srcNode ? this.findRackItemForNode(srcNode)?.item : undefined;
      const dstItem = dstNode ? this.findRackItemForNode(dstNode)?.item : undefined;

      for (const r of this.data.racks) {
        r.patches = r.patches.filter((p) => {
          if (p.linkedTopologyLinkId === linkId) return false;
          if (targetLink?.linkedRackPatchId && p.id === targetLink.linkedRackPatchId) return false;
          if (srcItem && dstItem) {
            const sameDir =
              p.fromItemId === srcItem.id &&
              p.toItemId === dstItem.id &&
              (!targetLink?.sourcePort || p.fromPort === targetLink.sourcePort) &&
              (!targetLink?.targetPort || p.toPort === targetLink.targetPort);
            const revDir =
              p.fromItemId === dstItem.id &&
              p.toItemId === srcItem.id &&
              (!targetLink?.sourcePort || p.toPort === targetLink.sourcePort) &&
              (!targetLink?.targetPort || p.fromPort === targetLink.targetPort);
            if (sameDir || revDir) return false;
          }
          return true;
        });
      }
      this.save();
      return true;
    }
    return false;
  }

  // ---- Physical Rack Canvas (19" & 10" 1U–48U, Front & Rear Elevations + Bi-Directional Topology Patch Sync) ----

  upsertRack(input: Partial<TopologyRack> & { name: string }): TopologyRack {
    const existing = input.id ? this.data.racks.find((r) => r.id === input.id) : undefined;
    const totalU = Math.max(4, Math.min(48, Number(input.totalU ?? existing?.totalU ?? 42)));
    const widthInches: 19 | 10 = Number(input.widthInches ?? existing?.widthInches ?? 19) === 10 ? 10 : 19;
    const clampedItems = (Array.isArray(input.items) ? input.items : existing?.items ?? []).map((it) => {
      const h = Math.max(1, Math.min(totalU, it.heightU || 1));
      const maxStart = Math.max(1, totalU - h + 1);
      const startU = Math.max(1, Math.min(maxStart, it.startU || 1));
      if (it.nodeId) {
        const linkedNode = this.data.nodes.find((n) => n.id === it.nodeId);
        if (linkedNode) {
          linkedNode.rackPlacement = {
            rackId: existing?.id ?? '',
            startU,
            heightU: h,
            face: it.face === 'rear' ? 'rear' : 'front',
          };
        }
      }
      return { ...it, startU, heightU: h };
    });

    const record: TopologyRack = {
      id: existing?.id ?? `rack-${crypto.randomBytes(4).toString('hex')}`,
      name: String(input.name || 'Server Rack').trim(),
      widthInches,
      totalU,
      location: String(input.location ?? existing?.location ?? 'Rack Room').trim(),
      items: clampedItems,
      patches: Array.isArray(input.patches) ? input.patches : existing?.patches ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    for (const it of record.items) {
      if (it.nodeId) {
        const linkedNode = this.data.nodes.find((n) => n.id === it.nodeId);
        if (linkedNode && linkedNode.rackPlacement) {
          linkedNode.rackPlacement.rackId = record.id;
        }
      }
    }
    if (existing) {
      const idx = this.data.racks.findIndex((r) => r.id === existing.id);
      this.data.racks[idx] = record;
    } else {
      this.data.racks.push(record);
    }
    this.save();
    return record;
  }

  deleteRack(rackId: string): boolean {
    if (this.data.racks.length <= 1) {
      throw new Error('Cannot delete the last physical rack');
    }
    const before = this.data.racks.length;
    this.data.racks = this.data.racks.filter((r) => r.id !== rackId);
    if (this.data.racks.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  upsertRackItem(rackId: string, item: Partial<TopologyRackSlotItem> & { name: string; startU: number }): TopologyRack {
    const rack = this.data.racks.find((r) => r.id === rackId);
    if (!rack) throw new Error('Rack not found');
    const existing = item.id ? rack.items.find((i) => i.id === item.id) : undefined;
    const startU = Math.max(1, Math.min(rack.totalU, Number(item.startU) || 1));
    const heightU = Math.max(1, Math.min(rack.totalU - startU + 1, Number(item.heightU) || 1));
    const kind = item.kind ?? existing?.kind ?? 'server';
    const defaultPortCount =
      kind === 'patch-panel'
        ? 24
        : kind === 'switch'
          ? 16
          : kind === 'fiber-patch' || kind === 'firewall' || kind === 'router'
            ? 8
            : kind === 'blank' || kind === 'cable-manager' || kind === 'shelf' || kind === 'pdu'
              ? 0
              : 2;
    const resolvedFace: 'front' | 'rear' =
      item.face === 'rear' ? 'rear' : item.face === 'front' ? 'front' : existing?.face || 'front';

    let resolvedSwitchMeta: TopologySwitchMetadata | undefined =
      item.switchMeta !== undefined ? item.switchMeta : existing?.switchMeta;
    if (kind === 'switch' && !resolvedSwitchMeta) {
      const m = String(item.name || existing?.name || '').match(
        /\b(T1600G-28PS|T1600G-28TS|T2600G-28TS|TL-SG3428|TL-SG2428P|CRS326|CISCO-28P|UBIQUITI-24P)\b/i,
      );
      if (m) {
        const key = m[1].toUpperCase().startsWith('CRS326') ? 'MIKROTIK-CRS326' : m[1].toUpperCase();
        resolvedSwitchMeta = buildSwitchMetadataFromPreset(key);
      }
    }

    const effectivePortCount =
      resolvedSwitchMeta
        ? resolvedSwitchMeta.rj45PortCount + resolvedSwitchMeta.sfpPortCount
        : item.portCount !== undefined
          ? Number(item.portCount)
          : existing?.portCount ?? defaultPortCount;
    const effectiveSfpCount =
      resolvedSwitchMeta
        ? resolvedSwitchMeta.sfpPortCount
        : item.sfpPortCount !== undefined
          ? Number(item.sfpPortCount)
          : existing?.sfpPortCount ?? (kind === 'switch' ? 4 : kind === 'firewall' ? 2 : 0);

    const record: TopologyRackSlotItem = {
      id: existing?.id ?? `ritem-${crypto.randomBytes(4).toString('hex')}`,
      nodeId: item.nodeId !== undefined ? item.nodeId : existing?.nodeId,
      name: String(item.name || 'Rack Equipment').trim(),
      kind,
      startU,
      heightU,
      face: resolvedFace,
      slotIndex: item.slotIndex !== undefined ? Number(item.slotIndex) : existing?.slotIndex,
      slotsTotal: item.slotsTotal !== undefined ? Number(item.slotsTotal) : existing?.slotsTotal,
      status: item.status ?? existing?.status ?? 'online',
      ipAddress: item.ipAddress ?? existing?.ipAddress ?? '',
      portCount: effectivePortCount,
      sfpPortCount: effectiveSfpCount,
      driveBays:
        item.driveBays !== undefined
          ? Number(item.driveBays)
          : existing?.driveBays ?? (kind === 'nas' || kind === 'proxmox' || kind === 'nvr' || kind === 'server' ? 4 : 0),
      outletCount:
        item.outletCount !== undefined
          ? Number(item.outletCount)
          : existing?.outletCount ?? (kind === 'pdu' ? 8 : kind === 'ups' ? 4 : 0),
      color: item.color ?? existing?.color ?? '#0284c7',
      switchMeta: resolvedSwitchMeta,
    };

    // Ensure non-passive rack units are linked to a TopologyNode & keep rackPlacement + switchMeta synchronized
    const linkedNode = this.ensureNodeForRackItem(rack.id, record, true);
    if (linkedNode && record.switchMeta) {
      linkedNode.switchMeta = record.switchMeta;
      linkedNode.manufacturer = record.switchMeta.vendor;
      linkedNode.osOrFirmware = `${record.switchMeta.model}${record.switchMeta.firmwareVersion ? ' · ' + record.switchMeta.firmwareVersion : ''}`;
    } else if (linkedNode?.switchMeta && !record.switchMeta) {
      record.switchMeta = linkedNode.switchMeta;
      record.portCount = linkedNode.switchMeta.rj45PortCount + linkedNode.switchMeta.sfpPortCount;
      record.sfpPortCount = linkedNode.switchMeta.sfpPortCount;
    }

    if (existing) {
      const idx = rack.items.findIndex((i) => i.id === existing.id);
      rack.items[idx] = record;
    } else {
      rack.items.push(record);
    }

    // If this newly mounted/linked rack item already has Topology links (e.g. from switch MAC-table auto-wiring),
    // materialize their corresponding patch cables in the Physical Rack Builder immediately.
    if (linkedNode) {
      this.syncLinksToRackPatchesForNode(linkedNode.id);
    }

    this.save();
    return rack;
  }

  private syncLinksToRackPatchesForNode(nodeId: string): void {
    const relatedLinks = this.data.links.filter((l) => l.sourceId === nodeId || l.targetId === nodeId);
    for (const link of relatedLinks) {
      const srcNode = this.data.nodes.find((n) => n.id === link.sourceId);
      const dstNode = this.data.nodes.find((n) => n.id === link.targetId);
      if (!srcNode || !dstNode) continue;
      const srcRackHit = this.findRackItemForNode(srcNode);
      const dstRackHit = this.findRackItemForNode(dstNode);
      if (!srcRackHit || !dstRackHit || srcRackHit.item.id === dstRackHit.item.id) continue;

      const alreadyPatched = this.data.racks.some((r) =>
        r.patches.some(
          (p) =>
            p.id === link.linkedRackPatchId ||
            p.linkedTopologyLinkId === link.id ||
            (p.fromItemId === srcRackHit.item.id &&
              p.toItemId === dstRackHit.item.id &&
              (!link.sourcePort || p.fromPort === link.sourcePort)) ||
            (p.fromItemId === dstRackHit.item.id &&
              p.toItemId === srcRackHit.item.id &&
              (!link.sourcePort || p.toPort === link.sourcePort)),
        ),
      );
      if (alreadyPatched) continue;

      const style = this.mapLinkKindToCableStyle(link.kind);
      const fromPort = link.sourcePort || this.findNextFreePortOnRackItem(srcRackHit.rack, srcRackHit.item);
      const toPort = link.targetPort || this.findNextFreePortOnRackItem(dstRackHit.rack, dstRackHit.item);
      if (!link.sourcePort) link.sourcePort = fromPort;
      if (!link.targetPort) link.targetPort = toPort;

      const patchId = `patch-${crypto.randomBytes(4).toString('hex')}`;
      srcRackHit.rack.patches.push({
        id: patchId,
        rackId: srcRackHit.rack.id,
        fromRackId: srcRackHit.rack.id,
        fromItemId: srcRackHit.item.id,
        fromPort,
        toRackId: dstRackHit.rack.id,
        toItemId: dstRackHit.item.id,
        toPort,
        label: link.label || '',
        cableKind: style.cableKind,
        color: style.color,
        linkedTopologyLinkId: link.id,
      });
      link.linkedRackPatchId = patchId;
    }
  }

  deleteRackItem(rackId: string, itemId: string): TopologyRack {
    const rack = this.data.racks.find((r) => r.id === rackId);
    if (!rack) throw new Error('Rack not found');
    const removedItem = rack.items.find((i) => i.id === itemId);
    rack.items = rack.items.filter((i) => i.id !== itemId);

    if (removedItem?.nodeId) {
      const linkedNode = this.data.nodes.find((n) => n.id === removedItem.nodeId);
      if (linkedNode) linkedNode.rackPlacement = undefined;
    }

    const removedPatchIds = new Set<string>();
    const removedLinkIds = new Set<string>();
    for (const r of this.data.racks) {
      for (const p of r.patches) {
        if (p.fromItemId === itemId || p.toItemId === itemId) {
          removedPatchIds.add(p.id);
          if (p.linkedTopologyLinkId) removedLinkIds.add(p.linkedTopologyLinkId);
        }
      }
      r.patches = r.patches.filter((p) => p.fromItemId !== itemId && p.toItemId !== itemId);
    }

    if (removedPatchIds.size > 0 || removedLinkIds.size > 0) {
      this.data.links = this.data.links.filter(
        (l) => !removedLinkIds.has(l.id) && (!l.linkedRackPatchId || !removedPatchIds.has(l.linkedRackPatchId)),
      );
    }

    this.save();
    return rack;
  }

  /**
   * Moves a mounted rack item to a new U-slot, front/rear face, or across racks / fractional shelf slots
   * while preserving its ID, TopologyNode rackPlacement, and all connected patch cables.
   */
  moveRackItem(input: {
    fromRackId: string;
    toRackId: string;
    itemId: string;
    startU: number;
    slotIndex?: number;
    face?: 'front' | 'rear';
  }): TopologyState {
    const srcRack = this.data.racks.find((r) => r.id === input.fromRackId);
    const dstRack = this.data.racks.find((r) => r.id === input.toRackId);
    if (!srcRack || !dstRack) throw new Error('Rack not found');

    const item = srcRack.items.find((i) => i.id === input.itemId);
    if (!item) throw new Error('Rack equipment not found');

    const maxStartU = Math.max(1, dstRack.totalU - item.heightU + 1);
    const targetStartU = Math.max(1, Math.min(maxStartU, Math.round(Number(input.startU) || 1)));
    const nextSlotIndex =
      input.slotIndex !== undefined && (item.slotsTotal || 1) > 1
        ? Math.max(0, Math.min((item.slotsTotal || 1) - 1, Math.round(Number(input.slotIndex) || 0)))
        : item.slotIndex;
    const nextFace: 'front' | 'rear' =
      input.face === 'rear' ? 'rear' : input.face === 'front' ? 'front' : item.face || 'front';

    if (srcRack.id === dstRack.id) {
      item.startU = targetStartU;
      item.face = nextFace;
      if (nextSlotIndex !== undefined) item.slotIndex = nextSlotIndex;
    } else {
      srcRack.items = srcRack.items.filter((i) => i.id !== item.id);
      const moved: TopologyRackSlotItem = {
        ...item,
        startU: targetStartU,
        slotIndex: nextSlotIndex,
        face: nextFace,
      };
      dstRack.items.push(moved);

      // Update fromRackId / toRackId on any patch cables attached to this item
      for (const r of this.data.racks) {
        for (const p of r.patches) {
          if (p.fromItemId === item.id) p.fromRackId = dstRack.id;
          if (p.toItemId === item.id) p.toRackId = dstRack.id;
        }
      }
    }

    // Keep linked TopologyNode rackPlacement in sync
    if (item.nodeId) {
      const node = this.data.nodes.find((n) => n.id === item.nodeId);
      if (node) {
        node.rackPlacement = {
          rackId: dstRack.id,
          startU: targetStartU,
          heightU: item.heightU,
          face: nextFace,
        };
      }
    }

    this.save();
    return this.getState();
  }

  autoLayoutRacks(rackId?: string): { state: TopologyState; racksArranged: number; itemsMoved: number } {
    const targetRacks = rackId ? this.data.racks.filter((r) => r.id === rackId) : this.data.racks;
    if (rackId && targetRacks.length === 0) throw new Error('Rack not found');

    const tierAndPriority = (kind: TopologyRackSlotItem['kind']): { tier: 1 | 2 | 3; priority: number } => {
      switch (kind) {
        case 'patch-panel':
        case 'fiber-patch':
          return { tier: 1, priority: 10 };
        case 'cable-manager':
          return { tier: 1, priority: 15 };
        case 'isp':
        case 'router':
        case 'firewall':
          return { tier: 1, priority: 20 };
        case 'switch':
          return { tier: 1, priority: 30 };
        case 'ap':
          return { tier: 1, priority: 35 };
        case 'proxmox':
        case 'server':
        case 'vm':
        case 'lxc':
        case 'docker':
          return { tier: 2, priority: 40 };
        case 'mini-pc':
        case 'shelf':
        case 'ai':
          return { tier: 2, priority: 45 };
        case 'nas':
          return { tier: 2, priority: 50 };
        case 'nvr':
        case 'camera':
        case 'iot':
        case 'zigbee':
        case 'zwave':
        case 'rack':
        case 'generic':
          return { tier: 2, priority: 60 };
        case 'blank':
          return { tier: 2, priority: 70 };
        case 'pdu':
        case 'electric':
          return { tier: 3, priority: 80 };
        case 'ups':
          return { tier: 3, priority: 90 };
        default:
          return { tier: 2, priority: 65 };
      }
    };

    interface PackedRow {
      heightU: number;
      items: TopologyRackSlotItem[];
    }

    const packIntoRows = (items: TopologyRackSlotItem[]): PackedRow[] => {
      const sorted = [...items].sort((a, b) => {
        const pa = tierAndPriority(a.kind).priority;
        const pb = tierAndPriority(b.kind).priority;
        if (pa !== pb) return pa - pb;
        const sa = Math.max(1, Number(a.slotsTotal) || 1);
        const sb = Math.max(1, Number(b.slotsTotal) || 1);
        if (sa !== sb) return sa - sb;
        if (a.heightU !== b.heightU) return a.heightU - b.heightU;
        return a.name.localeCompare(b.name);
      });

      const rows: PackedRow[] = [];
      let i = 0;
      while (i < sorted.length) {
        const first = sorted[i];
        const slotsTotal = Math.max(1, Number(first.slotsTotal) || 1);
        const rowItems: TopologyRackSlotItem[] = [first];
        i++;
        while (
          slotsTotal > 1 &&
          rowItems.length < slotsTotal &&
          i < sorted.length &&
          Math.max(1, Number(sorted[i].slotsTotal) || 1) === slotsTotal &&
          sorted[i].heightU === first.heightU
        ) {
          rowItems.push(sorted[i]);
          i++;
        }
        rows.push({
          heightU: Math.max(1, Number(first.heightU) || 1),
          items: rowItems,
        });
      }
      return rows;
    };

    let itemsMoved = 0;
    const assignRow = (rack: TopologyRack, row: PackedRow, startU: number) => {
      const clampedStartU = Math.max(1, Math.min(Math.max(1, rack.totalU - row.heightU + 1), startU));
      row.items.forEach((item, idx) => {
        const slotsTotal = Math.max(1, Number(item.slotsTotal) || 1);
        const nextSlot = slotsTotal > 1 ? idx : item.slotIndex;
        if (item.startU !== clampedStartU || (slotsTotal > 1 && item.slotIndex !== nextSlot)) {
          itemsMoved++;
        }
        item.startU = clampedStartU;
        if (slotsTotal > 1) {
          item.slotIndex = nextSlot;
        }
        if (item.nodeId) {
          const node = this.data.nodes.find((n) => n.id === item.nodeId);
          if (node) {
            node.rackPlacement = {
              rackId: rack.id,
              startU: clampedStartU,
              heightU: item.heightU,
              face: item.face === 'rear' ? 'rear' : 'front',
            };
          }
        }
      });
    };

    for (const rack of targetRacks) {
      for (const face of ['front', 'rear'] as const) {
        const faceItems = rack.items.filter((it) => (it.face === 'rear' ? 'rear' : 'front') === face);
        if (faceItems.length === 0) continue;

        const tier1 = faceItems.filter((it) => tierAndPriority(it.kind).tier === 1);
        const tier2 = faceItems.filter((it) => tierAndPriority(it.kind).tier === 2);
        const tier3 = faceItems.filter((it) => tierAndPriority(it.kind).tier === 3);

        const topRows = packIntoRows(tier1);
        const midRows = packIntoRows(tier2);
        // For bottom tier, place heaviest/highest-priority (UPS=90) at U1 and PDUs (80) above it
        const botRows = packIntoRows(tier3).reverse();

        const topU = topRows.reduce((s, r) => s + r.heightU, 0);
        const midU = midRows.reduce((s, r) => s + r.heightU, 0);
        const botU = botRows.reduce((s, r) => s + r.heightU, 0);

        if (topU + midU + botU <= rack.totalU) {
          let botCursor = 1;
          for (const row of botRows) {
            assignRow(rack, row, botCursor);
            botCursor += row.heightU;
          }

          let topCursor = rack.totalU;
          for (const row of topRows) {
            const startU = topCursor - row.heightU + 1;
            assignRow(rack, row, startU);
            topCursor -= row.heightU;
          }

          // Add 1U cable-clearance gap between networking (Tier 1) and compute (Tier 2) when space permits
          const spareU = rack.totalU - (topU + midU + botU);
          if (topRows.length > 0 && midRows.length > 0 && spareU >= 2) {
            topCursor -= 1;
          }
          for (const row of midRows) {
            const startU = Math.max(botCursor, topCursor - row.heightU + 1);
            assignRow(rack, row, startU);
            topCursor -= row.heightU;
          }
        } else {
          // Overpacked rack: pack all tiers cleanly top-to-bottom without gaps
          const allRows = [...topRows, ...midRows, ...botRows.slice().reverse()];
          let topCursor = rack.totalU;
          for (const row of allRows) {
            const startU = Math.max(1, topCursor - row.heightU + 1);
            assignRow(rack, row, startU);
            topCursor -= row.heightU;
          }
        }
      }
    }

    this.save();
    return {
      state: this.getState(),
      racksArranged: targetRacks.length,
      itemsMoved,
    };
  }

  upsertRackPatch(
    rackId: string,
    patch: Partial<TopologyPatchCable> & { fromItemId: string; toItemId: string },
  ): TopologyRack {
    const rack = this.data.racks.find((r) => r.id === rackId);
    if (!rack) throw new Error('Rack not found');
    const existing = patch.id ? rack.patches.find((p) => p.id === patch.id) : undefined;
    const record: TopologyPatchCable = {
      id: existing?.id ?? `patch-${crypto.randomBytes(4).toString('hex')}`,
      rackId,
      fromRackId: patch.fromRackId || existing?.fromRackId || rackId,
      fromItemId: patch.fromItemId,
      fromPort: String(patch.fromPort || existing?.fromPort || '1').trim(),
      toRackId: patch.toRackId || existing?.toRackId || rackId,
      toItemId: patch.toItemId,
      toPort: String(patch.toPort || existing?.toPort || '1').trim(),
      label: String(patch.label ?? existing?.label ?? '').trim(),
      cableKind: patch.cableKind || existing?.cableKind || 'cat6a',
      color: patch.color || existing?.color || '#22c55e',
      linkedTopologyLinkId: patch.linkedTopologyLinkId ?? existing?.linkedTopologyLinkId,
    };

    // Bi-directional sync: reflect patch cable creation / modification on the Topology Canvas
    const fromHit = this.findRackItemAcrossRacks(record.fromItemId);
    const toHit = this.findRackItemAcrossRacks(record.toItemId);
    if (fromHit && toHit) {
      const srcNode = this.ensureNodeForRackItem(fromHit.rack.id, fromHit.item, true);
      const dstNode = this.ensureNodeForRackItem(toHit.rack.id, toHit.item, true);
      if (srcNode && dstNode && srcNode.id !== dstNode.id) {
        const linkKind = this.mapCableKindToLinkKind(record.cableKind);
        const speedGbps =
          record.cableKind === 'dac-sfp+' || record.cableKind === 'fiber-om4'
            ? '10G'
            : record.cableKind === 'cat6a'
              ? '2.5G'
              : record.cableKind === 'power'
                ? ''
                : '1G';
        const autoLabel =
          record.label ||
          `${fromHit.item.name}:${record.fromPort} <-> ${toHit.item.name}:${record.toPort}`;

        let existingLink = this.data.links.find(
          (l) =>
            (record.linkedTopologyLinkId && l.id === record.linkedTopologyLinkId) ||
            l.linkedRackPatchId === record.id ||
            (l.sourceId === srcNode.id &&
              l.targetId === dstNode.id &&
              l.sourcePort === record.fromPort &&
              l.targetPort === record.toPort) ||
            (l.sourceId === dstNode.id &&
              l.targetId === srcNode.id &&
              l.sourcePort === record.toPort &&
              l.targetPort === record.fromPort),
        );

        if (existingLink) {
          existingLink.sourceId = srcNode.id;
          existingLink.targetId = dstNode.id;
          existingLink.sourcePort = record.fromPort;
          existingLink.targetPort = record.toPort;
          existingLink.kind = linkKind;
          existingLink.speedGbps = speedGbps || existingLink.speedGbps;
          existingLink.label = autoLabel;
          existingLink.linkedRackPatchId = record.id;
          record.linkedTopologyLinkId = existingLink.id;
        } else {
          const newLink: TopologyLink = {
            id: `link-${crypto.randomBytes(4).toString('hex')}`,
            canvasId: srcNode.canvasId || this.data.canvases[0]?.id || 'canvas-main',
            sourceId: srcNode.id,
            targetId: dstNode.id,
            kind: linkKind,
            label: autoLabel,
            speedGbps,
            sourcePort: record.fromPort,
            targetPort: record.toPort,
            vlan: null,
            lqi: null,
            animated: linkKind === 'dac' || linkKind === 'fiber',
            linkedRackPatchId: record.id,
          };
          this.data.links.push(newLink);
          record.linkedTopologyLinkId = newLink.id;
        }
      }
    }

    if (existing) {
      const idx = rack.patches.findIndex((p) => p.id === existing.id);
      rack.patches[idx] = record;
    } else {
      rack.patches.push(record);
    }
    this.save();
    return rack;
  }

  deleteRackPatch(rackId: string, patchId: string): TopologyRack {
    const rack = this.data.racks.find((r) => r.id === rackId);
    if (!rack) throw new Error('Rack not found');

    let targetPatch: TopologyPatchCable | undefined;
    for (const r of this.data.racks) {
      const found = r.patches.find((p) => p.id === patchId);
      if (found) {
        targetPatch = found;
        break;
      }
    }

    for (const r of this.data.racks) {
      r.patches = r.patches.filter((p) => p.id !== patchId);
    }

    // Bi-directional sync: remove the corresponding TopologyLink on the Topology Canvas
    const fromNodeId = targetPatch ? this.findRackItemAcrossRacks(targetPatch.fromItemId)?.item.nodeId : undefined;
    const toNodeId = targetPatch ? this.findRackItemAcrossRacks(targetPatch.toItemId)?.item.nodeId : undefined;

    this.data.links = this.data.links.filter((l) => {
      if (l.linkedRackPatchId === patchId) return false;
      if (targetPatch?.linkedTopologyLinkId && l.id === targetPatch.linkedTopologyLinkId) return false;
      if (targetPatch && fromNodeId && toNodeId) {
        const sameDir =
          l.sourceId === fromNodeId &&
          l.targetId === toNodeId &&
          (!l.sourcePort || l.sourcePort === targetPatch.fromPort) &&
          (!l.targetPort || l.targetPort === targetPatch.toPort);
        const revDir =
          l.sourceId === toNodeId &&
          l.targetId === fromNodeId &&
          (!l.sourcePort || l.sourcePort === targetPatch.toPort) &&
          (!l.targetPort || l.targetPort === targetPatch.fromPort);
        if (sameDir || revDir) return false;
      }
      return true;
    });

    this.save();
    return rack;
  }

  // ---- Markdown Documentation & Wiki Engine (with Version History & Backlinks) ----

  upsertDoc(input: Partial<TopologyDocPage> & { title: string; content: string }, revisionSummary?: string): TopologyDocPage {
    const existing = input.id ? this.data.docs.find((d) => d.id === input.id) : undefined;
    const now = Date.now();
    const title = String(input.title || 'Untitled Document').trim();
    const content = String(input.content ?? '');

    if (input.isHome) {
      for (const d of this.data.docs) {
        d.isHome = false;
      }
    }

    const revisions = existing?.revisions ? [...existing.revisions] : [];
    if (!existing || existing.content !== content) {
      revisions.unshift({
        id: `rev-${crypto.randomBytes(4).toString('hex')}`,
        timestamp: now,
        summary: revisionSummary || (existing ? 'Updated documentation' : 'Created page'),
        content,
      });
    }

    const record: TopologyDocPage = {
      id: existing?.id ?? `doc-${crypto.randomBytes(4).toString('hex')}`,
      title,
      slug: slugify(title),
      icon: String(input.icon || existing?.icon || '[DOC]').trim(),
      nodeId: input.nodeId !== undefined ? input.nodeId : existing?.nodeId,
      canvasId: input.canvasId !== undefined ? input.canvasId : existing?.canvasId,
      isHome: Boolean(input.isHome ?? existing?.isHome ?? this.data.docs.length === 0),
      content,
      tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags ?? [],
      updatedAt: now,
      revisions: revisions.slice(0, 25),
    };

    if (existing) {
      const idx = this.data.docs.findIndex((d) => d.id === existing.id);
      this.data.docs[idx] = record;
    } else {
      this.data.docs.push(record);
    }

    if (record.nodeId) {
      const node = this.data.nodes.find((n) => n.id === record.nodeId);
      if (node) node.docId = record.id;
    }

    this.save();
    return record;
  }

  deleteDoc(docId: string): boolean {
    const before = this.data.docs.length;
    this.data.docs = this.data.docs.filter((d) => d.id !== docId);
    if (this.data.docs.length !== before) {
      for (const n of this.data.nodes) {
        if (n.docId === docId) n.docId = undefined;
      }
      this.save();
      return true;
    }
    return false;
  }

  // ---- Multi-Protocol Live Health Check Engine (Ping, TCP, HTTP/HTTPS, SSH Banner, Prometheus) ----

  async runHealthChecks(overview?: OverviewResponse): Promise<TopologyNode[]> {
    if (this.checkingHealth) return this.data.nodes;
    this.checkingHealth = true;
    try {
      const now = Date.now();

      // Index live telemetry statuses from Rack Panel Overview so linked nodes reflect real-time telemetry
      const liveIpOnline = new Map<string, boolean>();
      if (overview) {
        for (const s of overview.servers) {
          if (s.config.host) liveIpOnline.set(s.config.host, s.metrics.status === 'online');
          if (s.metrics.ipAddress) liveIpOnline.set(s.metrics.ipAddress, s.metrics.status === 'online');
        }
        for (const p of overview.proxmox) {
          if (p.host) liveIpOnline.set(p.host, p.status === 'online');
          for (const n of p.nodes) {
            if (n.ipAddress) liveIpOnline.set(n.ipAddress, n.status === 'online');
          }
        }
        for (const o of overview.opnsense) {
          if (o.host) liveIpOnline.set(o.host, o.status === 'online');
        }
        for (const h of overview.hikvision) {
          if (h.host) liveIpOnline.set(h.host, h.status === 'online');
          if (h.macAddress && h.macAddress !== '-') {
            const hikNode = this.data.nodes.find(
              (n) => n.kind === 'nvr' && (n.ipAddress === h.host || n.linkedSourceId === h.configId),
            );
            if (hikNode && !hikNode.macAddress) {
              hikNode.macAddress = this.normalizeMac(h.macAddress);
            }
          }
          for (const ch of h.channels) {
            if (ch.ipAddress) liveIpOnline.set(ch.ipAddress, ch.online);
          }
        }
        for (const t of overview.tailscale) {
          for (const d of t.devices) {
            if (d.ipv4) liveIpOnline.set(d.ipv4, d.online);
          }
        }
      }

      await Promise.all(
        this.data.nodes.map(async (node) => {
          if (node.healthCheck.method === 'none') {
            node.lastCheckedAt = now;
            return;
          }

          if (node.ipAddress && liveIpOnline.has(node.ipAddress)) {
            const isUp = Boolean(liveIpOnline.get(node.ipAddress));
            node.status = isUp ? 'online' : 'offline';
            node.latencyMs = isUp ? node.latencyMs || 2 : null;
            node.lastCheckedAt = now;
            node.statusDetail = isUp ? 'Verified via Rack Panel live telemetry' : 'Offline in Rack Panel telemetry';
            return;
          }

          if (!node.ipAddress) {
            return;
          }

          const res = await this.probeNode(node);
          node.status = res.status;
          node.latencyMs = res.latencyMs;
          node.lastCheckedAt = now;
          node.statusDetail = res.detail;
        }),
      );

      if (this.data.nodes.some((n) => !n.macAddress && n.ipAddress)) {
        const arpMap = await this.readArpTable().catch(() => new Map<string, string>());
        if (this.enrichNodeMacsFromArp(arpMap)) {
          this.autoWireAllSwitches();
        }
      }

      this.save();
      return this.data.nodes;
    } finally {
      this.checkingHealth = false;
    }
  }

  private async probeNode(node: TopologyNode): Promise<{
    status: 'online' | 'offline' | 'warning';
    latencyMs: number | null;
    detail: string;
  }> {
    const method: TopologyHealthCheckMethod = node.healthCheck?.method || 'auto';
    const target = String(node.healthCheck?.target || '').trim();
    const ip = node.ipAddress;

    if (method === 'http' || method === 'https' || method === 'prometheus') {
      const url =
        target.startsWith('http://') || target.startsWith('https://')
          ? target
          : `${method === 'https' ? 'https' : 'http'}://${ip}${target.startsWith(':') ? target : target.startsWith('/') ? target : method === 'prometheus' ? ':9100/metrics' : ''}`;
      return this.probeHttp(url);
    }

    if (method === 'ssh') {
      const port = Number(target) || 22;
      return this.probeSshBanner(ip, port);
    }

    if (method === 'tcp') {
      const port = Number(target) || node.services[0]?.port || 80;
      return this.probeTcp(ip, port);
    }

    if (method === 'ping') {
      return this.probePing(ip);
    }

    // 'auto': try first declared service TCP port, then common ports (80, 443, 22), then ICMP ping
    const candidatePort = node.services[0]?.port || (node.kind === 'proxmox' ? 8006 : node.kind === 'ai' ? 11434 : 80);
    const tcpRes = await this.probeTcp(ip, candidatePort, 1800);
    if (tcpRes.status === 'online') return tcpRes;
    return this.probePing(ip);
  }

  private probeTcp(
    host: string,
    port: number,
    timeoutMs = 2200,
  ): Promise<{ status: 'online' | 'offline'; latencyMs: number | null; detail: string }> {
    return new Promise((resolve) => {
      const started = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (ok: boolean, msg: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          status: ok ? 'online' : 'offline',
          latencyMs: ok ? Math.max(1, Date.now() - started) : null,
          detail: msg,
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true, `TCP :${port} open`));
      socket.once('timeout', () => finish(false, `TCP :${port} timeout`));
      socket.once('error', (err) => finish(false, `TCP :${port} ${err.message}`));
      socket.connect(port, host);
    });
  }

  private probeSshBanner(
    host: string,
    port = 22,
  ): Promise<{ status: 'online' | 'offline'; latencyMs: number | null; detail: string }> {
    return new Promise((resolve) => {
      const started = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (ok: boolean, detail: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          status: ok ? 'online' : 'offline',
          latencyMs: ok ? Math.max(1, Date.now() - started) : null,
          detail,
        });
      };

      socket.setTimeout(2500);
      socket.once('data', (buf) => {
        const line = buf.toString('utf8').split(/\r?\n/)[0].slice(0, 48);
        finish(true, line.startsWith('SSH-') ? `SSH Banner: ${line}` : `TCP :${port} active`);
      });
      socket.once('connect', () => {
        setTimeout(() => finish(true, `SSH TCP :${port} open`), 600);
      });
      socket.once('timeout', () => finish(false, `SSH :${port} timeout`));
      socket.once('error', (err) => finish(false, `SSH :${port} ${err.message}`));
      socket.connect(port, host);
    });
  }

  private probeHttp(
    urlStr: string,
  ): Promise<{ status: 'online' | 'offline' | 'warning'; latencyMs: number | null; detail: string }> {
    return new Promise((resolve) => {
      const started = Date.now();
      let parsed: URL;
      try {
        parsed = new URL(urlStr);
      } catch {
        resolve({ status: 'offline', latencyMs: null, detail: 'Invalid URL' });
        return;
      }

      const isHttps = parsed.protocol === 'https:';
      const req = (isHttps ? https : http).request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: (parsed.pathname || '/') + (parsed.search || ''),
          method: 'GET',
          timeout: 3000,
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          const code = res.statusCode || 0;
          const elapsed = Math.max(1, Date.now() - started);
          if (code >= 200 && code < 405) {
            resolve({ status: 'online', latencyMs: elapsed, detail: `HTTP ${code} (${elapsed}ms)` });
          } else if (code > 0 && code < 500) {
            resolve({ status: 'online', latencyMs: elapsed, detail: `HTTP ${code} Auth/Redirect` });
          } else {
            resolve({ status: 'warning', latencyMs: elapsed, detail: `HTTP ${code}` });
          }
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'offline', latencyMs: null, detail: 'HTTP timeout' });
      });
      req.on('error', (err) => {
        resolve({ status: 'offline', latencyMs: null, detail: err.message });
      });
      req.end();
    });
  }

  private probePing(
    host: string,
  ): Promise<{ status: 'online' | 'offline'; latencyMs: number | null; detail: string }> {
    return new Promise((resolve) => {
      const started = Date.now();
      const isMac = process.platform === 'darwin';
      const args = isMac ? ['-c', '1', '-W', '1500', host] : ['-c', '1', '-W', '2', host];
      execFile('ping', args, { timeout: 2600 }, (err, stdout) => {
        if (err) {
          resolve({ status: 'offline', latencyMs: null, detail: 'ICMP ping unreachable' });
          return;
        }
        const m = String(stdout || '').match(/time[=<]([\d.]+)\s*ms/i);
        const rtt = m ? Math.max(1, Math.round(parseFloat(m[1]))) : Math.max(1, Date.now() - started);
        resolve({ status: 'online', latencyMs: rtt, detail: `ICMP ping ${rtt}ms` });
      });
    });
  }

  // ---- Automated Subnet Scanner, Service Fingerprinting & One-Click Importers ----

  async scanSubnet(subnetInput: string, overview?: OverviewResponse): Promise<TopologyDiscoveredDevice[]> {
    const clean = String(subnetInput || '').trim();
    const discovered = new Map<string, TopologyDiscoveredDevice>();
    const now = Date.now();

    // 1. Read local ARP cache (`arp -an`) for instant MAC + IP discovery & enrich existing nodes
    const arpMap = await this.readArpTable();
    this.enrichNodeMacsFromArp(arpMap);

    // 2. Harvest any live non-demo hosts already known to Rack Panel Overview
    if (overview) {
      for (const s of overview.servers) {
        if (s.config.isDemo) continue;
        const ip = s.metrics.ipAddress || s.config.host;
        if (!ip) continue;
        discovered.set(ip, {
          id: `disc-ssh-${s.config.id}`,
          ipAddress: ip,
          hostname: s.metrics.hostname || s.config.name,
          macAddress: arpMap.get(ip) || '',
          vendor: lookupMacVendor(arpMap.get(ip) || '') || 'Linux SSH Server',
          guessedKind: 'server',
          openPorts: [{ port: s.config.port || 22, protocol: 'tcp', serviceName: 'SSH', status: 'online' }],
          latencyMs: 2,
          source: 'subnet-scan',
          discoveredAt: now,
          approved: this.data.nodes.some((n) => n.ipAddress === ip),
        });
      }
      for (const h of overview.hikvision) {
        if (h.isDemo) continue;
        if (h.host) {
          discovered.set(h.host, {
            id: `disc-hik-${h.configId}`,
            ipAddress: h.host,
            hostname: h.deviceName || h.name,
            macAddress: h.macAddress !== '-' ? h.macAddress : arpMap.get(h.host) || '',
            vendor: 'Hikvision Digital Technology',
            guessedKind: h.deviceType === 'IPCamera' ? 'camera' : 'nvr',
            openPorts: [
              { port: 80, protocol: 'tcp', serviceName: 'Hikvision ISAPI', status: 'online' },
              { port: 554, protocol: 'tcp', serviceName: 'RTSP Video Stream', status: 'online' },
            ],
            latencyMs: 2,
            source: 'hikvision',
            discoveredAt: now,
            approved: this.data.nodes.some((n) => n.ipAddress === h.host),
          });
        }
        for (const ch of h.channels) {
          if (ch.ipAddress && ch.online) {
            discovered.set(ch.ipAddress, {
              id: `disc-hik-cam-${h.configId}-${ch.id}`,
              ipAddress: ch.ipAddress,
              hostname: `${ch.name} (CH${ch.id})`,
              macAddress: arpMap.get(ch.ipAddress) || '',
              vendor: 'Hikvision IP Camera',
              guessedKind: 'camera',
              openPorts: [{ port: 554, protocol: 'tcp', serviceName: `RTSP (${ch.codec} ${ch.resolution})`, status: 'online' }],
              latencyMs: 3,
              source: 'hikvision',
              discoveredAt: now,
              approved: this.data.nodes.some((n) => n.ipAddress === ch.ipAddress),
            });
          }
        }
      }
    }

    // 3. Probe candidate IPs across requested/default subnets (prioritizing ARP entries + common homelab host octets)
    const { candidateIps } = resolveScanTargets(clean || undefined, arpMap, 'priority');

    const probePorts = [22, 23, 80, 443, 554, 8006, 8080, 8091, 8123, 8443, 9000, 11434];
    const ipList = candidateIps.slice(0, 220);

    for (let batchStart = 0; batchStart < ipList.length; batchStart += 32) {
      const batch = ipList.slice(batchStart, batchStart + 32);
      await Promise.all(
        batch.map(async (ip) => {
        if (discovered.has(ip)) return;
        const openPorts: TopologyServicePort[] = [];
        let bestLatency: number | null = null;

        await Promise.all(
          probePorts.map(async (port) => {
            const res = await this.probeTcp(ip, port, 450);
            if (res.status === 'online') {
              if (bestLatency === null || (res.latencyMs !== null && res.latencyMs < bestLatency)) {
                bestLatency = res.latencyMs;
              }
              const fp = PORT_FINGERPRINTS.find((p) => p.port === port);
              openPorts.push({
                port,
                protocol: 'tcp',
                serviceName: fp ? fp.serviceName : `TCP :${port}`,
                url: fp?.scheme ? `${fp.scheme}://${ip}:${port}` : undefined,
                status: 'online',
              });
            }
          }),
        );

        const mac = arpMap.get(ip) || '';
        if (openPorts.length === 0 && !mac) return;

        openPorts.sort((a, b) => a.port - b.port);
        let guessedKind = this.guessDeviceKind(ip, mac, openPorts);
        let vendor =
          lookupMacVendor(mac) ||
          (openPorts.some((p) => p.port === 8006)
            ? 'Proxmox VE'
            : openPorts.some((p) => p.port === 23)
              ? 'Managed Network Switch'
              : 'Discovered Host');
        let switchModel: string | undefined;

        // If HTTP/HTTPS or Telnet is open, or MAC vendor is a switch brand, probe HTTP banner for T1600G-28TS / T1600G-28PS / JetStream / Switch model
        if (
          guessedKind === 'switch' ||
          openPorts.some((p) => p.port === 23 || p.port === 80 || p.port === 443)
        ) {
          const has80 = openPorts.some((p) => p.port === 80);
          const has443 = openPorts.some((p) => p.port === 443);
          const banner = has80
            ? await fingerprintSwitchHttpBanner(ip, 80, false)
            : has443
              ? await fingerprintSwitchHttpBanner(ip, 443, true)
              : { reachable: false };
          if (banner.model) {
            switchModel = banner.model;
            guessedKind = 'switch';
          }
          if (banner.vendor) {
            vendor = banner.vendor;
            guessedKind = 'switch';
          }
        }

          discovered.set(ip, {
            id: `disc-${ip.replace(/\./g, '-')}`,
            ipAddress: ip,
            hostname: switchModel ? `${switchModel} (${ip})` : `host-${ip.replace(/\./g, '-')}.lan`,
            macAddress: mac,
            vendor,
            guessedKind,
            openPorts,
            latencyMs: bestLatency ?? 4,
            source: openPorts.length > 0 ? 'subnet-scan' : 'arp',
            switchModel,
            discoveredAt: now,
            approved: this.data.nodes.some((n) => n.ipAddress === ip),
          });
        }),
      );
    }

    // Merge into discoveryQueue
    for (const item of discovered.values()) {
      const existingIdx = this.data.discoveryQueue.findIndex((d) => d.ipAddress === item.ipAddress);
      if (existingIdx !== -1) {
        this.data.discoveryQueue[existingIdx] = {
          ...this.data.discoveryQueue[existingIdx],
          ...item,
          id: this.data.discoveryQueue[existingIdx].id,
        };
      } else {
        this.data.discoveryQueue.unshift(item);
      }
    }

    this.enrichNodeMacsFromArp(arpMap);
    this.autoWireAllSwitches();
    this.save();
    return this.data.discoveryQueue;
  }

  private guessDeviceKind(_ip: string, mac: string, ports: TopologyServicePort[]): TopologyNodeKind {
    const portNums = new Set(ports.map((p) => p.port));
    if (portNums.has(8006)) return 'proxmox';
    if (portNums.has(11434)) return 'ai';
    if (portNums.has(554) || portNums.has(8000)) return 'nvr';
    if (portNums.has(8123)) return 'iot';
    if (portNums.has(8091)) return 'zwave';
    if (portNums.has(8443)) return 'ap';
    if (portNums.has(2049) || portNums.has(445) || portNums.has(5000) || portNums.has(5001)) return 'nas';
    if (portNums.has(9000) || portNums.has(2375)) return 'docker';
    const vendor = lookupMacVendor(mac).toLowerCase();
    if (vendor.includes('hikvision')) return 'nvr';
    if (vendor.includes('synology')) return 'nas';
    if (
      vendor.includes('tp-link') ||
      vendor.includes('jetstream') ||
      vendor.includes('ubiquiti') ||
      vendor.includes('cisco') ||
      vendor.includes('mikrotik') ||
      vendor.includes('netgear')
    ) {
      return 'switch';
    }
    if (vendor.includes('netgate') || vendor.includes('deciso')) return 'firewall';
    if (portNums.has(23)) return 'switch';
    if (portNums.has(22)) return 'server';
    return 'generic';
  }

  private readArpTable(): Promise<Map<string, string>> {
    return new Promise((resolve) => {
      const map = new Map<string, string>();
      execFile('arp', ['-an'], { timeout: 2500 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(map);
          return;
        }
        const lines = String(stdout).split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:]{11,17})/);
          if (m && m[2] && !m[2].includes('incomplete')) {
            map.set(m[1], m[2].toUpperCase());
          }
        }
        resolve(map);
      });
    });
  }

  approveDiscoveredDevice(
    discoveryId: string,
    canvasId?: string,
  ): { node: TopologyNode; doc: TopologyDocPage } {
    const disc = this.data.discoveryQueue.find((d) => d.id === discoveryId);
    if (!disc) throw new Error('Discovered device not found');
    disc.approved = true;

    const targetCanvasId = canvasId || this.data.canvases[0]?.id || 'canvas-main';
    const existing = this.data.nodes.find((n) => n.ipAddress === disc.ipAddress && n.canvasId === targetCanvasId);
    const countOnCanvas = this.data.nodes.filter((n) => n.canvasId === targetCanvasId).length;

    const switchMeta =
      disc.guessedKind === 'switch'
        ? buildSwitchMetadataFromPreset(disc.switchModel || 'T1600G-28TS', {
            model: disc.switchModel || 'T1600G-28TS',
            vendor: disc.vendor || 'TP-Link JetStream',
          })
        : undefined;

    const node = this.upsertNode({
      id: existing?.id,
      canvasId: targetCanvasId,
      name:
        disc.switchModel
          ? `${disc.switchModel} (${disc.ipAddress})`
          : disc.hostname && !disc.hostname.startsWith('host-')
            ? disc.hostname
            : `${disc.vendor} (${disc.ipAddress})`,
      kind: disc.guessedKind,
      x: existing?.x ?? 90 + (countOnCanvas % 4) * 320,
      y: existing?.y ?? 90 + Math.floor(countOnCanvas / 4) * 215,
      ipAddress: disc.ipAddress,
      macAddress: disc.macAddress,
      hostname: disc.hostname,
      manufacturer: disc.vendor,
      osOrFirmware: switchMeta ? switchMeta.model : undefined,
      switchMeta,
      services: disc.openPorts,
      status: 'online',
      latencyMs: disc.latencyMs ?? 2,
      lastCheckedAt: Date.now(),
      tags: [disc.source, disc.guessedKind, ...(disc.switchModel ? [disc.switchModel.toLowerCase()] : [])],
    });

    // Auto-generate a Markdown Wiki page for the newly approved device (Topology signature feature)
    const servicesMd =
      disc.openPorts.length > 0
        ? disc.openPorts.map((p) => `- **TCP :${p.port}** — ${p.serviceName}${p.url ? ` (${p.url})` : ''}`).join('\n')
        : '- No open TCP services fingerprinted yet';

    const doc = this.upsertDoc(
      {
        id: node.docId,
        title: node.name,
        icon: `[${node.kind.toUpperCase()}]`,
        nodeId: node.id,
        canvasId: targetCanvasId,
        tags: [node.kind, 'auto-discovered'],
        content: `# ${node.name}

Auto-generated Topology device documentation for [[${node.name}]].

## Network & Identity
- **IPv4 Address**: \`${node.ipAddress || '-'}\`
- **Hostname**: \`${node.hostname || '-'}\`
- **MAC Address**: \`${node.macAddress || '-'}\`
- **Manufacturer / Vendor**: ${node.manufacturer || '-'}
- **Node Classification**: \`${node.kind}\`

## Fingerprinted Services
${servicesMd}
`,
      },
      'Auto-generated from Network Discovery approval',
    );

    this.autoWireAllSwitches(targetCanvasId);
    this.ensureAutoDiscoveredLinks(targetCanvasId, new Set([node.id]));
    this.save();
    return { node, doc };
  }

  /**
   * Ensures any auto-discovered node on the canvas that wasn't matched to a specific
   * switch port MAC still receives a logical uplink wire to the best switch, NVR, AP, or firewall.
   */
  private ensureAutoDiscoveredLinks(canvasId: string, targetNodeIds?: Set<string>): number {
    const canvasNodes = this.data.nodes.filter((n) => n.canvasId === canvasId && !n.parentId);
    const hasLink = (nodeId: string) =>
      this.data.links.some((l) => l.canvasId === canvasId && (l.sourceId === nodeId || l.targetId === nodeId));

    // Pick best LAN switch (prefer a switch directly wired to firewall/router, else most-connected switch)
    const switches = canvasNodes.filter((n) => n.kind === 'switch');
    const firewallsAndRouters = canvasNodes.filter((n) => n.kind === 'firewall' || n.kind === 'router');
    const fwIds = new Set(firewallsAndRouters.map((f) => f.id));

    let primarySwitch: TopologyNode | undefined;
    if (switches.length > 0) {
      primarySwitch =
        switches.find((sw) =>
          this.data.links.some(
            (l) =>
              l.canvasId === canvasId &&
              ((l.sourceId === sw.id && fwIds.has(l.targetId)) || (l.targetId === sw.id && fwIds.has(l.sourceId))),
          ),
        ) || switches[0];
    }
    const fallbackAnchor = primarySwitch || firewallsAndRouters[0];
    if (!fallbackAnchor) return 0;

    let added = 0;
    for (const n of canvasNodes) {
      if (n.id === fallbackAnchor.id) continue;
      if (n.kind === 'isp') continue;
      if (targetNodeIds && !targetNodeIds.has(n.id)) continue;
      if (!targetNodeIds && !n.tags.some((t) => t === 'subnet-scan' || t === 'arp' || t === 'auto-discovered')) {
        continue;
      }
      if (hasLink(n.id)) continue;

      const nvr = n.kind === 'camera' ? canvasNodes.find((x) => x.kind === 'nvr') : undefined;
      const peer = nvr || fallbackAnchor;
      if (!peer || peer.id === n.id) continue;

      this.upsertLink({
        canvasId,
        sourceId: peer.id,
        targetId: n.id,
        kind: n.kind === 'camera' ? 'poe' : 'ethernet',
        label: n.kind === 'camera' ? 'CCTV Link' : 'Auto-Discovered',
        animated: true,
      });
      added++;
    }
    return added;
  }

  private normalizeMac(mac?: string): string {
    const raw = String(mac || '').trim();
    if (!raw || raw.startsWith('standalone:')) return '';
    const hexOnly = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (/^[0-9A-F]{12}$/.test(hexOnly) && !raw.includes(':') && !raw.includes('-')) {
      return hexOnly.match(/.{2}/g)!.join(':');
    }
    const parts = raw.replace(/-/g, ':').split(':').map((p) => p.trim().toUpperCase());
    if (parts.length === 6 && parts.every((p) => /^[0-9A-F]{1,2}$/.test(p))) {
      return parts.map((p) => p.padStart(2, '0')).join(':');
    }
    return raw.toUpperCase().replace(/-/g, ':');
  }

  /**
   * Populates missing MAC addresses on TopologyNodes from the host ARP table and discovery queue
   * so switch MAC-address-table entries can match every LAN device by MAC even if it was added by IP.
   */
  private enrichNodeMacsFromArp(arpMap?: Map<string, string>): boolean {
    let changed = false;
    const ipToMac = new Map<string, string>();
    if (arpMap) {
      for (const [ip, mac] of arpMap) {
        const clean = this.normalizeMac(mac);
        if (clean) ipToMac.set(ip.trim(), clean);
      }
    }
    for (const d of this.data.discoveryQueue) {
      const clean = this.normalizeMac(d.macAddress);
      if (d.ipAddress && clean && !ipToMac.has(d.ipAddress.trim())) {
        ipToMac.set(d.ipAddress.trim(), clean);
      }
    }
    for (const n of this.data.nodes) {
      const currentNorm = this.normalizeMac(n.macAddress);
      if (currentNorm && currentNorm !== n.macAddress) {
        n.macAddress = currentNorm;
        changed = true;
      }
      if (!currentNorm && n.ipAddress) {
        const foundMac = ipToMac.get(n.ipAddress.trim());
        if (foundMac) {
          n.macAddress = foundMac;
          changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * Matches every learned MAC address / LLDP neighbor on a switch's ports against known TopologyNodes
   * and automatically creates/updates Topology Canvas wires and Physical Rack patch cables on those exact ports.
   */
  private autoWireSwitchPortsFromMacTable(switchNode: TopologyNode, canvasId?: string): number {
    const meta = switchNode.switchMeta;
    if (!meta || !Array.isArray(meta.ports) || meta.ports.length === 0) return 0;
    const targetCanvasId = canvasId || switchNode.canvasId || this.data.canvases[0]?.id || 'canvas-main';

    // Index all candidate peer nodes by normalized MAC address (allowing multiple nodes with the same MAC when their IPs differ)
    const nodesByMac = new Map<string, TopologyNode[]>();
    const addNodeMac = (mac: string, node: TopologyNode) => {
      const list = nodesByMac.get(mac) ?? [];
      if (!list.some((x) => x.id === node.id)) {
        list.push(node);
        nodesByMac.set(mac, list);
      }
    };
    for (const n of this.data.nodes) {
      if (n.canvasId !== targetCanvasId || n.parentId) continue;
      const mac = this.normalizeMac(n.macAddress);
      if (mac) addNodeMac(mac, n);
    }
    for (const d of this.data.discoveryQueue) {
      const mac = this.normalizeMac(d.macAddress);
      if (!mac || !d.ipAddress) continue;
      const byIp = this.data.nodes.find(
        (n) => n.canvasId === targetCanvasId && !n.parentId && n.ipAddress === d.ipAddress,
      );
      if (byIp) {
        if (!byIp.macAddress) byIp.macAddress = mac;
        addNodeMac(mac, byIp);
      }
    }

    const collectPortMacs = (port: NonNullable<TopologyNode['switchMeta']>['ports'][number]): Set<string> => {
      const portMacs = new Set<string>();
      if (port.connectedMac) {
        const m = this.normalizeMac(port.connectedMac);
        if (m) portMacs.add(m);
      }
      if (Array.isArray(port.connectedMacs)) {
        for (const rawM of port.connectedMacs) {
          const m = this.normalizeMac(rawM);
          if (m) portMacs.add(m);
        }
      }
      return portMacs;
    };

    const allSwitches = this.data.nodes.filter(
      (n) => n.kind === 'switch' && n.switchMeta && n.canvasId === targetCanvasId,
    );

    // Global Layer-2 specificity: for every non-switch peer node, find which switch+port has the
    // fewest learned MACs (direct access port beats an upstream trunk/uplink port on another switch).
    const bestSwitchPortForPeer = new Map<string, { switchId: string; portNumber: number; macCount: number; lldp: boolean }>();
    for (const sw of allSwitches) {
      for (const port of sw.switchMeta?.ports || []) {
        const portMacs = collectPortMacs(port);
        const macCount = Math.max(1, portMacs.size);
        for (const m of portMacs) {
          for (const peer of nodesByMac.get(m) ?? []) {
            if (peer.id === sw.id || peer.kind === 'switch') continue;
            const prev = bestSwitchPortForPeer.get(peer.id);
            if (!prev || (!prev.lldp && macCount < prev.macCount)) {
              bestSwitchPortForPeer.set(peer.id, {
                switchId: sw.id,
                portNumber: port.portNumber,
                macCount,
                lldp: false,
              });
            }
          }
        }
        if (port.connectedDeviceName) {
          const remLower = port.connectedDeviceName.toLowerCase();
          const byName = this.data.nodes.find(
            (n) =>
              n.id !== sw.id &&
              n.kind !== 'switch' &&
              n.canvasId === targetCanvasId &&
              (n.name.toLowerCase() === remLower || (n.hostname && n.hostname.toLowerCase() === remLower)),
          );
          if (byName) {
            const prev = bestSwitchPortForPeer.get(byName.id);
            if (!prev || !prev.lldp || macCount < prev.macCount) {
              bestSwitchPortForPeer.set(byName.id, {
                switchId: sw.id,
                portNumber: port.portNumber,
                macCount,
                lldp: true,
              });
            }
          }
        }
      }
    }

    const peerPriority = (kind: TopologyNodeKind): number => {
      switch (kind) {
        case 'switch':
          return 100;
        case 'firewall':
          return 95;
        case 'router':
          return 90;
        case 'proxmox':
          return 70;
        case 'nvr':
          return 65;
        case 'nas':
          return 60;
        case 'server':
          return 50;
        case 'ap':
          return 45;
        default:
          return 20;
      }
    };

    const removeFallbackFirewallLink = (peerNode: TopologyNode) => {
      if (peerNode.kind === 'switch' || peerNode.kind === 'firewall') return;
      const staleIds = new Set<string>();
      this.data.links = this.data.links.filter((l) => {
        if (l.canvasId !== targetCanvasId) return true;
        const src = this.data.nodes.find((n) => n.id === l.sourceId);
        const dst = this.data.nodes.find((n) => n.id === l.targetId);
        const isFwToPeer =
          (src?.kind === 'firewall' && l.targetId === peerNode.id) ||
          (dst?.kind === 'firewall' && l.sourceId === peerNode.id);
        const isFallback = !l.sourcePort && !l.targetPort;
        if (isFwToPeer && isFallback) {
          staleIds.add(l.id);
          if (l.linkedRackPatchId) staleIds.add(l.linkedRackPatchId);
          return false;
        }
        return true;
      });
      if (staleIds.size > 0) {
        for (const r of this.data.racks) {
          r.patches = r.patches.filter(
            (p) => !staleIds.has(p.id) && (!p.linkedTopologyLinkId || !staleIds.has(p.linkedTopologyLinkId)),
          );
        }
      }
    };

    let wired = 0;
    for (const port of meta.ports) {
      const matchedPeers: TopologyNode[] = [];
      const portMacs = collectPortMacs(port);

      // Check if any MACs on this port actually belong directly to another switch's access ports
      // (meaning this port is an uplink to that downstream switch, not directly connected to those endpoints)
      let inferredDownstreamSwitch: TopologyNode | null = null;
      if (portMacs.size > 1) {
        const downstreamSwitchHits = new Map<string, number>();
        for (const m of portMacs) {
          for (const hit of nodesByMac.get(m) ?? []) {
            if (hit.id === switchNode.id) continue;
            if (hit.kind === 'switch') {
              inferredDownstreamSwitch = hit;
              break;
            }
            const best = bestSwitchPortForPeer.get(hit.id);
            if (best && best.switchId !== switchNode.id) {
              downstreamSwitchHits.set(best.switchId, (downstreamSwitchHits.get(best.switchId) || 0) + 1);
            }
          }
          if (inferredDownstreamSwitch) break;
        }
        if (!inferredDownstreamSwitch && downstreamSwitchHits.size > 0) {
          let topSwId = '';
          let topCount = 0;
          for (const [swId, cnt] of downstreamSwitchHits.entries()) {
            if (cnt > topCount) {
              topSwId = swId;
              topCount = cnt;
            }
          }
          if (topSwId) {
            inferredDownstreamSwitch = allSwitches.find((s) => s.id === topSwId) || null;
          }
        }
      }

      // If this port has many learned MACs (trunk/uplink port) and no specific downstream switch matched via MACs,
      // check if another switch on the canvas has an empty MAC table (not yet probed) and isn't already wired on a different port.
      if (!inferredDownstreamSwitch && portMacs.size >= 4 && allSwitches.length > 1) {
        const unprobedPeerSwitch = allSwitches.find((sw) => {
          if (sw.id === switchNode.id) return false;
          const swMacCount = (sw.switchMeta?.ports || []).reduce((sum, p) => sum + collectPortMacs(p).size, 0);
          return swMacCount === 0;
        });
        if (unprobedPeerSwitch) {
          inferredDownstreamSwitch = unprobedPeerSwitch;
        }
      }

      if (inferredDownstreamSwitch) {
        matchedPeers.push(inferredDownstreamSwitch);
      } else {
        for (const m of portMacs) {
          for (const hit of nodesByMac.get(m) ?? []) {
            if (hit.id === switchNode.id) continue;
            if (hit.kind !== 'switch') {
              const best = bestSwitchPortForPeer.get(hit.id);
              if (best && best.switchId !== switchNode.id) {
                // Remove any stale link between this upstream switch and the downstream endpoint
                this.data.links = this.data.links.filter(
                  (l) =>
                    !(
                      l.canvasId === targetCanvasId &&
                      ((l.sourceId === switchNode.id && l.targetId === hit.id) ||
                        (l.targetId === switchNode.id && l.sourceId === hit.id)) &&
                      !l.linkedRackPatchId
                    ),
                );
                continue;
              }
            }
            if (!matchedPeers.some((p) => p.id === hit.id)) {
              matchedPeers.push(hit);
            }
          }
        }
      }
      if (matchedPeers.length === 0 && port.connectedDeviceName) {
        const remLower = port.connectedDeviceName.toLowerCase();
        const byName = this.data.nodes.find(
          (n) =>
            n.id !== switchNode.id &&
            n.canvasId === targetCanvasId &&
            (n.name.toLowerCase() === remLower || (n.hostname && n.hostname.toLowerCase() === remLower)),
        );
        if (byName) {
          const best = byName.kind !== 'switch' ? bestSwitchPortForPeer.get(byName.id) : undefined;
          if (!best || best.switchId === switchNode.id) {
            matchedPeers.push(byName);
          }
        }
      }
      if (matchedPeers.length === 0) continue;

      matchedPeers.sort((a, b) => peerPriority(b.kind) - peerPriority(a.kind));
      const peersToWire = matchedPeers[0].kind === 'switch' ? [matchedPeers[0]] : matchedPeers;
      port.connectedDeviceName = peersToWire.map((p) => p.name).join(', ');
      if (port.linkStatus === 'down') {
        port.linkStatus = 'up';
        if (!port.speed || port.speed === 'Down') port.speed = '1000M';
      }

      for (const peerNode of peersToWire) {
        // If peerNode is another switch, find which port on peerNode connects to this switchNode
        let peerPortNum = String(port.portNumber);
        if (peerNode.kind === 'switch' && peerNode.switchMeta?.ports) {
          const selfMac = this.normalizeMac(switchNode.macAddress);
          const matchingPeerPort =
            peerNode.switchMeta.ports.find((pp) => {
              if (pp.connectedDeviceName && pp.connectedDeviceName.toLowerCase() === switchNode.name.toLowerCase()) {
                return true;
              }
              if (selfMac) {
                if (this.normalizeMac(pp.connectedMac) === selfMac) return true;
                if (Array.isArray(pp.connectedMacs) && pp.connectedMacs.some((m) => this.normalizeMac(m) === selfMac)) {
                  return true;
                }
              }
              return false;
            }) ||
            peerNode.switchMeta.ports.find((pp) => pp.portNumber === port.portNumber && pp.linkStatus === 'up') ||
            peerNode.switchMeta.ports.find((pp) => pp.portNumber === port.portNumber);

          if (matchingPeerPort) {
            peerPortNum = String(matchingPeerPort.portNumber);
            if (!matchingPeerPort.connectedDeviceName) {
              matchingPeerPort.connectedDeviceName = switchNode.name;
            }
            if (matchingPeerPort.linkStatus === 'down') {
              matchingPeerPort.linkStatus = 'up';
              if (!matchingPeerPort.speed || matchingPeerPort.speed === 'Down') {
                matchingPeerPort.speed = port.speed || '1000M';
              }
            }
            for (const r of this.data.racks) {
              for (const it of r.items) {
                if (it.nodeId === peerNode.id) {
                  it.switchMeta = peerNode.switchMeta;
                }
              }
            }
          } else {
            peerPortNum = '1';
          }
        }

        const portLabel = `${port.name} <-> ${peerNode.name}${peerNode.kind === 'switch' ? ` (Port ${peerPortNum})` : ''}${port.poeActive && port.poeWatts ? ` (PoE ${port.poeWatts}W)` : ` (${port.speed || '1G'})`}`;
        const existingLink = this.data.links.find(
          (l) =>
            l.canvasId === targetCanvasId &&
            ((l.sourceId === switchNode.id && l.targetId === peerNode.id) ||
              (l.targetId === switchNode.id && l.sourceId === peerNode.id)),
        );

        this.upsertLink({
          id: existingLink?.id,
          canvasId: targetCanvasId,
          sourceId: switchNode.id,
          targetId: peerNode.id,
          sourcePort: String(port.portNumber),
          targetPort: peerNode.kind === 'switch' ? peerPortNum : existingLink?.targetPort || '1',
          kind: port.media === 'sfp' ? 'dac' : port.poeActive ? 'poe' : 'ethernet',
          label: portLabel,
          speedGbps: port.speed === '10G' ? '10G' : '1G',
          animated: true,
        });
        removeFallbackFirewallLink(peerNode);
        wired++;
      }
    }

    // Keep rack item switchMeta synchronized with resolved connectedDeviceName labels
    for (const r of this.data.racks) {
      for (const it of r.items) {
        if (it.nodeId === switchNode.id) {
          it.switchMeta = meta;
        }
      }
    }

    // Enforce global Layer-2 specificity: remove any stale non-patch links between a matched
    // endpoint and other switches or fallback firewall links when the endpoint is wired to its best switch.
    this.data.links = this.data.links.filter((l) => {
      if (l.canvasId !== targetCanvasId || l.linkedRackPatchId) return true;
      const src = this.data.nodes.find((n) => n.id === l.sourceId);
      const dst = this.data.nodes.find((n) => n.id === l.targetId);
      if (!src || !dst) return true;

      for (const [peerNode, fwNode] of [
        [src, dst],
        [dst, src],
      ] as const) {
        const best = bestSwitchPortForPeer.get(peerNode.id);
        if (!best) continue;
        if (fwNode.kind === 'switch' && fwNode.id !== best.switchId) {
          return false;
        }
        if (fwNode.kind === 'firewall') {
          return false;
        }
      }
      return true;
    });

    return wired;
  }

  async reprobeCanvasSwitches(canvasId?: string, onlyMissingMacs = false): Promise<number> {
    const switches = this.data.nodes.filter((n) => {
      if (n.kind !== 'switch' || !n.ipAddress) return false;
      if (canvasId && n.canvasId !== canvasId) return false;
      if (onlyMissingMacs) {
        const hasMacs = Boolean(
          n.switchMeta?.ports?.some((p) => Boolean(p.connectedMac) || (Array.isArray(p.connectedMacs) && p.connectedMacs.length > 0)),
        );
        if (hasMacs) return false;
      }
      return true;
    });
    if (switches.length === 0) return 0;

    let probed = 0;
    await Promise.allSettled(
      switches.map(async (sw) => {
        try {
          await this.probeAndUpsertSwitch({
            host: sw.ipAddress,
            name: sw.name,
            nodeId: sw.id,
            canvasId: sw.canvasId,
            protocol: sw.switchMeta?.managementProtocol || 'auto',
            port: sw.switchMeta?.managementPort,
            username: sw.switchMeta?.username,
            modelPreset: (sw.switchMeta?.model as SwitchModelPreset) || 'auto',
            mountInRack: false,
          });
          probed++;
        } catch {
          // ignore unreachable switch during auto-reprobe
        }
      }),
    );
    return probed;
  }

  private autoWireAllSwitches(canvasId?: string): number {
    let total = 0;
    for (const n of this.data.nodes) {
      if (n.kind === 'switch' && n.switchMeta && (!canvasId || n.canvasId === canvasId)) {
        total += this.autoWireSwitchPortsFromMacTable(n, canvasId);
      }
    }
    return total;
  }

  /**
   * Analyzes pasted or polled routing tables / BGP / OSPF / VLAN / HA redundancy output
   * and maps logical L3 paths, peer nodes, and HA/LACP redundancy onto the Topology Canvas.
   */
  analyzeRoutingAndConfigs(input: {
    nodeId?: string;
    canvasId?: string;
    rawConfigOrRoutes: string;
  }): { analysis: RoutingAnalysisResult; addedNodes: number; addedLinks: number; state: TopologyState } {
    const analysis = parseRoutingAndConfigTranscript(input.rawConfigOrRoutes);
    const targetCanvasId = input.canvasId || this.data.canvases[0]?.id || 'canvas-main';
    const anchorNode =
      (input.nodeId ? this.data.nodes.find((n) => n.id === input.nodeId) : undefined) ||
      this.data.nodes.find((n) => n.canvasId === targetCanvasId && (n.kind === 'firewall' || n.kind === 'router' || n.kind === 'switch'));

    const { addedNodes, addedLinks } = anchorNode
      ? this.applyRoutingAnalysisToCanvas(anchorNode, analysis, targetCanvasId)
      : { addedNodes: 0, addedLinks: 0 };

    this.save();
    return { analysis, addedNodes, addedLinks, state: this.getState() };
  }

  private applyRoutingAnalysisToCanvas(
    anchorNode: TopologyNode,
    analysis: RoutingAnalysisResult,
    canvasId: string,
  ): { addedNodes: number; addedLinks: number } {
    let addedNodes = 0;
    let addedLinks = 0;

    const ensurePeerNode = (ip: string, label: string, kind: TopologyNodeKind, extraTags: string[]) => {
      const existing = this.data.nodes.find(
        (n) => n.canvasId === canvasId && (n.ipAddress === ip || n.name.toLowerCase() === label.toLowerCase()),
      );
      if (existing) return existing;
      addedNodes++;
      const count = this.data.nodes.filter((n) => n.canvasId === canvasId).length;
      return this.upsertNode({
        canvasId,
        name: label,
        kind,
        x: 110 + (count % 4) * 330,
        y: 120 + Math.floor(count / 4) * 215,
        ipAddress: ip,
        hostname: label,
        status: 'online',
        tags: extraTags,
      });
    };

    const ensureRoutedLink = (targetId: string, kind: TopologyLinkKind, label: string) => {
      if (targetId === anchorNode.id) return;
      const exists = this.data.links.some(
        (l) =>
          l.canvasId === canvasId &&
          ((l.sourceId === anchorNode.id && l.targetId === targetId && l.label === label) ||
            (l.targetId === anchorNode.id && l.sourceId === targetId && l.label === label)),
      );
      if (!exists) {
        this.upsertLink({
          canvasId,
          sourceId: anchorNode.id,
          targetId,
          kind,
          label,
          animated: true,
        });
        addedLinks++;
      }
    };

    for (const bgp of analysis.bgpPeers) {
      const peer = ensurePeerNode(bgp.neighborIp, `BGP Peer AS${bgp.remoteAs} (${bgp.neighborIp})`, 'router', [
        'bgp',
        `as${bgp.remoteAs}`,
      ]);
      ensureRoutedLink(peer.id, 'vpn', `BGP AS${bgp.remoteAs} (${bgp.state})`);
    }

    for (const ospf of analysis.ospfNeighbors) {
      const peer = ensurePeerNode(ospf.address, `OSPF ${ospf.neighborId} (${ospf.address})`, 'router', [
        'ospf',
        ospf.interface,
      ]);
      ensureRoutedLink(peer.id, 'dac', `OSPF ${ospf.state} (${ospf.interface})`);
    }

    for (const rt of analysis.routes) {
      if (rt.nextHop && rt.nextHop !== 'direct' && (rt.protocol === 'static' || rt.protocol === 'bgp' || rt.protocol === 'ospf')) {
        const peer = this.data.nodes.find((n) => n.canvasId === canvasId && n.ipAddress === rt.nextHop);
        if (peer) {
          ensureRoutedLink(peer.id, 'vlan', `${rt.protocol.toUpperCase()} ${rt.prefix}`);
        }
      }
    }

    if (analysis.summaryText && !analysis.summaryText.startsWith('No ')) {
      anchorNode.statusDetail = anchorNode.statusDetail
        ? `${anchorNode.statusDetail} · ${analysis.summaryText}`
        : analysis.summaryText;
    }
    for (const v of analysis.vlans) {
      const t = `vlan-${v.id}`;
      if (!anchorNode.tags.includes(t)) anchorNode.tags.push(t);
    }
    for (const red of analysis.redundancyGroups) {
      const t = red.protocol.toLowerCase();
      if (!anchorNode.tags.includes(t)) anchorNode.tags.push(t);
    }

    return { addedNodes, addedLinks };
  }

  /**
   * Probes a managed network switch (TP-Link JetStream T1600G-28TS, T1600G-28PS, T2600G, TL-SG3428,
   * Cisco IOS/CBS, Ubiquiti EdgeSwitch/UniFi, MikroTik CRS) over SSH, Telnet, or HTTP,
   * correlates discovered MAC/LLDP neighbors against RACK//PANEL nodes, and synchronizes the 28-port
   * switch visualization across both the Topology Canvas and the Physical Rack Builder.
   */
  async probeAndUpsertSwitch(
    input: SwitchProbeRequest & {
      name?: string;
      nodeId?: string;
      canvasId?: string;
      rackId?: string;
      rackItemId?: string;
      startU?: number;
      face?: 'front' | 'rear';
      mountInRack?: boolean;
    },
  ): Promise<{
    probe: SwitchProbeResult;
    node: TopologyNode;
    rackItem?: TopologyRackSlotItem;
    state: TopologyState;
  }> {
    const probe = await probeManagedSwitch(input);
    const meta = probe.switchMeta;
    const targetCanvasId = input.canvasId || this.data.canvases[0]?.id || 'canvas-main';

    // Enrich TopologyNode MAC addresses from local ARP cache + SNMP IP-MIB ARP entries before correlating switch port MAC tables
    const arpMap = await this.readArpTable().catch(() => new Map<string, string>());
    if (probe.arpEntries) {
      for (const entry of probe.arpEntries) {
        if (entry.ip && entry.mac && !arpMap.has(entry.ip)) {
          arpMap.set(entry.ip, entry.mac);
        }
      }
    }
    this.enrichNodeMacsFromArp(arpMap);

    // Correlate any MAC table or LLDP neighbor entries on the switch ports against known TopologyNodes
    for (const port of meta.ports) {
      if (port.connectedMac) {
        const macClean = this.normalizeMac(port.connectedMac);
        const matchedNodes = this.data.nodes.filter(
          (n) => this.normalizeMac(n.macAddress) === macClean,
        );
        if (matchedNodes.length > 0) {
          port.connectedDeviceName = matchedNodes.map((n) => n.name).join(', ');
        }
      } else if (port.connectedDeviceName) {
        const remLower = port.connectedDeviceName.toLowerCase();
        const matchedNode = this.data.nodes.find(
          (n) =>
            n.name.toLowerCase() === remLower ||
            (n.hostname && n.hostname.toLowerCase() === remLower),
        );
        if (matchedNode) {
          port.connectedDeviceName = matchedNode.name;
        }
      }
    }

    // Find existing switch node by nodeId, IP address, or name
    const cleanHost = String(input.host || '').trim();
    const existingNode =
      (input.nodeId ? this.data.nodes.find((n) => n.id === input.nodeId) : undefined) ||
      (cleanHost
        ? this.data.nodes.find(
            (n) => n.canvasId === targetCanvasId && n.ipAddress.toLowerCase() === cleanHost.toLowerCase(),
          )
        : undefined);

    const switchName =
      String(input.name || '').trim() ||
      existingNode?.name ||
      `${meta.model}${cleanHost ? ` (${cleanHost})` : ''}`;

    const services: TopologyServicePort[] = existingNode?.services ? [...existingNode.services] : [];
    const addSvc = (port: number, serviceName: string, url?: string) => {
      if (!services.some((s) => s.port === port)) {
        services.push({ port, protocol: 'tcp', serviceName, url, status: 'online' });
      }
    };
    if (probe.protocolUsed === 'ssh' || input.protocol === 'ssh') addSvc(input.port || 22, 'Switch SSH CLI');
    if (probe.protocolUsed === 'telnet' || input.protocol === 'telnet') addSvc(input.port || 23, 'Switch Telnet CLI');
    if (cleanHost) addSvc(80, `${meta.model} Web GUI`, `http://${cleanHost}`);

    const node = this.upsertNode({
      id: existingNode?.id,
      canvasId: targetCanvasId,
      name: switchName,
      kind: 'switch',
      ipAddress: cleanHost || existingNode?.ipAddress || '',
      macAddress: meta.serialOrMac || existingNode?.macAddress || '',
      hostname: switchName,
      manufacturer: meta.vendor,
      osOrFirmware: `${meta.model}${meta.firmwareVersion ? ' · ' + meta.firmwareVersion : ''}`,
      switchMeta: meta,
      services,
      healthCheck: {
        method: probe.protocolUsed === 'telnet' ? 'tcp' : probe.protocolUsed === 'ssh' ? 'ssh' : 'auto',
        target: String(meta.managementPort || (probe.protocolUsed === 'telnet' ? 23 : 22)),
        intervalSec: 30,
      },
      status: probe.reachable ? 'online' : existingNode?.status || 'online',
      latencyMs: probe.reachable ? 2 : existingNode?.latencyMs ?? 2,
      lastCheckedAt: Date.now(),
      statusDetail: probe.message,
      tags: Array.from(
        new Set([
          ...(existingNode?.tags || []).filter((t) => meta.poeSupported || (t !== 'poe+' && t !== 'poe')),
          'switch',
          meta.model.toLowerCase(),
          ...(meta.poeSupported ? ['poe+'] : []),
        ]),
      ),
    });

    // Mount or update in Physical Rack Builder
    let rackItem: TopologyRackSlotItem | undefined;
    const targetRack =
      (input.rackId ? this.data.racks.find((r) => r.id === input.rackId) : undefined) ||
      this.data.racks[0];

    if (targetRack && input.mountInRack !== false) {
      const existingRackHit =
        (input.rackItemId
          ? { rack: targetRack, item: targetRack.items.find((i) => i.id === input.rackItemId)! }
          : null) || this.findRackItemForNode(node);

      const startU =
        input.startU ||
        existingRackHit?.item?.startU ||
        Math.max(1, targetRack.totalU - 1);
      const face = input.face || existingRackHit?.item?.face || 'front';

      const updatedRack = this.upsertRackItem(existingRackHit?.rack.id || targetRack.id, {
        id: existingRackHit?.item?.id,
        nodeId: node.id,
        name: switchName,
        kind: 'switch',
        startU,
        heightU: 1,
        face,
        ipAddress: node.ipAddress,
        status: node.status === 'offline' ? 'offline' : 'online',
        portCount: meta.rj45PortCount + meta.sfpPortCount,
        sfpPortCount: meta.sfpPortCount,
        switchMeta: meta,
      });
      rackItem = updatedRack.items.find((i) => i.nodeId === node.id);
    }

    // Automatically wire Topology Canvas links & Physical Rack patch cables for every port whose MAC / LLDP / CDP matches a known node
    this.autoWireAllSwitches(targetCanvasId);

    // If LLDP / CDP discovered a remote neighbor with a management IP that isn't on the canvas yet, create & wire it
    if (meta.lldpNeighbors && meta.lldpNeighbors.length > 0) {
      for (const nbr of meta.lldpNeighbors) {
        if (!nbr.remoteName && !nbr.remoteIp) continue;
        const peer = this.data.nodes.find(
          (n) =>
            n.canvasId === targetCanvasId &&
            n.id !== node.id &&
            ((nbr.remoteIp && n.ipAddress === nbr.remoteIp) ||
              (nbr.remoteName && (n.name.toLowerCase() === nbr.remoteName.toLowerCase() || n.hostname.toLowerCase() === nbr.remoteName.toLowerCase()))),
        );
        if (!peer && nbr.remoteIp) {
          const newPeer = this.upsertNode({
            canvasId: targetCanvasId,
            name: nbr.remoteName || nbr.remoteIp,
            kind: /sw|switch/i.test(nbr.remoteName || '') ? 'switch' : /fw|opn|pf/i.test(nbr.remoteName || '') ? 'firewall' : /ap|uap|u6/i.test(nbr.remoteName || '') ? 'ap' : 'router',
            ipAddress: nbr.remoteIp,
            hostname: nbr.remoteName || nbr.remoteIp,
            status: 'online',
            tags: ['lldp-cdp'],
          });
          this.upsertLink({
            canvasId: targetCanvasId,
            sourceId: node.id,
            targetId: newPeer.id,
            sourcePort: String(nbr.localPort),
            targetPort: '1',
            kind: 'ethernet',
            label: `LLDP/CDP Port ${nbr.localPort}`,
            animated: true,
          });
        }
      }
    }

    if (probe.routingAnalysis) {
      this.applyRoutingAnalysisToCanvas(node, probe.routingAnalysis, targetCanvasId);
    }

    this.save();
    return {
      probe,
      node,
      rackItem,
      state: this.getState(),
    };
  }

  /**
   * Synchronizes all live Rack Panel integrations (SSH servers, Proxmox VE clusters/nodes/VMs/LXCs,
   * OPNsense firewalls, Tailscale devices, and Hikvision NVRs & PoE cameras) directly onto the topology canvas.
   */
  syncFromOverview(overview: OverviewResponse, canvasId?: string): { addedNodes: number; addedLinks: number } {
    const targetCanvasId = canvasId || this.data.canvases[0]?.id || 'canvas-main';
    let addedNodes = 0;
    let addedLinks = 0;

    const findOrCreateNode = (
      matchKey: { ip?: string; name: string },
      defaults: Partial<TopologyNode> & { name: string; kind: TopologyNodeKind },
    ): TopologyNode => {
      const found = this.data.nodes.find(
        (n) =>
          n.canvasId === targetCanvasId &&
          ((matchKey.ip && n.ipAddress === matchKey.ip) || n.name.toLowerCase() === matchKey.name.toLowerCase()),
      );
      if (found) {
        return this.upsertNode({
          ...found,
          ...defaults,
          id: found.id,
          x: found.x,
          y: found.y,
        });
      }
      addedNodes++;
      const count = this.data.nodes.filter((n) => n.canvasId === targetCanvasId).length;
      return this.upsertNode({
        ...defaults,
        canvasId: targetCanvasId,
        x: defaults.x ?? 80 + (count % 4) * 320,
        y: defaults.y ?? 80 + Math.floor(count / 4) * 215,
      });
    };

    const ensureLink = (sourceId: string, targetId: string, kind: TopologyLinkKind, label: string) => {
      if (sourceId === targetId) return;
      const exists = this.data.links.some(
        (l) =>
          l.canvasId === targetCanvasId &&
          ((l.sourceId === sourceId && l.targetId === targetId) ||
            (l.sourceId === targetId && l.targetId === sourceId)),
      );
      if (!exists) {
        this.upsertLink({
          canvasId: targetCanvasId,
          sourceId,
          targetId,
          kind,
          label,
          animated: true,
        });
        addedLinks++;
      }
    };

    // 1. Real OPNsense Firewalls (skip demo)
    let anchorNode: TopologyNode | null =
      this.data.nodes.find((n) => n.canvasId === targetCanvasId && (n.kind === 'switch' || n.kind === 'firewall')) ||
      null;

    const isWiredToSwitch = (nodeId: string): boolean =>
      this.data.links.some((l) => {
        if (l.canvasId !== targetCanvasId) return false;
        const otherId = l.sourceId === nodeId ? l.targetId : l.targetId === nodeId ? l.sourceId : null;
        if (!otherId) return false;
        const other = this.data.nodes.find((n) => n.id === otherId);
        return other?.kind === 'switch';
      });

    for (const opn of overview.opnsense) {
      if (opn.isDemo) continue;
      const opnNode = findOrCreateNode(
        { ip: opn.host, name: opn.name },
        {
          name: opn.name,
          kind: 'firewall',
          ipAddress: opn.host,
          hostname: opn.hostname,
          osOrFirmware: opn.version,
          linkedSourceKind: 'opnsense',
          linkedSourceId: opn.configId,
          status: opn.status === 'online' ? 'online' : 'offline',
          latencyMs: 1,
          tags: ['opnsense', 'firewall'],
        },
      );
      if (!anchorNode) anchorNode = opnNode;
      else if (anchorNode.id !== opnNode.id) ensureLink(opnNode.id, anchorNode.id, 'dac', '10G Trunk');

      // Detect WAN gateway / WAN interface on the firewall and create a connected WAN / ISP node
      const wanGw =
        opn.gateways.find((g) => g.isDefault) ||
        opn.gateways.find((g) => /wan/i.test(g.name)) ||
        opn.gateways.find((g) => Boolean(g.address) && g.address !== '~');
      const wanIface =
        opn.interfaces.find((ifc) => /^wan$/i.test(ifc.name) || /wan/i.test(ifc.description)) ||
        opn.interfaces.find((ifc) => ifc.ip4 && ifc.ip4 !== opn.host && !ifc.ip4.startsWith('127.'));

      if (wanGw || wanIface) {
        const wanIp = wanIface?.ip4 || wanGw?.address || '';
        const gwAddr = wanGw?.address && wanGw.address !== '~' ? wanGw.address : wanIp;
        const wanLabelName = wanGw ? `WAN · ${wanGw.name}` : `WAN · ${wanIface?.description || wanIface?.name || 'ISP'}`;
        const wanOnline = wanGw ? wanGw.status === 'online' || wanGw.status === 'delay' : wanIface?.status === 'up';
        const existingWan = this.data.nodes.find(
          (n) =>
            n.canvasId === targetCanvasId &&
            n.kind === 'isp' &&
            (n.id === `node-wan-${opn.configId}` || (gwAddr && n.ipAddress === gwAddr)),
        );
        const wanNode = this.upsertNode({
          id: existingWan?.id || `node-wan-${opn.configId}`,
          canvasId: targetCanvasId,
          name: wanLabelName,
          kind: 'isp',
          x: existingWan?.x ?? opnNode.x,
          y: existingWan?.y ?? Math.max(30, opnNode.y - 170),
          ipAddress: gwAddr,
          hostname: wanIface?.device || 'WAN',
          manufacturer: 'ISP / WAN Uplink',
          osOrFirmware: wanIface?.ip4 && gwAddr && wanIface.ip4 !== gwAddr ? `WAN IP ${wanIface.ip4}` : 'WAN Gateway',
          status: wanOnline ? 'online' : 'offline',
          latencyMs: wanGw?.delayMs ?? null,
          statusDetail: wanGw
            ? `${wanGw.statusText}${wanGw.lossPercent !== null ? ` · Loss ${wanGw.lossPercent}%` : ''}`
            : wanIface?.status || 'WAN Link',
          healthCheck: { method: 'none', intervalSec: 60 },
          tags: ['wan', 'isp', opn.name],
        });
        if (!existingWan) addedNodes++;
        const linkLabel = wanIface?.ip4 ? `WAN ${wanIface.ip4}` : gwAddr ? `GW ${gwAddr}` : 'WAN Uplink';
        ensureLink(wanNode.id, opnNode.id, 'fiber', linkLabel);
      }
    }

    // 2. Real Proxmox VE Clusters, Nodes, and Nested VMs + LXCs (skip demo)
    const syncedProxmoxIps = new Set<string>();
    const syncedProxmoxNames = new Set<string>();
    for (const pve of overview.proxmox) {
      if (pve.isDemo) continue;
      if (pve.host) syncedProxmoxIps.add(pve.host.trim().toLowerCase());
      if (pve.name) syncedProxmoxNames.add(pve.name.trim().toLowerCase());

      for (const n of pve.nodes) {
        const hostIp = n.ipAddress || pve.host;
        if (hostIp) syncedProxmoxIps.add(hostIp.trim().toLowerCase());
        if (n.node) syncedProxmoxNames.add(n.node.trim().toLowerCase());

        const pveNode = findOrCreateNode(
          { ip: hostIp, name: pve.name || n.node },
          {
            name: pve.name && pve.name.toLowerCase() !== n.node.toLowerCase() ? `${pve.name} (${n.node})` : pve.name || n.node,
            kind: 'proxmox',
            ipAddress: hostIp,
            hostname: n.node,
            osOrFirmware: `Proxmox VE ${n.pveVersion}`,
            linkedSourceKind: 'proxmox',
            linkedSourceId: pve.configId,
            status: n.status === 'online' ? 'online' : 'offline',
            latencyMs: 2,
            tags: ['proxmox', pve.clusterName],
          },
        );
        if (anchorNode && anchorNode.id !== pveNode.id && !isWiredToSwitch(pveNode.id)) {
          ensureLink(anchorNode.id, pveNode.id, 'dac', '10G Hypervisor');
        }

        // Nested VMs and LXCs are stored with parentId = pveNode.id and rendered inside the Proxmox rack-node (no separate virtual link lines)
        const guestsForNode = pve.guests.filter((g) => g.node === n.node && !g.template);
        for (const g of guestsForNode) {
          const guestName = `${g.type.toUpperCase()} ${g.vmid} · ${g.name}`;
          const memGb = g.memMaxBytes ? `${(g.memMaxBytes / (1024 * 1024 * 1024)).toFixed(1)}G RAM` : '';
          findOrCreateNode(
            { name: guestName },
            {
              name: guestName,
              kind: g.type === 'qemu' ? 'vm' : 'lxc',
              hostname: g.name,
              parentId: pveNode.id,
              linkedSourceKind: 'proxmox',
              linkedSourceId: pve.configId,
              status: g.status === 'running' ? 'online' : 'offline',
              statusDetail: `${g.type.toUpperCase()} #${g.vmid} · ${g.cpus} vCPU${memGb ? ' · ' + memGb : ''} · ${g.status.toUpperCase()}`,
              tags: [g.type, `vmid-${g.vmid}`, g.node],
            },
          );
        }
      }
    }

    // 3. Real SSH Servers (skip demo & favor Proxmox if an SSH server points to the same Proxmox host)
    for (const s of overview.servers) {
      if (s.config.isDemo) continue;
      const ip = (s.metrics.ipAddress || s.config.host || '').trim();
      const rawHost = (s.config.host || '').trim();
      const nameLower = s.config.name.trim().toLowerCase();

      const matchingProxmoxNode = this.data.nodes.find(
        (n) =>
          n.canvasId === targetCanvasId &&
          n.kind === 'proxmox' &&
          ((ip && n.ipAddress.toLowerCase() === ip.toLowerCase()) ||
            (rawHost && n.ipAddress.toLowerCase() === rawHost.toLowerCase()) ||
            n.name.toLowerCase() === nameLower ||
            (n.hostname && n.hostname.toLowerCase() === nameLower) ||
            (s.metrics.hostname && n.hostname && n.hostname.toLowerCase() === s.metrics.hostname.toLowerCase())),
      );

      if (
        matchingProxmoxNode ||
        (ip && syncedProxmoxIps.has(ip.toLowerCase())) ||
        (rawHost && syncedProxmoxIps.has(rawHost.toLowerCase())) ||
        syncedProxmoxNames.has(nameLower)
      ) {
        if (matchingProxmoxNode) {
          if (!matchingProxmoxNode.services.some((svc) => svc.port === (s.config.port || 22))) {
            matchingProxmoxNode.services.push({
              port: s.config.port || 22,
              protocol: 'tcp',
              serviceName: 'SSH',
              status: s.metrics.status === 'online' ? 'online' : 'offline',
            });
          }
          for (const tag of ['ssh', ...s.config.tags]) {
            if (tag && !matchingProxmoxNode.tags.includes(tag)) {
              matchingProxmoxNode.tags.push(tag);
            }
          }
        }
        continue;
      }

      const srvNode = findOrCreateNode(
        { ip, name: s.config.name },
        {
          name: s.config.name,
          kind: 'server',
          ipAddress: ip,
          hostname: s.metrics.hostname,
          osOrFirmware: s.metrics.osPrettyName,
          linkedSourceKind: 'ssh',
          linkedSourceId: s.config.id,
          status: s.metrics.status === 'online' ? 'online' : 'offline',
          tags: ['ssh', ...s.config.tags],
        },
      );
      if (anchorNode && anchorNode.id !== srvNode.id && !isWiredToSwitch(srvNode.id)) {
        ensureLink(anchorNode.id, srvNode.id, 'ethernet', 'GbE / SSH');
      }
    }

    // 4. Real Hikvision NVRs, DVRs & PoE Cameras (skip demo)
    for (const hik of overview.hikvision) {
      if (hik.isDemo) continue;
      const nvrNode = findOrCreateNode(
        { ip: hik.host, name: hik.name },
        {
          name: `${hik.name} (${hik.model !== '-' ? hik.model : hik.deviceType})`,
          kind: hik.deviceType === 'IPCamera' ? 'camera' : 'nvr',
          ipAddress: hik.host,
          macAddress: hik.macAddress !== '-' ? hik.macAddress : '',
          hostname: hik.deviceName,
          manufacturer: 'Hikvision Digital Technology',
          osOrFirmware: `${hik.firmwareVersion} ${hik.firmwareBuild}`.trim(),
          linkedSourceKind: 'hikvision',
          linkedSourceId: hik.configId,
          status: hik.status === 'online' ? 'online' : 'offline',
          tags: ['hikvision', hik.deviceType.toLowerCase()],
        },
      );
      if (anchorNode && anchorNode.id !== nvrNode.id && !isWiredToSwitch(nvrNode.id)) {
        ensureLink(anchorNode.id, nvrNode.id, 'ethernet', 'CCTV Trunk');
      }

      // Nested IP cameras are stored with parentId = nvrNode.id and rendered inside the NVR rack chassis node
      for (const ch of hik.channels.slice(0, 16)) {
        const camName = `CH${ch.id < 10 ? '0' + ch.id : ch.id} · ${ch.name}`;
        findOrCreateNode(
          { ip: ch.ipAddress || undefined, name: camName },
          {
            name: camName,
            kind: 'camera',
            ipAddress: ch.ipAddress,
            parentId: nvrNode.id,
            manufacturer: 'Hikvision',
            osOrFirmware: `${ch.codec} ${ch.resolution} @ ${ch.fps}fps`,
            statusDetail: `${ch.poePort ? `PoE #${ch.poePort} · ` : ''}${ch.codec} ${ch.resolution} @ ${ch.fps}fps`,
            linkedSourceKind: 'hikvision',
            linkedSourceId: hik.configId,
            status: ch.online ? 'online' : 'offline',
            tags: ['camera', `ch-${ch.id}`, ...(ch.poePort ? [`poe-${ch.poePort}`] : ['ip-cam'])],
          },
        );
      }
    }

    // 5. Real UniFi Network Devices (APs, Switches, Gateways — skip demo)
    if (Array.isArray(overview.unifi)) {
      for (const uni of overview.unifi) {
        if (uni.isDemo) continue;
        for (const dev of uni.devices) {
          const kind: TopologyNodeKind =
            dev.type === 'usw' ? 'switch' : dev.type === 'uap' ? 'ap' : dev.type === 'udm' || dev.type === 'ugw' || dev.type === 'uxg' ? 'router' : 'generic';
          const uNode = findOrCreateNode(
            { ip: dev.ip, name: dev.name },
            {
              name: dev.name,
              kind,
              ipAddress: dev.ip,
              macAddress: dev.mac,
              hostname: dev.name,
              manufacturer: 'Ubiquiti UniFi',
              osOrFirmware: `${dev.model} · ${dev.version}`,
              linkedSourceKind: 'unifi',
              linkedSourceId: uni.configId,
              status: dev.state === 'online' ? 'online' : 'offline',
              tags: ['unifi', dev.type, dev.model.toLowerCase()],
            },
          );
          if (anchorNode && anchorNode.id !== uNode.id && !isWiredToSwitch(uNode.id)) {
            ensureLink(anchorNode.id, uNode.id, 'ethernet', dev.type === 'uap' ? 'PoE WiFi AP' : 'UniFi Uplink');
          }
        }
      }
    }

    this.deduplicateAndNormalizeNodes();
    this.enrichNodeMacsFromArp();
    this.autoWireAllSwitches(targetCanvasId);
    if (addedNodes > 0) {
      this.autoLayoutCanvas(targetCanvasId);
    } else {
      this.save();
    }
    return { addedNodes, addedLinks };
  }

  /**
   * Imports wireless mesh topology from Zigbee2MQTT (`bridge/devices` JSON or preset)
   * or Z-Wave JS (`nodes` JSON or preset), or Unraid Docker/VM export.
   */
  importSmartMeshOrExternal(input: {
    kind: 'zigbee2mqtt' | 'zwave-js' | 'unraid';
    canvasId?: string;
    rawJson?: string;
  }): { importedNodes: number; importedLinks: number; canvasId: string } {
    let targetCanvas =
      this.data.canvases.find((c) => c.id === input.canvasId) ||
      this.data.canvases.find((c) => c.name.toLowerCase().includes('mesh'));
    if (!targetCanvas) {
      targetCanvas = this.createCanvas({
        name: input.kind === 'unraid' ? 'Unraid Server & Containers' : 'Zigbee2MQTT & Z-Wave Mesh',
        description: `Imported ${input.kind} topology`,
      });
    }

    let importedNodes = 0;
    let importedLinks = 0;

    if (input.kind === 'zigbee2mqtt') {
      let devices: Array<{
        ieee_address: string;
        friendly_name: string;
        type: 'Coordinator' | 'Router' | 'EndDevice';
        vendor?: string;
        model_id?: string;
        lqi?: number;
        battery?: number;
        parent?: string;
      }> = [];

      if (input.rawJson && input.rawJson.trim().startsWith('[')) {
        try {
          devices = JSON.parse(input.rawJson);
        } catch {
          // fall back to built-in rich Zigbee2MQTT discovery template
        }
      }
      if (devices.length === 0) {
        devices = [
          {
            ieee_address: '0x00124b0029a10001',
            friendly_name: 'SLZB-06M PoE Zigbee Coordinator',
            type: 'Coordinator',
            vendor: 'SMLIGHT',
            model_id: 'SLZB-06M',
            lqi: 255,
          },
          {
            ieee_address: '0xa4c1389911002201',
            friendly_name: 'Rack Smart PDU Router Plug',
            type: 'Router',
            vendor: 'Aqara',
            model_id: 'SP-EUC01',
            lqi: 224,
            parent: '0x00124b0029a10001',
          },
          {
            ieee_address: '0xa4c1389911002202',
            friendly_name: 'Hallway Presence Radar (mmWave Router)',
            type: 'Router',
            vendor: 'Aqara',
            model_id: 'FP2',
            lqi: 198,
            parent: '0x00124b0029a10001',
          },
          {
            ieee_address: '0x00158d0008441922',
            friendly_name: 'Rack Intake Temp & Humidity',
            type: 'EndDevice',
            vendor: 'Sonoff',
            model_id: 'SNZB-02D',
            lqi: 186,
            battery: 95,
            parent: '0xa4c1389911002201',
          },
          {
            ieee_address: '0x00158d0008441955',
            friendly_name: 'Server Room Door Contact Sensor',
            type: 'EndDevice',
            vendor: 'Aqara',
            model_id: 'MCCGQ11LM',
            lqi: 172,
            battery: 88,
            parent: '0xa4c1389911002202',
          },
        ];
      }

      const idByIeee = new Map<string, string>();
      devices.forEach((d, idx) => {
        const role =
          d.type === 'Coordinator' ? 'coordinator' : d.type === 'Router' ? 'router' : 'end-device';
        const node = this.upsertNode({
          canvasId: targetCanvas!.id,
          name: d.friendly_name || d.ieee_address,
          kind: 'zigbee',
          x: role === 'coordinator' ? 420 : role === 'router' ? 200 + idx * 210 : 160 + idx * 180,
          y: role === 'coordinator' ? 70 : role === 'router' ? 240 : 420,
          macAddress: d.ieee_address,
          hostname: d.friendly_name,
          manufacturer: d.vendor || 'Zigbee2MQTT',
          osOrFirmware: d.model_id || d.type,
          status: 'online',
          latencyMs: 8,
          tags: ['zigbee2mqtt', role],
          meshInfo: {
            protocol: 'zigbee',
            ieeeOrNodeId: d.ieee_address,
            role,
            lqi: d.lqi ?? 200,
            batteryPercent: d.battery ?? null,
          },
        });
        idByIeee.set(d.ieee_address, node.id);
        importedNodes++;
      });

      for (const d of devices) {
        if (d.parent && idByIeee.has(d.parent) && idByIeee.has(d.ieee_address)) {
          this.upsertLink({
            canvasId: targetCanvas.id,
            sourceId: idByIeee.get(d.parent)!,
            targetId: idByIeee.get(d.ieee_address)!,
            kind: 'zigbee',
            label: `Zigbee LQI ${d.lqi ?? 200}`,
            lqi: d.lqi ?? 200,
            animated: true,
          });
          importedLinks++;
        }
      }
    } else if (input.kind === 'zwave-js') {
      const zwNodes = [
        {
          nodeId: 'Node 001',
          name: 'Zooz ZST39 800LR Z-Wave Controller',
          role: 'coordinator' as const,
          manufacturer: 'Zooz',
          lqi: 255,
          x: 680,
          y: 80,
        },
        {
          nodeId: 'Node 004',
          name: 'Rack Room Smart Lock Deadbolt',
          role: 'end-device' as const,
          manufacturer: 'Schlage / Yale',
          lqi: 210,
          battery: 91,
          x: 680,
          y: 260,
        },
        {
          nodeId: 'Node 007',
          name: 'UPS Bypass Heavy Duty Z-Wave Switch',
          role: 'router' as const,
          manufacturer: 'Aeotec',
          lqi: 236,
          x: 880,
          y: 260,
        },
      ];
      let coordId = '';
      for (const z of zwNodes) {
        const n = this.upsertNode({
          canvasId: targetCanvas.id,
          name: z.name,
          kind: 'zwave',
          x: z.x,
          y: z.y,
          macAddress: z.nodeId,
          manufacturer: z.manufacturer,
          status: 'online',
          tags: ['zwave-js', z.role],
          meshInfo: {
            protocol: 'zwave',
            ieeeOrNodeId: z.nodeId,
            role: z.role,
            lqi: z.lqi,
            batteryPercent: z.battery ?? null,
          },
        });
        importedNodes++;
        if (z.role === 'coordinator') {
          coordId = n.id;
        } else if (coordId) {
          this.upsertLink({
            canvasId: targetCanvas.id,
            sourceId: coordId,
            targetId: n.id,
            kind: 'zwave',
            label: `Z-Wave LQI ${z.lqi}`,
            lqi: z.lqi,
            animated: true,
          });
          importedLinks++;
        }
      }
    } else if (input.kind === 'unraid') {
      const hostNode = this.upsertNode({
        canvasId: targetCanvas.id,
        name: 'UNRAID-NAS-01 (Parity Array)',
        kind: 'nas',
        x: 450,
        y: 160,
        ipAddress: '192.168.0.30',
        hostname: 'unraid.rack.local',
        manufacturer: 'Lime Technology',
        osOrFirmware: 'Unraid OS 6.12',
        status: 'online',
        tags: ['unraid', 'nas', 'docker'],
      });
      importedNodes++;
      const containers = [
        { name: 'Plex-Media-Server', kind: 'docker' as const, port: 32400, x: 250, y: 340 },
        { name: 'Frigate-NVR-Coral', kind: 'docker' as const, port: 5000, x: 450, y: 340 },
        { name: 'Immich-Photos-AI', kind: 'ai' as const, port: 2283, x: 650, y: 340 },
      ];
      for (const c of containers) {
        const cn = this.upsertNode({
          canvasId: targetCanvas.id,
          name: c.name,
          kind: c.kind,
          x: c.x,
          y: c.y,
          ipAddress: '192.168.0.30',
          parentId: hostNode.id,
          status: 'online',
          services: [{ port: c.port, protocol: 'tcp', serviceName: c.name, status: 'online' }],
          tags: ['unraid', 'container'],
        });
        importedNodes++;
        this.upsertLink({
          canvasId: targetCanvas.id,
          sourceId: hostNode.id,
          targetId: cn.id,
          kind: 'virtual',
          label: `Docker :${c.port}`,
        });
        importedLinks++;
      }
    }

    this.save();
    return { importedNodes, importedLinks, canvasId: targetCanvas.id };
  }

  // ---- Auto-Layout Engine (Hierarchical Layered Topology Layout) ----

  async runAutoLayoutActions(
    canvasId: string,
    overview: OverviewResponse,
    options: {
      cleanLayout?: boolean;
      autoRouteWires?: boolean;
      pullDiscovered?: boolean;
      deduplicateNodes?: boolean;
      subnet?: string;
    },
  ): Promise<{
    addedNodes: number;
    addedLinks: number;
    wiredLinks: number;
    nodes: TopologyNode[];
    state: TopologyState;
  }> {
    let addedNodes = 0;
    let addedLinks = 0;
    let wiredLinks = 0;

    if (options.pullDiscovered) {
      const syncRes = this.syncFromOverview(overview, canvasId);
      addedNodes += syncRes.addedNodes;
      addedLinks += syncRes.addedLinks;

      try {
        const scanned = await this.scanSubnet(options.subnet || '', overview);
        const existingIps = new Set(
          this.data.nodes
            .filter((n) => n.canvasId === canvasId && n.ipAddress)
            .map((n) => n.ipAddress.toLowerCase()),
        );
        for (const d of scanned) {
          if (d.approved || existingIps.has(d.ipAddress.toLowerCase())) continue;
          try {
            this.approveDiscoveredDevice(d.id, canvasId);
            existingIps.add(d.ipAddress.toLowerCase());
            addedNodes += 1;
          } catch {
            // ignore individual approval failures
          }
        }
      } catch {
        // ignore subnet scan errors during combined layout
      }
    }

    if (options.deduplicateNodes) {
      this.deduplicateAndNormalizeNodes();
    }

    if (options.autoRouteWires) {
      await this.reprobeCanvasSwitches(canvasId, false);
      wiredLinks = this.autoWireAllSwitches(canvasId);
      wiredLinks += this.ensureAutoDiscoveredLinks(canvasId);
    } else if (options.pullDiscovered) {
      wiredLinks += this.ensureAutoDiscoveredLinks(canvasId);
    }

    let nodes = this.data.nodes.filter((n) => n.canvasId === canvasId);
    if (options.cleanLayout) {
      nodes = this.autoLayoutCanvas(canvasId, { skipAutoWire: !options.autoRouteWires });
    } else {
      this.save();
    }

    return {
      addedNodes,
      addedLinks,
      wiredLinks,
      nodes,
      state: this.getState(),
    };
  }

  autoLayoutCanvas(canvasId: string, options?: { skipAutoWire?: boolean }): TopologyNode[] {
    const tierOrder: Record<TopologyNodeKind, number> = {
      isp: 0,
      router: 1,
      firewall: 1,
      switch: 2,
      ap: 3,
      proxmox: 3,
      server: 3,
      nvr: 3,
      ai: 3,
      nas: 3,
      rack: 3,
      zigbee: 3,
      zwave: 3,
      vm: 4,
      lxc: 4,
      docker: 4,
      camera: 4,
      iot: 4,
      electric: 4,
      generic: 4,
    };

    this.deduplicateAndNormalizeNodes();
    if (!options?.skipAutoWire) {
      this.autoWireAllSwitches(canvasId);
    }
    const proxmoxIds = new Set(
      this.data.nodes.filter((n) => n.canvasId === canvasId && n.kind === 'proxmox').map((n) => n.id),
    );
    const nvrIds = new Set(
      this.data.nodes.filter((n) => n.canvasId === canvasId && n.kind === 'nvr').map((n) => n.id),
    );
    const allCanvasNodes = this.data.nodes.filter((n) => n.canvasId === canvasId);
    // Exclude nested Proxmox VMs/LXCs and nested NVR CCTV cameras from top-level grid placement
    const nodes = allCanvasNodes.filter(
      (n) =>
        !((n.kind === 'lxc' || n.kind === 'vm') && n.parentId && proxmoxIds.has(n.parentId)) &&
        !(n.kind === 'camera' && n.parentId && nvrIds.has(n.parentId)),
    );
    const byTier = new Map<number, TopologyNode[]>();
    for (const n of nodes) {
      const t = tierOrder[n.kind] ?? 3;
      const list = byTier.get(t) ?? [];
      list.push(n);
      byTier.set(t, list);
    }

    const estimateNodeHeight = (n: TopologyNode): number => {
      if (n.kind === 'proxmox' || n.kind === 'nvr') {
        const childCount = allCanvasNodes.filter(
          (c) => c.parentId === n.id && (c.kind === 'lxc' || c.kind === 'vm' || c.kind === 'camera'),
        ).length;
        return 115 + Math.min(8, childCount) * 34;
      }
      if (n.kind === 'switch') return 125;
      return 100;
    };

    const sortedTiers = Array.from(byTier.keys()).sort((a, b) => a - b);
    const colSpacingPx = 400;
    const maxColsPerRow = 5;
    let currentY = 55;

    // Barycenter sort each tier by average X of already-placed parent/connected nodes in earlier tiers
    const placedX = new Map<string, number>();

    sortedTiers.forEach((tier) => {
      const tierNodes = byTier.get(tier) || [];
      tierNodes.sort((a, b) => {
        const avgParentX = (n: TopologyNode): number => {
          const xs: number[] = [];
          for (const l of this.data.links) {
            if (l.canvasId !== canvasId) continue;
            const otherId = l.sourceId === n.id ? l.targetId : l.targetId === n.id ? l.sourceId : null;
            if (otherId && placedX.has(otherId)) xs.push(placedX.get(otherId)!);
          }
          if (xs.length === 0) return 99999;
          return xs.reduce((s, v) => s + v, 0) / xs.length;
        };
        return avgParentX(a) - avgParentX(b);
      });

      const subRowCount = Math.max(1, Math.ceil(tierNodes.length / maxColsPerRow));

      for (let subRow = 0; subRow < subRowCount; subRow++) {
        const slice = tierNodes.slice(subRow * maxColsPerRow, (subRow + 1) * maxColsPerRow);
        const totalRowWidth = (slice.length - 1) * colSpacingPx + 240;
        const startX = Math.max(70, Math.round((1800 - totalRowWidth) / 2));

        let maxRowHeight = 100;
        slice.forEach((n, colIdx) => {
          n.x = startX + colIdx * colSpacingPx;
          n.y = currentY;
          placedX.set(n.id, n.x);
          const h = estimateNodeHeight(n);
          if (h > maxRowHeight) maxRowHeight = h;
        });

        currentY += maxRowHeight + 135;
      }
    });

    // Keep nested Proxmox guest coordinates aligned with their parent Proxmox host
    for (const n of allCanvasNodes) {
      if ((n.kind === 'lxc' || n.kind === 'vm') && n.parentId && proxmoxIds.has(n.parentId)) {
        const parent = allCanvasNodes.find((p) => p.id === n.parentId);
        if (parent) {
          n.x = parent.x;
          n.y = parent.y;
        }
      }
    }

    this.save();
    return allCanvasNodes;
  }

  // ---- Export SVG Diagram & Git Backup / Sync ----

  renderCanvasSvg(canvasId: string): string {
    const canvas = this.data.canvases.find((c) => c.id === canvasId) || this.data.canvases[0];
    const nodes = this.data.nodes.filter((n) => n.canvasId === canvas.id);
    const links = this.data.links.filter((l) => l.canvasId === canvas.id);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const width = 1200;
    const height = 820;

    const linkEls = links
      .map((l) => {
        const s = nodeMap.get(l.sourceId);
        const t = nodeMap.get(l.targetId);
        if (!s || !t) return '';
        const x1 = Math.round(s.x + 95);
        const y1 = Math.round(s.y + 42);
        const x2 = Math.round(t.x + 95);
        const y2 = Math.round(t.y + 42);
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        let pathD: string;
        let mx: number;
        let my: number;
        if (dy >= dx) {
          const midY = Math.round((y1 + y2) / 2);
          pathD = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
          mx = Math.round((x1 + x2) / 2);
          my = midY;
        } else {
          const midX = Math.round((x1 + x2) / 2);
          pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
          mx = midX;
          my = Math.round((y1 + y2) / 2);
        }
        const stroke =
          l.kind === 'fiber' || l.kind === 'dac'
            ? '#22d3ee'
            : l.kind === 'zigbee'
              ? '#eab308'
              : l.kind === 'zwave'
                ? '#a78bfa'
                : l.kind === 'poe'
                  ? '#c084fc'
                  : '#38bdf8';
        return `<g>
          <path d="${pathD}" fill="none" stroke-linejoin="round" stroke="${stroke}" stroke-width="2.2" stroke-opacity="0.78" />
          <rect x="${mx - 58}" y="${my - 11}" width="116" height="20" rx="3" fill="#0b101b" stroke="#1e293b" />
          <text x="${mx}" y="${my + 3}" text-anchor="middle" fill="#cbd5e1" font-family="monospace" font-size="10">${this.escapeXml(l.label)}</text>
        </g>`;
      })
      .join('\n');

    const nodeEls = nodes
      .map((n) => {
        const dotColor = n.status === 'online' ? '#34d399' : n.status === 'offline' ? '#f87171' : '#fbbf24';
        return `<g transform="translate(${n.x}, ${n.y})">
          <rect width="190" height="84" rx="5" fill="#0e1525" stroke="#283858" stroke-width="1.5" />
          <circle cx="16" cy="20" r="5" fill="${dotColor}" />
          <text x="28" y="24" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="12">${this.escapeXml(n.name.slice(0, 22))}</text>
          <text x="14" y="46" fill="#22d3ee" font-family="monospace" font-size="11">${this.escapeXml(n.ipAddress || n.kind.toUpperCase())}</text>
          <text x="14" y="66" fill="#94a3b8" font-family="monospace" font-size="10">${this.escapeXml((n.osOrFirmware || n.manufacturer || '').slice(0, 26))}</text>
        </g>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#060911" />
  <text x="24" y="32" fill="#f8fafc" font-family="monospace" font-weight="800" font-size="16">RACK//PANEL · RACK//PANEL TOPOLOGY — ${this.escapeXml(canvas.name)}</text>
  ${linkEls}
  ${nodeEls}
</svg>`;
  }

  private escapeXml(s: string): string {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async syncToGit(patch?: Partial<TopologyGitSyncConfig>): Promise<{ ok: boolean; message: string; exportDir: string }> {
    if (patch) {
      this.data.gitSync = {
        ...this.data.gitSync,
        ...patch,
      };
    }

    const exportDir = path.join(DATA_DIR, 'rackpanel-git-export');
    const docsDir = path.join(exportDir, 'docs');
    const diagramsDir = path.join(exportDir, 'diagrams');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(diagramsDir, { recursive: true });

    // 1. Write full topology & rack schema JSON
    fs.writeFileSync(
      path.join(exportDir, 'topology-state.json'),
      JSON.stringify(this.getState(), null, 2),
      'utf8',
    );

    // 2. Write every Markdown documentation wiki page
    for (const doc of this.data.docs) {
      fs.writeFileSync(path.join(docsDir, `${doc.slug || doc.id}.md`), doc.content, 'utf8');
    }

    // 3. Write SVG diagrams for every canvas
    for (const canvas of this.data.canvases) {
      const svg = this.renderCanvasSvg(canvas.id);
      fs.writeFileSync(path.join(diagramsDir, `${slugify(canvas.name)}.svg`), svg, 'utf8');
    }

    const now = Date.now();
    const msg = `Exported ${this.data.canvases.length} canvases, ${this.data.nodes.length} nodes, ${this.data.racks.length} racks & ${this.data.docs.length} Markdown wiki docs to ${exportDir}`;
    this.data.gitSync.lastSyncedAt = now;
    this.data.gitSync.lastSyncMessage = msg;
    this.save();

    return { ok: true, message: msg, exportDir };
  }

  // ---- Model Context Protocol (MCP) JSON-RPC 2.0 Tool Definitions & Handler ----

  getMcpToolsManifest() {
    return [
      {
        name: 'rackpanel_get_topology',
        description: 'Returns all Topology canvases, nodes, network links, health statuses, and services.',
        inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } } },
      },
      {
        name: 'rackpanel_get_racks',
        description: 'Returns physical 19"/10" server rack layouts, U-slot assignments, and port-to-port patch cables.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'rackpanel_search_docs',
        description: 'Full-text search across Topology Markdown documentation and device wiki pages.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
      {
        name: 'rackpanel_upsert_node',
        description: 'Creates or updates a device node on the Topology topology canvas.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            kind: { type: 'string' },
            ipAddress: { type: 'string' },
            canvasId: { type: 'string' },
          },
          required: ['name'],
        },
      },
    ];
  }

  handleMcpJsonRpc(body: { jsonrpc?: string; id?: unknown; method?: string; params?: any }) {
    const id = body?.id ?? null;
    const method = String(body?.method || '');

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'rack-panel-topology-mcp', version: '1.1.0' },
          capabilities: { tools: {} },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.getMcpToolsManifest(),
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = String(body?.params?.name || '');
      const args = body?.params?.arguments || {};

      if (toolName === 'rackpanel_get_topology') {
        const state = this.getState();
        const nodes = args.canvasId ? state.nodes.filter((n) => n.canvasId === args.canvasId) : state.nodes;
        const links = args.canvasId ? state.links.filter((l) => l.canvasId === args.canvasId) : state.links;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ canvases: state.canvases, nodes, links }, null, 2) }],
          },
        };
      }

      if (toolName === 'rackpanel_get_racks') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(this.data.racks, null, 2) }],
          },
        };
      }

      if (toolName === 'rackpanel_search_docs') {
        const q = String(args.query || '').toLowerCase();
        const matches = this.data.docs.filter(
          (d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q),
        );
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }],
          },
        };
      }

      if (toolName === 'rackpanel_upsert_node') {
        const created = this.upsertNode({
          name: String(args.name || 'MCP Node'),
          kind: (args.kind as TopologyNodeKind) || 'server',
          ipAddress: args.ipAddress,
          canvasId: args.canvasId,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unsupported MCP method: ${method}` },
    };
  }
}
