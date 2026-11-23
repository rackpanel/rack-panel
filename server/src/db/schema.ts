import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  pinLocked: integer('pin_locked').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  userAgent: text('user_agent'),
});

export const sshServers = sqliteTable('ssh_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  authMethod: text('auth_method').notNull(),
  password: text('password'),
  privateKey: text('private_key'),
  passphrase: text('passphrase'),
  rackUnit: text('rack_unit'),
  tagsJson: text('tags_json').notNull().default('[]'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const proxmoxConfigs = sqliteTable('proxmox_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  authType: text('auth_type').notNull(),
  username: text('username').notNull(),
  password: text('password'),
  tokenId: text('token_id'),
  tokenSecret: text('token_secret'),
  allowInsecureTls: integer('allow_insecure_tls').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const tailscaleConfigs = sqliteTable('tailscale_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mode: text('mode').notNull(),
  tailnet: text('tailnet').notNull(),
  apiKey: text('api_key'),
  oauthClientId: text('oauth_client_id'),
  oauthClientSecret: text('oauth_client_secret'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const opnsenseConfigs = sqliteTable('opnsense_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  protocol: text('protocol').notNull(),
  apiKey: text('api_key'),
  apiSecret: text('api_secret'),
  allowInsecureTls: integer('allow_insecure_tls').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const hikvisionConfigs = sqliteTable('hikvision_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  protocol: text('protocol').notNull(),
  rtspPort: integer('rtsp_port').notNull(),
  username: text('username').notNull(),
  password: text('password'),
  deviceKind: text('device_kind').notNull(),
  allowInsecureTls: integer('allow_insecure_tls').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const unifiConfigs = sqliteTable('unifi_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  controllerType: text('controller_type').notNull(),
  site: text('site').notNull().default('default'),
  username: text('username'),
  password: text('password'),
  apiKey: text('api_key'),
  allowInsecureTls: integer('allow_insecure_tls').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const upsConfigs = sqliteTable('ups_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  protocol: text('protocol').notNull().default('snmp'),
  port: integer('port').notNull().default(161),
  community: text('community'),
  password: text('password'),
  snmpVersion: text('snmp_version').notNull().default('2c'),
  upsName: text('ups_name'),
  modelPreset: text('model_preset').notNull().default('ibm-3000va-2700w-hv'),
  ratedVa: integer('rated_va').notNull().default(3000),
  ratedWatts: integer('rated_watts').notNull().default(2700),
  heightU: integer('height_u').notNull().default(2),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const topologyMeta = sqliteTable('topology_meta', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const topologyCanvases = sqliteTable('topology_canvases', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isDefault: integer('is_default').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const topologyNodes = sqliteTable('topology_nodes', {
  id: text('id').primaryKey(),
  canvasId: text('canvas_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  ipAddress: text('ip_address').notNull().default(''),
  macAddress: text('mac_address').notNull().default(''),
  hostname: text('hostname').notNull().default(''),
  vlan: integer('vlan'),
  subnet: text('subnet').notNull().default(''),
  manufacturer: text('manufacturer').notNull().default(''),
  osOrFirmware: text('os_or_firmware').notNull().default(''),
  parentId: text('parent_id'),
  linkedSourceKind: text('linked_source_kind'),
  linkedSourceId: text('linked_source_id'),
  customIconUrl: text('custom_icon_url'),
  tagsJson: text('tags_json').notNull().default('[]'),
  servicesJson: text('services_json').notNull().default('[]'),
  healthCheckJson: text('health_check_json').notNull(),
  status: text('status').notNull().default('unknown'),
  latencyMs: real('latency_ms'),
  lastCheckedAt: integer('last_checked_at'),
  statusDetail: text('status_detail'),
  rackPlacementJson: text('rack_placement_json'),
  meshInfoJson: text('mesh_info_json'),
  switchMetaJson: text('switch_meta_json'),
  docId: text('doc_id'),
  createdAt: text('created_at').notNull(),
});

export const topologyLinks = sqliteTable('topology_links', {
  id: text('id').primaryKey(),
  canvasId: text('canvas_id').notNull(),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull().default(''),
  speedGbps: text('speed_gbps').notNull().default(''),
  sourcePort: text('source_port').notNull().default(''),
  targetPort: text('target_port').notNull().default(''),
  vlan: integer('vlan'),
  lqi: integer('lqi'),
  animated: integer('animated').notNull().default(0),
  linkedRackPatchId: text('linked_rack_patch_id'),
});

export const topologyRacks = sqliteTable('topology_racks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  widthInches: integer('width_inches').notNull(),
  totalU: integer('total_u').notNull(),
  location: text('location').notNull().default(''),
  x: real('x'),
  y: real('y'),
  createdAt: text('created_at').notNull(),
});

export const topologyRackItems = sqliteTable('topology_rack_items', {
  id: text('id').primaryKey(),
  rackId: text('rack_id').notNull(),
  nodeId: text('node_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  startU: integer('start_u').notNull(),
  heightU: integer('height_u').notNull(),
  face: text('face').notNull().default('front'),
  slotIndex: integer('slot_index'),
  slotsTotal: integer('slots_total'),
  status: text('status').default('online'),
  ipAddress: text('ip_address').default(''),
  portCount: integer('port_count'),
  sfpPortCount: integer('sfp_port_count'),
  driveBays: integer('drive_bays'),
  outletCount: integer('outlet_count'),
  color: text('color').default('#0284c7'),
  switchMetaJson: text('switch_meta_json'),
});

export const topologyRackPatches = sqliteTable('topology_rack_patches', {
  id: text('id').primaryKey(),
  rackId: text('rack_id').notNull(),
  fromRackId: text('from_rack_id'),
  fromItemId: text('from_item_id').notNull(),
  fromPort: text('from_port').notNull(),
  toRackId: text('to_rack_id'),
  toItemId: text('to_item_id').notNull(),
  toPort: text('to_port').notNull(),
  label: text('label').notNull().default(''),
  cableKind: text('cable_kind').notNull(),
  color: text('color').notNull().default('#22c55e'),
  linkedTopologyLinkId: text('linked_topology_link_id'),
});

export const topologyDiscoveries = sqliteTable('topology_discoveries', {
  id: text('id').primaryKey(),
  ipAddress: text('ip_address').notNull(),
  hostname: text('hostname').notNull(),
  macAddress: text('mac_address').notNull().default(''),
  vendor: text('vendor').notNull().default(''),
  guessedKind: text('guessed_kind').notNull(),
  openPortsJson: text('open_ports_json').notNull().default('[]'),
  latencyMs: real('latency_ms'),
  source: text('source').notNull(),
  switchModel: text('switch_model'),
  discoveredAt: integer('discovered_at').notNull(),
  approved: integer('approved').notNull().default(0),
});

export const topologyDocs = sqliteTable('topology_docs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  icon: text('icon').notNull().default('[DOC]'),
  nodeId: text('node_id'),
  canvasId: text('canvas_id'),
  isHome: integer('is_home').notNull().default(0),
  content: text('content').notNull().default(''),
  tagsJson: text('tags_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
  revisionsJson: text('revisions_json').notNull().default('[]'),
});
