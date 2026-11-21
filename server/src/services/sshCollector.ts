import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type {
  CommandResult,
  ConnectionTestResult,
  DiskMetric,
  NetworkInterfaceMetric,
  ProcessMetric,
  ServiceStatus,
  SshServerConfig,
  SshServerMetrics,
  TelemetryPoint,
  ThermalSensor,
} from '../../../shared/types.js';

interface CpuSample {
  idle: number;
  total: number;
}

interface NetSample {
  timestamp: number;
  interfaces: Record<string, { rx: number; tx: number }>;
}

interface ConnectionSlot {
  client: Client;
  ready: boolean;
  connecting: Promise<void> | null;
  fingerprint: string;
}

const TELEMETRY_SCRIPT = `
OS_TYPE=$(uname -s 2>/dev/null || echo "Linux")
echo "===OSTYPE==="
echo "$OS_TYPE"
if [ "$OS_TYPE" = "Darwin" ]; then
  echo "===META==="
  hostname 2>/dev/null || echo "unknown"
  uname -r 2>/dev/null || echo "unknown"
  uname -m 2>/dev/null || echo "unknown"
  (ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig 2>/dev/null | awk '/inet / && $2!="127.0.0.1"{print $2; exit}') || echo ""
  echo "$(sw_vers -productName 2>/dev/null || echo macOS) $(sw_vers -productVersion 2>/dev/null || uname -r)"
  echo "===MACHINE_ID==="
  ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4; exit}' || echo ""
  echo "===ALL_IPS==="
  ifconfig 2>/dev/null | awk '/inet / && $2!="127.0.0.1"{print $2}' || true
  echo "===UPTIME==="
  NOW_S=$(date +%s 2>/dev/null || echo 0)
  BOOT_S=$(sysctl -n kern.boottime 2>/dev/null | sed -E 's/.*sec = ([0-9]+).*/\\1/' || echo 0)
  if [ "$NOW_S" -gt 0 ] && [ "$BOOT_S" -gt 0 ] 2>/dev/null; then
    echo $((NOW_S - BOOT_S))
  else
    echo "0"
  fi
  echo "===LOAD==="
  sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || echo "0 0 0"
  echo "===CPUINFO==="
  sysctl -n hw.ncpu 2>/dev/null || echo "1"
  sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon / macOS CPU"
  echo "===MAC_CPU==="
  top -l 1 -n 0 -s 0 2>/dev/null | grep -m1 "CPU usage:" || echo ""
  echo "===MAC_CPU_FALLBACK==="
  ps -A -o %cpu 2>/dev/null | awk 'NR>1 {s+=$1} END {printf "%.2f\\n", s+0}' || echo "0"
  echo "===MAC_MEM==="
  echo "MEMSIZE $(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  echo "SWAP $(sysctl -n vm.swapusage 2>/dev/null || echo '')"
  vm_stat 2>/dev/null || echo ""
  echo "===DISK_UNIT==="
  echo "1024"
  echo "===DISKS==="
  df -k -P 2>/dev/null | tail -n +2 || true
  echo "===MAC_NET==="
  netstat -ibn 2>/dev/null | awk '$3 ~ /^<Link#/ {print $1, $7, $10}' || true
  echo "===THERMAL==="
  if command -v osx-cpu-temp >/dev/null 2>&1; then
    echo "CPU|$(osx-cpu-temp 2>/dev/null | tr -dc '0-9.')"
  fi
  echo "===PROCS==="
  ps -axo pid,user,%cpu,%mem,comm -r 2>/dev/null | head -n 11 | tail -n +2 || true
  echo "===SERVICES==="
  if command -v brew >/dev/null 2>&1; then
    brew services list 2>/dev/null | tail -n +2 | head -n 12 | awk '{print "brew|" $1 "|" $2}' || true
  fi
else
  echo "===META==="
  hostname 2>/dev/null || echo "unknown"
  uname -r 2>/dev/null || echo "unknown"
  uname -m 2>/dev/null || echo "unknown"
  (hostname -I 2>/dev/null | awk '{print $1}') || echo ""
  grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"' || uname -s
  echo "===MACHINE_ID==="
  (cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "") | head -n 1
  echo "===ALL_IPS==="
  hostname -I 2>/dev/null || true
  echo "===UPTIME==="
  cat /proc/uptime 2>/dev/null || echo "0 0"
  echo "===LOAD==="
  cat /proc/loadavg 2>/dev/null || echo "0 0 0"
  echo "===CPUINFO==="
  nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1"
  grep -m1 '^model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ //' || echo "Generic CPU"
  echo "===CPUSTAT==="
  head -n 1 /proc/stat 2>/dev/null || echo ""
  echo "===MEM==="
  cat /proc/meminfo 2>/dev/null || echo ""
  echo "===DISK_UNIT==="
  if df -B1 -P / >/dev/null 2>&1; then echo "1"; else echo "1024"; fi
  echo "===DISKS==="
  df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null | tail -n +2 || df -k -P 2>/dev/null | tail -n +2
  echo "===NET==="
  cat /proc/net/dev 2>/dev/null | tail -n +3 || echo ""
  echo "===THERMAL==="
  for z in /sys/class/thermal/thermal_zone*; do
    if [ -r "$z/temp" ]; then
      t=$(cat "$z/type" 2>/dev/null || basename "$z")
      v=$(cat "$z/temp" 2>/dev/null || echo "")
      echo "$t|$v"
    fi
  done
  echo "===PROCS==="
  ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 11 | tail -n +2 || true
  echo "===SERVICES==="
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --type=service --state=running,failed --no-pager --no-legend 2>/dev/null | head -n 14 || true
  fi
  echo "===TAILSCALE==="
  if command -v tailscale >/dev/null 2>&1; then
    echo "installed=1"
    echo "ip=$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    TS_STATUS=$(tailscale status --json 2>/dev/null || true)
    if printf '%s' "$TS_STATUS" | grep -Eq '"BackendState"[[:space:]]*:[[:space:]]*"Running"'; then
      echo "running=1"
    else
      echo "running=0"
    fi
    if tailscale debug prefs 2>/dev/null | grep -Eq '"RunSSH"[[:space:]]*:[[:space:]]*true'; then
      echo "ssh=1"
    elif printf '%s' "$TS_STATUS" | grep -Eq '"sshHostKeys"[[:space:]]*:[[:space:]]*\[[[:space:]]*"'; then
      echo "ssh=1"
    else
      echo "ssh=0"
    fi
  else
    echo "installed=0"
  fi
fi
`;

function configFingerprint(cfg: SshServerConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}:${cfg.authMethod}:${cfg.password ?? ''}:${cfg.privateKey ?? ''}`;
}

function getCandidateUsernames(cfg: SshServerConfig): string[] {
  const explicit = (cfg.username || '').trim();
  if (explicit) return [explicit];
  // On Linux/Proxmox servers, root is the most common Tailscale SSH user; try root first, then local user
  const list: string[] = ['root'];
  try {
    const localUser = os.userInfo().username;
    if (localUser && !list.includes(localUser)) list.push(localUser);
  } catch {
    // ignore
  }
  return list;
}

function loadDefaultLocalPrivateKey(): Buffer | undefined {
  const sshDir = path.join(os.homedir(), '.ssh');
  for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
    const full = path.join(sshDir, name);
    try {
      if (fs.existsSync(full)) {
        const content = fs.readFileSync(full);
        // Skip encrypted keys when auto-loading without passphrase
        if (!content.toString('utf8').includes('ENCRYPTED')) return content;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function buildConnectConfig(cfg: SshServerConfig, usernameOverride?: string): ConnectConfig {
  const username = (usernameOverride ?? cfg.username ?? '').trim() || 'root';
  const base: ConnectConfig = {
    host: cfg.host,
    port: cfg.port || 22,
    username,
    readyTimeout: cfg.authMethod === 'tailscale' ? 12000 : 10000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
  };
  if (cfg.authMethod === 'tailscale') {
    const methods: Array<'none' | 'agent' | 'publickey'> = ['none'];
    const agentSock = process.env.SSH_AUTH_SOCK;
    if (agentSock) {
      base.agent = agentSock;
      methods.push('agent');
    }
    const localKey = loadDefaultLocalPrivateKey();
    if (localKey) {
      base.privateKey = localKey;
      methods.push('publickey');
    }
    base.authHandler = methods;
  } else if (cfg.authMethod === 'privateKey' && cfg.privateKey) {
    base.privateKey = cfg.privateKey;
    if (cfg.passphrase) base.passphrase = cfg.passphrase;
  } else if (cfg.password) {
    base.password = cfg.password;
    // Required for macOS OpenSSH & PAM servers that use keyboard-interactive for password auth
    base.tryKeyboard = true;
  }
  return base;
}

function formatSshError(cfg: SshServerConfig, err: unknown, remoteIdent = '', checkUrl = ''): string {
  if (checkUrl) {
    return `Tailscale SSH check required — approve at ${checkUrl} and retry.`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (cfg.authMethod === 'tailscale') {
    if (remoteIdent && !/tailscale/i.test(remoteIdent)) {
      return `${cfg.host} is running ${remoteIdent} (Tailscale SSH is not enabled on this host). Switch auth to Password or SSH Key (macOS does not support Tailscale SSH server), or run "tailscale set --ssh" on Linux.`;
    }
    if (/authentication|timed out/i.test(raw)) {
      return `Tailscale SSH auth failed (${raw}). Ensure "tailscale set --ssh" is enabled on ${cfg.host} and your Tailnet SSH ACL allows this user.`;
    }
  }
  return raw;
}

export class SshCollector {
  private pool = new Map<string, ConnectionSlot>();
  private lastCpu = new Map<string, CpuSample>();
  private lastNet = new Map<string, NetSample>();
  private history = new Map<string, TelemetryPoint[]>();

  disconnect(serverId: string): void {
    const slot = this.pool.get(serverId);
    if (slot) {
      try {
        slot.client.end();
      } catch {
        // ignore
      }
      this.pool.delete(serverId);
    }
  }

  disconnectAll(): void {
    for (const id of this.pool.keys()) {
      this.disconnect(id);
    }
  }

  private connectOnce(cfg: SshServerConfig, username: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      let remoteIdent = '';
      let checkUrl = '';

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) {
          try {
            client.end();
          } catch {
            // ignore
          }
          const enriched = new Error(formatSshError(cfg, err, remoteIdent, checkUrl));
          (enriched as any).remoteIdent = remoteIdent;
          (enriched as any).checkUrl = checkUrl;
          (enriched as any).rawMessage = err.message;
          reject(enriched);
        } else {
          resolve(client);
        }
      };

      client.on('banner', (msg: string) => {
        const m = msg.match(/https:\/\/login\.tailscale\.com\/a\/[^\s]+/i);
        if (m) checkUrl = m[0];
      });

      // Handle macOS OpenSSH & PAM keyboard-interactive password prompts cleanly
      if (cfg.authMethod === 'password' && cfg.password) {
        client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
          finish(prompts.map(() => cfg.password || ''));
        });
      }

      client.once('ready', () => done());
      client.once('error', (err) => done(err));
      try {
        const connectCfg = buildConnectConfig(cfg, username);
        connectCfg.debug = (line: string) => {
          const m = line.match(/Remote ident:\s*'([^']+)'/);
          if (m) remoteIdent = m[1];
        };
        client.connect(connectCfg);
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async connectWithFallbacks(cfg: SshServerConfig): Promise<{ client: Client; username: string }> {
    const candidates = getCandidateUsernames(cfg);
    let lastErr: unknown;
    for (const user of candidates) {
      try {
        const client = await this.connectOnce(cfg, user);
        return { client, username: user };
      } catch (err: any) {
        lastErr = err;
        // If the remote server is OpenSSH (not Tailscale SSH) or returned a Tailscale check URL, stop retrying
        if (err?.checkUrl) throw err;
        if (cfg.authMethod === 'tailscale' && err?.remoteIdent && !/tailscale/i.test(err.remoteIdent)) {
          throw err;
        }
        const rawMsg = String(err?.rawMessage || err?.message || '');
        if (cfg.authMethod !== 'tailscale' || !/authentication|timed out/i.test(rawMsg)) {
          throw err;
        }
      }
    }
    throw lastErr ?? new Error('SSH connection failed');
  }

  private async ensureClient(cfg: SshServerConfig): Promise<Client> {
    const fp = configFingerprint(cfg);
    const existing = this.pool.get(cfg.id);
    if (existing && existing.fingerprint === fp) {
      if (existing.ready) return existing.client;
      if (existing.connecting) {
        await existing.connecting;
        const refreshed = this.pool.get(cfg.id);
        if (refreshed && refreshed.ready) return refreshed.client;
      }
    } else if (existing) {
      this.disconnect(cfg.id);
    }

    const slot: ConnectionSlot = {
      client: new Client(),
      ready: false,
      connecting: null,
      fingerprint: fp,
    };

    const connectPromise = (async () => {
      try {
        const { client } = await this.connectWithFallbacks(cfg);
        slot.client = client;
        slot.ready = true;
        slot.connecting = null;
        client.on('close', () => {
          slot.ready = false;
          if (this.pool.get(cfg.id)?.client === client) {
            this.pool.delete(cfg.id);
          }
        });
        client.on('end', () => {
          slot.ready = false;
        });
      } catch (err) {
        slot.ready = false;
        slot.connecting = null;
        this.pool.delete(cfg.id);
        throw err instanceof Error ? err : new Error(String(err));
      }
    })();

    slot.connecting = connectPromise;
    this.pool.set(cfg.id, slot);
    await connectPromise;
    return slot.client;
  }

  private execOnClient(client: Client, command: string, timeoutMs = 10000): Promise<CommandResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        const MAX_BYTES = 128 * 1024;

        stream.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_BYTES) stdout += chunk.toString('utf8');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_BYTES) stderr += chunk.toString('utf8');
        });
        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode: code,
            durationMs: Date.now() - started,
          });
        });
      });
    });
  }

  async testConnection(cfg: SshServerConfig): Promise<ConnectionTestResult> {
    let client: Client | null = null;
    try {
      const connected = await this.connectWithFallbacks(cfg);
      client = connected.client;
      const res = await this.execOnClient(
        client,
        'hostname && uname -srm && if [ "$(uname -s)" = "Darwin" ]; then echo "$(sw_vers -productName 2>/dev/null || echo macOS) $(sw_vers -productVersion 2>/dev/null || uname -r)"; else grep -m1 ^PRETTY_NAME= /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'"\' || uname -s; fi',
        8000,
      );
      const lines = res.stdout.trim().split('\n').map((l) => l.trim());
      return {
        ok: true,
        message: `Connected to ${lines[0] || cfg.host} as ${connected.username} (${lines[2] || 'OK'})`,
        details: {
          hostname: lines[0] || cfg.host,
          username: connected.username,
          kernel: lines[1] || 'unknown',
          os: lines[2] || 'Linux',
          latencyMs: res.durationMs,
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (client) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
    }
  }

  async runCommand(cfg: SshServerConfig, command: string, timeoutMs = 15000): Promise<CommandResult> {
    const client = await this.ensureClient(cfg);
    return this.execOnClient(client, command, timeoutMs);
  }

  async openShell(cfg: SshServerConfig, cols = 100, rows = 30): Promise<ClientChannel> {
    const client = await this.ensureClient(cfg);
    return new Promise((resolve, reject) => {
      client.shell(
        {
          term: 'xterm-256color',
          cols: Math.max(40, Math.min(300, cols)),
          rows: Math.max(10, Math.min(120, rows)),
        },
        (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(stream);
        },
      );
    });
  }

  async collect(cfg: SshServerConfig): Promise<SshServerMetrics> {
    const now = Date.now();
    const existingHistory = this.history.get(cfg.id) ?? [];

    try {
      const client = await this.ensureClient(cfg);
      const result = await this.execOnClient(client, TELEMETRY_SCRIPT, 10000);
      const sections = parseSections(result.stdout);
      const isDarwin = (sections.OSTYPE ?? '').trim() === 'Darwin';

      const meta = (sections.META ?? '').split('\n').map((l) => l.trim());
      const hostname = meta[0] || cfg.name;
      const kernel = meta[1] || 'unknown';
      const arch = meta[2] || 'unknown';
      const ipAddress = meta[3] || cfg.host;
      const osPrettyName = meta[4] || (isDarwin ? 'macOS' : 'Linux');
      const machineId = (sections.MACHINE_ID ?? '').trim().split(/\s+/)[0] || undefined;
      const rawIps = (sections.ALL_IPS ?? '')
        .split(/[\s\n]+/)
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && s !== '127.0.0.1' && s !== '::1');
      const allIps = Array.from(new Set([ipAddress, ...rawIps].filter(Boolean)));

      const uptimeSeconds = parseFloat((sections.UPTIME ?? '0').trim().split(/\s+/)[0]) || 0;
      const loadParts = (sections.LOAD ?? '0 0 0').trim().split(/\s+/);
      const loadAvg: [number, number, number] = [
        parseFloat(loadParts[0]) || 0,
        parseFloat(loadParts[1]) || 0,
        parseFloat(loadParts[2]) || 0,
      ];

      const cpuLines = (sections.CPUINFO ?? '').split('\n').map((l) => l.trim());
      const cpuCores = Math.max(1, parseInt(cpuLines[0] || '1', 10) || 1);
      const cpuModel = cpuLines[1] || 'CPU';

      const cpuPercent = isDarwin
        ? parseDarwinCpu(sections.MAC_CPU ?? '', sections.MAC_CPU_FALLBACK ?? '', cpuCores)
        : this.computeCpuPercent(cfg.id, sections.CPUSTAT ?? '');
      const mem = isDarwin ? parseDarwinMemInfo(sections.MAC_MEM ?? '') : parseMemInfo(sections.MEM ?? '');
      const diskUnit = parseInt((sections.DISK_UNIT ?? '1').trim(), 10) || 1;
      const disks = parseDisks(sections.DISKS ?? '', diskUnit, isDarwin);
      const { interfaces: network, totalRxBps, totalTxBps } = this.computeNetwork(
        cfg.id,
        now,
        isDarwin ? sections.MAC_NET ?? '' : sections.NET ?? '',
        isDarwin,
      );
      const temperatures = parseThermal(sections.THERMAL ?? '');
      const maxTempC = temperatures.length > 0 ? Math.max(...temperatures.map((t) => t.tempC)) : null;
      const topProcesses = parseProcesses(sections.PROCS ?? '', isDarwin);
      const services = parseServices(sections.SERVICES ?? '');
      const tailscale = isDarwin ? undefined : parseTailscaleStatus(sections.TAILSCALE ?? '');

      const point: TelemetryPoint = {
        timestamp: now,
        cpuPercent,
        memPercent: mem.memPercent,
        netRxBps: totalRxBps,
        netTxBps: totalTxBps,
      };
      const nextHistory = [...existingHistory.slice(-49), point];
      this.history.set(cfg.id, nextHistory);

      return {
        serverId: cfg.id,
        status: 'online',
        collectedAt: now,
        hostname,
        osPrettyName,
        kernel,
        arch,
        ipAddress,
        allIps,
        machineId,
        uptimeSeconds,
        cpuModel,
        cpuCores,
        cpuPercent,
        loadAvg,
        memTotalBytes: mem.memTotalBytes,
        memUsedBytes: mem.memUsedBytes,
        memAvailableBytes: mem.memAvailableBytes,
        memPercent: mem.memPercent,
        swapTotalBytes: mem.swapTotalBytes,
        swapUsedBytes: mem.swapUsedBytes,
        swapPercent: mem.swapPercent,
        disks,
        network,
        netTotalRxBps: totalRxBps,
        netTotalTxBps: totalTxBps,
        temperatures,
        maxTempC,
        topProcesses,
        services,
        history: nextHistory,
        tailscale,
      };
    } catch (err) {
      return {
        serverId: cfg.id,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
        hostname: cfg.name,
        osPrettyName: 'Unavailable',
        kernel: '-',
        arch: '-',
        ipAddress: cfg.host,
        uptimeSeconds: 0,
        cpuModel: '-',
        cpuCores: 0,
        cpuPercent: 0,
        loadAvg: [0, 0, 0],
        memTotalBytes: 0,
        memUsedBytes: 0,
        memAvailableBytes: 0,
        memPercent: 0,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapPercent: 0,
        disks: [],
        network: [],
        netTotalRxBps: 0,
        netTotalTxBps: 0,
        temperatures: [],
        maxTempC: null,
        topProcesses: [],
        services: [],
        history: existingHistory,
      };
    }
  }

  private computeCpuPercent(serverId: string, statLine: string): number {
    const parts = statLine.trim().split(/\s+/);
    if (parts[0] !== 'cpu' || parts.length < 5) return 0;
    const nums = parts.slice(1).map((n) => parseInt(n, 10) || 0);
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
    const total = nums.reduce((acc, v) => acc + v, 0);
    const prev = this.lastCpu.get(serverId);
    this.lastCpu.set(serverId, { idle, total });
    if (!prev) return 0;
    const totalDelta = total - prev.total;
    const idleDelta = idle - prev.idle;
    if (totalDelta <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10));
  }

  private computeNetwork(
    serverId: string,
    now: number,
    raw: string,
    isDarwin = false,
  ): { interfaces: NetworkInterfaceMetric[]; totalRxBps: number; totalTxBps: number } {
    const current: Record<string, { rx: number; tx: number }> = {};
    if (isDarwin) {
      for (const line of raw.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 3) continue;
        const iface = cols[0].replace(/\*$/, '');
        if (!iface || isIgnoredInterface(iface)) continue;
        const rx = parseInt(cols[1], 10) || 0;
        const tx = parseInt(cols[2], 10) || 0;
        // On macOS, skip idle virtual utun tunnels with negligible traffic (< 100 KB)
        if (/^utun\d+$/i.test(iface) && rx + tx < 100 * 1024) continue;
        current[iface] = { rx, tx };
      }
    } else {
      for (const line of raw.split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const iface = line.slice(0, idx).trim();
        if (!iface || isIgnoredInterface(iface)) continue;
        const cols = line.slice(idx + 1).trim().split(/\s+/);
        if (cols.length < 9) continue;
        current[iface] = {
          rx: parseInt(cols[0], 10) || 0,
          tx: parseInt(cols[8], 10) || 0,
        };
      }
    }

    const prev = this.lastNet.get(serverId);
    this.lastNet.set(serverId, { timestamp: now, interfaces: current });
    const dtSec = prev ? Math.max(0.5, (now - prev.timestamp) / 1000) : 0;

    const allInterfaces: NetworkInterfaceMetric[] = [];
    for (const [iface, vals] of Object.entries(current)) {
      let rxBps = 0;
      let txBps = 0;
      if (prev && prev.interfaces[iface] && dtSec > 0) {
        rxBps = Math.max(0, Math.round((vals.rx - prev.interfaces[iface].rx) / dtSec));
        txBps = Math.max(0, Math.round((vals.tx - prev.interfaces[iface].tx) / dtSec));
      }
      allInterfaces.push({
        iface,
        rxBytesPerSec: rxBps,
        txBytesPerSec: txBps,
        rxTotalBytes: vals.rx,
        txTotalBytes: vals.tx,
      });
    }

    // Hide completely unused/unplugged NICs (0 total bytes ever transferred) unless none have traffic
    const nonZero = allInterfaces.filter(
      (n) => n.rxTotalBytes > 0 || n.txTotalBytes > 0 || n.rxBytesPerSec > 0 || n.txBytesPerSec > 0,
    );
    const relevant = (nonZero.length > 0 ? nonZero : allInterfaces).sort((a, b) => {
      const rateDiff = b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec);
      if (rateDiff !== 0) return rateDiff;
      return b.rxTotalBytes + b.txTotalBytes - (a.rxTotalBytes + a.txTotalBytes);
    });

    // Avoid double-counting bonds/vmbr bridges on top of physical NICs when computing host totals
    const physical = relevant.filter((n) => isPhysicalInterface(n.iface));
    const totalBasis = physical.length > 0 ? physical : relevant;
    let totalRxBps = 0;
    let totalTxBps = 0;
    for (const n of totalBasis) {
      totalRxBps += n.rxBytesPerSec;
      totalTxBps += n.txBytesPerSec;
    }

    return { interfaces: relevant.slice(0, 12), totalRxBps, totalTxBps };
  }
}

function isIgnoredInterface(iface: string): boolean {
  if (iface === 'lo' || iface === 'lo0') return true;
  return /^(veth|br-|docker|virbr|fwbr|fwpr|fwln|tap\d|vnet|vnic|cali|flannel|cni|kube|cilium|lxc|lxdbr|dummy|sit\d|gre|ip6tnl|tunl|erspan|ifb|ovs-system|genev|gif\d|stf\d|anpi\d|awdl\d|llw\d|nan\d|ap\d|xhc\d|iptap|pktap)/i.test(
    iface,
  );
}

function isPhysicalInterface(iface: string): boolean {
  return /^(en\d+|eno|enp|ens|enx|eth|em\d|p\d+p|wlan|wlp|ib\d)/i.test(iface);
}

function parseDarwinCpu(topLine: string, fallbackSum: string, cores: number): number {
  const idleMatch = topLine.match(/([\d.]+)%\s*idle/i);
  if (idleMatch) {
    const idle = parseFloat(idleMatch[1]);
    if (!Number.isNaN(idle)) {
      return Math.max(0, Math.min(100, Math.round((100 - idle) * 10) / 10));
    }
  }
  const userMatch = topLine.match(/([\d.]+)%\s*user/i);
  const sysMatch = topLine.match(/([\d.]+)%\s*sys/i);
  if (userMatch || sysMatch) {
    const total = (userMatch ? parseFloat(userMatch[1]) : 0) + (sysMatch ? parseFloat(sysMatch[1]) : 0);
    return Math.max(0, Math.min(100, Math.round(total * 10) / 10));
  }
  const sum = parseFloat(fallbackSum.trim()) || 0;
  return Math.max(0, Math.min(100, Math.round((sum / Math.max(1, cores)) * 10) / 10));
}

function parseSizeUnitToBytes(valStr: string): number {
  const m = valStr.match(/([\d.]+)\s*([KMGTP])?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const unit = (m[2] || '').toUpperCase();
  const mult: Record<string, number> = {
    '': 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };
  return Math.round(num * (mult[unit] ?? 1));
}

function parseDarwinMemInfo(raw: string) {
  let memTotalBytes = 0;
  let pageSize = 4096;
  let swapTotalBytes = 0;
  let swapUsedBytes = 0;
  const pages: Record<string, number> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('MEMSIZE ')) {
      memTotalBytes = parseInt(trimmed.slice(8).trim(), 10) || 0;
      continue;
    }
    if (trimmed.startsWith('SWAP ')) {
      const totalM = trimmed.match(/total\s*=\s*([\d.]+\s*[KMGTP]?)/i);
      const usedM = trimmed.match(/used\s*=\s*([\d.]+\s*[KMGTP]?)/i);
      if (totalM) swapTotalBytes = parseSizeUnitToBytes(totalM[1]);
      if (usedM) swapUsedBytes = parseSizeUnitToBytes(usedM[1]);
      continue;
    }
    const psMatch = trimmed.match(/page size of (\d+) bytes/i);
    if (psMatch) {
      pageSize = parseInt(psMatch[1], 10) || 4096;
      continue;
    }
    const kv = trimmed.match(/^([^:]+):\s+(\d+)\.?$/);
    if (kv) {
      pages[kv[1].trim().toLowerCase()] = parseInt(kv[2], 10) || 0;
    }
  }

  const wired = pages['pages wired down'] ?? 0;
  const compressed = pages['pages occupied by compressor'] ?? 0;
  const anon = pages['anonymous pages'] ?? 0;
  const purgeable = pages['pages purgeable'] ?? 0;
  const active = pages['pages active'] ?? 0;

  // Match macOS Activity Monitor (App Memory + Wired + Compressed), falling back to Active + Wired + Compressed
  const usedPages = anon > 0 ? Math.max(0, anon - purgeable) + wired + compressed : active + wired + compressed;
  const memUsedBytes = Math.min(memTotalBytes, usedPages * pageSize);
  const memAvailableBytes = Math.max(0, memTotalBytes - memUsedBytes);
  const memPercent = memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 1000) / 10 : 0;
  const swapPercent = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 1000) / 10 : 0;

  return {
    memTotalBytes,
    memUsedBytes,
    memAvailableBytes,
    memPercent,
    swapTotalBytes,
    swapUsedBytes,
    swapPercent,
  };
}

function parseSections(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  let current = '';
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^===([A-Z_]+)===$/);
    if (match) {
      current = match[1];
      result[current] = '';
    } else if (current) {
      result[current] += (result[current] ? '\n' : '') + line;
    }
  }
  return result;
}

function parseMemInfo(raw: string) {
  const map: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)/);
    if (m) map[m[1]] = parseInt(m[2], 10) * 1024;
  }
  const memTotalBytes = map.MemTotal ?? 0;
  const memAvailableBytes =
    map.MemAvailable ?? (map.MemFree ?? 0) + (map.Buffers ?? 0) + (map.Cached ?? 0);
  const memUsedBytes = Math.max(0, memTotalBytes - memAvailableBytes);
  const memPercent = memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 1000) / 10 : 0;

  const swapTotalBytes = map.SwapTotal ?? 0;
  const swapUsedBytes = Math.max(0, swapTotalBytes - (map.SwapFree ?? 0));
  const swapPercent = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 1000) / 10 : 0;

  return {
    memTotalBytes,
    memUsedBytes,
    memAvailableBytes,
    memPercent,
    swapTotalBytes,
    swapUsedBytes,
    swapPercent,
  };
}

function parseDisks(raw: string, unitBytes = 1, isDarwin = false): DiskMetric[] {
  const disks: DiskMetric[] = [];
  const seenMounts = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('map ') || trimmed.startsWith('devfs')) continue;
    // Match the 4 numeric columns + mountpoint cleanly even if filesystem has spaces
    const match = trimmed.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+%)\s+(.+)$/);
    if (!match) continue;
    const filesystem = match[1].trim();
    const totalBytes = (parseInt(match[2], 10) || 0) * unitBytes;
    const rawUsedBytes = (parseInt(match[3], 10) || 0) * unitBytes;
    const availBytes = (parseInt(match[4], 10) || 0) * unitBytes;
    const mount = match[6].trim();
    if (!mount || seenMounts.has(mount) || totalBytes < 10 * 1024 * 1024) continue;
    if (mount.startsWith('/snap') || mount.startsWith('/run') || mount.startsWith('/sys') || mount === '/dev') {
      continue;
    }
    if (isDarwin) {
      if (
        mount.startsWith('/System/Volumes/VM') ||
        mount.startsWith('/System/Volumes/Preboot') ||
        mount.startsWith('/System/Volumes/Update') ||
        mount.startsWith('/System/Volumes/xarts') ||
        mount.startsWith('/System/Volumes/iSCPreboot') ||
        mount.startsWith('/System/Volumes/Hardware') ||
        mount.startsWith('/private/var/folders') ||
        mount === '/Volumes/Recovery' ||
        mount.includes('/CoreDevice/DeviceFS') ||
        mount.endsWith('/home')
      ) {
        continue;
      }
    }
    seenMounts.add(mount);
    // On APFS /System/Volumes/Data, (total - avail) accurately reflects container usage
    const usedBytes =
      isDarwin && mount === '/System/Volumes/Data' ? Math.max(rawUsedBytes, totalBytes - availBytes) : rawUsedBytes;
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
    const displayMount = isDarwin && mount === '/System/Volumes/Data' ? '/ (Data)' : mount;
    disks.push({ filesystem, mount: displayMount, totalBytes, usedBytes, availBytes, usedPercent });
  }
  return disks.slice(0, 8);
}

function parseThermal(raw: string): ThermalSensor[] {
  const sensors: ThermalSensor[] = [];
  for (const line of raw.split('\n')) {
    const [label, valStr] = line.trim().split('|');
    if (!label || !valStr) continue;
    const rawNum = parseFloat(valStr);
    if (Number.isNaN(rawNum)) continue;
    const tempC = rawNum > 1000 ? Math.round((rawNum / 1000) * 10) / 10 : Math.round(rawNum * 10) / 10;
    if (tempC > -20 && tempC < 140) {
      sensors.push({ label, tempC });
    }
  }
  return sensors.slice(0, 8);
}

function parseProcesses(raw: string, isDarwin = false): ProcessMetric[] {
  const procs: ProcessMetric[] = [];
  for (const line of raw.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const pid = parseInt(cols[0], 10);
    if (Number.isNaN(pid)) continue;
    let command = cols.slice(4).join(' ');
    if (isDarwin && command.includes('/')) {
      command = command.split('/').pop() || command;
    }
    procs.push({
      pid,
      user: cols[1],
      cpuPercent: parseFloat(cols[2]) || 0,
      memPercent: parseFloat(cols[3]) || 0,
      command,
    });
  }
  return procs.slice(0, 10);
}

function parseServices(raw: string): ServiceStatus[] {
  const services: ServiceStatus[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('brew|')) {
      const [, name, status] = trimmed.split('|');
      if (!name) continue;
      const state: ServiceStatus['state'] =
        status === 'started'
          ? 'active'
          : status === 'error'
            ? 'failed'
            : status === 'stopped' || status === 'none'
              ? 'inactive'
              : 'unknown';
      services.push({ name, state, subState: status || 'unknown' });
      continue;
    }
    const clean = trimmed.replace(/^[●*]\s*/, '').trim();
    const cols = clean.split(/\s+/);
    if (cols.length < 4) continue;
    const name = cols[0].replace(/\.service$/, '');
    const active = cols[2];
    const subState = cols[3];
    const state: ServiceStatus['state'] =
      active === 'active'
        ? 'active'
        : active === 'failed'
          ? 'failed'
          : active === 'inactive'
            ? 'inactive'
            : 'unknown';
    services.push({ name, state, subState });
  }
  return services;
}

function parseTailscaleStatus(raw: string): SshServerMetrics['tailscale'] {
  if (!raw.trim()) return undefined;
  const map: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (!('installed' in map)) return undefined;
  return {
    installed: map.installed === '1',
    running: map.running === '1',
    sshEnabled: map.ssh === '1',
    ip: map.ip || '',
  };
}
