import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveDataDir(): string {
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

export class TursoDatabase {
  readonly client: Client;
  readonly drizzle: LibSQLDatabase<typeof schema>;
  readonly isRemote: boolean;
  readonly dbPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor() {
    const dataDir = resolveDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    this.dbPath = path.join(dataDir, 'rackpanel.db');
    const url = process.env.TURSO_DATABASE_URL || `file:${this.dbPath}`;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    this.isRemote = Boolean(process.env.TURSO_DATABASE_URL && !url.startsWith('file:'));
    this.client = createClient(authToken ? { url, authToken } : { url });
    this.drizzle = drizzle(this.client, { schema });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.isRemote) {
      await this.client.execute('PRAGMA journal_mode = WAL;');
      await this.client.execute('PRAGMA synchronous = NORMAL;');
      await this.client.execute('PRAGMA foreign_keys = ON;');
      await this.client.execute('PRAGMA busy_timeout = 5000;');
    }

    const schemaStatements = [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pin_locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        user_agent TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS ssh_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        auth_method TEXT NOT NULL,
        password TEXT,
        private_key TEXT,
        passphrase TEXT,
        rack_unit TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS proxmox_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        auth_type TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        token_id TEXT,
        token_secret TEXT,
        allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS tailscale_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        tailnet TEXT NOT NULL,
        api_key TEXT,
        oauth_client_id TEXT,
        oauth_client_secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS opnsense_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        api_key TEXT,
        api_secret TEXT,
        allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS hikvision_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        rtsp_port INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        device_kind TEXT NOT NULL,
        allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS unifi_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        controller_type TEXT NOT NULL,
        site TEXT NOT NULL DEFAULT 'default',
        username TEXT,
        password TEXT,
        api_key TEXT,
        allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS ups_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'snmp',
        port INTEGER NOT NULL DEFAULT 161,
        community TEXT,
        password TEXT,
        snmp_version TEXT NOT NULL DEFAULT '2c',
        ups_name TEXT,
        model_preset TEXT NOT NULL DEFAULT 'ibm-3000va-2700w-hv',
        rated_va INTEGER NOT NULL DEFAULT 3000,
        rated_watts INTEGER NOT NULL DEFAULT 2700,
        height_u INTEGER NOT NULL DEFAULT 2,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS topology_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS topology_canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS topology_nodes (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        mac_address TEXT NOT NULL DEFAULT '',
        hostname TEXT NOT NULL DEFAULT '',
        vlan INTEGER,
        subnet TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '',
        os_or_firmware TEXT DEFAULT '',
        parent_id TEXT,
        linked_source_kind TEXT,
        linked_source_id TEXT,
        custom_icon_url TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        services_json TEXT NOT NULL DEFAULT '[]',
        health_check_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'unknown',
        latency_ms REAL,
        last_checked_at INTEGER,
        status_detail TEXT,
        rack_placement_json TEXT,
        mesh_info_json TEXT,
        switch_meta_json TEXT,
        doc_id TEXT,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS topology_links (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        speed_gbps TEXT DEFAULT '',
        source_port TEXT DEFAULT '',
        target_port TEXT DEFAULT '',
        vlan INTEGER,
        lqi INTEGER,
        animated INTEGER NOT NULL DEFAULT 0,
        linked_rack_patch_id TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS topology_racks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width_inches INTEGER NOT NULL DEFAULT 19,
        total_u INTEGER NOT NULL DEFAULT 24,
        location TEXT NOT NULL DEFAULT 'Server Rack',
        x REAL,
        y REAL,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS topology_rack_items (
        id TEXT PRIMARY KEY,
        rack_id TEXT NOT NULL,
        node_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_u INTEGER NOT NULL,
        height_u INTEGER NOT NULL,
        face TEXT NOT NULL DEFAULT 'front',
        slot_index INTEGER,
        slots_total INTEGER,
        status TEXT DEFAULT 'online',
        ip_address TEXT DEFAULT '',
        port_count INTEGER,
        sfp_port_count INTEGER,
        drive_bays INTEGER,
        outlet_count INTEGER,
        color TEXT DEFAULT '#0284c7',
        switch_meta_json TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS topology_rack_patches (
        id TEXT PRIMARY KEY,
        rack_id TEXT NOT NULL,
        from_rack_id TEXT,
        from_item_id TEXT NOT NULL,
        from_port TEXT NOT NULL,
        to_rack_id TEXT,
        to_item_id TEXT NOT NULL,
        to_port TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        cable_kind TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#22c55e',
        linked_topology_link_id TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS topology_discoveries (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL,
        hostname TEXT NOT NULL,
        mac_address TEXT NOT NULL DEFAULT '',
        vendor TEXT NOT NULL DEFAULT '',
        guessed_kind TEXT NOT NULL,
        open_ports_json TEXT NOT NULL DEFAULT '[]',
        latency_ms REAL,
        source TEXT NOT NULL,
        switch_model TEXT,
        discovered_at INTEGER NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0
      );`,
      `CREATE TABLE IF NOT EXISTS topology_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '[DOC]',
        node_id TEXT,
        canvas_id TEXT,
        is_home INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        revisions_json TEXT NOT NULL DEFAULT '[]'
      );`,
    ];

    for (const sql of schemaStatements) {
      await this.client.execute(sql);
    }
    try {
      await this.client.execute('ALTER TABLE ups_configs ADD COLUMN password TEXT;');
    } catch {
      // column already exists
    }
    this.initialized = true;
  }

  /**
   * Executes a serialized Drizzle ORM write transaction on SQLite / Turso.
   */
  runDrizzleTransaction<T>(fn: (tx: Parameters<Parameters<LibSQLDatabase<typeof schema>['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(async () => {
      if (!this.initialized) {
        await this.init();
      }
      return this.drizzle.transaction(fn);
    });
    this.writeQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /**
   * Executes a multi-statement relational write inside a serialized `@libsql/client`
   * write transaction (using `tx.execute`, `tx.commit()`, `tx.rollback()`).
   */
  runConcurrentWrite(fn: (exec: (sql: string, args?: Array<string | number | null>) => Promise<void>) => Promise<void>): Promise<void> {
    const task = this.writeQueue.then(async () => {
      if (!this.initialized) {
        await this.init();
      }
      const tx = await this.client.transaction('write');
      try {
        await fn(async (sql, args) => {
          await tx.execute(args ? { sql, args } : sql);
        });
        await tx.commit();
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    });
    this.writeQueue = task.catch(() => {});
    return task;
  }
}
