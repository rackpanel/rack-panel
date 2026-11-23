<template>
  <div>
    <!-- Top Section Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Topology Infrastructure Lab &amp; Topology Suite</h2>
        <div class="panel-subtitle">
          Interactive network map, 19"/10" physical rack designer, subnet scanner,Zigbee/Z-Wave mesh importer, IPAM, and Markdown wiki
        </div>
      </div>
      <div class="btn-group">
        <button class="btn" type="button" :disabled="healthRunning" @click="triggerHealthChecks">
          {{ healthRunning ? 'Probing...' : 'Probe Health' }}
        </button>
        <button class="btn" type="button" :disabled="syncingOverview" @click="syncFromRackPanel">
          {{ syncingOverview ? 'Syncing...' : 'Sync Rack Panel Hosts' }}
        </button>
        <button class="btn btn-danger" type="button" @click="promptReset('all')">
          Reset Canvas &amp; Racks
        </button>
        <button class="btn btn-primary" type="button" @click="openNodeModal()">
          + Add Node
        </button>
      </div>
    </div>

    <!-- 5 Topology Sub-Tabs -->
    <div class="hl-subtabs">
      <div class="btn-group">
        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': activeSubTab === 'canvas' }"
          @click="setSubTab('canvas')"
        >
          Topology Canvas ({{ topLevelCanvasNodes.length }})
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': activeSubTab === 'racks' }"
          @click="setSubTab('racks')"
        >
          Physical Rack Builder ({{ state.racks.length }})
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': activeSubTab === 'scanner' }"
          @click="setSubTab('scanner')"
        >
          Scanner &amp; Mesh Importers ({{ pendingDiscoveriesCount }})
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': activeSubTab === 'ipam' }"
          @click="setSubTab('ipam')"
        >
          IPAM &amp; Health Monitor ({{ state.nodes.length }})
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': activeSubTab === 'docs' }"
          @click="setSubTab('docs')"
        >
          Wiki &amp; Git Sync ({{ state.docs.length }})
        </button>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SUB-TAB 1: INTERACTIVE TOPOLOGY CANVAS                                  -->
    <!-- ======================================================================= -->
    <div v-if="activeSubTab === 'canvas'">
      <!-- Canvas Selector & Controls Bar -->
      <div class="hl-canvas-toolbar panel" style="margin-bottom: 12px; padding: 10px 14px;">
        <div class="hl-toolbar-row">
          <div class="btn-group">
            <button
              v-for="c in state.canvases"
              :key="c.id"
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': selectedCanvasId === c.id }"
              @click="selectCanvas(c.id)"
            >
              {{ c.name }}
            </button>
            <button type="button" class="btn btn-sm" @click="creatingCanvas = !creatingCanvas">
              {{ creatingCanvas ? 'Cancel' : '+ New Canvas' }}
            </button>
          </div>

          <div class="btn-group">
            <button type="button" class="btn btn-sm" @click="openLinkModal">
              + Link Nodes
            </button>
            <button type="button" class="btn btn-sm" @click="openAutoLayoutModal">
              Auto-Layout
            </button>
            <button type="button" class="btn btn-sm" @click="adjustZoom(-0.15)">
              &minus; Zoom
            </button>
            <button type="button" class="btn btn-sm mono" @click="resetViewport">
              {{ Math.round(zoom * 100) }}%
            </button>
            <button type="button" class="btn btn-sm" @click="adjustZoom(0.15)">
              + Zoom
            </button>
            <a
              v-if="selectedCanvasId"
              :href="svgExportUrl"
              target="_blank"
              class="btn btn-sm"
              style="text-decoration: none;"
            >
              Export SVG
            </a>
            <button type="button" class="btn btn-sm btn-danger" @click="promptReset('canvas')">
              Reset Canvas
            </button>
          </div>
        </div>

        <!-- Inline New Canvas Creator -->
        <div v-if="creatingCanvas" class="hl-inline-form" style="margin-top: 10px;">
          <input
            v-model="newCanvasName"
            class="input"
            type="text"
            placeholder="Canvas name (e.g. DMZ & Cloud VLANs)"
            style="max-width: 280px; margin-right: 8px;"
          />
          <input
            v-model="newCanvasDesc"
            class="input"
            type="text"
            placeholder="Optional description"
            style="max-width: 340px; margin-right: 8px;"
          />
          <button class="btn btn-sm btn-primary" type="button" @click="submitCreateCanvas">
            Create Canvas
          </button>
        </div>
      </div>

      <div class="rack-row">
        <!-- Main Interactive Pan/Zoom/Drag Canvas -->
        <div :class="selectedNode ? 'col-8' : 'col-12'">
          <div
            ref="viewportEl"
            class="panel hl-canvas-viewport"
            @mousedown="onCanvasMouseDown"
            @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp"
            @mouseleave="onCanvasMouseUp"
            @touchstart="onCanvasTouchStart"
            @touchmove="onCanvasTouchMove"
            @touchend="onCanvasTouchEnd"
          >
            <!-- Top-Left Canvas Legend Overlay -->
            <div class="hl-canvas-hud mono">
              <span>ONLINE: {{ onlineCanvasCount }}/{{ topLevelCanvasNodes.length }}</span>
              <span style="margin-left: 10px;">LINKS: {{ renderedEdges.length }}</span>
              <span style="margin-left: 10px; color: #64748b;">DRAG NODE TO MOVE &middot; PROXMOX GUESTS NESTED IN RACK CHASSIS</span>
            </div>

            <!-- Transformed Stage -->
            <div ref="canvasStageEl" class="hl-canvas-stage" :style="stageTransformStyle">
              <!-- SVG Edges / Network Links Layer -->
              <svg class="hl-edges-svg" width="3200" height="2600" viewBox="0 0 3200 2600">
                <g
                  v-for="edge in renderedEdges"
                  :key="`path-${edge.link.id}`"
                  :class="{ 'hl-edge-dimmed': hoveredNodeId && !isEdgeConnectedToHover(edge.link) }"
                >
                  <path
                    :d="edge.path"
                    fill="none"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    :stroke="edge.color"
                    stroke-width="2.5"
                    :stroke-dasharray="edge.dashed ? '6,4' : undefined"
                  />
                </g>
                <g
                  v-for="edge in renderedEdges"
                  :key="`lbl-${edge.link.id}`"
                  :class="{ 'hl-edge-dimmed': hoveredNodeId && !isEdgeConnectedToHover(edge.link) }"
                  style="cursor: pointer;"
                  @click.stop="confirmDeleteLink(edge.link)"
                >
                  <rect
                    :x="edge.mx - 64"
                    :y="edge.my - 11"
                    width="128"
                    height="22"
                    rx="3"
                    fill="#090e18"
                    :stroke="edge.color"
                    stroke-width="1"
                  />
                  <text
                    :x="edge.mx"
                    :y="edge.my + 4"
                    text-anchor="middle"
                    fill="#e2e8f0"
                    font-family="monospace"
                    font-size="10"
                    font-weight="700"
                  >
                    {{ edge.link.label.slice(0, 20) }}
                  </text>
                </g>
              </svg>

              <!-- Dotted Group Boxes for Nodes Sharing the Same MAC with Different IPs -->
              <div
                v-for="grp in sharedMacGroups"
                :key="`macgrp-${grp.mac}`"
                class="hl-shared-mac-group"
                :style="{
                  left: `${grp.x}px`,
                  top: `${grp.y}px`,
                  width: `${grp.width}px`,
                  height: `${grp.height}px`,
                }"
              >
                <span class="hl-shared-mac-label mono">
                  SHARED MAC &middot; {{ grp.mac }} ({{ grp.count }} IPs)
                </span>
              </div>

              <!-- Draggable Device Nodes Layer (Proxmox, CCTV NVR & Managed Switch nodes render as Rack Builder Chassis!) -->
              <div
                v-for="node in topLevelCanvasNodes"
                :key="node.id"
                :data-node-id="node.id"
                class="hl-node-card"
                :class="{
                  'hl-node-proxmox-rack': node.kind === 'proxmox' || node.kind === 'nvr',
                  'hl-node-nvr-rack': node.kind === 'nvr',
                  'hl-node-switch-chassis': node.kind === 'switch',
                  'hl-node-selected':
                    selectedNode &&
                    (selectedNode.id === node.id || selectedNode.parentId === node.id),
                  'hl-node-dimmed': hoveredNodeId && !isNodeConnectedToHover(node.id),
                  'hl-node-offline': node.status === 'offline',
                }"
                :style="{ left: `${node.x}px`, top: `${node.y}px` }"
                @mouseenter="hoveredNodeId = node.id"
                @mouseleave="hoveredNodeId = ''"
                @mousedown.stop="onNodeMouseDown($event, node)"
                @touchstart.stop="onNodeTouchStart($event, node)"
                @click.stop="selectNode(node)"
              >
                <!-- ========================================================= -->
                <!-- PROXMOX HYPERVISOR MINI-RACK CABINET NODE                 -->
                <!-- ========================================================= -->
                <template v-if="node.kind === 'proxmox'">
                  <!-- Top Rack Cabinet Header Bar -->
                  <div class="hl-pve-rack-top-bezel mono">
                    <span class="hl-pve-rack-title-tag">PROXMOX RACK CHASSIS</span>
                    <span class="hl-pve-rack-count">
                      {{ (proxmoxGuestsByHostId[node.id] || []).length }} BAYS
                    </span>
                    <button
                      v-if="(proxmoxGuestsByHostId[node.id] || []).length > 0"
                      type="button"
                      class="hl-pve-collapse-btn mono"
                      @mousedown.stop
                      @touchstart.stop
                      @click.stop="toggleProxmoxRackCollapse(node.id)"
                    >
                      {{ collapsedProxmoxHosts[node.id] ? '+ EXPAND' : '− COLLAPSE' }}
                    </button>
                  </div>

                  <!-- 2U Hypervisor Head Unit Faceplate with Cage-Nut Rails, Drive Bays & SFP+ Ports -->
                  <div class="hl-pve-head-unit">
                    <div class="hl-pve-rail hl-pve-rail-left mono">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-u-num">0U</span>
                      <span class="hl-pve-hole"></span>
                    </div>

                    <div class="hl-pve-head-faceplate">
                      <div class="hl-node-top" style="margin-bottom: 3px;">
                        <span
                          class="dot"
                          :class="
                            node.status === 'online'
                              ? 'dot-ok'
                              : node.status === 'offline'
                                ? 'dot-crit'
                                : 'dot-warn'
                          "
                        ></span>
                        <span class="hl-node-kind mono" style="color: #fbbf24;">PROXMOX VE</span>
                        <span class="hl-node-ip mono" style="margin-top: 0; margin-left: 6px;">
                          {{ node.ipAddress || node.hostname }}
                        </span>
                        <span v-if="node.latencyMs !== null" class="hl-node-lat mono">
                          {{ node.latencyMs }}ms
                        </span>
                      </div>

                      <div class="hl-pve-head-mid">
                        <div class="hl-node-title" :title="node.name">{{ node.name }}</div>
                        <!-- Physical Rack Builder Style Drive Bays + RJ45/SFP+ Port LEDs -->
                        <div class="hl-pve-hw-strip">
                          <span class="hl-pve-drive-bay" title="NVMe / SATA Bay 1"></span>
                          <span class="hl-pve-drive-bay" title="NVMe / SATA Bay 2"></span>
                          <span class="hl-pve-drive-bay" title="NVMe / SATA Bay 3"></span>
                          <span class="hl-pve-drive-bay" title="NVMe / SATA Bay 4"></span>
                          <span class="hl-pve-port-led hl-pve-port-active" title="10G SFP+ Port 1"></span>
                          <span class="hl-pve-port-led hl-pve-port-sfp" title="10G SFP+ Port 2"></span>
                        </div>
                      </div>
                    </div>

                    <div class="hl-pve-rail hl-pve-rail-right">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-hole"></span>
                    </div>
                  </div>

                  <!-- Nested 1U Rack Blade Slots for All Proxmox VMs & LXC Containers -->
                  <div
                    v-if="!collapsedProxmoxHosts[node.id] && (proxmoxGuestsByHostId[node.id] || []).length > 0"
                    class="hl-pve-guest-rack-body"
                  >
                    <div
                      v-for="guest in proxmoxGuestsByHostId[node.id]"
                      :key="guest.id"
                      class="hl-pve-guest-u-row"
                      :class="{
                        'hl-pve-guest-selected': selectedNode && selectedNode.id === guest.id,
                        'hl-pve-guest-offline': guest.status !== 'online',
                      }"
                      @mousedown.stop
                      @touchstart.stop
                      @click.stop="selectProxmoxNestedGuest(node, guest)"
                    >
                      <!-- Left Perforated Mounting Rail with VMID / U-Number -->
                      <div class="hl-pve-rail hl-pve-rail-left mono">
                        <span class="hl-pve-u-num">{{ guest.vmid || guest.uSlot }}</span>
                      </div>

                      <!-- 1U Guest Blade Faceplate -->
                      <div class="hl-pve-guest-blade">
                        <span
                          class="dot"
                          :class="guest.status === 'online' ? 'dot-ok' : 'dot-crit'"
                        ></span>
                        <span
                          class="hl-pve-guest-kind mono"
                          :class="guest.kind === 'vm' ? 'hl-pve-kind-vm' : 'hl-pve-kind-lxc'"
                        >
                          {{ guest.kind.toUpperCase() }}
                        </span>
                        <span class="hl-pve-guest-name" :title="guest.name">{{ guest.name }}</span>
                        <span class="hl-pve-guest-telemetry mono">
                          {{ guest.telemetryLabel }}
                        </span>
                      </div>

                      <!-- Right Perforated Mounting Rail -->
                      <div class="hl-pve-rail hl-pve-rail-right">
                        <span class="hl-pve-hole"></span>
                        <span class="hl-pve-hole"></span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-else-if="(proxmoxGuestsByHostId[node.id] || []).length === 0"
                    class="hl-pve-empty-bay mono"
                  >
                    No VMs/LXCs synced yet &mdash; click "Sync Rack Panel Hosts"
                  </div>
                </template>

                <!-- ========================================================= -->
                <!-- CCTV NVR MINI-RACK CABINET NODE (NESTED CAMERAS)          -->
                <!-- ========================================================= -->
                <template v-else-if="node.kind === 'nvr'">
                  <div class="hl-pve-rack-top-bezel mono">
                    <span class="hl-pve-rack-title-tag" style="color: #c084fc;">CCTV NVR CHASSIS</span>
                    <span class="hl-pve-rack-count">
                      {{ (nvrCamerasByHostId[node.id] || []).length }} CHANNELS
                    </span>
                    <button
                      v-if="(nvrCamerasByHostId[node.id] || []).length > 0"
                      type="button"
                      class="hl-pve-collapse-btn mono"
                      @mousedown.stop
                      @touchstart.stop
                      @click.stop="toggleNvrRackCollapse(node.id)"
                    >
                      {{ collapsedNvrHosts[node.id] ? '+ EXPAND' : '− COLLAPSE' }}
                    </button>
                  </div>

                  <div class="hl-pve-head-unit">
                    <div class="hl-pve-rail hl-pve-rail-left mono">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-u-num">2U</span>
                      <span class="hl-pve-hole"></span>
                    </div>

                    <div class="hl-pve-head-faceplate">
                      <div class="hl-node-top" style="margin-bottom: 3px;">
                        <span
                          class="dot"
                          :class="
                            node.status === 'online'
                              ? 'dot-ok'
                              : node.status === 'offline'
                                ? 'dot-crit'
                                : 'dot-warn'
                          "
                        ></span>
                        <span class="hl-node-kind mono" style="color: #c084fc;">HIK NVR</span>
                        <span class="hl-node-ip mono" style="margin-top: 0; margin-left: 6px;">
                          {{ node.ipAddress || node.hostname }}
                        </span>
                        <span v-if="node.latencyMs !== null" class="hl-node-lat mono">
                          {{ node.latencyMs }}ms
                        </span>
                      </div>

                      <div class="hl-pve-head-mid">
                        <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                          <DeviceIconSvg
                            :kind="node.kind"
                            :name="node.name"
                            :hostname="node.hostname"
                            :vendor="node.vendor"
                            :size="24"
                          />
                          <div class="hl-node-title" :title="node.name">{{ node.name }}</div>
                        </div>
                        <div class="hl-pve-hw-strip">
                          <span class="mono" style="font-size: 9px; color: #f87171; font-weight: 700; margin-right: 3px;">● REC</span>
                          <span class="hl-pve-drive-bay" title="CCTV HDD Bay 1"></span>
                          <span class="hl-pve-drive-bay" title="CCTV HDD Bay 2"></span>
                          <span class="hl-pve-drive-bay" title="CCTV HDD Bay 3"></span>
                          <span class="hl-pve-drive-bay" title="CCTV HDD Bay 4"></span>
                          <span class="hl-pve-port-led hl-pve-port-active" title="NVR LAN Uplink"></span>
                        </div>
                      </div>
                    </div>

                    <div class="hl-pve-rail hl-pve-rail-right">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-hole"></span>
                    </div>
                  </div>

                  <div
                    v-if="!collapsedNvrHosts[node.id] && (nvrCamerasByHostId[node.id] || []).length > 0"
                    class="hl-pve-guest-rack-body"
                  >
                    <div
                      v-for="cam in nvrCamerasByHostId[node.id]"
                      :key="cam.id"
                      class="hl-pve-guest-u-row"
                      :class="{
                        'hl-pve-guest-selected': selectedNode && selectedNode.id === cam.id,
                        'hl-pve-guest-offline': cam.status !== 'online',
                      }"
                      @mousedown.stop
                      @touchstart.stop
                      @click.stop="selectNvrNestedCamera(node, cam)"
                    >
                      <div class="hl-pve-rail hl-pve-rail-left mono">
                        <span class="hl-pve-u-num">{{ cam.channelNum < 10 ? '0' + cam.channelNum : cam.channelNum }}</span>
                      </div>

                      <div class="hl-pve-guest-blade">
                        <span
                          class="dot"
                          :class="cam.status === 'online' ? 'dot-ok' : 'dot-crit'"
                        ></span>
                        <span class="hl-pve-guest-kind mono hl-nvr-kind-cam">
                          {{ cam.poePort ? `PoE#${cam.poePort}` : 'CAM' }}
                        </span>
                        <span class="hl-pve-guest-name" :title="cam.name">{{ cam.name }}</span>
                        <span class="hl-pve-guest-telemetry mono">
                          {{ cam.telemetryLabel }}
                        </span>
                      </div>

                      <div class="hl-pve-rail hl-pve-rail-right">
                        <span class="hl-pve-hole"></span>
                        <span class="hl-pve-hole"></span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-else-if="(nvrCamerasByHostId[node.id] || []).length === 0"
                    class="hl-pve-empty-bay mono"
                  >
                    No CCTV channels synced yet &mdash; click "Sync Rack Panel Hosts"
                  </div>
                </template>

                <!-- ========================================================= -->
                <!-- 1U MANAGED SWITCH FACEPLATE CHASSIS (T1600G-28TS / 28PS)  -->
                <!-- ========================================================= -->
                <template v-else-if="node.kind === 'switch'">
                  <div class="hl-sw-top-bezel mono">
                    <span class="hl-sw-vendor-tag">
                      {{ (node.switchMeta && node.switchMeta.vendor) || 'TP-LINK JETSTREAM' }}
                    </span>
                    <span class="hl-sw-model-pill">
                      {{ (node.switchMeta && node.switchMeta.model) || 'T1600G-28TS' }}
                    </span>
                    <span
                      v-if="node.switchMeta && node.switchMeta.poeSupported"
                      class="hl-sw-poe-pill"
                    >
                      PoE+ {{ node.switchMeta.poeUsedWatts || 0 }}W/{{ node.switchMeta.poeBudgetWatts || 192 }}W
                    </span>
                  </div>

                  <div class="hl-sw-chassis-row">
                    <!-- Left Cage-Nut Mounting Ear -->
                    <div class="hl-pve-rail hl-pve-rail-left mono">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-u-num">1U</span>
                      <span class="hl-pve-hole"></span>
                    </div>

                    <!-- 1U Switch Faceplate with Dual-Row 24x RJ45 + 4x SFP Matrix -->
                    <div class="hl-sw-faceplate-body">
                      <div class="hl-node-top" style="margin-bottom: 4px;">
                        <span
                          class="dot"
                          :class="
                            node.status === 'online'
                              ? 'dot-ok'
                              : node.status === 'offline'
                                ? 'dot-crit'
                                : 'dot-warn'
                          "
                        ></span>
                        <span class="hl-node-title" style="font-size: 12px;" :title="node.name">
                          {{ node.name }}
                        </span>
                        <span class="hl-node-ip mono" style="margin-left: auto; margin-top: 0; font-size: 10px;">
                          {{ node.ipAddress || 'L2+ Managed' }}
                        </span>
                      </div>

                      <!-- 24x RJ45 Dual-Row (Odd 1..23 top, Even 2..24 bottom) + 4x SFP Cages (25..28) -->
                      <div class="hl-sw-ports-strip">
                        <div class="hl-sw-rj45-matrix">
                          <div class="hl-sw-rj45-row">
                            <span
                              v-for="p in getSwitchPortRow(node, 'odd')"
                              :key="`sw-${node.id}-p-${p.portNumber}`"
                              class="hl-sw-port-box"
                              :class="{
                                'hl-sw-port-up-1g': p.linkStatus === 'up' && !/100M|10M/i.test(p.speed),
                                'hl-sw-port-up-100m': p.linkStatus === 'up' && /100M|10M/i.test(p.speed),
                                'hl-sw-port-poe': p.poeActive,
                              }"
                              :title="`${p.name} · ${p.linkStatus.toUpperCase()} (${p.speed})${p.poeActive ? ' · PoE ' + (p.poeWatts || '') + 'W' : ''}${p.connectedDeviceName ? ' · ' + p.connectedDeviceName : ''}`"
                            ></span>
                          </div>
                          <div class="hl-sw-rj45-row">
                            <span
                              v-for="p in getSwitchPortRow(node, 'even')"
                              :key="`sw-${node.id}-p-${p.portNumber}`"
                              class="hl-sw-port-box"
                              :class="{
                                'hl-sw-port-up-1g': p.linkStatus === 'up' && !/100M|10M/i.test(p.speed),
                                'hl-sw-port-up-100m': p.linkStatus === 'up' && /100M|10M/i.test(p.speed),
                                'hl-sw-port-poe': p.poeActive,
                              }"
                              :title="`${p.name} · ${p.linkStatus.toUpperCase()} (${p.speed})${p.poeActive ? ' · PoE ' + (p.poeWatts || '') + 'W' : ''}${p.connectedDeviceName ? ' · ' + p.connectedDeviceName : ''}`"
                            ></span>
                          </div>
                        </div>

                        <!-- 4x 1G SFP Slots (Ports 25..28) -->
                        <div class="hl-sw-sfp-bank">
                          <span
                            v-for="p in getSwitchPortRow(node, 'sfp')"
                            :key="`sw-${node.id}-sfp-${p.portNumber}`"
                            class="hl-sw-port-box hl-sw-port-sfp"
                            :class="{ 'hl-sw-port-up-sfp': p.linkStatus === 'up' }"
                            :title="`SFP ${p.name} · ${p.linkStatus.toUpperCase()} (${p.speed})`"
                          ></span>
                        </div>
                      </div>

                      <div class="hl-sw-footer-meta mono">
                        <span>
                          {{ getSwitchActivePortCount(node) }}/{{ getSwitchTotalPortCount(node) }} PORTS UP
                        </span>
                        <span v-if="node.switchMeta && node.switchMeta.managementProtocol">
                          {{ node.switchMeta.managementProtocol.toUpperCase() }} CLI
                        </span>
                        <span v-if="node.latencyMs !== null" style="color: #34d399;">
                          {{ node.latencyMs }}ms
                        </span>
                      </div>
                    </div>

                    <!-- Right Cage-Nut Mounting Ear -->
                    <div class="hl-pve-rail hl-pve-rail-right">
                      <span class="hl-pve-hole"></span>
                      <span class="hl-pve-hole"></span>
                    </div>
                  </div>
                </template>

                <!-- ========================================================= -->
                <!-- STANDARD NETWORK / SERVER / FIREWALL / NVR NODE CARD      -->
                <!-- ========================================================= -->
                <template v-else>
                  <div class="hl-node-top">
                    <span
                      class="dot"
                      :class="
                        node.status === 'online'
                          ? 'dot-ok'
                          : node.status === 'offline'
                            ? 'dot-crit'
                            : 'dot-warn'
                      "
                    ></span>
                    <span class="hl-node-kind mono" :style="{ color: kindColor(node.kind) }">
                      {{ kindBadge(node.kind) }}
                    </span>
                    <span v-if="node.vlan" class="hl-node-vlan mono">VLAN {{ node.vlan }}</span>
                    <span v-if="node.latencyMs !== null" class="hl-node-lat mono">{{ node.latencyMs }}ms</span>
                  </div>

                  <div style="display: flex; align-items: center; gap: 9px; margin-top: 2px;">
                    <DeviceIconSvg
                      :kind="node.kind"
                      :name="node.name"
                      :hostname="node.hostname"
                      :vendor="node.vendor"
                      :size="32"
                    />
                    <div style="min-width: 0; flex: 1;">
                      <div class="hl-node-title" :title="node.name">{{ node.name }}</div>
                      <div class="hl-node-ip mono">
                        {{ node.ipAddress || node.macAddress || node.hostname || node.kind.toUpperCase() }}
                      </div>
                    </div>
                  </div>

                  <!-- Nested Children / Mesh LQI / Services Pills -->
                  <div class="hl-node-badges">
                    <span
                      v-if="node.meshInfo"
                      class="hl-mini-pill mono"
                      style="border-color: rgba(234, 179, 8, 0.45); color: #fde047;"
                    >
                      {{ node.meshInfo.role.toUpperCase() }}
                      <template v-if="node.meshInfo.lqi"> &middot; LQI {{ node.meshInfo.lqi }}</template>
                      <template v-if="node.meshInfo.batteryPercent"> &middot; {{ node.meshInfo.batteryPercent }}%</template>
                    </span>
                    <span
                      v-for="srv in node.services.slice(0, 2)"
                      :key="srv.port"
                      class="hl-mini-pill mono"
                    >
                      :{{ srv.port }} {{ srv.serviceName.slice(0, 10) }}
                    </span>
                    <span
                      v-if="childCountMap[node.id]"
                      class="hl-mini-pill mono"
                      style="border-color: rgba(34, 211, 238, 0.45); color: #22d3ee;"
                    >
                      {{ childCountMap[node.id] }} Nested Guests
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Node Inspector Drawer -->
        <div v-if="selectedNode" class="col-4">
          <div class="panel">
            <div class="panel-header">
              <div>
                <div class="host-name-row">
                  <span
                    class="dot"
                    :class="selectedNode.status === 'online' ? 'dot-ok' : selectedNode.status === 'offline' ? 'dot-crit' : 'dot-warn'"
                  ></span>
                  <span class="panel-title">{{ selectedNode.name }}</span>
                </div>
                <div class="panel-subtitle mono" style="margin-top: 3px;">
                  {{ selectedNode.kind.toUpperCase() }} &middot; {{ selectedNode.ipAddress || 'No IP' }}
                </div>
              </div>
              <button class="btn btn-sm" type="button" @click="selectedNode = null">Close</button>
            </div>

            <div class="hl-inspector-grid mono">
              <div class="hl-insp-row">
                <span class="hl-insp-label">Status:</span>
                <span>{{ selectedNode.status.toUpperCase() }} ({{ selectedNode.statusDetail || 'Checked' }})</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">Hostname:</span>
                <span>{{ selectedNode.hostname || '-' }}</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">MAC / IEEE:</span>
                <span>{{ selectedNode.macAddress || '-' }}</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">Vendor:</span>
                <span>{{ selectedNode.manufacturer || '-' }}</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">OS / Firmware:</span>
                <span>{{ selectedNode.osOrFirmware || '-' }}</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">Health Check:</span>
                <span>{{ selectedNode.healthCheck.method.toUpperCase() }} {{ selectedNode.healthCheck.target || '' }}</span>
              </div>
              <div class="hl-insp-row">
                <span class="hl-insp-label">Coordinates:</span>
                <span>X={{ selectedNode.x }}, Y={{ selectedNode.y }}</span>
              </div>
            </div>

            <!-- Parent Proxmox / NVR Host Link (When Inspecting a Nested VM / LXC / Camera) -->
            <div v-if="selectedNodeParentHost" style="margin-top: 12px;">
              <div class="field-label">
                {{ selectedNodeParentHost.kind === 'nvr' ? 'Connected to CCTV NVR Chassis' : 'Mounted Inside Proxmox Rack Chassis' }}
              </div>
              <div
                class="hl-srv-row mono"
                style="cursor: pointer; border-color: rgba(251, 191, 36, 0.45);"
                @click="selectNode(selectedNodeParentHost)"
              >
                <span style="color: #fbbf24; font-weight: 700;">
                  &larr; {{ selectedNodeParentHost.name }} ({{ selectedNodeParentHost.ipAddress }})
                </span>
                <span class="pill pill-cyan">Host</span>
              </div>
            </div>

            <!-- Nested CCTV Cameras (When Inspecting an NVR Node) -->
            <div
              v-if="selectedNode.kind === 'nvr' && (nvrCamerasByHostId[selectedNode.id] || []).length > 0"
              style="margin-top: 12px;"
            >
              <div class="field-label">
                Nested CCTV Channels ({{ (nvrCamerasByHostId[selectedNode.id] || []).length }})
              </div>
              <div style="max-height: 190px; overflow-y: auto;">
                <div
                  v-for="cam in nvrCamerasByHostId[selectedNode.id]"
                  :key="cam.id"
                  class="hl-srv-row mono"
                  style="cursor: pointer;"
                  @click="selectNvrNestedCamera(selectedNode, cam)"
                >
                  <span>
                    <span
                      class="dot"
                      :class="cam.status === 'online' ? 'dot-ok' : 'dot-crit'"
                      style="margin-right: 5px;"
                    ></span>
                    <strong>CH{{ cam.channelNum < 10 ? '0' + cam.channelNum : cam.channelNum }}</strong> &middot; {{ cam.name }}
                  </span>
                  <span style="color: #94a3b8; font-size: 10px;">{{ cam.telemetryLabel }}</span>
                </div>
              </div>
            </div>

            <!-- Nested Proxmox Rack Guests (When Inspecting a Proxmox Hypervisor Node) -->
            <div
              v-if="selectedNode.kind === 'proxmox' && (proxmoxGuestsByHostId[selectedNode.id] || []).length > 0"
              style="margin-top: 12px;"
            >
              <div class="field-label">
                Nested Rack Guests ({{ (proxmoxGuestsByHostId[selectedNode.id] || []).length }} Bays)
              </div>
              <div style="max-height: 190px; overflow-y: auto;">
                <div
                  v-for="g in proxmoxGuestsByHostId[selectedNode.id]"
                  :key="g.id"
                  class="hl-srv-row mono"
                  style="cursor: pointer;"
                  @click="selectProxmoxNestedGuest(selectedNode, g)"
                >
                  <span>
                    <span
                      class="dot"
                      :class="g.status === 'online' ? 'dot-ok' : 'dot-crit'"
                      style="margin-right: 5px;"
                    ></span>
                    <strong>#{{ g.vmid || g.uSlot }}</strong> &middot; {{ g.kind.toUpperCase() }} &middot; {{ g.name }}
                  </span>
                  <span style="color: #94a3b8; font-size: 10px;">{{ g.telemetryLabel }}</span>
                </div>
              </div>
            </div>

            <!-- Managed Switch Live SSH / Telnet Poller & 28-Port Telemetry (When Inspecting a Switch Node) -->
            <div v-if="selectedNode.kind === 'switch'" style="margin-top: 12px;">
              <div class="field-label">
                Managed Switch CLI &amp; 28-Port Telemetry (SSH / Telnet / HTTP)
              </div>
              <div
                class="mono"
                style="padding: 8px 10px; background: #090e18; border: 1px solid #1e2d47; border-radius: 4px; font-size: 11px;"
              >
                <div style="display: flex; flex-direction: row; align-items: center; margin-bottom: 6px;">
                  <select
                    v-model="inspectorSwitchForm.modelPreset"
                    class="select mono"
                    style="flex: 1; margin-right: 6px; min-height: 30px; font-size: 11px;"
                  >
                    <option value="T1600G-28TS">TP-Link T1600G-28TS (24G + 4x SFP)</option>
                    <option value="T1600G-28PS">TP-Link T1600G-28PS (24x PoE+ 192W + 4x SFP)</option>
                    <option value="auto">Auto-Detect via SSH / Telnet / HTTP</option>
                    <option value="T2600G-28TS">TP-Link T2600G-28TS</option>
                    <option value="TL-SG3428">TP-Link Omada TL-SG3428</option>
                    <option value="TL-SG2428P">TP-Link Omada TL-SG2428P (PoE+)</option>
                    <option value="CISCO-28P">Cisco SG300-28 / CBS350-24</option>
                    <option value="UBIQUITI-24P">Ubiquiti USW-24-PoE / EdgeSwitch</option>
                    <option value="MIKROTIK-CRS326">MikroTik CRS326-24G-2S+RM</option>
                  </select>
                  <select
                    v-model="inspectorSwitchForm.protocol"
                    class="select mono"
                    style="width: 96px; min-height: 30px; font-size: 11px;"
                  >
                    <option value="auto">Auto CLI</option>
                    <option value="ssh">SSH :22</option>
                    <option value="telnet">Telnet :23</option>
                    <option value="snmp">SNMP :161</option>
                    <option value="http">HTTP :80</option>
                  </select>
                </div>

                <div style="display: flex; flex-direction: row; align-items: center; margin-bottom: 6px;">
                  <input
                    v-model="inspectorSwitchForm.username"
                    class="input mono"
                    type="text"
                    placeholder="User (admin)"
                    style="flex: 1; margin-right: 6px; min-height: 30px; font-size: 11px;"
                  />
                  <input
                    v-model="inspectorSwitchForm.password"
                    class="input mono"
                    type="password"
                    :placeholder="selectedNode.switchMeta && selectedNode.switchMeta.hasPassword ? 'Saved (leave blank to keep)' : 'SSH / Telnet Password'"
                    style="flex: 1; min-height: 30px; font-size: 11px;"
                  />
                </div>

                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  style="width: 100%;"
                  :disabled="probingSwitchCli"
                  @click="probeSwitchFromTopology(selectedNode)"
                >
                  {{ probingSwitchCli ? 'Polling Switch via SSH / Telnet...' : 'Poll Switch Live (SSH / Telnet / HTTP)' }}
                </button>

                <div
                  v-if="selectedNode.switchMeta && selectedNode.switchMeta.ports.length > 0"
                  style="max-height: 170px; overflow-y: auto; margin-top: 8px; border-top: 1px solid #1b2840; padding-top: 6px;"
                >
                  <div
                    v-for="p in selectedNode.switchMeta.ports"
                    :key="`insp-sw-p-${p.portNumber}`"
                    class="hl-srv-row mono"
                    style="padding: 4px 7px; margin-bottom: 3px; font-size: 10.5px;"
                  >
                    <span>
                      <span
                        class="dot"
                        :class="p.linkStatus === 'up' ? 'dot-ok' : 'dot-crit'"
                        style="margin-right: 4px;"
                      ></span>
                      <strong>{{ p.name }}</strong>
                      <span style="color: #64748b;"> ({{ p.media.toUpperCase() }})</span>
                      <template v-if="p.connectedDeviceName"> &rarr; <strong style="color: #22d3ee;">{{ p.connectedDeviceName }}</strong></template>
                      <template v-else-if="p.connectedMac"> &middot; {{ p.connectedMac }}</template>
                    </span>
                    <span>
                      <span :style="{ color: p.linkStatus === 'up' ? '#34d399' : '#64748b' }">
                        {{ p.linkStatus === 'up' ? p.speed : 'DOWN' }}
                      </span>
                      <span v-if="p.poeActive" style="color: #c084fc; margin-left: 5px;">
                        PoE {{ p.poeWatts || 0 }}W
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Open Services -->
            <div v-if="selectedNode.services.length > 0" style="margin-top: 12px;">
              <div class="field-label">Detected Services ({{ selectedNode.services.length }})</div>
              <div v-for="s in selectedNode.services" :key="s.port" class="hl-srv-row mono">
                <span>:{{ s.port }}/{{ s.protocol }} &mdash; {{ s.serviceName }}</span>
                <a v-if="s.url" :href="s.url" target="_blank" class="pill pill-cyan">Open &nearr;</a>
              </div>
            </div>

            <!-- Connected Links -->
            <div v-if="selectedNodeLinks.length > 0" style="margin-top: 12px;">
              <div class="field-label">Topology Links ({{ selectedNodeLinks.length }})</div>
              <div v-for="l in selectedNodeLinks" :key="l.id" class="hl-srv-row mono">
                <span>{{ l.label }} ({{ l.kind.toUpperCase() }})</span>
                <button class="btn btn-sm btn-danger" type="button" @click="confirmDeleteLink(l)">
                  Unlink
                </button>
              </div>
            </div>

            <div class="btn-group" style="margin-top: 14px;">
              <button class="btn btn-sm btn-primary" type="button" @click="openNodeModal(selectedNode)">
                Edit Node
              </button>
              <button class="btn btn-sm" type="button" @click="openNodeDoc(selectedNode)">
                Open Wiki Doc
              </button>
              <button
                v-if="selectedNode.linkedSourceKind"
                class="btn btn-sm"
                type="button"
                @click="jumpToNativeIntegration(selectedNode)"
              >
                Open Console &rarr;
              </button>
              <button class="btn btn-sm btn-danger" type="button" @click="removeNode(selectedNode)">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SUB-TAB 2: PHYSICAL RACK CANVAS (SIDE-BY-SIDE RACKS + BEZIER PATCHING)  -->
    <!-- ======================================================================= -->
    <div v-else-if="activeSubTab === 'racks'">
      <RackStudioCanvas
        :racks="state.racks"
        :nodes="state.nodes"
        :discovery-queue="state.discoveryQueue"
        :overview="overview"
        @updated="loadTopologyState"
        @import-links="syncFromRackPanel"
        @save-racks="onSaveRackStudio"
        @reset-racks="promptReset('racks')"
        @navigate="$emit('navigate', $event)"
        @toast="$emit('toast', $event)"
      />
    </div>

    <!-- ======================================================================= -->
    <!-- SUB-TAB 3: NETWORK SCANNER, SERVICE FINGERPRINTING & MESH IMPORTERS     -->
    <!-- ======================================================================= -->
    <div v-else-if="activeSubTab === 'scanner'">
      <div class="rack-row">
        <!-- Subnet Scanner -->
        <div class="col-6">
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Automated Subnet Scanner &amp; Service Fingerprinting</span>
              <span class="pill pill-cyan mono">ARP + TCP FINGERPRINT</span>
            </div>
            <div class="panel-subtitle" style="margin-bottom: 12px;">
              Sweeps your target /24 subnet &amp; local ARP table, probes common homelab TCP ports (SSH, HTTP/S, RTSP, Proxmox :8006, Home Assistant :8123, Zigbee2MQTT :8080, Z-Wave JS :8091, Ollama AI :11434), guesses device types, and queues discoveries for 1-tap approval.
            </div>
            <div class="hl-inline-form">
              <input
                v-model="scanSubnetInput"
                class="input mono"
                type="text"
                placeholder="Auto (192.168.1.0/24, 192.168.0.0/24, 10/8, 172.16/12, 192.168/16)"
                style="max-width: 260px; margin-right: 8px;"
              />
              <button
                class="btn btn-primary"
                type="button"
                :disabled="scanning"
                @click="runSubnetScan"
              >
                {{ scanning ? 'Scanning Subnet...' : 'Scan Subnet Now' }}
              </button>
            </div>
          </div>
        </div>

        <!-- One-Click Smart Home Mesh & Hypervisor Importers -->
        <div class="col-6">
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Wireless Mesh &amp; Platform Topology Importers</span>
              <span class="pill pill-violet mono">1-CLICK IMPORT</span>
            </div>
            <div class="panel-subtitle" style="margin-bottom: 12px;">
              Import your Proxmox VE clusters (with nested VMs/LXCs), Hikvision NVR &amp; PoE cameras, Zigbee2MQTT mesh routers/sensors, Z-Wave JS nodes, or Unraid containers directly onto your topology map.
            </div>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" type="button" @click="syncFromRackPanel">
                Import Proxmox / OPNsense / Hikvision
              </button>
              <button class="btn btn-sm" type="button" @click="importExternalMesh('zigbee2mqtt')">
                + Zigbee2MQTT Mesh
              </button>
              <button class="btn btn-sm" type="button" @click="importExternalMesh('zwave-js')">
                + Z-Wave JS Mesh
              </button>
              <button class="btn btn-sm" type="button" @click="importExternalMesh('unraid')">
                + Unraid Containers
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Managed Network Switches notice (managed in dedicated Switches tab to avoid duplication) -->
      <div class="panel" style="margin-bottom: 14px; display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px;">
        <div>
          <span class="panel-title">Managed Network Switches</span>
          <div class="panel-subtitle" style="margin-top: 2px;">
            Switches are added, polled, and monitored in the dedicated <strong>Switches</strong> tab and automatically appear here in Topology &amp; Rack Builder.
          </div>
        </div>
        <button type="button" class="btn btn-primary" @click="$emit('navigate', 'switches')">
          Open Switches &rarr;
        </button>
      </div>

      <!-- Routing & Config Analyzer (BGP, OSPF, Static Routes, VLANs, HA / LACP) -->
      <div class="panel" style="margin-bottom: 14px;">
        <div class="panel-header">
          <div>
            <span class="panel-title">Routing &amp; Config Analyzer (BGP / OSPF / Routes / VLANs / HA)</span>
            <div class="panel-subtitle" style="margin-top: 2px;">
              Paste <span class="mono">show ip route</span>, <span class="mono">show ip bgp summary</span>, <span class="mono">show ip ospf neighbor</span>, <span class="mono">show vlan brief</span>, or <span class="mono">show running-config</span> to map L3 paths, peers, and redundancy.
            </div>
          </div>
          <span class="pill pill-violet mono">L2 + L3 ANALYSIS</span>
        </div>

        <div class="hl-inline-form" style="margin-bottom: 8px;">
          <select
            v-model="routingAnalyzeForm.nodeId"
            class="select mono"
            style="max-width: 280px; margin-right: 8px;"
          >
            <option value="">Auto-select Firewall / Router / Switch</option>
            <option v-for="n in canvasNodes" :key="`ra-${n.id}`" :value="n.id">
              [{{ n.kind.toUpperCase() }}] {{ n.name }} ({{ n.ipAddress || '-' }})
            </option>
          </select>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="analyzingRouting || !routingAnalyzeForm.rawConfigOrRoutes.trim()"
            @click="runRoutingAnalysis"
          >
            {{ analyzingRouting ? 'Analyzing...' : 'Analyze & Map Routes' }}
          </button>
        </div>

        <textarea
          v-model="routingAnalyzeForm.rawConfigOrRoutes"
          class="input mono"
          rows="4"
          placeholder="Paste BGP / OSPF / routing table / VLAN / VRRP / CARP / LACP output here..."
          style="width: 100%; font-size: 11.5px; resize: vertical;"
        ></textarea>
      </div>

      <!-- Discovery Review Queue Table -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">
            Discovered Devices Queue ({{ state.discoveryQueue.length }})
          </span>
          <span class="panel-subtitle">
            Approve any discovered device to place it onto your active topology canvas and auto-generate its Markdown wiki page
          </span>
        </div>

        <div v-if="state.discoveryQueue.length === 0" class="panel-subtitle" style="padding: 18px 0;">
          No devices in the discovery queue yet. Enter a subnet above (e.g. <span class="mono">192.168.0.0/24</span> or <span class="mono">172.16.0.0/24</span>) and tap <strong>Scan Subnet Now</strong>.
        </div>

        <div v-else class="table-scroll">
          <table class="rack-table">
            <thead>
              <tr>
                <th>IPv4 Address</th>
                <th>Hostname</th>
                <th>MAC / Vendor</th>
                <th>Guessed Role</th>
                <th>Fingerprinted Open Services</th>
                <th>State</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in state.discoveryQueue" :key="d.id">
                <td class="mono" style="font-weight: 800; color: #22d3ee;">{{ d.ipAddress }}</td>
                <td class="mono">{{ d.hostname }}</td>
                <td class="mono">
                  <div>{{ d.vendor || 'Unknown Vendor' }}</div>
                  <div v-if="d.macAddress" style="font-size: 11px; color: #64748b;">{{ d.macAddress }}</div>
                </td>
                <td>
                  <span class="pill pill-cyan mono">{{ d.guessedKind.toUpperCase() }}</span>
                </td>
                <td>
                  <span
                    v-for="p in d.openPorts"
                    :key="p.port"
                    class="pill pill-muted mono"
                    style="margin-right: 4px; margin-bottom: 3px; font-size: 11px;"
                  >
                    :{{ p.port }} {{ p.serviceName }}
                  </span>
                  <span v-if="d.openPorts.length === 0" class="mono" style="color: #64748b;">ARP Neighbor</span>
                </td>
                <td>
                  <span class="pill" :class="d.approved ? 'pill-ok' : 'pill-warn'">
                    {{ d.approved ? 'ON CANVAS' : 'PENDING' }}
                  </span>
                </td>
                <td style="text-align: right;">
                  <button
                    class="btn btn-sm btn-primary"
                    type="button"
                    @click="approveDiscovery(d.id)"
                  >
                    {{ d.approved ? 'Re-Sync to Canvas' : 'Approve & Map' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SUB-TAB 4: IPAM INVENTORY & LIVE MULTI-PROTOCOL HEALTH MONITOR          -->
    <!-- ======================================================================= -->
    <div v-else-if="activeSubTab === 'ipam'">
      <div class="panel">
        <div class="panel-header">
          <div>
            <span class="panel-title">IPAM Address Table &amp; Live Healthcheck Matrix ({{ filteredIpamNodes.length }})</span>
            <div class="panel-subtitle">
              Real-time ICMP Ping, TCP Port, HTTP/HTTPS, SSH Banner, and Prometheus status tracking across all canvases
            </div>
          </div>
          <div class="hl-inline-form">
            <input
              v-model="ipamSearch"
              class="input"
              type="text"
              placeholder="Filter by IP, hostname, VLAN, role..."
              style="max-width: 260px; margin-right: 8px;"
            />
            <button class="btn btn-sm btn-primary" type="button" :disabled="healthRunning" @click="triggerHealthChecks">
              {{ healthRunning ? 'Probing...' : 'Run All Checks' }}
            </button>
          </div>
        </div>

        <div class="table-scroll">
          <table class="rack-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Device Name</th>
                <th>Role</th>
                <th>IPv4 / MAC</th>
                <th>VLAN</th>
                <th>Health Method</th>
                <th>Latency / Detail</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in filteredIpamNodes" :key="n.id">
                <td>
                  <span
                    class="pill"
                    :class="n.status === 'online' ? 'pill-ok' : n.status === 'offline' ? 'pill-crit' : 'pill-warn'"
                  >
                    <span
                      class="dot"
                      :class="n.status === 'online' ? 'dot-ok' : n.status === 'offline' ? 'dot-crit' : 'dot-warn'"
                    ></span>
                    {{ n.status.toUpperCase() }}
                  </span>
                </td>
                <td style="font-weight: 700; color: #f8fafc;">
                  {{ n.name }}
                  <div class="mono" style="font-size: 11px; color: #64748b;">{{ n.osOrFirmware || n.manufacturer }}</div>
                </td>
                <td>
                  <span class="pill pill-cyan mono">{{ n.kind.toUpperCase() }}</span>
                </td>
                <td class="mono">
                  <div style="color: #22d3ee; font-weight: 700;">{{ n.ipAddress || '-' }}</div>
                  <div v-if="n.macAddress" style="font-size: 11px; color: #64748b;">{{ n.macAddress }}</div>
                </td>
                <td class="mono">
                  <span v-if="n.vlan" class="pill pill-violet mono">VLAN {{ n.vlan }}</span>
                  <span v-else style="color: #64748b;">-</span>
                </td>
                <td class="mono">
                  {{ n.healthCheck.method.toUpperCase() }}
                  <span v-if="n.healthCheck.target" style="color: #94a3b8;">({{ n.healthCheck.target }})</span>
                </td>
                <td class="mono">
                  <span v-if="n.latencyMs !== null" style="color: #34d399; font-weight: 700;">{{ n.latencyMs }}ms</span>
                  <span v-if="n.statusDetail" style="margin-left: 6px; color: #94a3b8; font-size: 11px;">
                    {{ n.statusDetail }}
                  </span>
                </td>
                <td style="text-align: right;">
                  <div class="btn-group" style="justify-content: flex-end;">
                    <button class="btn btn-sm" type="button" @click="openNodeModal(n)">Edit</button>
                    <button class="btn btn-sm" type="button" @click="openNodeDoc(n)">Wiki</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SUB-TAB 5: MARKDOWN WIKI, VERSION HISTORY, GIT SYNC & MCP / HACS        -->
    <!-- ======================================================================= -->
    <div v-else-if="activeSubTab === 'docs'">
      <div class="rack-row">
        <!-- Left Sidebar: Document Tree, Search, Git Sync & MCP/HACS Info -->
        <div class="col-4 stack-col">
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Documentation Tree ({{ state.docs.length }})</span>
              <button class="btn btn-sm btn-primary" type="button" @click="startNewDoc">
                + New Page
              </button>
            </div>

            <input
              v-model="docSearch"
              class="input"
              type="text"
              placeholder="Full-text wiki search..."
              style="margin-bottom: 10px;"
            />

            <div
              v-for="doc in filteredDocs"
              :key="doc.id"
              class="hl-doc-nav-item"
              :class="{ active: activeDoc && activeDoc.id === doc.id }"
              @click="selectDoc(doc)"
            >
              <div>
                <span class="mono" style="color: #22d3ee; margin-right: 6px; font-size: 11px;">{{ doc.icon }}</span>
                <span style="font-weight: 700; color: #f8fafc;">{{ doc.title }}</span>
                <span v-if="doc.isHome" class="pill pill-ok mono" style="margin-left: 6px; font-size: 9px;">HOME</span>
              </div>
              <div class="mono" style="font-size: 11px; color: #64748b; margin-top: 2px;">
                {{ doc.revisions.length }} rev &middot; {{ formatDocTime(doc.updatedAt) }}
              </div>
            </div>
          </div>

          <!-- Git Backup & Sync Panel (Topology v3.7 Feature) -->
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Git Backup &amp; Export</span>
              <span class="pill pill-ok mono">v3.7 SYNC</span>
            </div>
            <div class="panel-subtitle" style="margin-bottom: 10px;">
              Export all topology canvases (JSON + SVG diagrams), physical rack elevations, and Markdown wiki pages into a Git-ready directory.
            </div>
            <button
              class="btn btn-sm btn-primary"
              type="button"
              :disabled="gitSyncing"
              @click="triggerGitSync"
            >
              {{ gitSyncing ? 'Exporting...' : 'Export Schemas, SVGs & Wiki to Git' }}
            </button>
            <div v-if="state.gitSync.lastSyncMessage" class="mono" style="font-size: 11px; color: #34d399; margin-top: 8px;">
              {{ state.gitSync.lastSyncMessage }}
            </div>
          </div>

          <!-- AI MCP Server & Home Assistant HACS Panel -->
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">AI MCP Server &amp; Home Assistant</span>
              <span class="pill pill-cyan mono">JSON-RPC 2.0</span>
            </div>
            <div class="panel-subtitle" style="line-height: 1.55;">
              <div>
                <strong>MCP Endpoint:</strong> <span class="mono">POST /api/topology/mcp</span>
              </div>
              <div style="margin-top: 4px;">
                Exposes <span class="mono">rackpanel_get_topology</span>, <span class="mono">rackpanel_get_racks</span>, <span class="mono">rackpanel_search_docs</span>, and <span class="mono">rackpanel_upsert_node</span> for Claude / AI assistants.
              </div>
              <div style="margin-top: 6px;">
                <strong>Home Assistant Panel:</strong> Embed <span class="mono">http://&lt;rack-panel-ip&gt;:3840/topology</span> as a Home Assistant sidebar panel (<span class="mono">panel_custom</span> / <span class="mono">webpage</span> dashboard).
              </div>
            </div>
          </div>
        </div>

        <!-- Right Main Document Viewer / Markdown Editor with [[Wiki-Links]] & Revisions -->
        <div class="col-8">
          <div v-if="activeDoc" class="panel">
            <div class="panel-header">
              <div>
                <div class="host-name-row">
                  <span class="mono" style="color: #22d3ee; font-weight: 800; margin-right: 8px;">
                    {{ activeDoc.icon }}
                  </span>
                  <span class="panel-title" style="font-size: 18px;">{{ activeDoc.title }}</span>
                </div>
                <div class="panel-subtitle mono" style="margin-top: 4px;">
                  Slug: /wiki/{{ activeDoc.slug }} &middot; Updated {{ formatDocTime(activeDoc.updatedAt) }}
                </div>
              </div>
              <div class="btn-group">
                <button
                  class="btn btn-sm"
                  :class="{ 'btn-primary': !editingDocMode }"
                  type="button"
                  @click="editingDocMode = false"
                >
                  Reader View
                </button>
                <button
                  class="btn btn-sm"
                  :class="{ 'btn-primary': editingDocMode }"
                  type="button"
                  @click="startEditActiveDoc"
                >
                  Edit Markdown
                </button>
                <button
                  v-if="!activeDoc.isHome"
                  class="btn btn-sm btn-danger"
                  type="button"
                  @click="removeDoc(activeDoc)"
                >
                  Delete
                </button>
              </div>
            </div>

            <!-- Markdown Editor Mode -->
            <div v-if="editingDocMode">
              <div class="rack-row">
                <div class="col-2">
                  <div class="field">
                    <label class="field-label">Icon Tag</label>
                    <input v-model="docForm.icon" class="input mono" type="text" placeholder="[DOC]" />
                  </div>
                </div>
                <div class="col-7">
                  <div class="field">
                    <label class="field-label">Page Title</label>
                    <input v-model="docForm.title" class="input" type="text" placeholder="Document Title" />
                  </div>
                </div>
                <div class="col-3">
                  <div class="field">
                    <label class="field-label">Attached Node</label>
                    <select v-model="docForm.nodeId" class="select">
                      <option value="">None (Global)</option>
                      <option v-for="n in state.nodes" :key="n.id" :value="n.id">{{ n.name }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="field">
                <label class="field-label">
                  Markdown Content (Use <span class="mono">[[Device Name]]</span> for bi-directional wiki-links)
                </label>
                <textarea
                  v-model="docForm.content"
                  class="textarea mono"
                  rows="14"
                  placeholder="# Heading..."
                ></textarea>
              </div>

              <div class="hl-inline-form">
                <input
                  v-model="docForm.revisionSummary"
                  class="input"
                  type="text"
                  placeholder="Revision note (e.g. Updated VLAN table)"
                  style="max-width: 320px; margin-right: 8px;"
                />
                <button class="btn btn-primary" type="button" @click="saveDocForm">
                  Save Wiki Page
                </button>
              </div>
            </div>

            <!-- Rendered Markdown Reader View with Interactive [[Wiki-Links]] -->
            <div v-else>
              <!-- Attached Hardware Node Quick-Jump Banner -->
              <div v-if="attachedDocNode" class="hl-doc-node-banner" @click="jumpToCanvasNode(attachedDocNode)">
                <div>
                  <span
                    class="dot"
                    :class="attachedDocNode.status === 'online' ? 'dot-ok' : 'dot-crit'"
                  ></span>
                  <strong>Attached Topology Node:</strong> {{ attachedDocNode.name }}
                  <span class="mono" style="color: #22d3ee; margin-left: 8px;">
                    {{ attachedDocNode.ipAddress }}
                  </span>
                </div>
                <span class="pill pill-cyan mono">Locate on Canvas &rarr;</span>
              </div>

              <!-- Rendered Markdown Blocks -->
              <div class="hl-markdown-body" @click="onMarkdownBodyClick" v-html="renderedMarkdownHtml"></div>

              <!-- Bi-Directional Backlinks Footer -->
              <div v-if="docBacklinks.length > 0" class="hl-doc-backlinks">
                <div class="field-label">Bi-Directional Backlinks ({{ docBacklinks.length }})</div>
                <div class="btn-group">
                  <button
                    v-for="bl in docBacklinks"
                    :key="bl.id"
                    type="button"
                    class="btn btn-sm"
                    @click="selectDoc(bl)"
                  >
                    {{ bl.icon }} {{ bl.title }}
                  </button>
                </div>
              </div>

              <!-- Version History & Revisions -->
              <div v-if="activeDoc.revisions.length > 0" class="hl-doc-revisions">
                <div class="field-label">Revision History ({{ activeDoc.revisions.length }})</div>
                <div v-for="rev in activeDoc.revisions.slice(0, 5)" :key="rev.id" class="hl-rev-row mono">
                  <span>{{ rev.summary }}</span>
                  <span style="color: #64748b;">{{ formatDocTime(rev.timestamp) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- MODAL: ADD / EDIT TOPOLOGY NODE                                         -->
    <!-- ======================================================================= -->
    <UiDialog
      :open="nodeModalOpen"
      :title="nodeForm.id ? 'Edit Topology Node' : 'Add Topology Topology Node'"
      @close="nodeModalOpen = false"
    >
      <div class="rack-row">
        <div class="col-7">
          <div class="field">
            <label class="field-label">Device / Node Name</label>
            <input v-model="nodeForm.name" class="input" type="text" placeholder="e.g. Core 10G Switch" />
          </div>
        </div>
        <div class="col-5">
          <div class="field">
            <label class="field-label">Node Type (19 Topology Kinds)</label>
            <select v-model="nodeForm.kind" class="select">
              <option value="isp">ISP / WAN Uplink</option>
              <option value="router">Router</option>
              <option value="firewall">Firewall (OPNsense / pfSense)</option>
              <option value="switch">Managed Switch</option>
              <option value="ap">Wi-Fi Access Point</option>
              <option value="proxmox">Proxmox VE Hypervisor</option>
              <option value="server">Linux / Bare-Metal Server</option>
              <option value="vm">Virtual Machine (QEMU)</option>
              <option value="lxc">LXC Container</option>
              <option value="docker">Docker Host / Container</option>
              <option value="nas">NAS / ZFS Storage</option>
              <option value="nvr">Hikvision NVR / DVR</option>
              <option value="camera">IP Camera (PoE / RTSP)</option>
              <option value="ai">AI / LLM GPU Server</option>
              <option value="iot">Smart Home / Home Assistant</option>
              <option value="zigbee">Zigbee2MQTT Device</option>
              <option value="zwave">Z-Wave JS Device</option>
              <option value="electric">UPS / Smart PDU / Power</option>
              <option value="generic">Generic Network Device</option>
            </select>
          </div>
        </div>

        <div class="col-5">
          <div class="field">
            <label class="field-label">IPv4 / Hostname</label>
            <input v-model="nodeForm.ipAddress" class="input mono" type="text" placeholder="192.168.0.10" />
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="field-label">MAC / Zigbee IEEE</label>
            <input v-model="nodeForm.macAddress" class="input mono" type="text" placeholder="BC:24:11:00:10:01" />
          </div>
        </div>
        <div class="col-3">
          <div class="field">
            <label class="field-label">VLAN ID</label>
            <input v-model.number="nodeForm.vlan" class="input mono" type="number" placeholder="10" />
          </div>
        </div>

        <div class="col-6">
          <div class="field">
            <label class="field-label">Manufacturer / Hardware</label>
            <input v-model="nodeForm.manufacturer" class="input" type="text" placeholder="Supermicro / Ubiquiti / Hikvision" />
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="field-label">OS / Firmware Version</label>
            <input v-model="nodeForm.osOrFirmware" class="input" type="text" placeholder="Proxmox VE 8.2 / V4.61.025" />
          </div>
        </div>

        <div class="col-5">
          <div class="field">
            <label class="field-label">Health Check Protocol</label>
            <select v-model="nodeForm.healthMethod" class="select">
              <option value="auto">Auto (TCP + ICMP Ping)</option>
              <option value="ping">ICMP Ping</option>
              <option value="tcp">Custom TCP Port</option>
              <option value="http">HTTP Endpoint</option>
              <option value="https">HTTPS Endpoint</option>
              <option value="ssh">SSH Banner Check</option>
              <option value="prometheus">Prometheus /metrics</option>
              <option value="none">Disabled</option>
            </select>
          </div>
        </div>
        <div class="col-7">
          <div class="field">
            <label class="field-label">Health Check Target (Port or URL)</label>
            <input
              v-model="nodeForm.healthTarget"
              class="input mono"
              type="text"
              placeholder="e.g. 8006 or https://192.168.0.1/api/health"
            />
          </div>
        </div>

        <div class="col-4">
          <div class="field">
            <label class="field-label">Canvas X</label>
            <input v-model.number="nodeForm.x" class="input mono" type="number" />
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="field-label">Canvas Y</label>
            <input v-model.number="nodeForm.y" class="input mono" type="number" />
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="field-label">Parent Hypervisor / Router</label>
            <select v-model="nodeForm.parentId" class="select">
              <option value="">None (Top-Level)</option>
              <option v-for="n in canvasNodes" :key="n.id" :value="n.id">{{ n.name }}</option>
            </select>
          </div>
        </div>
      </div>

      <template #footer>
        <UiButton @click="nodeModalOpen = false">Cancel</UiButton>
        <UiButton variant="primary" @click="saveNodeModal">
          {{ nodeForm.id ? 'Save Changes' : 'Create Node' }}
        </UiButton>
      </template>
    </UiDialog>

    <!-- ======================================================================= -->
    <!-- MODAL: LINK TWO NODES                                                   -->
    <!-- ======================================================================= -->
    <UiDialog :open="linkModalOpen" title="Connect Topology Nodes" @close="linkModalOpen = false">
      <div class="rack-row">
        <div class="col-6">
          <div class="field">
            <label class="field-label">Source Node</label>
            <select v-model="linkForm.sourceId" class="select">
              <option v-for="n in canvasNodes" :key="n.id" :value="n.id">{{ n.name }}</option>
            </select>
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="field-label">Target Node</label>
            <select v-model="linkForm.targetId" class="select">
              <option v-for="n in canvasNodes" :key="n.id" :value="n.id">{{ n.name }}</option>
            </select>
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="field-label">Connection Medium</label>
            <select v-model="linkForm.kind" class="select">
              <option value="ethernet">Ethernet (Cat6 / Cat6A)</option>
              <option value="dac">10G/25G SFP+ DAC</option>
              <option value="fiber">Optical Fiber (OM4 / OS2)</option>
              <option value="poe">PoE / PoE+ Feed</option>
              <option value="virtual">Virtual Bridge (vmbr / veth)</option>
              <option value="wifi">Wi-Fi Wireless</option>
              <option value="zigbee">Zigbee Mesh Link</option>
              <option value="zwave">Z-Wave Mesh Link</option>
              <option value="vpn">WireGuard / Tailscale Tunnel</option>
            </select>
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="field-label">Link Label (Speed / Ports / VLAN)</label>
            <input v-model="linkForm.label" class="input mono" type="text" placeholder="10G SFP+ Trunk (VLAN 10)" />
          </div>
        </div>
      </div>

      <template #footer>
        <UiButton @click="linkModalOpen = false">Cancel</UiButton>
        <UiButton variant="primary" @click="saveLinkModal">Create Link</UiButton>
      </template>
    </UiDialog>

    <!-- ======================================================================= -->
    <!-- MODAL: AUTO-LAYOUT & NETWORK DISCOVERY OPTIONS                          -->
    <!-- ======================================================================= -->
    <UiDialog
      :open="autoLayoutModalOpen"
      title="Auto-Layout &amp; Network Sync"
      @close="autoLayoutModalOpen = false"
    >
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0 0 12px 0;">
        Choose which actions to run on the current topology canvas:
      </p>

      <div style="display: flex; flex-direction: column;">
        <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
          <input v-model="autoLayoutOpts.cleanLayout" type="checkbox" style="margin-right: 10px;" />
          <span>
            <strong style="color: #f8fafc;">Clean up layout positions</strong>
            <span style="display: block; font-size: 12px; color: #94a3b8;">
              Arrange nodes into clean hierarchical tiers (ISP &rarr; Firewall/Router &rarr; Switches/APs &rarr; Servers)
            </span>
          </span>
        </label>

        <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
          <input v-model="autoLayoutOpts.autoRouteWires" type="checkbox" style="margin-right: 10px;" />
          <span>
            <strong style="color: #f8fafc;">Auto-route wires based on discovery</strong>
            <span style="display: block; font-size: 12px; color: #94a3b8;">
              Match MAC tables, ARP, LLDP/CDP neighbors, SNMP &amp; switch ports to wire connected nodes
            </span>
          </span>
        </label>

        <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
          <input v-model="autoLayoutOpts.pullDiscovered" type="checkbox" style="margin-right: 10px;" />
          <span>
            <strong style="color: #f8fafc;">Automatically pull in discovered devices across the network</strong>
            <span style="display: block; font-size: 12px; color: #94a3b8;">
              Sync configured RACK//PANEL gear and scan the local subnet for newly discovered devices
            </span>
          </span>
        </label>

        <div v-if="autoLayoutOpts.pullDiscovered" style="margin: 0 0 10px 24px;">
          <input
            v-model="autoLayoutOpts.subnet"
            class="input font-mono"
            type="text"
            placeholder="Optional subnet (auto-detect, e.g. 192.168.1.0/24)"
          />
        </div>

        <label class="topo-check-row" style="margin-bottom: 6px; cursor: pointer;">
          <input v-model="autoLayoutOpts.deduplicateNodes" type="checkbox" style="margin-right: 10px;" />
          <span>
            <strong style="color: #f8fafc;">Deduplicate &amp; normalize nodes</strong>
            <span style="display: block; font-size: 12px; color: #94a3b8;">
              Merge duplicate IP/MAC entries and clean up node metadata
            </span>
          </span>
        </label>
      </div>

      <template #footer>
        <UiButton :disabled="autoLayoutRunning" @click="autoLayoutModalOpen = false">Cancel</UiButton>
        <UiButton
          :disabled="
            autoLayoutRunning ||
            (!autoLayoutOpts.cleanLayout &&
              !autoLayoutOpts.autoRouteWires &&
              !autoLayoutOpts.pullDiscovered &&
              !autoLayoutOpts.deduplicateNodes)
          "
          @click="executeAutoLayout(false)"
        >
          {{ autoLayoutRunning ? 'Running...' : 'Run Selected' }}
        </UiButton>
        <UiButton variant="primary" :disabled="autoLayoutRunning" @click="executeAutoLayout(true)">
          {{ autoLayoutRunning ? 'Running...' : 'All' }}
        </UiButton>
      </template>
    </UiDialog>

    <!-- ======================================================================= -->
    <!-- MODAL: CONFIRM RESET CANVAS / RACK BUILDER                              -->
    <!-- ======================================================================= -->
    <UiDialog
      :open="Boolean(resetTargetScope)"
      :title="
        resetTargetScope === 'canvas'
          ? 'Reset Topology Canvas'
          : resetTargetScope === 'racks'
            ? 'Reset Physical Rack Builder'
            : 'Reset Topology Canvas & Rack Builder'
      "
      @close="resetTargetScope = null"
    >
      <div v-if="resetTargetScope === 'canvas'">
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0 0 12px 0;">
          Choose what to reset on the current topology canvas:
        </p>
        <div style="display: flex; flex-direction: column;">
          <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
            <input v-model="resetCanvasOpts.resetWires" type="checkbox" style="margin-right: 10px;" />
            <span>
              <strong style="color: #f8fafc;">Reset wires / links</strong>
              <span style="display: block; font-size: 12px; color: #94a3b8;">
                Clear all wires connecting nodes on this canvas
              </span>
            </span>
          </label>
          <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
            <input v-model="resetCanvasOpts.resetCustomNodes" type="checkbox" style="margin-right: 10px;" />
            <span>
              <strong style="color: #f8fafc;">Reset custom / unlinked nodes</strong>
              <span style="display: block; font-size: 12px; color: #94a3b8;">
                Remove unlinked custom nodes while keeping configured gear, provisioned switches &amp; rack-mounted devices
              </span>
            </span>
          </label>
          <label class="topo-check-row" style="margin-bottom: 8px; cursor: pointer;">
            <input v-model="resetCanvasOpts.resetAllNodes" type="checkbox" style="margin-right: 10px;" />
            <span>
              <strong style="color: #f8fafc;">Reset all canvas nodes to configured defaults</strong>
              <span style="display: block; font-size: 12px; color: #94a3b8;">
                Rebuild canvas nodes from RACK//PANEL configured devices (preserves provisioned switches &amp; rack gear)
              </span>
            </span>
          </label>
          <label class="topo-check-row" style="margin-bottom: 6px; cursor: pointer;">
            <input v-model="resetCanvasOpts.resetDiscovery" type="checkbox" style="margin-right: 10px;" />
            <span>
              <strong style="color: #f8fafc;">Clear discovery queue</strong>
              <span style="display: block; font-size: 12px; color: #94a3b8;">
                Remove pending discovered devices from the discovery queue
              </span>
            </span>
          </label>
        </div>
      </div>
      <p v-else style="color: #cbd5e1; font-size: 14px; line-height: 1.55; margin: 0;">
        {{
          resetTargetScope === 'racks'
            ? 'Reset the Physical Rack Builder back to only the real devices configured in RACK//PANEL? Custom rack mounts and patch cables will be cleared.'
            : 'Reset both the Topology Canvas and Physical Rack Builder back to only the real devices configured in RACK//PANEL?'
        }}
      </p>
      <template #footer>
        <UiButton :disabled="resetting" @click="resetTargetScope = null">Cancel</UiButton>
        <template v-if="resetTargetScope === 'canvas'">
          <UiButton
            variant="danger"
            :disabled="
              resetting ||
              (!resetCanvasOpts.resetWires &&
                !resetCanvasOpts.resetCustomNodes &&
                !resetCanvasOpts.resetAllNodes &&
                !resetCanvasOpts.resetDiscovery)
            "
            @click="executeReset(false)"
          >
            {{ resetting ? 'Resetting...' : 'Reset Selected' }}
          </UiButton>
          <UiButton variant="danger" :disabled="resetting" @click="executeReset(true)">
            {{ resetting ? 'Resetting...' : 'Reset All Canvas' }}
          </UiButton>
        </template>
        <UiButton v-else variant="danger" :disabled="resetting" @click="executeReset(false)">
          {{ resetting ? 'Resetting...' : 'Confirm Reset' }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import type {
  TopologyDocPage,
  TopologyHealthCheckMethod,
  TopologyLink,
  TopologyLinkKind,
  TopologyNode,
  TopologyNodeKind,
  TopologyRackSlotItem,
  TopologyState,
  OverviewResponse,
} from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import RackStudioCanvas from '@/components/RackStudioCanvas.vue';
import DeviceIconSvg from '@/components/DeviceIconSvg.vue';

type TopologySubTab = 'canvas' | 'racks' | 'scanner' | 'ipam' | 'docs';

export default defineComponent({
  name: 'TopologyView',
  components: { UiDialog, UiButton, RackStudioCanvas, DeviceIconSvg },
  props: {
    overview: { type: Object as () => OverviewResponse | null, default: null },
    initialSubTab: { type: String as () => TopologySubTab, default: 'racks' },
  },
  setup(props, { emit }) {
    const activeSubTab = ref<TopologySubTab>(props.initialSubTab || 'racks');
    const state = ref<TopologyState>({
      canvases: [],
      nodes: [],
      links: [],
      racks: [],
      discoveryQueue: [],
      docs: [],
      gitSync: {
        repoPathOrUrl: '',
        branch: 'main',
        autoCommit: false,
      },
      shareEnabled: true,
      sharePasswordProtected: false,
    });

    const selectedCanvasId = ref('');
    const selectedNode = ref<TopologyNode | null>(null);
    const hoveredNodeId = ref('');
    const zoom = ref(1);
    const panX = ref(0);
    const panY = ref(0);

    const creatingCanvas = ref(false);
    const newCanvasName = ref('');
    const newCanvasDesc = ref('');

    const healthRunning = ref(false);
    const syncingOverview = ref(false);
    const scanning = ref(false);
    const scanSubnetInput = ref('');
    const ipamSearch = ref('');
    const resetTargetScope = ref<'all' | 'canvas' | 'racks' | null>(null);
    const resetting = ref(false);

    // Physical Rack state
    const selectedRackId = ref('');
    const creatingRack = ref(false);
    const addingRackItem = ref(false);
    const addingPatch = ref(false);
    const newRack = reactive({ name: '', widthInches: 19 as 19 | 10, totalU: 42 });
    const newRackItem = reactive({
      name: '',
      kind: 'server' as TopologyRackSlotItem['kind'],
      startU: 20,
      heightU: 1,
      ipAddress: '',
    });
    const newPatch = reactive({
      fromItemId: '',
      fromPort: 'Port 1',
      toItemId: '',
      toPort: 'LAN1',
      cableKind: 'cat6a' as 'cat6' | 'cat6a' | 'fiber-om4' | 'dac-sfp+' | 'poe' | 'coax',
      label: '10G Trunk',
    });

    // Wiki state
    const docSearch = ref('');
    const activeDocId = ref('');
    const editingDocMode = ref(false);
    const gitSyncing = ref(false);
    const docForm = reactive({
      id: '',
      title: '',
      icon: '[DOC]',
      nodeId: '',
      content: '',
      revisionSummary: '',
    });

    // Modals
    const nodeModalOpen = ref(false);
    const nodeForm = reactive({
      id: '',
      name: '',
      kind: 'server' as TopologyNodeKind,
      ipAddress: '',
      macAddress: '',
      vlan: null as number | null,
      manufacturer: '',
      osOrFirmware: '',
      healthMethod: 'auto' as TopologyHealthCheckMethod,
      healthTarget: '',
      x: 240,
      y: 200,
      parentId: '',
    });

    const linkModalOpen = ref(false);
    const linkForm = reactive({
      sourceId: '',
      targetId: '',
      kind: 'ethernet' as TopologyLinkKind,
      label: '1GbE Link',
    });

    function pad2(n: number): string {
      return n < 10 ? `0${n}` : `${n}`;
    }

    async function loadTopologyState() {
      try {
        const res = await api.getTopologyState();
        applyState(res);
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to load Topology topology',
          error: true,
        });
      }
    }

    function applyState(next: TopologyState) {
      state.value = next;
      if (!selectedCanvasId.value && next.canvases.length > 0) {
        selectedCanvasId.value = next.canvases[0].id;
      }
      if (!selectedRackId.value && next.racks.length > 0) {
        selectedRackId.value = next.racks[0].id;
      }
      if (!activeDocId.value && next.docs.length > 0) {
        const home = next.docs.find((d) => d.isHome) || next.docs[0];
        activeDocId.value = home.id;
      }
      if (selectedNode.value) {
        selectedNode.value = next.nodes.find((n) => n.id === selectedNode.value!.id) || null;
      }
    }

    function setSubTab(sub: TopologySubTab) {
      activeSubTab.value = sub;
      emit('change-sub-tab', sub);
    }

    watch(
      () => props.initialSubTab,
      (v) => {
        if (v && v !== activeSubTab.value) activeSubTab.value = v;
      },
    );

    const canvasNodes = computed(() =>
      state.value.nodes.filter((n) => n.canvasId === selectedCanvasId.value),
    );

    const collapsedProxmoxHosts = reactive<Record<string, boolean>>({});
    const collapsedNvrHosts = reactive<Record<string, boolean>>({});

    function toggleProxmoxRackCollapse(hostNodeId: string) {
      collapsedProxmoxHosts[hostNodeId] = !collapsedProxmoxHosts[hostNodeId];
    }

    function toggleNvrRackCollapse(nvrNodeId: string) {
      collapsedNvrHosts[nvrNodeId] = !collapsedNvrHosts[nvrNodeId];
    }

    const proxmoxHostIdSet = computed<Set<string>>(() => {
      const set = new Set<string>();
      for (const n of canvasNodes.value) {
        if (n.kind === 'proxmox') set.add(n.id);
      }
      return set;
    });

    const nvrHostIdSet = computed<Set<string>>(() => {
      const set = new Set<string>();
      for (const n of canvasNodes.value) {
        if (n.kind === 'nvr') set.add(n.id);
      }
      return set;
    });

    function isNestedProxmoxGuest(node: TopologyNode): boolean {
      return (
        (node.kind === 'lxc' || node.kind === 'vm') &&
        Boolean(node.parentId && proxmoxHostIdSet.value.has(node.parentId))
      );
    }

    function isNestedNvrCamera(node: TopologyNode): boolean {
      return (
        node.kind === 'camera' &&
        Boolean(node.parentId && nvrHostIdSet.value.has(node.parentId))
      );
    }

    // Top-level draggable canvas nodes (excludes nested Proxmox VMs/LXCs and nested NVR CCTV cameras)
    const topLevelCanvasNodes = computed(() =>
      canvasNodes.value.filter((n) => !isNestedProxmoxGuest(n) && !isNestedNvrCamera(n)),
    );

    interface ProxmoxNestedGuestSlot {
      id: string;
      vmid: number;
      uSlot: number;
      kind: 'lxc' | 'vm';
      name: string;
      status: 'online' | 'offline';
      telemetryLabel: string;
      nodeObj: TopologyNode;
    }

    const proxmoxGuestsByHostId = computed<Record<string, ProxmoxNestedGuestSlot[]>>(() => {
      const map: Record<string, ProxmoxNestedGuestSlot[]> = {};
      const pveHosts = canvasNodes.value.filter((n) => n.kind === 'proxmox');

      for (const hostNode of pveHosts) {
        const guestByVmidOrName = new Map<string, ProxmoxNestedGuestSlot>();

        // 1) Synced child TopologyNodes (parentId === hostNode.id)
        const syncedChildren = canvasNodes.value.filter(
          (n) => n.parentId === hostNode.id && (n.kind === 'lxc' || n.kind === 'vm'),
        );
        for (const child of syncedChildren) {
          const vmidTag = child.tags.find((t) => t.startsWith('vmid-'));
          const vmidFromTag = vmidTag ? parseInt(vmidTag.replace('vmid-', ''), 10) : 0;
          const vmidMatch = child.name.match(/\b(\d{3,5})\b/);
          const vmid = vmidFromTag || (vmidMatch ? parseInt(vmidMatch[1], 10) : 0);
          const cleanName = child.name
            .replace(/^(LXC|QEMU|VM)\s+\d+\s*[·:-]\s*/i, '')
            .trim();
          const key = vmid ? `vmid:${vmid}` : `name:${cleanName.toLowerCase()}`;
          guestByVmidOrName.set(key, {
            id: child.id,
            vmid,
            uSlot: 1,
            kind: child.kind === 'vm' ? 'vm' : 'lxc',
            name: cleanName || child.hostname || child.name,
            status: child.status === 'online' ? 'online' : 'offline',
            telemetryLabel: child.status === 'online' ? 'RUN' : 'STOP',
            nodeObj: child,
          });
        }

        // 2) Live telemetry from props.overview?.proxmox (enriches CPU/RAM telemetry & populates guests immediately even before manual sync)
        if (props.overview && Array.isArray(props.overview.proxmox)) {
          const matchedPveSnap = props.overview.proxmox.find(
            (p) =>
              !p.isDemo &&
              ((hostNode.linkedSourceId && p.configId === hostNode.linkedSourceId) ||
                (hostNode.ipAddress && p.host.toLowerCase() === hostNode.ipAddress.toLowerCase()) ||
                p.name.toLowerCase() === hostNode.name.toLowerCase() ||
                p.nodes.some(
                  (pn) =>
                    (pn.ipAddress && hostNode.ipAddress && pn.ipAddress.toLowerCase() === hostNode.ipAddress.toLowerCase()) ||
                    pn.node.toLowerCase() === (hostNode.hostname || hostNode.name).toLowerCase(),
                )),
          );
          if (matchedPveSnap) {
            for (const g of matchedPveSnap.guests) {
              if (g.template) continue;
              const key = `vmid:${g.vmid}`;
              const existing =
                guestByVmidOrName.get(key) ||
                guestByVmidOrName.get(`name:${g.name.trim().toLowerCase()}`);
              const cpuPct = `${Math.round(g.cpuPercent || 0)}%`;
              const memGb = g.memMaxBytes
                ? `${(g.memUsedBytes / (1024 * 1024 * 1024)).toFixed(1)}G`
                : '';
              const liveStatus: 'online' | 'offline' = g.status === 'running' ? 'online' : 'offline';
              const telemetryLabel =
                g.status === 'running' ? `${cpuPct}${memGb ? ' · ' + memGb : ''}` : 'STOP';

              if (existing) {
                existing.vmid = g.vmid;
                existing.status = liveStatus;
                existing.telemetryLabel = telemetryLabel;
                existing.nodeObj = {
                  ...existing.nodeObj,
                  status: liveStatus,
                  statusDetail: `${g.type.toUpperCase()} #${g.vmid} · ${g.cpus} vCPU · ${telemetryLabel}`,
                };
              } else {
                const syntheticNode: TopologyNode = {
                  id: `pve-guest-${hostNode.id}-${g.vmid}`,
                  canvasId: hostNode.canvasId,
                  name: `${g.type.toUpperCase()} ${g.vmid} · ${g.name}`,
                  kind: g.type === 'qemu' ? 'vm' : 'lxc',
                  x: hostNode.x,
                  y: hostNode.y,
                  ipAddress: hostNode.ipAddress,
                  macAddress: '',
                  hostname: g.name,
                  parentId: hostNode.id,
                  linkedSourceKind: 'proxmox',
                  linkedSourceId: matchedPveSnap.configId,
                  tags: [g.type, `vmid-${g.vmid}`, g.node],
                  services: [],
                  healthCheck: { method: 'none', intervalSec: 60 },
                  status: liveStatus,
                  latencyMs: null,
                  lastCheckedAt: Date.now(),
                  statusDetail: `${g.type.toUpperCase()} #${g.vmid} on ${g.node} (${g.cpus} vCPU · ${telemetryLabel})`,
                  createdAt: hostNode.createdAt,
                };
                guestByVmidOrName.set(key, {
                  id: syntheticNode.id,
                  vmid: g.vmid,
                  uSlot: 1,
                  kind: g.type === 'qemu' ? 'vm' : 'lxc',
                  name: g.name,
                  status: liveStatus,
                  telemetryLabel,
                  nodeObj: syntheticNode,
                });
              }
            }
          }
        }

        const sorted = Array.from(guestByVmidOrName.values()).sort(
          (a, b) => (a.vmid || 9999) - (b.vmid || 9999),
        );
        sorted.forEach((item, idx) => {
          item.uSlot = idx + 1;
        });
        map[hostNode.id] = sorted;
      }

      return map;
    });

    const selectedNodeParentHost = computed<TopologyNode | null>(() => {
      if (!selectedNode.value || !selectedNode.value.parentId) return null;
      return (
        canvasNodes.value.find(
          (n) =>
            n.id === selectedNode.value!.parentId &&
            (n.kind === 'proxmox' || n.kind === 'nvr'),
        ) || null
      );
    });

    function selectProxmoxNestedGuest(_hostNode: TopologyNode, guest: ProxmoxNestedGuestSlot) {
      selectedNode.value = guest.nodeObj;
    }

    interface NvrNestedCameraSlot {
      id: string;
      channelNum: number;
      name: string;
      poePort: number | null;
      status: 'online' | 'offline';
      telemetryLabel: string;
      nodeObj: TopologyNode;
    }

    const nvrCamerasByHostId = computed<Record<string, NvrNestedCameraSlot[]>>(() => {
      const map: Record<string, NvrNestedCameraSlot[]> = {};
      const nvrs = canvasNodes.value.filter((n) => n.kind === 'nvr');

      for (const nvrNode of nvrs) {
        const camByChOrName = new Map<string, NvrNestedCameraSlot>();

        const syncedCams = canvasNodes.value.filter(
          (n) => n.parentId === nvrNode.id && n.kind === 'camera',
        );
        for (const child of syncedCams) {
          const chMatch = child.name.match(/CH0?(\d+)/i);
          const chNum = chMatch ? parseInt(chMatch[1], 10) : 0;
          const cleanName = child.name.replace(/^CH\d+\s*[·:-]\s*/i, '').trim();
          const poeTag = child.tags.find((t) => t.startsWith('poe-'));
          const poePort = poeTag ? parseInt(poeTag.replace('poe-', ''), 10) : null;
          const key = chNum ? `ch:${chNum}` : `name:${cleanName.toLowerCase()}`;
          camByChOrName.set(key, {
            id: child.id,
            channelNum: chNum,
            name: cleanName || child.name,
            poePort,
            status: child.status === 'online' ? 'online' : 'offline',
            telemetryLabel: child.status === 'online' ? 'LIVE' : 'OFF',
            nodeObj: child,
          });
        }

        if (props.overview && Array.isArray(props.overview.hikvision)) {
          const matchedHik = props.overview.hikvision.find(
            (h) =>
              !h.isDemo &&
              ((nvrNode.linkedSourceId && h.configId === nvrNode.linkedSourceId) ||
                (nvrNode.ipAddress && h.host.toLowerCase() === nvrNode.ipAddress.toLowerCase())),
          );
          if (matchedHik) {
            for (const ch of matchedHik.channels) {
              const key = `ch:${ch.id}`;
              const existing =
                camByChOrName.get(key) ||
                camByChOrName.get(`name:${ch.name.trim().toLowerCase()}`);
              const liveStatus: 'online' | 'offline' = ch.online ? 'online' : 'offline';
              const telemetryLabel = ch.online
                ? `${ch.codec || 'H264'}${ch.resolution ? ' · ' + ch.resolution : ''}`
                : 'OFFLINE';

              if (existing) {
                existing.channelNum = ch.id;
                existing.poePort = ch.poePort;
                existing.status = liveStatus;
                existing.telemetryLabel = telemetryLabel;
                existing.nodeObj = {
                  ...existing.nodeObj,
                  status: liveStatus,
                  ipAddress: ch.ipAddress || existing.nodeObj.ipAddress,
                  osOrFirmware: `${ch.codec} ${ch.resolution} @ ${ch.fps}fps`,
                };
              } else {
                const syntheticCam: TopologyNode = {
                  id: `nvr-cam-${nvrNode.id}-${ch.id}`,
                  canvasId: nvrNode.canvasId,
                  name: `CH${ch.id < 10 ? '0' + ch.id : ch.id} · ${ch.name}`,
                  kind: 'camera',
                  x: nvrNode.x,
                  y: nvrNode.y,
                  ipAddress: ch.ipAddress || '',
                  macAddress: '',
                  hostname: ch.name,
                  parentId: nvrNode.id,
                  manufacturer: 'Hikvision',
                  osOrFirmware: `${ch.codec} ${ch.resolution} @ ${ch.fps}fps`,
                  linkedSourceKind: 'hikvision',
                  linkedSourceId: matchedHik.configId,
                  tags: ['camera', `ch-${ch.id}`, ...(ch.poePort ? [`poe-${ch.poePort}`] : [])],
                  services: [],
                  healthCheck: { method: 'none', intervalSec: 60 },
                  status: liveStatus,
                  latencyMs: null,
                  lastCheckedAt: Date.now(),
                  statusDetail: `${ch.poePort ? `PoE #${ch.poePort} · ` : ''}${telemetryLabel}`,
                  createdAt: nvrNode.createdAt,
                };
                camByChOrName.set(key, {
                  id: syntheticCam.id,
                  channelNum: ch.id,
                  name: ch.name,
                  poePort: ch.poePort,
                  status: liveStatus,
                  telemetryLabel,
                  nodeObj: syntheticCam,
                });
              }
            }
          }
        }

        const sorted = Array.from(camByChOrName.values()).sort(
          (a, b) => (a.channelNum || 999) - (b.channelNum || 999),
        );
        sorted.forEach((c, idx) => {
          if (!c.channelNum) c.channelNum = idx + 1;
        });
        map[nvrNode.id] = sorted;
      }

      return map;
    });

    function selectNvrNestedCamera(_nvrNode: TopologyNode, cam: NvrNestedCameraSlot) {
      selectedNode.value = cam.nodeObj;
    }

    const canvasLinks = computed(() =>
      state.value.links.filter((l) => l.canvasId === selectedCanvasId.value),
    );

    const onlineCanvasCount = computed(() =>
      topLevelCanvasNodes.value.filter((n) => n.status === 'online').length,
    );

    const pendingDiscoveriesCount = computed(() =>
      state.value.discoveryQueue.filter((d) => !d.approved).length,
    );

    const childCountMap = computed<Record<string, number>>(() => {
      const counts: Record<string, number> = {};
      for (const n of canvasNodes.value) {
        if (n.parentId) {
          counts[n.parentId] = (counts[n.parentId] || 0) + 1;
        }
      }
      return counts;
    });

    const stageTransformStyle = computed(() => ({
      transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
      transformOrigin: '0 0',
    }));

    const svgExportUrl = computed(() =>
      selectedCanvasId.value ? api.getTopologySvgExportUrl(selectedCanvasId.value) : '#',
    );

    const sharedMacGroups = computed(() => {
      const groups = new Map<string, TopologyNode[]>();
      for (const n of topLevelCanvasNodes.value) {
        const mac = (n.macAddress || '').trim().toUpperCase().replace(/-/g, ':');
        if (!mac || mac === '-') continue;
        const list = groups.get(mac) ?? [];
        list.push(n);
        groups.set(mac, list);
      }
      const out: Array<{ mac: string; count: number; x: number; y: number; width: number; height: number }> = [];
      for (const [mac, list] of groups.entries()) {
        if (list.length < 2) continue;
        const distinctIps = new Set(list.map((n) => (n.ipAddress || '').trim().toLowerCase()).filter(Boolean));
        if (distinctIps.size < 2) continue;

        let minX = Infinity;
        let minY = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        for (const n of list) {
          const w = n.kind === 'proxmox' || n.kind === 'nvr' ? 316 : n.kind === 'switch' ? 304 : 204;
          const h = n.kind === 'proxmox' || n.kind === 'nvr' ? 140 : n.kind === 'switch' ? 115 : 96;
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x + w > maxR) maxR = n.x + w;
          if (n.y + h > maxB) maxB = n.y + h;
        }
        out.push({
          mac,
          count: distinctIps.size,
          x: minX - 18,
          y: minY - 26,
          width: Math.max(120, maxR - minX + 36),
          height: Math.max(90, maxB - minY + 44),
        });
      }
      return out;
    });

    const canvasStageEl = ref<HTMLElement | null>(null);
    const measuredNodeDims = ref<Record<string, { w: number; h: number }>>({});

    function measureCanvasNodes() {
      const stage = canvasStageEl.value;
      if (!stage) return;
      const els = stage.querySelectorAll<HTMLElement>('[data-node-id]');
      const next: Record<string, { w: number; h: number }> = {};
      els.forEach((el) => {
        const id = el.getAttribute('data-node-id');
        if (id && el.offsetWidth > 0 && el.offsetHeight > 0) {
          next[id] = { w: el.offsetWidth, h: el.offsetHeight };
        }
      });
      measuredNodeDims.value = next;
    }

    watch(
      () => [topLevelCanvasNodes.value.length, canvasLinks.value.length, activeSubTab.value],
      () => {
        void nextTick(() => measureCanvasNodes());
      },
      { immediate: true },
    );

    const renderedEdges = computed(() => {
      const map = new Map<string, TopologyNode>();
      for (const n of topLevelCanvasNodes.value) map.set(n.id, n);
      const nodeDims = (n: TopologyNode) => {
        const measured = measuredNodeDims.value[n.id];
        if (measured) return measured;
        if (n.kind === 'proxmox' || n.kind === 'nvr') {
          const children = childCountMap.value[n.id] || 0;
          return { w: 316, h: Math.max(140, 115 + Math.min(8, children) * 34) };
        }
        if (n.kind === 'switch') return { w: 304, h: 112 };
        return { w: 204, h: 96 };
      };
      const pad = 16;
      const obstacles = topLevelCanvasNodes.value.map((n) => {
        const d = nodeDims(n);
        return { id: n.id, x1: n.x - pad, y1: n.y - pad, x2: n.x + d.w + pad, y2: n.y + d.h + pad };
      });

      const segHitsBox = (ax: number, ay: number, bx: number, by: number, b: { x1: number; y1: number; x2: number; y2: number }) => {
        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        return maxX > b.x1 && minX < b.x2 && maxY > b.y1 && minY < b.y2;
      };

      const countHits = (pts: Array<[number, number]>, srcId: string, dstId: string): number => {
        let hits = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          for (const box of obstacles) {
            if (box.id === srcId || box.id === dstId) continue;
            if (segHitsBox(ax, ay, bx, by, box)) hits++;
          }
        }
        return hits;
      };

      const MIN_LINE_GAP = 44;
      const usedHoriz: Array<{ y: number; x1: number; x2: number }> = [];
      const usedVert: Array<{ x: number; y1: number; y2: number }> = [];

      const countLineProximity = (pts: Array<[number, number]>): number => {
        let penalty = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          if (ay === by) {
            const minX = Math.min(ax, bx) - 12;
            const maxX = Math.max(ax, bx) + 12;
            for (const h of usedHoriz) {
              if (Math.abs(h.y - ay) < MIN_LINE_GAP && maxX >= h.x1 && minX <= h.x2) {
                penalty += 1;
              }
            }
          } else if (ax === bx) {
            const minY = Math.min(ay, by) - 12;
            const maxY = Math.max(ay, by) + 12;
            for (const v of usedVert) {
              if (Math.abs(v.x - ax) < MIN_LINE_GAP && maxY >= v.y1 && minY <= v.y2) {
                penalty += 1;
              }
            }
          }
        }
        return penalty;
      };

      // Pre-collect links per node side and sort by peer coordinate so wires never cross on exit/entry
      const sideLinksList = new Map<string, Array<{ linkId: string; peerCoord: number }>>();
      const linkSides: Array<{ sSide: 'top' | 'bottom' | 'left' | 'right'; tSide: 'top' | 'bottom' | 'left' | 'right'; verticalDominant: boolean }> = [];
      for (const link of canvasLinks.value) {
        const s = map.get(link.sourceId);
        const t = map.get(link.targetId);
        if (!s || !t) {
          linkSides.push({ sSide: 'bottom', tSide: 'top', verticalDominant: true });
          continue;
        }
        const sd = nodeDims(s);
        const td = nodeDims(t);
        const scx = s.x + sd.w / 2;
        const scy = s.y + sd.h / 2;
        const tcx = t.x + td.w / 2;
        const tcy = t.y + td.h / 2;
        const dx = tcx - scx;
        const dy = tcy - scy;
        const verticalDominant = Math.abs(dy) >= Math.abs(dx);
        const sSide = verticalDominant ? (dy >= 0 ? 'bottom' : 'top') : dx >= 0 ? 'right' : 'left';
        const tSide = verticalDominant ? (dy >= 0 ? 'top' : 'bottom') : dx >= 0 ? 'left' : 'right';

        const sKey = `${s.id}:${sSide}`;
        const tKey = `${t.id}:${tSide}`;
        const sArr = sideLinksList.get(sKey) ?? [];
        sArr.push({ linkId: link.id, peerCoord: sSide === 'top' || sSide === 'bottom' ? tcx : tcy });
        sideLinksList.set(sKey, sArr);

        const tArr = sideLinksList.get(tKey) ?? [];
        tArr.push({ linkId: link.id, peerCoord: tSide === 'top' || tSide === 'bottom' ? scx : scy });
        sideLinksList.set(tKey, tArr);

        linkSides.push({ sSide, tSide, verticalDominant });
      }
      for (const arr of sideLinksList.values()) {
        arr.sort((a, b) => a.peerCoord - b.peerCoord);
      }

      const nextPortCoord = (node: TopologyNode, side: 'top' | 'bottom' | 'left' | 'right', linkId: string): [number, number] => {
        const d = nodeDims(node);
        const arr = sideLinksList.get(`${node.id}:${side}`) || [];
        const total = Math.max(1, arr.length);
        const idxOnSide = Math.max(0, arr.findIndex((x) => x.linkId === linkId));
        const maxSpan = (side === 'top' || side === 'bottom' ? d.w : d.h) - 20;
        const step = total > 1 ? Math.min(44, maxSpan / (total - 1)) : 0;
        const offset = Math.round((idxOnSide - (total - 1) / 2) * step);
        if (side === 'top') return [Math.round(node.x + d.w / 2 + offset), Math.round(node.y)];
        if (side === 'bottom') return [Math.round(node.x + d.w / 2 + offset), Math.round(node.y + d.h)];
        if (side === 'left') return [Math.round(node.x), Math.round(node.y + d.h / 2 + offset)];
        return [Math.round(node.x + d.w), Math.round(node.y + d.h / 2 + offset)];
      };

      const list: Array<{
        link: TopologyLink;
        path: string;
        mx: number;
        my: number;
        color: string;
        dashed: boolean;
      }> = [];
      for (let idx = 0; idx < canvasLinks.value.length; idx++) {
        const link = canvasLinks.value[idx];
        const s = map.get(link.sourceId);
        const t = map.get(link.targetId);
        if (!s || !t) continue;
        const { sSide, tSide, verticalDominant } = linkSides[idx];
        const [sx, sy] = nextPortCoord(s, sSide, link.id);
        const [tx, ty] = nextPortCoord(t, tSide, link.id);

        const candidates: Array<{ pts: Array<[number, number]>; mx: number; my: number }> = [];
        const laneShifts = [0, 44, -44, 88, -88, 132, -132, 176, -176];
        if (verticalDominant) {
          const baseMidY = Math.round((sy + ty) / 2);
          const midYs: number[] = laneShifts.map((sh) => baseMidY + sh);
          for (const box of obstacles) {
            if (box.id === s.id || box.id === t.id) continue;
            midYs.push(Math.round(box.y1 - 16), Math.round(box.y2 + 16));
          }
          for (const my of midYs) {
            candidates.push({
              pts: [
                [sx, sy],
                [sx, my],
                [tx, my],
                [tx, ty],
              ],
              mx: Math.round((sx + tx) / 2),
              my,
            });
          }
        } else {
          const baseMidX = Math.round((sx + tx) / 2);
          const midXs: number[] = laneShifts.map((sh) => baseMidX + sh);
          for (const box of obstacles) {
            if (box.id === s.id || box.id === t.id) continue;
            midXs.push(Math.round(box.x1 - 16), Math.round(box.x2 + 16));
          }
          for (const mx of midXs) {
            candidates.push({
              pts: [
                [sx, sy],
                [mx, sy],
                [mx, ty],
                [tx, ty],
              ],
              mx,
              my: Math.round((sy + ty) / 2),
            });
          }
        }

        // Also try corridor detour routes above/below or left/right if direct orthogonal paths hit an obstacle
        const clearYTop = Math.min(...obstacles.map((b) => b.y1)) - 24 - idx * 24;
        const clearYBot = Math.max(...obstacles.map((b) => b.y2)) + 24 + idx * 24;
        const clearXLeft = Math.min(...obstacles.map((b) => b.x1)) - 24 - idx * 24;
        const clearXRight = Math.max(...obstacles.map((b) => b.x2)) + 24 + idx * 24;
        candidates.push(
          {
            pts: [
              [sx, sy],
              [sx, clearYTop],
              [tx, clearYTop],
              [tx, ty],
            ],
            mx: Math.round((sx + tx) / 2),
            my: clearYTop,
          },
          {
            pts: [
              [sx, sy],
              [sx, clearYBot],
              [tx, clearYBot],
              [tx, ty],
            ],
            mx: Math.round((sx + tx) / 2),
            my: clearYBot,
          },
          {
            pts: [
              [sx, sy],
              [clearXLeft, sy],
              [clearXLeft, ty],
              [tx, ty],
            ],
            mx: clearXLeft,
            my: Math.round((sy + ty) / 2),
          },
          {
            pts: [
              [sx, sy],
              [clearXRight, sy],
              [clearXRight, ty],
              [tx, ty],
            ],
            mx: clearXRight,
            my: Math.round((sy + ty) / 2),
          },
        );

        let best = candidates[0];
        let bestScore = Infinity;
        for (const cand of candidates) {
          const hits = countHits(cand.pts, s.id, t.id);
          const prox = countLineProximity(cand.pts);
          let len = 0;
          for (let i = 0; i < cand.pts.length - 1; i++) {
            len += Math.abs(cand.pts[i + 1][0] - cand.pts[i][0]) + Math.abs(cand.pts[i + 1][1] - cand.pts[i][1]);
          }
          const score = hits * 100000 + prox * 10000 + len;
          if (score < bestScore) {
            bestScore = score;
            best = cand;
          }
        }

        for (let i = 0; i < best.pts.length - 1; i++) {
          const [ax, ay] = best.pts[i];
          const [bx, by] = best.pts[i + 1];
          if (ay === by) {
            usedHoriz.push({ y: ay, x1: Math.min(ax, bx), x2: Math.max(ax, bx) });
          } else if (ax === bx) {
            usedVert.push({ x: ax, y1: Math.min(ay, by), y2: Math.max(ay, by) });
          }
        }

        const path = best.pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px} ${py}`).join(' ');
        const mx = best.mx;
        const my = best.my;
        const color =
          link.kind === 'dac' || link.kind === 'fiber'
            ? '#22d3ee'
            : link.kind === 'zigbee'
              ? '#eab308'
              : link.kind === 'zwave'
                ? '#a78bfa'
                : link.kind === 'poe'
                  ? '#c084fc'
                  : link.kind === 'virtual'
                    ? '#34d399'
                    : '#38bdf8';
        list.push({
          link,
          path,
          mx,
          my,
          color,
          dashed: link.kind === 'virtual' || link.kind === 'zigbee' || link.kind === 'zwave' || link.kind === 'wifi',
        });
      }
      return list;
    });

    const selectedNodeLinks = computed(() => {
      if (!selectedNode.value) return [];
      const id = selectedNode.value.id;
      return canvasLinks.value.filter((l) => l.sourceId === id || l.targetId === id);
    });

    function isEdgeConnectedToHover(link: TopologyLink): boolean {
      if (!hoveredNodeId.value) return true;
      return link.sourceId === hoveredNodeId.value || link.targetId === hoveredNodeId.value;
    }

    function isNodeConnectedToHover(nodeId: string): boolean {
      if (!hoveredNodeId.value) return true;
      if (nodeId === hoveredNodeId.value) return true;
      return canvasLinks.value.some(
        (l) =>
          (l.sourceId === hoveredNodeId.value && l.targetId === nodeId) ||
          (l.targetId === hoveredNodeId.value && l.sourceId === nodeId),
      );
    }

    function kindBadge(kind: TopologyNodeKind): string {
      const labels: Record<TopologyNodeKind, string> = {
        isp: 'ISP / WAN',
        router: 'ROUTER',
        firewall: 'FIREWALL',
        switch: 'SWITCH',
        ap: 'WIFI AP',
        server: 'SERVER',
        proxmox: 'PROXMOX',
        vm: 'QEMU VM',
        lxc: 'LXC',
        docker: 'DOCKER',
        nas: 'NAS / ZFS',
        nvr: 'HIK NVR',
        camera: 'IP CAM',
        ai: 'AI / LLM',
        iot: 'SMART IOT',
        zigbee: 'ZIGBEE',
        zwave: 'Z-WAVE',
        electric: 'UPS / PDU',
        rack: 'RACK',
        generic: 'DEVICE',
      };
      return labels[kind] || String(kind).toUpperCase();
    }

    function kindColor(kind: TopologyNodeKind): string {
      if (kind === 'firewall' || kind === 'nvr') return '#fb923c';
      if (kind === 'proxmox') return '#fbbf24';
      if (kind === 'ai' || kind === 'zwave') return '#c084fc';
      if (kind === 'nas' || kind === 'lxc') return '#34d399';
      if (kind === 'zigbee') return '#fde047';
      return '#22d3ee';
    }

    // ---- Dragging Nodes & Panning Canvas (Mouse + Touch Android 4.4 Safe) ----
    let dragMode: 'none' | 'pan' | 'node' = 'none';
    let draggedNode: TopologyNode | null = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragStartOriginX = 0;
    let dragStartOriginY = 0;
    let nodeMoved = false;

    function onNodeMouseDown(evt: MouseEvent, node: TopologyNode) {
      dragMode = 'node';
      draggedNode = node;
      nodeMoved = false;
      dragStartClientX = evt.clientX;
      dragStartClientY = evt.clientY;
      dragStartOriginX = node.x;
      dragStartOriginY = node.y;
    }

    function onNodeTouchStart(evt: TouchEvent, node: TopologyNode) {
      if (evt.touches.length !== 1) return;
      dragMode = 'node';
      draggedNode = node;
      nodeMoved = false;
      dragStartClientX = evt.touches[0].clientX;
      dragStartClientY = evt.touches[0].clientY;
      dragStartOriginX = node.x;
      dragStartOriginY = node.y;
    }

    function onCanvasMouseDown(evt: MouseEvent) {
      dragMode = 'pan';
      dragStartClientX = evt.clientX;
      dragStartClientY = evt.clientY;
      dragStartOriginX = panX.value;
      dragStartOriginY = panY.value;
    }

    function onCanvasTouchStart(evt: TouchEvent) {
      if (evt.touches.length !== 1) return;
      dragMode = 'pan';
      dragStartClientX = evt.touches[0].clientX;
      dragStartClientY = evt.touches[0].clientY;
      dragStartOriginX = panX.value;
      dragStartOriginY = panY.value;
    }

    function onCanvasMouseMove(evt: MouseEvent) {
      if (dragMode === 'none') return;
      const dx = evt.clientX - dragStartClientX;
      const dy = evt.clientY - dragStartClientY;
      if (dragMode === 'pan') {
        panX.value = dragStartOriginX + dx;
        panY.value = dragStartOriginY + dy;
      } else if (dragMode === 'node' && draggedNode) {
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) nodeMoved = true;
        draggedNode.x = Math.max(10, Math.round(dragStartOriginX + dx / zoom.value));
        draggedNode.y = Math.max(10, Math.round(dragStartOriginY + dy / zoom.value));
      }
    }

    function onCanvasTouchMove(evt: TouchEvent) {
      if (dragMode === 'none' || evt.touches.length !== 1) return;
      const dx = evt.touches[0].clientX - dragStartClientX;
      const dy = evt.touches[0].clientY - dragStartClientY;
      if (dragMode === 'pan') {
        panX.value = dragStartOriginX + dx;
        panY.value = dragStartOriginY + dy;
      } else if (dragMode === 'node' && draggedNode) {
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) nodeMoved = true;
        draggedNode.x = Math.max(10, Math.round(dragStartOriginX + dx / zoom.value));
        draggedNode.y = Math.max(10, Math.round(dragStartOriginY + dy / zoom.value));
      }
    }

    function finishDrag() {
      if (dragMode === 'node' && draggedNode && nodeMoved) {
        const moved = draggedNode;
        void api.updateTopologyNodePositions([{ id: moved.id, x: moved.x, y: moved.y }]);
      }
      dragMode = 'none';
      draggedNode = null;
    }

    function onCanvasMouseUp() {
      finishDrag();
    }

    function onCanvasTouchEnd() {
      finishDrag();
    }

    function adjustZoom(delta: number) {
      zoom.value = Math.max(0.45, Math.min(1.6, Math.round((zoom.value + delta) * 100) / 100));
    }

    function resetViewport() {
      zoom.value = 1;
      panX.value = 0;
      panY.value = 0;
    }

    function selectCanvas(id: string) {
      selectedCanvasId.value = id;
      selectedNode.value = null;
      resetViewport();
    }

    const analyzingRouting = ref(false);
    const routingAnalyzeForm = reactive({
      nodeId: '',
      rawConfigOrRoutes: '',
    });

    async function runRoutingAnalysis() {
      if (!routingAnalyzeForm.rawConfigOrRoutes.trim()) return;
      analyzingRouting.value = true;
      try {
        const res = await api.analyzeTopologyRouting({
          nodeId: routingAnalyzeForm.nodeId || undefined,
          canvasId: selectedCanvasId.value,
          rawConfigOrRoutes: routingAnalyzeForm.rawConfigOrRoutes,
        });
        applyState(res.state);
        emit('toast', {
          message: `Routing analysis: ${res.analysis.summaryText} (+${res.addedNodes} nodes, +${res.addedLinks} links)`,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Routing analysis failed',
          error: true,
        });
      } finally {
        analyzingRouting.value = false;
      }
    }

    const probingSwitchCli = ref(false);
    const switchCliForm = reactive({
      modelPreset: 'T1600G-28TS',
      host: '',
      protocol: 'auto' as 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp',
      username: 'admin',
      password: '',
    });

    // Per-switch isolated credentials for the Inspector drawer so changing one switch's password never affects another switch
    const switchCredsByNodeId = reactive<
      Record<string, { modelPreset: string; protocol: 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp'; username: string; password: string }>
    >({});
    const inspectorSwitchForm = reactive({
      modelPreset: 'T1600G-28TS',
      protocol: 'auto' as 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp',
      username: 'admin',
      password: '',
    });

    function getDefaultSwitchPortsForNode(node: TopologyNode) {
      if (node.switchMeta && Array.isArray(node.switchMeta.ports) && node.switchMeta.ports.length > 0) {
        return node.switchMeta.ports;
      }
      const isPoe = /28PS|2428P|POE/i.test(`${node.name} ${node.osOrFirmware || ''}`);
      const ports: Array<{
        portNumber: number;
        name: string;
        media: 'rj45' | 'sfp';
        linkStatus: 'up' | 'down' | 'disabled';
        speed: string;
        poeActive?: boolean;
        poeWatts?: number;
        connectedDeviceName?: string;
      }> = [];
      for (let i = 1; i <= 28; i++) {
        ports.push({
          portNumber: i,
          name: `Gi1/0/${i}`,
          media: i > 24 ? 'sfp' : 'rj45',
          linkStatus: 'down',
          speed: 'Down',
          poeActive: false,
          poeWatts: isPoe ? 0 : undefined,
        });
      }
      return ports;
    }

    function getSwitchPortRow(node: TopologyNode, rowKind: 'odd' | 'even' | 'sfp') {
      const all = getDefaultSwitchPortsForNode(node);
      if (rowKind === 'sfp') {
        return all.filter((p) => p.media === 'sfp');
      }
      const rj45s = all.filter((p) => p.media !== 'sfp');
      return rj45s.filter((p) => (rowKind === 'odd' ? p.portNumber % 2 === 1 : p.portNumber % 2 === 0));
    }

    function getSwitchActivePortCount(node: TopologyNode): number {
      return getDefaultSwitchPortsForNode(node).filter((p) => p.linkStatus === 'up').length;
    }

    function getSwitchTotalPortCount(node: TopologyNode): number {
      return getDefaultSwitchPortsForNode(node).length;
    }

    async function probeSwitchFromTopology(targetNode?: TopologyNode) {
      probingSwitchCli.value = true;
      try {
        const isTargetSwitch = Boolean(targetNode);
        const activeForm = isTargetSwitch ? inspectorSwitchForm : switchCliForm;
        if (targetNode) {
          switchCredsByNodeId[targetNode.id] = {
            modelPreset: inspectorSwitchForm.modelPreset,
            protocol: inspectorSwitchForm.protocol,
            username: inspectorSwitchForm.username,
            password: inspectorSwitchForm.password,
          };
        }
        const host = targetNode ? targetNode.ipAddress || '' : switchCliForm.host.trim();
        const preset =
          targetNode?.switchMeta?.model && activeForm.modelPreset === 'auto'
            ? targetNode.switchMeta.model
            : activeForm.modelPreset;
        const res = await api.probeTopologySwitch({
          host,
          name: targetNode?.name,
          protocol: activeForm.protocol,
          username: activeForm.username.trim() || 'admin',
          password: activeForm.password,
          modelPreset: preset,
          nodeId: targetNode?.id,
          canvasId: selectedCanvasId.value,
          mountInRack: true,
        });
        applyState(res.state);
        const updatedNode = res.state.nodes.find((n) => n.id === res.node.id) || res.node;
        selectedNode.value = updatedNode;
        if (updatedNode.kind === 'switch') {
          switchCredsByNodeId[updatedNode.id] = {
            modelPreset: updatedNode.switchMeta?.model || activeForm.modelPreset,
            protocol: activeForm.protocol,
            username: activeForm.username.trim() || 'admin',
            password: activeForm.password,
          };
        }
        if (activeSubTab.value === 'scanner') {
          setSubTab('canvas');
        }
        emit('toast', {
          message: res.probe.message,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Switch CLI probe failed',
          error: true,
        });
      } finally {
        probingSwitchCli.value = false;
      }
    }

    function selectNode(node: TopologyNode) {
      // Save current inspector switch form under previous node ID before switching
      if (selectedNode.value && selectedNode.value.kind === 'switch') {
        switchCredsByNodeId[selectedNode.value.id] = {
          modelPreset: inspectorSwitchForm.modelPreset,
          protocol: inspectorSwitchForm.protocol,
          username: inspectorSwitchForm.username,
          password: inspectorSwitchForm.password,
        };
      }
      selectedNode.value = node;
      if (node.kind === 'switch') {
        const cached = switchCredsByNodeId[node.id];
        const proto = node.switchMeta?.managementProtocol;
        inspectorSwitchForm.modelPreset = cached?.modelPreset || node.switchMeta?.model || 'T1600G-28TS';
        inspectorSwitchForm.protocol =
          cached?.protocol ||
          (proto === 'ssh' || proto === 'telnet' || proto === 'http' || proto === 'snmp' ? proto : 'auto');
        inspectorSwitchForm.username = cached?.username || node.switchMeta?.username || 'admin';
        inspectorSwitchForm.password = cached?.password || '';
      }
    }

    async function submitCreateCanvas() {
      if (!newCanvasName.value.trim()) return;
      try {
        const created = await api.createTopologyCanvas({
          name: newCanvasName.value.trim(),
          description: newCanvasDesc.value.trim(),
        });
        newCanvasName.value = '';
        newCanvasDesc.value = '';
        creatingCanvas.value = false;
        await loadTopologyState();
        selectedCanvasId.value = created.id;
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to create canvas', error: true });
      }
    }

    const autoLayoutModalOpen = ref(false);
    const autoLayoutRunning = ref(false);
    const autoLayoutOpts = reactive({
      cleanLayout: true,
      autoRouteWires: true,
      pullDiscovered: false,
      deduplicateNodes: false,
      subnet: '',
    });

    function openAutoLayoutModal() {
      autoLayoutModalOpen.value = true;
    }

    async function executeAutoLayout(runAll: boolean) {
      if (!selectedCanvasId.value) return;
      autoLayoutRunning.value = true;
      try {
        const res = await api.autoLayoutTopologyCanvas(
          selectedCanvasId.value,
          runAll
            ? {
                all: true,
                subnet: autoLayoutOpts.subnet.trim() || undefined,
              }
            : {
                cleanLayout: autoLayoutOpts.cleanLayout,
                autoRouteWires: autoLayoutOpts.autoRouteWires,
                pullDiscovered: autoLayoutOpts.pullDiscovered,
                deduplicateNodes: autoLayoutOpts.deduplicateNodes,
                subnet: autoLayoutOpts.subnet.trim() || undefined,
              },
        );
        if (res.state) {
          applyState(res.state);
        } else {
          await loadTopologyState();
        }
        if (runAll || autoLayoutOpts.cleanLayout) {
          resetViewport();
        }
        autoLayoutModalOpen.value = false;
        const parts: string[] = [];
        if (res.addedNodes) parts.push(`+${res.addedNodes} device(s)`);
        if (res.wiredLinks) parts.push(`+${res.wiredLinks} wire(s) routed`);
        if (runAll || autoLayoutOpts.cleanLayout) parts.push('layout organized');
        emit('toast', {
          message: parts.length > 0 ? `Auto-Layout: ${parts.join(', ')}` : 'Auto-Layout completed',
          error: false,
        });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Auto-layout failed', error: true });
      } finally {
        autoLayoutRunning.value = false;
      }
    }

    function openNodeModal(node?: TopologyNode) {
      if (node) {
        nodeForm.id = node.id;
        nodeForm.name = node.name;
        nodeForm.kind = node.kind;
        nodeForm.ipAddress = node.ipAddress;
        nodeForm.macAddress = node.macAddress;
        nodeForm.vlan = node.vlan ?? null;
        nodeForm.manufacturer = node.manufacturer || '';
        nodeForm.osOrFirmware = node.osOrFirmware || '';
        nodeForm.healthMethod = node.healthCheck.method;
        nodeForm.healthTarget = node.healthCheck.target || '';
        nodeForm.x = node.x;
        nodeForm.y = node.y;
        nodeForm.parentId = node.parentId || '';
      } else {
        nodeForm.id = '';
        nodeForm.name = '';
        nodeForm.kind = 'server';
        nodeForm.ipAddress = '';
        nodeForm.macAddress = '';
        nodeForm.vlan = null;
        nodeForm.manufacturer = '';
        nodeForm.osOrFirmware = '';
        nodeForm.healthMethod = 'auto';
        nodeForm.healthTarget = '';
        nodeForm.x = 90 + (canvasNodes.value.length % 4) * 320;
        nodeForm.y = 90 + Math.floor(canvasNodes.value.length / 4) * 215;
        nodeForm.parentId = '';
      }
      nodeModalOpen.value = true;
    }

    async function saveNodeModal() {
      if (!nodeForm.name.trim()) return;
      try {
        const saved = await api.upsertTopologyNode({
          id: nodeForm.id || undefined,
          canvasId: selectedCanvasId.value,
          name: nodeForm.name.trim(),
          kind: nodeForm.kind,
          ipAddress: nodeForm.ipAddress.trim(),
          macAddress: nodeForm.macAddress.trim(),
          vlan: nodeForm.vlan ? Number(nodeForm.vlan) : null,
          manufacturer: nodeForm.manufacturer.trim(),
          osOrFirmware: nodeForm.osOrFirmware.trim(),
          x: Number(nodeForm.x) || 200,
          y: Number(nodeForm.y) || 200,
          parentId: nodeForm.parentId || undefined,
          healthCheck: {
            method: nodeForm.healthMethod,
            target: nodeForm.healthTarget.trim(),
            intervalSec: 60,
          },
        });
        nodeModalOpen.value = false;
        await loadTopologyState();
        selectedNode.value = state.value.nodes.find((n) => n.id === saved.id) || null;
        emit('toast', { message: `Saved node ${saved.name}`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to save node', error: true });
      }
    }

    async function removeNode(node: TopologyNode) {
      try {
        await api.deleteTopologyNode(node.id);
        if (selectedNode.value && selectedNode.value.id === node.id) {
          selectedNode.value = null;
        }
        await loadTopologyState();
        emit('toast', { message: `Removed ${node.name}`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Delete failed', error: true });
      }
    }

    function openLinkModal() {
      const list = canvasNodes.value;
      linkForm.sourceId = selectedNode.value ? selectedNode.value.id : list[0]?.id || '';
      linkForm.targetId = list.find((n) => n.id !== linkForm.sourceId)?.id || list[0]?.id || '';
      linkForm.kind = 'ethernet';
      linkForm.label = '1GbE Trunk';
      linkModalOpen.value = true;
    }

    async function saveLinkModal() {
      if (!linkForm.sourceId || !linkForm.targetId || linkForm.sourceId === linkForm.targetId) return;
      try {
        await api.upsertTopologyLink({
          canvasId: selectedCanvasId.value,
          sourceId: linkForm.sourceId,
          targetId: linkForm.targetId,
          kind: linkForm.kind,
          label: linkForm.label.trim() || 'Link',
        });
        linkModalOpen.value = false;
        await loadTopologyState();
        emit('toast', { message: 'Topology link created', error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to create link', error: true });
      }
    }

    async function confirmDeleteLink(link: TopologyLink) {
      try {
        await api.deleteTopologyLink(link.id);
        await loadTopologyState();
        emit('toast', { message: `Unlinked ${link.label}`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Unlink failed', error: true });
      }
    }

    function jumpToNativeIntegration(node: TopologyNode) {
      if (node.linkedSourceKind === 'proxmox') emit('navigate', 'proxmox');
      else if (node.linkedSourceKind === 'opnsense') emit('navigate', 'opnsense');
      else if (node.linkedSourceKind === 'hikvision') emit('navigate', 'hikvision');
      else if (node.linkedSourceKind === 'tailscale') emit('navigate', 'tailscale');
      else if (node.linkedSourceKind === 'ssh') emit('navigate', 'servers');
    }

    // ---- Physical Racks & Port-to-Port Patching ----

    const activeRack = computed(() => {
      if (state.value.racks.length === 0) return null;
      return state.value.racks.find((r) => r.id === selectedRackId.value) || state.value.racks[0];
    });

    const rackElevationRows = computed(() => {
      const rack = activeRack.value;
      if (!rack) return [];
      const rows: Array<{
        u: number;
        item: TopologyRackSlotItem | null;
        isTopOfItem: boolean;
      }> = [];
      for (let u = rack.totalU; u >= 1; u--) {
        const found = rack.items.find((it) => u >= it.startU && u < it.startU + it.heightU) || null;
        const isTopOfItem = found ? u === found.startU + found.heightU - 1 : false;
        rows.push({ u, item: found, isTopOfItem });
      }
      return rows;
    });

    function rackItemName(itemId: string): string {
      if (!activeRack.value) return itemId;
      const found = activeRack.value.items.find((i) => i.id === itemId);
      return found ? `${found.name} (U${found.startU})` : itemId;
    }

    function prefillRackSlot(u: number) {
      newRackItem.startU = u;
      newRackItem.heightU = 1;
      addingRackItem.value = true;
    }

    async function submitCreateRack() {
      if (!newRack.name.trim()) return;
      try {
        const created = await api.upsertTopologyRack({
          name: newRack.name.trim(),
          widthInches: newRack.widthInches,
          totalU: newRack.totalU,
        });
        newRack.name = '';
        creatingRack.value = false;
        await loadTopologyState();
        selectedRackId.value = created.id;
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to create rack', error: true });
      }
    }

    async function submitMountRackItem() {
      if (!activeRack.value || !newRackItem.name.trim()) return;
      try {
        await api.upsertTopologyRackItem(activeRack.value.id, {
          name: newRackItem.name.trim(),
          kind: newRackItem.kind,
          startU: newRackItem.startU,
          heightU: newRackItem.heightU,
          ipAddress: newRackItem.ipAddress.trim(),
        });
        newRackItem.name = '';
        newRackItem.ipAddress = '';
        addingRackItem.value = false;
        await loadTopologyState();
        emit('toast', { message: 'Mounted equipment into rack U-slot', error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Mount failed', error: true });
      }
    }

    async function removeRackItem(itemId: string) {
      if (!activeRack.value) return;
      await api.deleteTopologyRackItem(activeRack.value.id, itemId);
      await loadTopologyState();
    }

    async function submitAddPatch() {
      if (!activeRack.value || !newPatch.fromItemId || !newPatch.toItemId) return;
      try {
        await api.upsertTopologyRackPatch(activeRack.value.id, {
          fromItemId: newPatch.fromItemId,
          fromPort: newPatch.fromPort,
          toItemId: newPatch.toItemId,
          toPort: newPatch.toPort,
          cableKind: newPatch.cableKind,
          label: newPatch.label,
        });
        addingPatch.value = false;
        await loadTopologyState();
        emit('toast', { message: 'Port-to-port patch run added', error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Patch failed', error: true });
      }
    }

    async function removeRackPatch(patchId: string) {
      if (!activeRack.value) return;
      await api.deleteTopologyRackPatch(activeRack.value.id, patchId);
      await loadTopologyState();
    }

    // ---- Subnet Scanner, Health Checks & Mesh Importers ----

    async function triggerHealthChecks() {
      healthRunning.value = true;
      try {
        const res = await api.runTopologyHealthChecks();
        applyState(res.state);
        emit('toast', { message: `Probed health across ${res.nodes.length} nodes`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Health check failed', error: true });
      } finally {
        healthRunning.value = false;
      }
    }

    async function syncFromRackPanel() {
      syncingOverview.value = true;
      try {
        const res = await api.syncTopologyFromOverview(selectedCanvasId.value);
        applyState(res.state);
        emit('toast', {
          message: `Synced Rack Panel telemetry (+${res.addedNodes} nodes, +${res.addedLinks} links)`,
          error: false,
        });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Sync failed', error: true });
      } finally {
        syncingOverview.value = false;
      }
    }

    async function runSubnetScan() {
      scanning.value = true;
      try {
        const res = await api.scanTopologySubnet(scanSubnetInput.value);
        applyState(res.state);
        emit('toast', {
          message: `Subnet scan complete (${res.state.discoveryQueue.length} devices fingerprinted)`,
          error: false,
        });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Subnet scan failed', error: true });
      } finally {
        scanning.value = false;
      }
    }

    async function approveDiscovery(discoveryId: string) {
      try {
        const res = await api.approveTopologyDiscovery(discoveryId, selectedCanvasId.value);
        applyState(res.state);
        emit('toast', { message: 'Device approved onto topology canvas & wiki page generated', error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Approval failed', error: true });
      }
    }

    async function importExternalMesh(kind: 'zigbee2mqtt' | 'zwave-js' | 'unraid') {
      try {
        const res = await api.importTopologyMesh({ kind });
        applyState(res.state);
        selectedCanvasId.value = res.canvasId;
        setSubTab('canvas');
        emit('toast', {
          message: `Imported ${kind} topology (+${res.importedNodes} nodes, +${res.importedLinks} links)`,
          error: false,
        });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Mesh import failed', error: true });
      }
    }

    // ---- IPAM Filter ----
    const filteredIpamNodes = computed(() => {
      const q = ipamSearch.value.trim().toLowerCase();
      if (!q) return state.value.nodes;
      return state.value.nodes.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.ipAddress.toLowerCase().includes(q) ||
          n.hostname.toLowerCase().includes(q) ||
          n.kind.toLowerCase().includes(q) ||
          (n.vlan && `vlan ${n.vlan}`.includes(q)),
      );
    });

    // ---- Markdown Wiki, [[Wiki-Links]] & Backlinks ----
    const filteredDocs = computed(() => {
      const q = docSearch.value.trim().toLowerCase();
      if (!q) return state.value.docs;
      return state.value.docs.filter(
        (d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q),
      );
    });

    const activeDoc = computed<TopologyDocPage | null>(() => {
      if (state.value.docs.length === 0) return null;
      return state.value.docs.find((d) => d.id === activeDocId.value) || state.value.docs[0];
    });

    const attachedDocNode = computed<TopologyNode | null>(() => {
      if (!activeDoc.value || !activeDoc.value.nodeId) return null;
      return state.value.nodes.find((n) => n.id === activeDoc.value!.nodeId) || null;
    });

    const docBacklinks = computed<TopologyDocPage[]>(() => {
      if (!activeDoc.value) return [];
      const needle = `[[${activeDoc.value.title.toLowerCase()}]]`;
      return state.value.docs.filter(
        (d) => d.id !== activeDoc.value!.id && d.content.toLowerCase().includes(needle),
      );
    });

    function escapeHtml(raw: string): string {
      return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    const renderedMarkdownHtml = computed(() => {
      if (!activeDoc.value) return '';
      const lines = activeDoc.value.content.split(/\r?\n/);
      const htmlLines: string[] = [];

      const formatInline = (text: string): string => {
        let s = escapeHtml(text);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/`([^`]+)`/g, '<code class="hl-md-code">$1</code>');
        s = s.replace(
          /\[\[([^\]]+)\]\]/g,
          '<a href="#" class="hl-wikilink" data-wikilink="$1">[[$1]]</a>',
        );
        return s;
      };

      for (const line of lines) {
        if (line.indexOf('# ') === 0) {
          htmlLines.push(`<h2 class="hl-md-h1">${formatInline(line.slice(2))}</h2>`);
        } else if (line.indexOf('## ') === 0) {
          htmlLines.push(`<h3 class="hl-md-h2">${formatInline(line.slice(3))}</h3>`);
        } else if (line.indexOf('- ') === 0 || line.indexOf('* ') === 0) {
          htmlLines.push(`<div class="hl-md-li">&bull; ${formatInline(line.slice(2))}</div>`);
        } else if (/^\d+\.\s+/.test(line)) {
          htmlLines.push(`<div class="hl-md-li">${formatInline(line)}</div>`);
        } else if (!line.trim()) {
          htmlLines.push('<div style="height: 8px;"></div>');
        } else {
          htmlLines.push(`<p class="hl-md-p">${formatInline(line)}</p>`);
        }
      }
      return htmlLines.join('\n');
    });

    function onMarkdownBodyClick(evt: MouseEvent) {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const wl = target.getAttribute('data-wikilink');
      if (!wl) return;
      evt.preventDefault();
      const lower = wl.toLowerCase();
      const targetDoc = state.value.docs.find((d) => d.title.toLowerCase() === lower);
      if (targetDoc) {
        selectDoc(targetDoc);
        return;
      }
      const targetNode = state.value.nodes.find((n) => n.name.toLowerCase() === lower);
      if (targetNode) {
        jumpToCanvasNode(targetNode);
      }
    }

    function selectDoc(doc: TopologyDocPage) {
      activeDocId.value = doc.id;
      editingDocMode.value = false;
    }

    function openNodeDoc(node: TopologyNode) {
      const existing = state.value.docs.find((d) => d.id === node.docId || d.nodeId === node.id);
      setSubTab('docs');
      if (existing) {
        activeDocId.value = existing.id;
        editingDocMode.value = false;
      } else {
        docForm.id = '';
        docForm.title = node.name;
        docForm.icon = `[${node.kind.toUpperCase()}]`;
        docForm.nodeId = node.id;
        docForm.content = `# ${node.name}\n\nDevice documentation for [[${node.name}]] (\`${node.ipAddress || node.kind}\`).\n\n## Specifications\n- **Role**: \`${node.kind}\`\n- **IPv4**: \`${node.ipAddress || '-'}\`\n- **OS / Firmware**: ${node.osOrFirmware || '-'}`;
        docForm.revisionSummary = 'Initial device documentation';
        editingDocMode.value = true;
      }
    }

    function jumpToCanvasNode(node: TopologyNode) {
      selectedCanvasId.value = node.canvasId;
      selectedNode.value = node;
      setSubTab('canvas');
    }

    function startNewDoc() {
      docForm.id = '';
      docForm.title = 'New Homelab Runbook';
      docForm.icon = '[DOC]';
      docForm.nodeId = '';
      docForm.content = '# New Homelab Runbook\n\nWrite Markdown notes and link devices with [[OPNsense Edge Firewall]].';
      docForm.revisionSummary = 'Created wiki page';
      editingDocMode.value = true;
    }

    function startEditActiveDoc() {
      if (!activeDoc.value) return;
      docForm.id = activeDoc.value.id;
      docForm.title = activeDoc.value.title;
      docForm.icon = activeDoc.value.icon;
      docForm.nodeId = activeDoc.value.nodeId || '';
      docForm.content = activeDoc.value.content;
      docForm.revisionSummary = '';
      editingDocMode.value = true;
    }

    async function saveDocForm() {
      if (!docForm.title.trim()) return;
      try {
        const saved = await api.upsertTopologyDoc({
          id: docForm.id || undefined,
          title: docForm.title.trim(),
          icon: docForm.icon.trim() || '[DOC]',
          nodeId: docForm.nodeId || undefined,
          content: docForm.content,
          revisionSummary: docForm.revisionSummary.trim() || undefined,
        });
        editingDocMode.value = false;
        await loadTopologyState();
        activeDocId.value = saved.id;
        emit('toast', { message: `Saved wiki page "${saved.title}"`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to save wiki page', error: true });
      }
    }

    async function removeDoc(doc: TopologyDocPage) {
      await api.deleteTopologyDoc(doc.id);
      await loadTopologyState();
    }

    async function triggerGitSync() {
      gitSyncing.value = true;
      try {
        const res = await api.syncTopologyGit();
        applyState(res.state);
        emit('toast', { message: res.message, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Git export failed', error: true });
      } finally {
        gitSyncing.value = false;
      }
    }

    function formatDocTime(ts: number): string {
      if (!ts) return '-';
      const d = new Date(ts);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    onMounted(() => {
      void loadTopologyState();
    });

    function onSaveRackStudio() {
      emit('toast', { message: 'Physical rack layout & patch cables saved', error: false });
    }

    const resetCanvasOpts = reactive({
      resetWires: true,
      resetCustomNodes: false,
      resetAllNodes: false,
      resetDiscovery: false,
    });

    function promptReset(scope: 'all' | 'canvas' | 'racks') {
      resetTargetScope.value = scope;
    }

    async function executeReset(resetAllCanvas = false) {
      if (!resetTargetScope.value) return;
      const scope = resetTargetScope.value;
      resetting.value = true;
      try {
        const res = await api.resetTopologyState(
          scope,
          scope === 'canvas'
            ? resetAllCanvas
              ? {
                  resetWires: true,
                  resetCustomNodes: true,
                  resetAllNodes: true,
                  resetDiscovery: true,
                  canvasId: selectedCanvasId.value || undefined,
                }
              : {
                  resetWires: resetCanvasOpts.resetWires,
                  resetCustomNodes: resetCanvasOpts.resetCustomNodes,
                  resetAllNodes: resetCanvasOpts.resetAllNodes,
                  resetDiscovery: resetCanvasOpts.resetDiscovery,
                  canvasId: selectedCanvasId.value || undefined,
                }
            : undefined,
        );
        if (scope !== 'canvas') {
          selectedCanvasId.value = '';
          selectedRackId.value = '';
          selectedNode.value = null;
        }
        applyState(res.state);
        resetTargetScope.value = null;
        const label =
          scope === 'canvas'
            ? resetAllCanvas
              ? 'Topology canvas reset (wires, nodes & discovery cleared)'
              : 'Selected topology canvas items reset'
            : scope === 'racks'
              ? 'Rack builder reset to configured RACK//PANEL devices'
              : 'Topology canvas & rack builder reset to configured RACK//PANEL devices';
        emit('toast', { message: label, error: false });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to reset topology state',
          error: true,
        });
      } finally {
        resetting.value = false;
      }
    }

    return {
      activeSubTab,
      loadTopologyState,
      onSaveRackStudio,
      resetTargetScope,
      resetCanvasOpts,
      resetting,
      promptReset,
      executeReset,
      setSubTab,
      state,
      selectedCanvasId,
      selectedNode,
      hoveredNodeId,
      zoom,
      creatingCanvas,
      newCanvasName,
      newCanvasDesc,
      healthRunning,
      syncingOverview,
      scanning,
      scanSubnetInput,
      ipamSearch,
      selectedRackId,
      creatingRack,
      addingRackItem,
      addingPatch,
      newRack,
      newRackItem,
      newPatch,
      docSearch,
      editingDocMode,
      gitSyncing,
      docForm,
      nodeModalOpen,
      nodeForm,
      linkModalOpen,
      linkForm,
      canvasNodes,
      topLevelCanvasNodes,
      proxmoxGuestsByHostId,
      collapsedProxmoxHosts,
      toggleProxmoxRackCollapse,
      selectProxmoxNestedGuest,
      nvrCamerasByHostId,
      collapsedNvrHosts,
      toggleNvrRackCollapse,
      selectNvrNestedCamera,
      selectedNodeParentHost,
      analyzingRouting,
      routingAnalyzeForm,
      runRoutingAnalysis,
      probingSwitchCli,
      switchCliForm,
      inspectorSwitchForm,
      getSwitchPortRow,
      getSwitchActivePortCount,
      getSwitchTotalPortCount,
      probeSwitchFromTopology,
      canvasLinks,
      onlineCanvasCount,
      pendingDiscoveriesCount,
      childCountMap,
      stageTransformStyle,
      canvasStageEl,
      svgExportUrl,
      renderedEdges,
      sharedMacGroups,
      selectedNodeLinks,
      activeRack,
      rackElevationRows,
      filteredIpamNodes,
      filteredDocs,
      activeDoc,
      attachedDocNode,
      docBacklinks,
      renderedMarkdownHtml,
      pad2,
      kindBadge,
      kindColor,
      isEdgeConnectedToHover,
      isNodeConnectedToHover,
      onNodeMouseDown,
      onNodeTouchStart,
      onCanvasMouseDown,
      onCanvasTouchStart,
      onCanvasMouseMove,
      onCanvasTouchMove,
      onCanvasMouseUp,
      onCanvasTouchEnd,
      adjustZoom,
      resetViewport,
      selectCanvas,
      selectNode,
      submitCreateCanvas,
      autoLayoutModalOpen,
      autoLayoutRunning,
      autoLayoutOpts,
      openAutoLayoutModal,
      executeAutoLayout,
      openNodeModal,
      saveNodeModal,
      removeNode,
      openLinkModal,
      saveLinkModal,
      confirmDeleteLink,
      jumpToNativeIntegration,
      rackItemName,
      prefillRackSlot,
      submitCreateRack,
      submitMountRackItem,
      removeRackItem,
      submitAddPatch,
      removeRackPatch,
      triggerHealthChecks,
      syncFromRackPanel,
      runSubnetScan,
      approveDiscovery,
      importExternalMesh,
      selectDoc,
      openNodeDoc,
      jumpToCanvasNode,
      startNewDoc,
      startEditActiveDoc,
      saveDocForm,
      removeDoc,
      triggerGitSync,
      onMarkdownBodyClick,
      formatDocTime,
    };
  },
});
</script>

<style scoped lang="scss">
.hl-subtabs {
  margin-bottom: 12px;
}

.hl-toolbar-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.hl-inline-form {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.hl-canvas-viewport {
  position: relative;
  width: 100%;
  height: 640px;
  overflow: hidden;
  padding: 0 !important;
  cursor: grab;
  background-color: #060911;
  background-image: radial-gradient(#1e293b 1px, transparent 1px);
  background-size: 22px 22px;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
}

.hl-canvas-hud {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 20;
  padding: 5px 10px;
  border-radius: 4px;
  background: rgba(8, 12, 22, 0.85);
  border: 1px solid #1f2d46;
  font-size: 11px;
  color: #cbd5e1;
  pointer-events: none;
}

.hl-canvas-stage {
  position: absolute;
  top: 0;
  left: 0;
  width: 3200px;
  height: 2600px;
}

.hl-edges-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 3200px;
  height: 2600px;
  overflow: visible;
}

.hl-edge-dimmed {
  opacity: 0.2;
}

.hl-node-card {
  position: absolute;
  width: 204px;
  min-height: 92px;
  padding: 9px 11px;
  border-radius: 5px;
  background: #0d1424;
  border: 1.5px solid #243452;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.65);
  cursor: pointer;
  transition: border-color 0.14s ease, opacity 0.14s ease;

  &:hover {
    border-color: #38bdf8;
  }

  &.hl-node-selected {
    border-color: #22d3ee;
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.28), 0 12px 30px rgba(0, 0, 0, 0.75);
  }

  &.hl-node-offline {
    border-color: rgba(248, 113, 113, 0.55);
  }

  &.hl-node-dimmed {
    opacity: 0.28;
  }

  /* Proxmox Hypervisor Mini-Rack Chassis Node on Topology Canvas */
  &.hl-node-proxmox-rack {
    width: 316px;
    padding: 0;
    background: #090d16;
    border: 2px solid #2e3e5c;
    border-radius: 6px;
    overflow: hidden;

    &:hover {
      border-color: #fbbf24;
    }

    &.hl-node-selected {
      border-color: #22d3ee;
      box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.32), 0 14px 34px rgba(0, 0, 0, 0.8);
    }
  }

  /* 1U Managed Switch Chassis Node on Topology Canvas (T1600G-28TS / T1600G-28PS / 24G+4SFP) */
  &.hl-node-switch-chassis {
    width: 304px;
    padding: 0;
    background: #0a0f1a;
    border: 2px solid #283a5a;
    border-radius: 6px;
    overflow: hidden;

    &:hover {
      border-color: #22d3ee;
    }

    &.hl-node-selected {
      border-color: #22d3ee;
      box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.32), 0 14px 34px rgba(0, 0, 0, 0.8);
    }
  }
}

.hl-sw-top-bezel {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 4px 9px;
  background: #101829;
  border-bottom: 1px solid #20304c;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.hl-sw-vendor-tag {
  color: #38bdf8;
  margin-right: 6px;
}

.hl-sw-model-pill {
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(34, 211, 238, 0.14);
  border: 1px solid rgba(34, 211, 238, 0.4);
  color: #22d3ee;
}

.hl-sw-poe-pill {
  margin-left: auto;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(192, 132, 252, 0.16);
  border: 1px solid rgba(192, 132, 252, 0.45);
  color: #c084fc;
}

.hl-sw-chassis-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  background: #151e30;
}

.hl-sw-faceplate-body {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
}

.hl-sw-ports-strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 4px 5px;
  margin: 3px 0;
  background: #0a0f19;
  border: 1px solid #22314d;
  border-radius: 3px;
}

.hl-sw-rj45-matrix {
  display: flex;
  flex-direction: column;
}

.hl-sw-rj45-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 2px;

  &:last-child {
    margin-bottom: 0;
  }
}

.hl-sw-port-box {
  display: inline-block;
  width: 11px;
  height: 8px;
  margin-right: 3px;
  border-radius: 1.5px;
  background: #0d1422;
  border: 1px solid #475569;

  &:nth-child(4n) {
    margin-right: 7px;
  }

  &:last-child {
    margin-right: 0;
  }

  &.hl-sw-port-up-1g {
    background: #22c55e;
    border-color: #f8fafc;
  }

  &.hl-sw-port-up-100m {
    background: #f59e0b;
    border-color: #f8fafc;
  }

  &.hl-sw-port-poe {
    box-shadow: 0 0 0 1px #c084fc;
    border-color: #c084fc;
  }
}

.hl-sw-sfp-bank {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: 6px;
  border-left: 1px dashed #293a5a;
}

.hl-sw-port-sfp {
  width: 10px;
  height: 15px;
  margin-right: 3px !important;
  border-color: #38bdf8;
  background: #0b1322;

  &.hl-sw-port-up-sfp {
    background: #38bdf8;
    border-color: #f8fafc;
  }
}

.hl-sw-footer-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  font-size: 9.5px;
  color: #94a3b8;
  margin-top: 3px;
}

.hl-pve-rack-top-bezel {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: #101726;
  border-bottom: 1px solid #22304a;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.7px;
}

.hl-pve-rack-title-tag {
  color: #fbbf24;
}

.hl-pve-rack-count {
  color: #22d3ee;
  margin-left: auto;
  margin-right: 8px;
}

.hl-pve-collapse-btn {
  background: #090e18;
  border: 1px solid #293856;
  border-radius: 3px;
  color: #cbd5e1;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  cursor: pointer;

  &:hover {
    border-color: #22d3ee;
    color: #22d3ee;
  }
}

.hl-pve-head-unit {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  background: #172133;
  border-bottom: 2px solid #0b0f18;
}

.hl-pve-head-faceplate {
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
}

.hl-pve-head-mid {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 3px;
}

.hl-pve-hw-strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-left: 6px;
}

.hl-pve-drive-bay {
  display: inline-block;
  width: 11px;
  height: 16px;
  margin-right: 2px;
  background: #0d1320;
  border: 1px solid #334361;
  border-radius: 1.5px;
}

.hl-pve-port-led {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 3px;
  border-radius: 1px;
  background: #0d1422;
  border: 1px solid #64748b;

  &.hl-pve-port-active {
    background: #22c55e;
    border-color: #f8fafc;
  }

  &.hl-pve-port-sfp {
    background: #38bdf8;
    border-color: #f8fafc;
  }
}

.hl-pve-rail {
  width: 24px;
  min-width: 24px;
  background: #131b2b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  padding: 3px 0;
}

.hl-pve-rail-left {
  border-right: 1px solid #25344f;
}

.hl-pve-rail-right {
  width: 16px;
  min-width: 16px;
  border-left: 1px solid #25344f;
}

.hl-pve-hole {
  display: block;
  width: 4px;
  height: 4px;
  background: #070b12;
  border: 1px solid #24324c;
}

.hl-pve-u-num {
  font-size: 8.5px;
  font-weight: 800;
  color: #64748b;
  line-height: 1;
}

.hl-pve-guest-rack-body {
  max-height: 310px;
  overflow-y: auto;
  background: #080c14;
}

.hl-pve-guest-u-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 25px;
  border-bottom: 1px solid #121a29;
  cursor: pointer;

  &:hover .hl-pve-guest-blade {
    background: #1b273d;
    border-color: #38bdf8;
  }

  &.hl-pve-guest-selected .hl-pve-guest-blade {
    background: rgba(34, 211, 238, 0.14);
    border-color: #22d3ee;
  }

  &.hl-pve-guest-offline {
    opacity: 0.72;
  }
}

.hl-pve-guest-blade {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 3px 7px;
  margin: 1px 2px;
  background: #141d2e;
  border: 1px solid #283754;
  border-radius: 2px;
}

.hl-pve-guest-kind {
  font-size: 8.5px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 2px;
  margin-right: 6px;

  &.hl-pve-kind-lxc {
    background: rgba(52, 211, 153, 0.16);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.4);
  }

  &.hl-pve-kind-vm {
    background: rgba(56, 189, 248, 0.16);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.4);
  }

  &.hl-nvr-kind-cam {
    background: rgba(192, 132, 252, 0.16);
    color: #c084fc;
    border: 1px solid rgba(192, 132, 252, 0.4);
  }
}

.hl-node-nvr-rack {
  &:hover {
    border-color: #c084fc !important;
  }
}

.hl-pve-guest-name {
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.hl-pve-guest-telemetry {
  font-size: 9px;
  color: #94a3b8;
  margin-left: 6px;
  white-space: nowrap;
}

.hl-pve-empty-bay {
  padding: 8px 10px;
  font-size: 10px;
  color: #64748b;
  text-align: center;
  background: #090d16;
}

.hl-node-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 5px;
}

.hl-node-kind {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.6px;
}

.hl-node-vlan {
  margin-left: 6px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(139, 92, 246, 0.18);
  color: #c4b5fd;
}

.hl-node-lat {
  margin-left: auto;
  font-size: 10px;
  color: #34d399;
}

.hl-node-title {
  font-size: 13px;
  font-weight: 800;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hl-node-ip {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hl-node-badges {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 6px;
}

.hl-mini-pill {
  font-size: 9px;
  padding: 1px 5px;
  margin-right: 4px;
  margin-bottom: 3px;
  border-radius: 3px;
  background: #080d17;
  border: 1px solid #1e2d47;
  color: #cbd5e1;
}

/* Inspector */
.hl-inspector-grid {
  background: #090e18;
  border: 1px solid #1c283e;
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 12px;
}

.hl-insp-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid #141d2e;

  &:last-child {
    border-bottom: none;
  }
}

.hl-insp-label {
  color: #64748b;
  margin-right: 8px;
}

.hl-srv-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  margin-bottom: 5px;
  border-radius: 4px;
  background: #0a101c;
  border: 1px solid #1c2840;
  font-size: 12px;
}

/* Physical Rack Cabinet */
.hl-rack-cabinet {
  border: 3px solid #283652;
  border-radius: 5px;
  background: #070b13;
  padding: 6px;
  max-height: 640px;
  overflow-y: auto;

  &.hl-rack-10in {
    max-width: 480px;
    margin: 0 auto;
  }
}

.hl-rack-u-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 36px;
  border-bottom: 1px solid #141e30;
}

.hl-rack-ear {
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0e1627;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  border-right: 1px dashed #23314d;
  border-left: 1px dashed #23314d;
}

.hl-rack-chassis {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: linear-gradient(90deg, #111b2e 0%, #0d1423 100%);
  border-left: 4px solid #22d3ee;
}

.hl-rack-chassis-main {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.hl-rack-item-name {
  font-size: 13px;
  font-weight: 800;
  color: #f8fafc;
}

.hl-rack-chassis-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  font-size: 11px;
}

.hl-rack-chassis-cont {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: #0b1220;
  color: #64748b;
  font-size: 11px;
}

.hl-rack-blank {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  color: #334155;
  font-size: 11px;
}

/* Patch Cards */
.hl-patch-card {
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  background: #0a101b;
  border: 1px solid #1d2a42;
}

.hl-patch-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.hl-patch-title {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  flex: 1;
  margin-left: 8px;
}

.hl-patch-endpoints {
  font-size: 12px;
  color: #cbd5e1;
}

/* Wiki & Docs */
.hl-doc-nav-item {
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: 4px;
  background: #0a101b;
  border: 1px solid #1b273d;
  cursor: pointer;

  &.active {
    border-color: #22d3ee;
    background: rgba(34, 211, 238, 0.08);
  }
}

.hl-doc-node-banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 4px;
  background: rgba(8, 145, 178, 0.14);
  border: 1px solid rgba(34, 211, 238, 0.4);
  cursor: pointer;
}

.hl-markdown-body {
  padding: 14px 16px;
  border-radius: 4px;
  background: #080d17;
  border: 1px solid #1a253a;
  color: #e2e8f0;
  font-size: 14px;
  line-height: 1.65;
}

.hl-doc-backlinks {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #1e293b;
}

.hl-doc-revisions {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #1e293b;
}

.hl-rev-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 5px 0;
  font-size: 12px;
  color: #94a3b8;
  border-bottom: 1px solid #131c2e;
}

.host-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}
</style>

<style lang="scss">
.hl-md-h1 {
  font-size: 20px;
  font-weight: 800;
  color: #f8fafc;
  margin: 0 0 10px 0;
  padding-bottom: 6px;
  border-bottom: 1px solid #1e293b;
}

.hl-md-h2 {
  font-size: 16px;
  font-weight: 700;
  color: #38bdf8;
  margin: 14px 0 8px 0;
}

.hl-md-p {
  margin: 0 0 8px 0;
}

.hl-md-li {
  margin: 0 0 5px 10px;
}

.hl-md-code {
  font-family: monospace;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  background: #131d31;
  color: #22d3ee;
}

.hl-wikilink {
  color: #22d3ee;
  font-weight: 700;
  text-decoration: none;
  border-bottom: 1px dashed #22d3ee;

  &:hover {
    color: #67e8f9;
  }
}

.hl-shared-mac-group {
  position: absolute;
  border: 2px dashed rgba(34, 211, 238, 0.55);
  border-radius: 10px;
  background: rgba(14, 116, 144, 0.06);
  pointer-events: none;
  z-index: 1;
}

.hl-shared-mac-label {
  position: absolute;
  top: -11px;
  left: 12px;
  padding: 1px 8px;
  border-radius: 4px;
  background: #0b1220;
  border: 1px dashed rgba(34, 211, 238, 0.65);
  color: #67e8f9;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
</style>
