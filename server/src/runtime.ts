import { Service, type OnInit, type OnDestroy } from '@tsed/di';
import type express from 'express';
import type { AuthUserPublic } from '../../shared/types.js';
import { TursoDatabase } from './db/tursoDb.js';
import { ConfigStore } from './store/configStore.js';
import { SshCollector } from './services/sshCollector.js';
import { ProxmoxClient } from './services/proxmoxClient.js';
import { TailscaleClient } from './services/tailscaleClient.js';
import { OpnsenseClient } from './services/opnsenseClient.js';
import { HikvisionClient } from './services/hikvisionClient.js';
import { UnifiClient } from './services/unifiClient.js';
import { TopologyService } from './services/topologyService.js';
import { TelemetryManager } from './services/telemetryManager.js';

export interface AuthenticatedRequest extends express.Request {
  auth?: {
    token: string;
    user: AuthUserPublic;
    pinLocked: boolean;
  };
}

export function extractBearerToken(req: {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}): string {
  const hdr = req.headers?.authorization;
  const raw = Array.isArray(hdr) ? hdr[0] : hdr || '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const qToken = req.query && typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return qToken;
}

@Service()
export class RackPanelRuntime implements OnInit, OnDestroy {
  readonly db = new TursoDatabase();
  readonly store = new ConfigStore(this.db);
  readonly ssh = new SshCollector();
  readonly proxmox = new ProxmoxClient();
  readonly tailscale = new TailscaleClient();
  readonly opnsense = new OpnsenseClient();
  readonly hikvision = new HikvisionClient();
  readonly unifi = new UnifiClient();
  readonly topology = new TopologyService(this.store, this.db);
  readonly telemetry = new TelemetryManager(
    this.store,
    this.ssh,
    this.proxmox,
    this.tailscale,
    this.opnsense,
    this.hikvision,
    this.unifi,
  );

  async $onInit(): Promise<void> {
    await this.store.init();
    await this.topology.init();
    console.log(
      `[rack-panel] Turso/SQLite + Drizzle ORM initialized (${this.db.isRemote ? 'remote libsql' : this.db.dbPath})`,
    );
    this.telemetry.start();
    this.topology.startBackgroundHealthChecks();
  }

  $onDestroy(): void {
    this.telemetry.stop();
    this.topology.stopBackgroundHealthChecks();
    this.ssh.disconnectAll();
  }
}
