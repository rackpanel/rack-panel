import type {
  CommandResult,
  DockerContainerAction,
  DockerContainerInfo,
  DockerHostSnapshot,
  DockerImageInfo,
  DockerNetworkInfo,
  DockerVolumeInfo,
  SshServerConfig,
} from '../../../shared/types.js';
import type { ConfigStore } from '../store/configStore.js';
import type { SshCollector } from './sshCollector.js';

const VALID_CONTAINER_ID = /^[a-zA-Z0-9_.:-]+$/;

function shellQuote(val: string): string {
  return `'${val.replace(/'/g, `'\\''`)}'`;
}

function parseJsonLines(block: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed JSON line
    }
  }
  return out;
}

function splitSections(stdout: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current = '';
  const buf: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^===([A-Z_]+)===$/);
    if (m) {
      if (current) sections[current] = buf.join('\n');
      current = m[1];
      buf.length = 0;
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections[current] = buf.join('\n');
  return sections;
}

function parseLabels(rawLabels: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  const str = String(rawLabels || '');
  if (!str) return map;
  for (const part of str.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      map[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  }
  return map;
}

const DOCKER_INSPECT_SCRIPT = [
  'if ! command -v docker >/dev/null 2>&1; then echo "===NO_DOCKER==="; exit 0; fi',
  'if ! docker info >/dev/null 2>&1; then echo "===DOCKER_ERR==="; docker info 2>&1 | head -n 5; exit 0; fi',
  'echo "===VERSION==="',
  'docker version --format "{{.Server.Version}}" 2>/dev/null || true',
  'echo "===PS==="',
  'docker ps -a --no-trunc --format "{{json .}}" 2>/dev/null || true',
  'echo "===STATS==="',
  'timeout 5 docker stats --no-stream --format "{{json .}}" 2>/dev/null || docker stats --no-stream --format "{{json .}}" 2>/dev/null || true',
  'echo "===IMAGES==="',
  'docker images --format "{{json .}}" 2>/dev/null || true',
  'echo "===VOLUMES==="',
  'docker volume ls --format "{{json .}}" 2>/dev/null || true',
  'echo "===NETWORKS==="',
  'docker network ls --format "{{json .}}" 2>/dev/null || true',
].join('\n');

function buildDemoDockerHost(server: SshServerConfig): DockerHostSnapshot {
  const now = Date.now();
  return {
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    status: 'online',
    dockerVersion: '27.3.1',
    isDemo: true,
    collectedAt: now,
    containers: [
      {
        id: 'a1b2c3d4e5f6',
        name: 'traefik',
        image: 'traefik:v3.2',
        state: 'running',
        status: 'Up 14 days (healthy)',
        ports: '0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp',
        createdAt: '2 weeks ago',
        composeProject: 'edge-proxy',
        composeService: 'traefik',
        cpuPercent: '1.42%',
        memUsage: '118MiB / 32GiB',
        memPercent: '0.36%',
        netIO: '4.8GB / 3.9GB',
        pids: '19',
      },
      {
        id: 'b2c3d4e5f6a1',
        name: 'portainer',
        image: 'portainer/portainer-ce:2.21.4',
        state: 'running',
        status: 'Up 14 days',
        ports: '0.0.0.0:9000->9000/tcp, 0.0.0.0:9443->9443/tcp',
        createdAt: '2 weeks ago',
        composeProject: 'mgmt',
        composeService: 'portainer',
        cpuPercent: '0.38%',
        memUsage: '64MiB / 32GiB',
        memPercent: '0.20%',
        netIO: '820MB / 410MB',
        pids: '12',
      },
      {
        id: 'c3d4e5f6a1b2',
        name: 'plex',
        image: 'lscr.io/linuxserver/plex:latest',
        state: 'running',
        status: 'Up 9 days (healthy)',
        ports: '0.0.0.0:32400->32400/tcp',
        createdAt: '3 weeks ago',
        composeProject: 'media',
        composeService: 'plex',
        cpuPercent: '6.85%',
        memUsage: '1.84GiB / 32GiB',
        memPercent: '5.75%',
        netIO: '42.1GB / 198GB',
        pids: '64',
      },
      {
        id: 'd4e5f6a1b2c3',
        name: 'frigate',
        image: 'ghcr.io/blakeblackshear/frigate:0.14.1',
        state: 'running',
        status: 'Up 5 days (healthy)',
        ports: '0.0.0.0:5000->5000/tcp, 0.0.0.0:8554->8554/tcp',
        createdAt: '1 month ago',
        composeProject: 'nvr-ai',
        composeService: 'frigate',
        cpuPercent: '11.20%',
        memUsage: '2.15GiB / 32GiB',
        memPercent: '6.72%',
        netIO: '91.4GB / 12.2GB',
        pids: '88',
      },
      {
        id: 'e5f6a1b2c3d4',
        name: 'uptime-kuma',
        image: 'louislam/uptime-kuma:1.23.15',
        state: 'running',
        status: 'Up 14 days (healthy)',
        ports: '0.0.0.0:3001->3001/tcp',
        createdAt: '2 months ago',
        composeProject: 'monitoring',
        composeService: 'uptime-kuma',
        cpuPercent: '0.65%',
        memUsage: '142MiB / 32GiB',
        memPercent: '0.43%',
        netIO: '1.2GB / 940MB',
        pids: '24',
      },
      {
        id: 'f6a1b2c3d4e5',
        name: 'backup-worker',
        image: 'restic/restic:0.17.1',
        state: 'exited',
        status: 'Exited (0) 6 hours ago',
        ports: '',
        createdAt: '3 weeks ago',
        composeProject: 'backup',
        composeService: 'restic',
        cpuPercent: '0.00%',
        memUsage: '0B / 0B',
        memPercent: '0.00%',
      },
    ],
    images: [
      { id: 'sha256:9f82a10c4b11', repository: 'traefik', tag: 'v3.2', size: '164MB', createdSince: '2 weeks ago' },
      { id: 'sha256:4c22e90b1a44', repository: 'lscr.io/linuxserver/plex', tag: 'latest', size: '512MB', createdSince: '3 weeks ago' },
      { id: 'sha256:7d19f22c8e33', repository: 'ghcr.io/blakeblackshear/frigate', tag: '0.14.1', size: '1.42GB', createdSince: '1 month ago' },
      { id: 'sha256:2b10a88f9c22', repository: 'louislam/uptime-kuma', tag: '1.23.15', size: '418MB', createdSince: '2 months ago' },
    ],
    volumes: [
      { name: 'plex_config', driver: 'local', mountpoint: '/var/lib/docker/volumes/plex_config/_data' },
      { name: 'frigate_media', driver: 'local', mountpoint: '/var/lib/docker/volumes/frigate_media/_data' },
      { name: 'portainer_data', driver: 'local', mountpoint: '/var/lib/docker/volumes/portainer_data/_data' },
    ],
    networks: [
      { id: '9911aa22bb33', name: 'bridge', driver: 'bridge', scope: 'local' },
      { id: '8822bb33cc44', name: 'proxy_net', driver: 'bridge', scope: 'local' },
      { id: '7733cc44dd55', name: 'host', driver: 'host', scope: 'local' },
    ],
  };
}

export class DockerService {
  constructor(
    private readonly store: ConfigStore,
    private readonly ssh: SshCollector,
  ) {}

  async listDockerHosts(serverId?: string): Promise<DockerHostSnapshot[]> {
    const servers = this.store.listServers().filter((s) => (serverId ? s.id === serverId : true));
    const results = await Promise.all(servers.map((srv) => this.pollDockerHost(srv)));
    // Put online hosts with Docker first, then no-docker/offline
    return results.sort((a, b) => {
      const rank = (s: DockerHostSnapshot) =>
        s.status === 'online' ? 0 : s.status === 'error' ? 1 : s.status === 'no-docker' ? 2 : 3;
      return rank(a) - rank(b) || a.serverName.localeCompare(b.serverName);
    });
  }

  private async pollDockerHost(server: SshServerConfig): Promise<DockerHostSnapshot> {
    const now = Date.now();
    if (server.id.startsWith('demo-')) {
      if (server.id === 'demo-2' || server.tags.some((t) => /docker/i.test(t))) {
        return buildDemoDockerHost(server);
      }
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        status: 'no-docker',
        isDemo: true,
        containers: [],
        images: [],
        volumes: [],
        networks: [],
        collectedAt: now,
      };
    }

    try {
      const res = await this.ssh.runCommand(server, DOCKER_INSPECT_SCRIPT, 14000);
      const out = res.stdout || '';
      if (out.includes('===NO_DOCKER===')) {
        return {
          serverId: server.id,
          serverName: server.name,
          host: server.host,
          status: 'no-docker',
          containers: [],
          images: [],
          volumes: [],
          networks: [],
          collectedAt: now,
        };
      }
      if (out.includes('===DOCKER_ERR===')) {
        const msg = out.split('===DOCKER_ERR===')[1]?.trim() || res.stderr || 'Docker daemon unreachable';
        return {
          serverId: server.id,
          serverName: server.name,
          host: server.host,
          status: 'error',
          errorMessage: msg,
          containers: [],
          images: [],
          volumes: [],
          networks: [],
          collectedAt: now,
        };
      }

      const sections = splitSections(out);
      const dockerVersion = (sections['VERSION'] || '').trim() || undefined;

      const statsByKey = new Map<string, Record<string, unknown>>();
      for (const row of parseJsonLines(sections['STATS'] || '')) {
        const id = String(row['ID'] || '').trim();
        const name = String(row['Name'] || '').trim();
        if (id) statsByKey.set(id.slice(0, 12), row);
        if (name) statsByKey.set(name, row);
      }

      const containers: DockerContainerInfo[] = parseJsonLines(sections['PS'] || '').map((row) => {
        const fullId = String(row['ID'] || '').trim();
        const shortId = fullId.slice(0, 12);
        const name = String(row['Names'] || shortId).replace(/^\//, '').trim();
        const labels = parseLabels(row['Labels']);
        const stat = statsByKey.get(shortId) || statsByKey.get(name);
        return {
          id: shortId || name,
          name,
          image: String(row['Image'] || ''),
          state: String(row['State'] || 'unknown').toLowerCase(),
          status: String(row['Status'] || ''),
          ports: String(row['Ports'] || ''),
          createdAt: String(row['RunningFor'] || row['CreatedAt'] || ''),
          composeProject: labels['com.docker.compose.project'] || undefined,
          composeService: labels['com.docker.compose.service'] || undefined,
          cpuPercent: stat ? String(stat['CPUPerc'] || '') : undefined,
          memUsage: stat ? String(stat['MemUsage'] || '') : undefined,
          memPercent: stat ? String(stat['MemPerc'] || '') : undefined,
          netIO: stat ? String(stat['NetIO'] || '') : undefined,
          pids: stat ? String(stat['PIDs'] || '') : undefined,
        };
      });

      const images: DockerImageInfo[] = parseJsonLines(sections['IMAGES'] || '').map((row) => ({
        id: String(row['ID'] || '').slice(0, 19),
        repository: String(row['Repository'] || '<none>'),
        tag: String(row['Tag'] || '<none>'),
        size: String(row['Size'] || ''),
        createdSince: String(row['CreatedSince'] || ''),
      }));

      const volumes: DockerVolumeInfo[] = parseJsonLines(sections['VOLUMES'] || '').map((row) => ({
        name: String(row['Name'] || ''),
        driver: String(row['Driver'] || 'local'),
        mountpoint: String(row['Mountpoint'] || ''),
      }));

      const networks: DockerNetworkInfo[] = parseJsonLines(sections['NETWORKS'] || '').map((row) => ({
        id: String(row['ID'] || '').slice(0, 12),
        name: String(row['Name'] || ''),
        driver: String(row['Driver'] || ''),
        scope: String(row['Scope'] || 'local'),
      }));

      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        status: 'online',
        dockerVersion,
        containers,
        images,
        volumes,
        networks,
        collectedAt: now,
      };
    } catch (err) {
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        status: 'offline',
        errorMessage: err instanceof Error ? err.message : String(err),
        containers: [],
        images: [],
        volumes: [],
        networks: [],
        collectedAt: now,
      };
    }
  }

  private getServerOrThrow(serverId: string): SshServerConfig {
    const server = this.store.getServer(serverId);
    if (!server) throw new Error('Server not found');
    return server;
  }

  private validateContainerId(containerId: string): string {
    const clean = containerId.trim();
    if (!clean || !VALID_CONTAINER_ID.test(clean)) {
      throw new Error('Invalid container identifier');
    }
    return clean;
  }

  async containerAction(
    serverId: string,
    containerId: string,
    action: DockerContainerAction,
  ): Promise<{ ok: boolean; message: string }> {
    const server = this.getServerOrThrow(serverId);
    const id = this.validateContainerId(containerId);

    if (serverId.startsWith('demo-')) {
      return {
        ok: true,
        message: `[DEMO] Executed docker ${action} on ${id} (${server.name})`,
      };
    }

    const cmdMap: Record<DockerContainerAction, string> = {
      start: `docker start ${shellQuote(id)}`,
      stop: `docker stop ${shellQuote(id)}`,
      restart: `docker restart ${shellQuote(id)}`,
      pause: `docker pause ${shellQuote(id)}`,
      unpause: `docker unpause ${shellQuote(id)}`,
      remove: `docker rm -f ${shellQuote(id)}`,
    };
    const cmd = cmdMap[action];
    if (!cmd) throw new Error('Unsupported Docker action');

    const res = await this.ssh.runCommand(server, cmd, 30000);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || `docker ${action} failed`);
    }
    return {
      ok: true,
      message: `Container ${id}: ${action} completed`,
    };
  }

  async getContainerLogs(serverId: string, containerId: string, tail = 200): Promise<{ logs: string }> {
    const server = this.getServerOrThrow(serverId);
    const id = this.validateContainerId(containerId);
    const safeTail = Math.max(10, Math.min(2000, Math.round(Number(tail) || 200)));

    if (serverId.startsWith('demo-')) {
      return {
        logs: [
          `${new Date(Date.now() - 120000).toISOString()} [INFO] ${id}: container started on ${server.host}`,
          `${new Date(Date.now() - 60000).toISOString()} [INFO] ${id}: healthcheck passed (200 OK)`,
          `${new Date().toISOString()} [INFO] ${id}: serving requests normally`,
        ].join('\n'),
      };
    }

    const res = await this.ssh.runCommand(
      server,
      `docker logs --tail ${safeTail} --timestamps ${shellQuote(id)} 2>&1`,
      15000,
    );
    return {
      logs: (res.stdout || res.stderr || '').trim() || '(no log output)',
    };
  }

  async execInContainer(serverId: string, containerId: string, command: string): Promise<CommandResult> {
    const server = this.getServerOrThrow(serverId);
    const id = this.validateContainerId(containerId);
    const cleanCmd = command.trim();
    if (!cleanCmd) throw new Error('Command is required');

    if (serverId.startsWith('demo-')) {
      return {
        stdout: `[DEMO] (${id}) $ ${cleanCmd}\nuid=0(root) gid=0(root) groups=0(root)`,
        stderr: '',
        exitCode: 0,
        durationMs: 18,
      };
    }

    return this.ssh.runCommand(server, `docker exec ${shellQuote(id)} sh -c ${shellQuote(cleanCmd)}`, 20000);
  }

  async pruneHost(serverId: string, target: 'containers' | 'images' | 'all'): Promise<{ ok: boolean; output: string }> {
    const server = this.getServerOrThrow(serverId);
    if (serverId.startsWith('demo-')) {
      return { ok: true, output: `[DEMO] Pruned unused ${target} on ${server.name} (reclaimed 312MB).` };
    }
    const cmd =
      target === 'containers'
        ? 'docker container prune -f'
        : target === 'images'
          ? 'docker image prune -f'
          : 'docker system prune -f';
    const res = await this.ssh.runCommand(server, cmd, 30000);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'Docker prune failed');
    }
    return {
      ok: true,
      output: (res.stdout || res.stderr || 'Prune complete').trim(),
    };
  }
}
