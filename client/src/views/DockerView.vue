<template>
  <div>
    <!-- Section Header -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Docker Engine &amp; Container Control</h2>
        <div class="panel-subtitle">
          Live containers, compose stacks, CPU/memory stats, logs, shell exec, images, volumes, and networks across SSH hosts
        </div>
      </div>
      <div class="btn-group">
        <button class="btn" type="button" :disabled="loading" @click="loadHosts">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-server')">
          + Add Docker Host (SSH)
        </button>
      </div>
    </div>

    <div v-if="loading && hosts.length === 0" class="panel empty-state">
      <h3>Scanning SSH Hosts for Docker...</h3>
      <p>Querying configured SSH servers for Docker Engine containers, stats, images, volumes, and networks.</p>
    </div>

    <div v-else-if="hosts.length === 0" class="panel empty-state">
      <h3>No SSH Hosts Configured</h3>
      <p>Add a Linux SSH server running Docker to view and manage its containers, logs, images, and volumes.</p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-server')">
        + Add Docker Host (SSH)
      </button>
    </div>

    <template v-else>
      <!-- Host Selector Strip -->
      <div class="cluster-strip">
        <button
          v-for="h in hosts"
          :key="h.serverId"
          type="button"
          class="cluster-chip"
          :class="{ active: activeHostId === h.serverId }"
          @click="selectedHostId = h.serverId"
        >
          <span
            class="dot"
            :class="h.status === 'online' ? 'dot-ok' : h.status === 'no-docker' ? 'dot-warn' : 'dot-crit'"
          ></span>
          <span style="margin-right: 8px;">{{ h.serverName }}</span>
          <span
            v-if="h.status === 'online'"
            class="pill pill-cyan mono"
            style="font-size: 10px; padding: 2px 7px;"
          >
            {{ runningCount(h) }}/{{ h.containers.length }} UP
          </span>
          <span
            v-else
            class="pill pill-muted mono"
            style="font-size: 10px; padding: 2px 7px;"
          >
            {{ h.status === 'no-docker' ? 'NO DOCKER' : h.status.toUpperCase() }}
          </span>
        </button>
      </div>

      <div v-if="activeHost">
        <div v-if="activeHost.status === 'error' || activeHost.status === 'offline'" class="alert-row alert-critical" style="margin-bottom: 16px;">
          <div>
            <strong>Docker Host Error ({{ activeHost.host }}):</strong>
            {{ activeHost.errorMessage || 'Unable to reach Docker daemon over SSH.' }}
          </div>
        </div>

        <div v-else-if="activeHost.status === 'no-docker'" class="panel empty-state">
          <h3>Docker Not Detected on {{ activeHost.serverName }}</h3>
          <p class="mono">{{ activeHost.host }} does not have the <code class="hl-md-code">docker</code> CLI installed or accessible.</p>
        </div>

        <template v-else>
          <!-- KPI Strip -->
          <div class="rack-row" style="margin-bottom: 16px;">
            <div class="col-3">
              <div class="panel kpi-card">
                <div class="kpi-label">RUNNING / TOTAL</div>
                <div class="kpi-value mono">{{ runningCount(activeHost) }} / {{ activeHost.containers.length }}</div>
                <div class="kpi-sub mono">Engine v{{ activeHost.dockerVersion || '?' }}</div>
              </div>
            </div>
            <div class="col-3">
              <div class="panel kpi-card">
                <div class="kpi-label">STOPPED / EXITED</div>
                <div class="kpi-value mono">{{ activeHost.containers.length - runningCount(activeHost) }}</div>
                <div class="kpi-sub mono">{{ composeProjectsCount }} compose stacks</div>
              </div>
            </div>
            <div class="col-3">
              <div class="panel kpi-card">
                <div class="kpi-label">IMAGES</div>
                <div class="kpi-value mono">{{ activeHost.images.length }}</div>
                <div class="kpi-sub mono">Local image cache</div>
              </div>
            </div>
            <div class="col-3">
              <div class="panel kpi-card">
                <div class="kpi-label">VOLUMES &amp; NETWORKS</div>
                <div class="kpi-value mono">{{ activeHost.volumes.length }} / {{ activeHost.networks.length }}</div>
                <div class="kpi-sub mono">{{ activeHost.host }}</div>
              </div>
            </div>
          </div>

          <!-- Sub-Tabs & Actions -->
          <div class="section-bar" style="margin-bottom: 12px;">
            <div class="tab-strip" style="margin-bottom: 0;">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: subTab === 'containers' }"
                @click="subTab = 'containers'"
              >
                Containers ({{ activeHost.containers.length }})
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: subTab === 'images' }"
                @click="subTab = 'images'"
              >
                Images ({{ activeHost.images.length }})
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: subTab === 'storage' }"
                @click="subTab = 'storage'"
              >
                Volumes &amp; Networks ({{ activeHost.volumes.length + activeHost.networks.length }})
              </button>
            </div>

            <div class="btn-group">
              <button
                class="btn btn-sm"
                type="button"
                :disabled="pruning"
                @click="runPrune('containers')"
              >
                Prune Stopped
              </button>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="pruning"
                @click="runPrune('images')"
              >
                Prune Unused Images
              </button>
            </div>
          </div>

          <!-- TAB 1: CONTAINERS -->
          <div v-if="subTab === 'containers'" class="panel">
            <div class="panel-header" style="flex-wrap: wrap; gap: 10px;">
              <div class="btn-group">
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-primary': stateFilter === 'all' }"
                  @click="stateFilter = 'all'"
                >
                  All ({{ activeHost.containers.length }})
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-primary': stateFilter === 'running' }"
                  @click="stateFilter = 'running'"
                >
                  Running ({{ runningCount(activeHost) }})
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-primary': stateFilter === 'stopped' }"
                  @click="stateFilter = 'stopped'"
                >
                  Stopped ({{ activeHost.containers.length - runningCount(activeHost) }})
                </button>
              </div>
              <input
                v-model="searchQuery"
                class="input mono"
                type="text"
                placeholder="Filter containers, image, stack, port..."
                style="max-width: 280px;"
              />
            </div>

            <div v-if="filteredContainers.length === 0" class="empty-state" style="padding: 28px 16px;">
              <p class="mono">No containers match the current filter.</p>
            </div>

            <div v-else class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Container</th>
                    <th>Image</th>
                    <th>State</th>
                    <th>CPU / Mem</th>
                    <th>Ports</th>
                    <th style="text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in filteredContainers" :key="c.id">
                    <td>
                      <div class="mono" style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                        <span
                          class="dot"
                          :class="c.state === 'running' ? 'dot-ok' : c.state === 'paused' ? 'dot-warn' : 'dot-crit'"
                        ></span>
                        <span>{{ c.name }}</span>
                        <span v-if="c.composeProject" class="pill pill-violet" style="font-size: 10px; padding: 1px 6px;">
                          {{ c.composeProject }}
                        </span>
                      </div>
                      <div class="mono" style="font-size: 11px; opacity: 0.65; margin-top: 2px;">
                        {{ c.id }}
                      </div>
                    </td>
                    <td class="mono" style="font-size: 12px;">{{ c.image }}</td>
                    <td>
                      <span
                        class="pill mono"
                        :class="c.state === 'running' ? 'pill-ok' : c.state === 'paused' ? 'pill-warn' : 'pill-muted'"
                        style="font-size: 10px;"
                      >
                        {{ c.state.toUpperCase() }}
                      </span>
                      <div class="mono" style="font-size: 11px; opacity: 0.7; margin-top: 2px;">{{ c.status }}</div>
                    </td>
                    <td class="mono" style="font-size: 12px;">
                      <template v-if="c.state === 'running' && (c.cpuPercent || c.memUsage)">
                        <div>CPU: {{ c.cpuPercent || '—' }}</div>
                        <div style="opacity: 0.75; font-size: 11px;">{{ c.memUsage || '—' }}</div>
                      </template>
                      <span v-else style="opacity: 0.5;">—</span>
                    </td>
                    <td class="mono" style="font-size: 11px; max-width: 220px; word-break: break-word;">
                      {{ c.ports || '—' }}
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                      <div class="btn-group" style="justify-content: flex-end;">
                        <button
                          v-if="c.state !== 'running'"
                          type="button"
                          class="btn btn-sm btn-primary"
                          :disabled="busyContainer === c.id"
                          @click="doAction(c, 'start')"
                        >
                          Start
                        </button>
                        <button
                          v-if="c.state === 'running'"
                          type="button"
                          class="btn btn-sm"
                          :disabled="busyContainer === c.id"
                          @click="doAction(c, 'restart')"
                        >
                          Restart
                        </button>
                        <button
                          v-if="c.state === 'running'"
                          type="button"
                          class="btn btn-sm"
                          :disabled="busyContainer === c.id"
                          @click="doAction(c, 'stop')"
                        >
                          Stop
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm"
                          @click="openLogs(c)"
                        >
                          Logs
                        </button>
                        <button
                          v-if="c.state === 'running'"
                          type="button"
                          class="btn btn-sm"
                          @click="openExec(c)"
                        >
                          Exec
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm btn-danger"
                          :disabled="busyContainer === c.id"
                          @click="confirmRemove(c)"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- TAB 2: IMAGES -->
          <div v-else-if="subTab === 'images'" class="panel">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Tag</th>
                    <th>Image ID</th>
                    <th>Size</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="img in activeHost.images" :key="`${img.id}-${img.repository}-${img.tag}`">
                    <td class="mono" style="font-weight: 600;">{{ img.repository }}</td>
                    <td><span class="pill pill-cyan mono" style="font-size: 11px;">{{ img.tag }}</span></td>
                    <td class="mono" style="font-size: 12px; opacity: 0.75;">{{ img.id }}</td>
                    <td class="mono">{{ img.size }}</td>
                    <td class="mono" style="font-size: 12px; opacity: 0.75;">{{ img.createdSince }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- TAB 3: VOLUMES & NETWORKS -->
          <div v-else-if="subTab === 'storage'" class="rack-row">
            <div class="col-6">
              <div class="panel">
                <div class="panel-header">
                  <span class="panel-title">Volumes ({{ activeHost.volumes.length }})</span>
                </div>
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Driver</th>
                        <th>Mountpoint</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="v in activeHost.volumes" :key="v.name">
                        <td class="mono" style="font-weight: 600;">{{ v.name }}</td>
                        <td><span class="pill pill-muted mono" style="font-size: 10px;">{{ v.driver }}</span></td>
                        <td class="mono" style="font-size: 11px; word-break: break-all;">{{ v.mountpoint }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div class="col-6">
              <div class="panel">
                <div class="panel-header">
                  <span class="panel-title">Networks ({{ activeHost.networks.length }})</span>
                </div>
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Driver</th>
                        <th>Scope</th>
                        <th>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="n in activeHost.networks" :key="n.id">
                        <td class="mono" style="font-weight: 600;">{{ n.name }}</td>
                        <td><span class="pill pill-cyan mono" style="font-size: 10px;">{{ n.driver }}</span></td>
                        <td class="mono">{{ n.scope }}</td>
                        <td class="mono" style="font-size: 11px; opacity: 0.75;">{{ n.id }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Logs Modal -->
    <UiDialog
      :open="logsModal.open"
      :title="`Container Logs — ${logsModal.containerName}`"
      max-width="860px"
      @close="logsModal.open = false"
    >
      <div class="btn-group" style="margin-bottom: 10px; justify-content: space-between;">
        <div class="btn-group">
          <select v-model.number="logsModal.tail" class="select mono" style="max-width: 130px;" @change="refreshLogs">
            <option :value="100">Tail 100</option>
            <option :value="200">Tail 200</option>
            <option :value="500">Tail 500</option>
          </select>
          <button type="button" class="btn btn-sm" :disabled="logsModal.loading" @click="refreshLogs">
            {{ logsModal.loading ? 'Loading...' : 'Refresh Logs' }}
          </button>
        </div>
        <button type="button" class="btn btn-sm" @click="copyLogs">Copy</button>
      </div>
      <pre class="dk-terminal mono">{{ logsModal.content }}</pre>
      <template #footer>
        <UiButton @click="logsModal.open = false">Close</UiButton>
      </template>
    </UiDialog>

    <!-- Exec Modal -->
    <UiDialog
      :open="execModal.open"
      :title="`Container Shell Exec — ${execModal.containerName}`"
      max-width="780px"
      @close="execModal.open = false"
    >
      <div class="btn-group" style="margin-bottom: 8px; flex-wrap: wrap;">
        <button
          v-for="preset in execPresets"
          :key="preset"
          type="button"
          class="btn btn-sm mono"
          @click="runExecPreset(preset)"
        >
          {{ preset }}
        </button>
      </div>
      <div class="hl-inline-form" style="margin-bottom: 10px;">
        <input
          v-model="execModal.command"
          class="input mono"
          type="text"
          placeholder="Command inside container (e.g. ls -la /app)"
          style="flex: 1; margin-right: 8px;"
          @keyup.enter="runExec"
        />
        <button type="button" class="btn btn-primary" :disabled="execModal.running" @click="runExec">
          {{ execModal.running ? 'Running...' : 'Run' }}
        </button>
      </div>
      <pre class="dk-terminal mono">{{ execModal.output || 'Enter a command above to execute inside the container.' }}</pre>
      <template #footer>
        <UiButton @click="execModal.open = false">Close</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, reactive, ref } from 'vue';
import type { DockerContainerAction, DockerContainerInfo, DockerHostSnapshot } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';

export default defineComponent({
  name: 'DockerView',
  components: { UiDialog, UiButton },
  emits: ['add-server', 'toast'],
  setup(_, { emit }) {
    const hosts = ref<DockerHostSnapshot[]>([]);
    const loading = ref(false);
    const pruning = ref(false);
    const selectedHostId = ref('');
    const subTab = ref<'containers' | 'images' | 'storage'>('containers');
    const stateFilter = ref<'all' | 'running' | 'stopped'>('all');
    const searchQuery = ref('');
    const busyContainer = ref('');

    const logsModal = reactive({
      open: false,
      serverId: '',
      containerId: '',
      containerName: '',
      tail: 200,
      loading: false,
      content: '',
    });

    const execModal = reactive({
      open: false,
      serverId: '',
      containerId: '',
      containerName: '',
      command: 'ps aux',
      running: false,
      output: '',
    });

    const execPresets = ['ps aux', 'env', 'df -h', 'ls -la', 'cat /etc/os-release'];

    const activeHostId = computed(() => {
      if (selectedHostId.value && hosts.value.some((h) => h.serverId === selectedHostId.value)) {
        return selectedHostId.value;
      }
      return hosts.value[0]?.serverId || '';
    });

    const activeHost = computed(() => hosts.value.find((h) => h.serverId === activeHostId.value) || null);

    function runningCount(h: DockerHostSnapshot): number {
      return h.containers.filter((c) => c.state === 'running').length;
    }

    const composeProjectsCount = computed(() => {
      if (!activeHost.value) return 0;
      const projects = new Set(activeHost.value.containers.map((c) => c.composeProject).filter(Boolean));
      return projects.size;
    });

    const filteredContainers = computed(() => {
      if (!activeHost.value) return [];
      const q = searchQuery.value.trim().toLowerCase();
      return activeHost.value.containers.filter((c) => {
        if (stateFilter.value === 'running' && c.state !== 'running') return false;
        if (stateFilter.value === 'stopped' && c.state === 'running') return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          (c.composeProject || '').toLowerCase().includes(q) ||
          c.ports.toLowerCase().includes(q)
        );
      });
    });

    async function loadHosts() {
      loading.value = true;
      try {
        hosts.value = await api.getDockerHosts();
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to query Docker hosts',
          error: true,
        });
      } finally {
        loading.value = false;
      }
    }

    async function doAction(c: DockerContainerInfo, action: DockerContainerAction) {
      if (!activeHost.value) return;
      busyContainer.value = c.id;
      try {
        const res = await api.dockerContainerAction(activeHost.value.serverId, c.id, action);
        emit('toast', { message: res.message, error: false });
        await loadHosts();
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : `Failed to ${action} ${c.name}`,
          error: true,
        });
      } finally {
        busyContainer.value = '';
      }
    }

    function confirmRemove(c: DockerContainerInfo) {
      if (window.confirm(`Force-remove container "${c.name}" (${c.id})?`)) {
        void doAction(c, 'remove');
      }
    }

    async function openLogs(c: DockerContainerInfo) {
      if (!activeHost.value) return;
      logsModal.open = true;
      logsModal.serverId = activeHost.value.serverId;
      logsModal.containerId = c.id;
      logsModal.containerName = c.name;
      logsModal.content = 'Loading logs...';
      await refreshLogs();
    }

    async function refreshLogs() {
      if (!logsModal.serverId || !logsModal.containerId) return;
      logsModal.loading = true;
      try {
        const res = await api.getDockerContainerLogs(logsModal.serverId, logsModal.containerId, logsModal.tail);
        logsModal.content = res.logs;
      } catch (err) {
        logsModal.content = err instanceof Error ? err.message : 'Failed to fetch logs';
      } finally {
        logsModal.loading = false;
      }
    }

    async function copyLogs() {
      try {
        await navigator.clipboard.writeText(logsModal.content);
        emit('toast', { message: 'Logs copied to clipboard', error: false });
      } catch {
        // ignore clipboard error
      }
    }

    function openExec(c: DockerContainerInfo) {
      if (!activeHost.value) return;
      execModal.open = true;
      execModal.serverId = activeHost.value.serverId;
      execModal.containerId = c.id;
      execModal.containerName = c.name;
      execModal.output = '';
    }

    function runExecPreset(cmd: string) {
      execModal.command = cmd;
      void runExec();
    }

    async function runExec() {
      const cmd = execModal.command.trim();
      if (!cmd || !execModal.serverId || !execModal.containerId) return;
      execModal.running = true;
      try {
        const res = await api.execDockerContainer(execModal.serverId, execModal.containerId, cmd);
        execModal.output = [res.stdout, res.stderr].filter(Boolean).join('\n') || `(exit code ${res.exitCode})`;
      } catch (err) {
        execModal.output = err instanceof Error ? err.message : 'Exec failed';
      } finally {
        execModal.running = false;
      }
    }

    async function runPrune(target: 'containers' | 'images' | 'all') {
      if (!activeHost.value) return;
      if (!window.confirm(`Prune unused ${target} on ${activeHost.value.serverName}?`)) return;
      pruning.value = true;
      try {
        const res = await api.pruneDockerHost(activeHost.value.serverId, target);
        emit('toast', { message: res.output || `Pruned ${target}`, error: false });
        await loadHosts();
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Prune failed',
          error: true,
        });
      } finally {
        pruning.value = false;
      }
    }

    onMounted(() => {
      void loadHosts();
    });

    return {
      hosts,
      loading,
      pruning,
      selectedHostId,
      activeHostId,
      activeHost,
      subTab,
      stateFilter,
      searchQuery,
      busyContainer,
      filteredContainers,
      composeProjectsCount,
      runningCount,
      loadHosts,
      doAction,
      confirmRemove,
      logsModal,
      openLogs,
      refreshLogs,
      copyLogs,
      execModal,
      execPresets,
      openExec,
      runExecPreset,
      runExec,
      runPrune,
    };
  },
});
</script>

<style scoped>
.dk-terminal {
  background: #060911;
  border: 1px solid #1d2a42;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.45;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #e2e8f0;
  margin: 0;
}
</style>
