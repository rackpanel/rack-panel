<template>
  <div class="rv-root">
    <!-- Top Patching & Rack Studio Toolbar -->
    <div class="rv-topbar">
      <div class="rv-topbar-left">
        <span class="rv-brand-badge mono">RACK STUDIO</span>
        <span v-if="dragState.active" class="pill pill-cyan mono" style="margin-left: 8px;">
          MOVING {{ dragState.itemName }} &rarr; {{ dragState.targetRackName }} [{{ dragState.targetFace.toUpperCase() }}] &middot; U{{ dragState.targetU }}
          <template v-if="dragState.slotsTotal > 1"> (Slot {{ dragState.targetSlotIndex + 1 }}/{{ dragState.slotsTotal }})</template>
        </span>
        <span v-else-if="selectedPort" class="pill pill-cyan mono" style="margin-left: 8px;">
          PATCHING FROM: {{ selectedPort.itemName }} [Port {{ selectedPort.port }}] &mdash; Tap destination port
        </span>
        <span v-else-if="patchingMode" class="pill pill-ok mono" style="margin-left: 8px;">
          INTERACTIVE PATCHING ACTIVE &mdash; Tap any two RJ45 / SFP+ ports to run a cable (auto-syncs to Topology)
        </span>
        <span v-else class="pill pill-muted mono" style="margin-left: 8px;">
          FRONT &amp; REAR ELEVATIONS &middot; DRAG TO MOVE U-SLOT OR FLIP RAILS &middot; CABLES SYNC WITH TOPOLOGY
        </span>
      </div>

      <div class="btn-group">
        <!-- Front / Rear / Split Elevation Mode Toggle -->
        <div class="rv-face-mode-group mono">
          <button
            type="button"
            class="rv-face-mode-btn"
            :class="{ active: faceViewMode === 'both' }"
            title="Show Front and Rear rack elevations side-by-side"
            @click="faceViewMode = 'both'"
          >
            Front + Rear
          </button>
          <button
            type="button"
            class="rv-face-mode-btn"
            :class="{ active: faceViewMode === 'front' }"
            title="Show Front rack rails only"
            @click="setFaceViewMode('front')"
          >
            Front Only
          </button>
          <button
            type="button"
            class="rv-face-mode-btn"
            :class="{ active: faceViewMode === 'rear' }"
            title="Show Rear rack rails only"
            @click="setFaceViewMode('rear')"
          >
            Rear Only
          </button>
        </div>

        <button type="button" class="btn btn-sm" @click="creatingRack = !creatingRack">
          {{ creatingRack ? 'Cancel' : '+ Rack' }}
        </button>

        <button
          type="button"
          class="btn btn-sm"
          :class="{ 'btn-primary': patchingMode }"
          @click="togglePatchingMode"
        >
          {{ patchingMode ? 'Exit patching' : 'Patch ports' }}
        </button>

        <!-- Cable Color Picker when in Patching Mode -->
        <div v-if="patchingMode" class="rv-color-strip">
          <button
            v-for="c in cablePalette"
            :key="c.color"
            type="button"
            class="rv-color-swatch"
            :class="{ active: activeCableColor === c.color }"
            :style="{ backgroundColor: c.color }"
            :title="c.label"
            @click="selectCablePalette(c)"
          ></button>
        </div>

        <!-- Cable Visibility Cycle -->
        <button type="button" class="btn btn-sm" @click="cycleCableVisibility">
          Cables: {{ cableVisibility === 'always' ? 'Always' : cableVisibility === 'hover' ? 'Hover' : 'Hidden' }}
        </button>

        <button type="button" class="btn btn-sm" @click="$emit('import-links')">
          Import links
        </button>

        <button
          type="button"
          class="btn btn-sm"
          :disabled="autoLayingOut || racks.length === 0"
          title="Auto-arrange rack gear top-to-bottom (Networking at top, Compute/Storage in middle, UPS/PDU at bottom)"
          @click="runRackAutoLayout"
        >
          {{ autoLayingOut ? 'Arranging...' : 'Auto-Layout' }}
        </button>

        <button type="button" class="btn btn-sm" @click="exportRackSvg">
          SVG / PNG
        </button>

        <button type="button" class="btn btn-sm btn-danger" @click="$emit('reset-racks')">
          Reset Rack
        </button>

        <button type="button" class="btn btn-sm btn-primary" @click="$emit('save-racks')">
          Save
        </button>
      </div>
    </div>

    <!-- Inline New Rack Creator Bar -->
    <div v-if="creatingRack" class="rv-create-bar">
      <input
        v-model="newRack.name"
        class="input"
        type="text"
        placeholder="Rack Name (e.g. Rack C — Storage)"
        style="max-width: 210px; margin-right: 8px;"
      />
      <input
        v-model="newRack.location"
        class="input"
        type="text"
        placeholder="Location (e.g. Garage)"
        style="max-width: 150px; margin-right: 8px;"
      />
      <select v-model.number="newRack.widthInches" class="select" style="max-width: 120px; margin-right: 8px;">
        <option :value="19">19" Rack</option>
        <option :value="10">10" Mini</option>
      </select>
      <input
        v-model.number="newRack.totalU"
        class="input mono"
        type="number"
        min="6"
        max="48"
        placeholder="24"
        style="max-width: 80px; margin-right: 8px;"
      />
      <button type="button" class="btn btn-sm btn-primary" @click="handleCreateRack">
        Create Cabinet
      </button>
    </div>

    <!-- Main Studio Layout: Left Sidebar (Accessories, Unmounted Devices & Stats) + Multi-Rack SVG Stage -->
    <div class="rv-workspace">
      <!-- Left Accessories & Rack Inventory Sidebar -->
      <aside class="rv-sidebar">
        <div class="rv-side-section">
          <div class="rv-side-heading">TARGET RACK &amp; RAIL FACE</div>
          <select v-model="activeRackId" class="select" style="margin-bottom: 6px;">
            <option v-for="r in racks" :key="r.id" :value="r.id">
              {{ r.name }} ({{ r.totalU }}U)
            </option>
          </select>
          <div class="rv-face-picker mono" style="margin-bottom: 6px;">
            <button
              type="button"
              class="rv-face-pick-btn"
              :class="{ active: targetFace === 'front' }"
              @click="targetFace = 'front'"
            >
              FRONT RAILS
            </button>
            <button
              type="button"
              class="rv-face-pick-btn rv-face-pick-rear"
              :class="{ active: targetFace === 'rear' }"
              @click="targetFace = 'rear'"
            >
              REAR RAILS
            </button>
          </div>
          <div class="rv-slot-row mono" style="margin-bottom: 6px;">
            <span>Mount at U:</span>
            <input
              v-model.number="targetU"
              class="input mono"
              type="number"
              min="1"
              :max="activeRack ? activeRack.totalU : 48"
              style="max-width: 68px; padding: 4px 8px; min-height: 30px;"
            />
          </div>

          <!-- Rack Size (Updates Both Front & Rear Elevations Together) -->
          <div v-if="activeRack" class="rv-rack-size-box mono">
            <div class="rv-side-heading" style="margin-bottom: 4px;">
              RACK SIZE (FRONT &amp; REAR)
            </div>
            <div class="rv-custom-row" style="margin-bottom: 5px;">
              <input
                v-model.number="editRackSize.totalU"
                class="input mono"
                type="number"
                min="4"
                max="48"
                title="Total Rack Units (4U - 48U)"
                style="width: 62px; margin-right: 4px; min-height: 30px; font-size: 11px; padding: 3px 6px;"
              />
              <select
                v-model.number="editRackSize.widthInches"
                class="select mono"
                style="flex: 1; margin-right: 4px; min-height: 30px; font-size: 11px; padding: 3px 6px;"
              >
                <option :value="19">19" Std</option>
                <option :value="10">10" Mini</option>
              </select>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                style="min-height: 30px; padding: 3px 8px; font-size: 11px;"
                :disabled="savingRackSize"
                @click="applyRackSize"
              >
                {{ savingRackSize ? '...' : 'Apply' }}
              </button>
            </div>
            <div class="rv-size-presets">
              <button
                v-for="uPreset in [12, 18, 24, 42, 48]"
                :key="uPreset"
                type="button"
                class="rv-size-preset-btn mono"
                :class="{ active: activeRack.totalU === uPreset }"
                @click="setRackSizePreset(uPreset)"
              >
                {{ uPreset }}U
              </button>
            </div>
          </div>
        </div>

        <!-- Real & Discovered Devices Inventory (One-Tap or Drag to Mount into Rack) -->
        <div class="rv-side-section">
          <div class="rv-side-heading-row">
            <span class="rv-side-heading" style="margin-bottom: 0;">
              DISCOVERED &amp; LIVE DEVICES ({{ unmountedRealDevices.length }})
            </span>
            <button
              type="button"
              class="rv-mini-link mono"
              @click="showAllRealDevices = !showAllRealDevices"
            >
              {{ showAllRealDevices ? 'Unmounted' : 'Show All' }}
            </button>
          </div>
          <div class="rv-side-hint">
            Drag any discovered device directly into a rack U-slot, or tap <strong>+ U{{ targetU }}</strong>
          </div>

          <div v-if="displayedRealDevices.length === 0" class="mono" style="font-size: 11px; color: #64748b; padding: 6px 0;">
            All discovered devices are mounted. Use <strong>Scanner</strong> or <strong>Show All</strong>.
          </div>

          <div class="rv-real-device-list">
            <div
              v-for="dev in displayedRealDevices"
              :key="dev.key"
              class="rv-real-dev-card"
              :class="{ 'rv-real-dev-mounted': dev.alreadyMounted }"
              @mousedown.prevent="onInventoryDeviceMouseDown($event, dev)"
              @touchstart.prevent="onInventoryDeviceTouchStart($event, dev)"
            >
              <div class="rv-real-dev-info">
                <div class="rv-real-dev-top">
                  <span
                    class="dot"
                    :class="dev.status === 'online' ? 'dot-ok' : 'dot-crit'"
                  ></span>
                  <span class="rv-real-dev-name" :title="dev.name">{{ dev.name }}</span>
                </div>
                <div class="rv-real-dev-meta mono">
                  <span>{{ dev.badge }}</span>
                  <span v-if="dev.ipAddress"> &middot; {{ dev.ipAddress }}</span>
                  <span> &middot; {{ dev.heightU }}U</span>
                </div>
              </div>
              <button
                type="button"
                class="btn btn-sm rv-real-mount-btn mono"
                @mousedown.stop
                @touchstart.stop
                @click.stop="mountRealDeviceAtTarget(dev)"
              >
                + U{{ targetU }}
              </button>
            </div>
          </div>
        </div>

        <!-- Managed Switch Detector & Mounter (T1600G-28TS / T1600G-28PS / SSH / Telnet) -->
        <div class="rv-side-section">
          <div class="rv-side-heading">MANAGED SWITCHES (SSH / TELNET)</div>
          <div class="rv-side-hint">
            Quick-mount or probe <strong>T1600G-28TS</strong>, <strong>T1600G-28PS</strong> &amp; L2+ switches via SSH, Telnet, or HTTP
          </div>
          <select
            v-model="switchProbeForm.modelPreset"
            class="select mono"
            style="margin-bottom: 5px; min-height: 32px; font-size: 11px;"
          >
            <option value="T1600G-28TS">TP-Link T1600G-28TS (24x GbE + 4x SFP)</option>
            <option value="T1600G-28PS">TP-Link T1600G-28PS (24x PoE+ 192W + 4x SFP)</option>
            <option value="auto">Auto-Detect Model via SSH / Telnet / HTTP</option>
            <option value="T2600G-28TS">TP-Link T2600G-28TS (24G + 4x SFP)</option>
            <option value="TL-SG3428">TP-Link Omada TL-SG3428 (24G + 4x SFP)</option>
            <option value="TL-SG2428P">TP-Link Omada TL-SG2428P (24x PoE+ + 4x SFP)</option>
            <option value="CISCO-28P">Cisco SG300-28 / CBS350-24T-4G</option>
            <option value="UBIQUITI-24P">Ubiquiti USW-24-PoE / EdgeSwitch 24</option>
            <option value="MIKROTIK-CRS326">MikroTik CRS326-24G-2S+RM</option>
          </select>
          <div class="rv-custom-row" style="margin-bottom: 5px;">
            <input
              v-model="switchProbeForm.host"
              class="input mono"
              type="text"
              placeholder="Switch IP (optional)"
              style="flex: 1; margin-right: 4px; min-height: 30px; font-size: 11px; padding: 3px 7px;"
            />
            <select
              v-model="switchProbeForm.protocol"
              class="select mono"
              style="width: 78px; min-height: 30px; font-size: 11px; padding: 3px 5px;"
            >
              <option value="auto">Auto</option>
              <option value="ssh">SSH :22</option>
              <option value="telnet">Telnet :23</option>
              <option value="snmp">SNMP :161</option>
              <option value="http">HTTP :80</option>
            </select>
          </div>
          <div v-if="switchProbeForm.host.trim()" class="rv-custom-row" style="margin-bottom: 5px;">
            <input
              v-model="switchProbeForm.username"
              class="input mono"
              type="text"
              placeholder="User (admin)"
              style="flex: 1; margin-right: 4px; min-height: 28px; font-size: 11px; padding: 2px 6px;"
            />
            <input
              v-model="switchProbeForm.password"
              class="input mono"
              type="password"
              placeholder="Password"
              style="flex: 1; min-height: 28px; font-size: 11px; padding: 2px 6px;"
            />
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            style="width: 100%;"
            :disabled="probingSwitch"
            @click="probeAndMountSwitch"
          >
            {{
              probingSwitch
                ? 'Probing Switch...'
                : switchProbeForm.host.trim()
                  ? `Probe & Mount at U${targetU}`
                  : `+ Mount ${switchProbeForm.modelPreset === 'auto' ? 'T1600G-28TS' : switchProbeForm.modelPreset} at U${targetU}`
            }}
          </button>
        </div>

        <!-- Accessories Quick-Insert Palette -->
        <div class="rv-side-section">
          <div class="rv-side-heading">ACCESSORIES</div>
          <div class="rv-side-hint">
            Tap any accessory below to mount at <strong>U{{ targetU }}</strong> in
            <strong>{{ activeRack ? activeRack.name : 'Rack' }}</strong>
          </div>

          <button
            v-for="acc in accessoriesPalette"
            :key="acc.label"
            type="button"
            class="rv-acc-btn"
            @click="quickMountAccessory(acc)"
          >
            <span>{{ acc.label }}</span>
            <span class="mono rv-acc-tag">{{ acc.tag }}</span>
          </button>
        </div>

        <!-- Custom Device Mounter -->
        <div class="rv-side-section">
          <div class="rv-side-heading">MOUNT DEVICE</div>
          <input
            v-model="customItem.name"
            class="input"
            type="text"
            placeholder="Label (e.g. pve-04 or nas-02)"
            style="margin-bottom: 6px; min-height: 34px; font-size: 12px;"
          />
          <div class="rv-custom-row" style="margin-bottom: 6px;">
            <select
              v-model="customItem.kind"
              class="select"
              style="flex: 1; margin-right: 4px; min-height: 34px; font-size: 12px;"
            >
              <option value="switch">Switch (RJ45+SFP+)</option>
              <option value="patch-panel">Patch Panel 24p</option>
              <option value="fiber-patch">Fiber LC Panel</option>
              <option value="firewall">Edge Router / FW</option>
              <option value="proxmox">Proxmox Server</option>
              <option value="nas">NAS (Drive Bays)</option>
              <option value="nvr">Hikvision NVR</option>
              <option value="mini-pc">Mini-PC / NUC / Pi</option>
              <option value="ups">UPS Battery</option>
              <option value="pdu">Rack PDU</option>
            </select>
            <select
              v-model.number="customItem.heightU"
              class="select mono"
              style="width: 58px; min-height: 34px; font-size: 12px;"
            >
              <option :value="1">1U</option>
              <option :value="2">2U</option>
              <option :value="3">3U</option>
              <option :value="4">4U</option>
            </select>
          </div>
          <div class="rv-custom-row" style="margin-bottom: 6px;">
            <select
              v-model.number="customItem.slotsTotal"
              class="select mono"
              style="flex: 1; margin-right: 4px; min-height: 32px; font-size: 11px;"
            >
              <option :value="1">Full 19" Width</option>
              <option :value="2">1/2 Shelf (2x NUC)</option>
              <option :value="3">1/3 Shelf (3x Pi)</option>
            </select>
            <select
              v-if="customItem.slotsTotal > 1"
              v-model.number="customItem.slotIndex"
              class="select mono"
              style="width: 68px; min-height: 32px; font-size: 11px;"
            >
              <option :value="0">Slot 1</option>
              <option :value="1">Slot 2</option>
              <option v-if="customItem.slotsTotal >= 3" :value="2">Slot 3</option>
            </select>
          </div>
          <button type="button" class="btn btn-sm btn-primary" style="width: 100%;" @click="mountCustomDevice">
            + Add Device to U{{ targetU }}
          </button>
        </div>

        <!-- Selected Equipment or Cable Inspector + Link to Real Discovered Device -->
        <div v-if="selectedItem" class="rv-side-section rv-selected-box">
          <div class="rv-side-heading-row" style="margin-bottom: 4px;">
            <span class="rv-side-heading" style="margin-bottom: 0;">SELECTED GEAR</span>
            <span
              class="mono rv-face-pill"
              :class="(selectedItem.item.face || 'front') === 'rear' ? 'rv-face-pill-rear' : 'rv-face-pill-front'"
            >
              {{ (selectedItem.item.face || 'front').toUpperCase() }} RAILS
            </span>
          </div>
          <div class="mono" style="font-weight: 800; color: #f8fafc; font-size: 13px;">
            {{ selectedItem.item.name }}
          </div>
          <div class="mono" style="font-size: 11px; color: #38bdf8; margin-top: 2px;">
            U{{ selectedItem.item.startU }} ({{ selectedItem.item.heightU }}U) &middot; {{ selectedItem.item.kind }}
            <template v-if="selectedItem.item.ipAddress"> &middot; {{ selectedItem.item.ipAddress }}</template>
          </div>

          <!-- Switch Live Telemetry & Re-Poll Section when Selected Gear is a Switch -->
          <div
            v-if="selectedItem.item.kind === 'switch'"
            class="mono"
            style="margin-top: 6px; padding: 6px 8px; background: #0a101d; border: 1px solid #1e2d47; border-radius: 4px; font-size: 10.5px;"
          >
            <div style="color: #fbbf24; font-weight: 800;">
              {{ selectedItem.item.switchMeta ? `${selectedItem.item.switchMeta.vendor} ${selectedItem.item.switchMeta.model}` : '28-Port Managed Switch' }}
            </div>
            <div v-if="selectedItem.item.switchMeta" style="color: #94a3b8; margin-top: 2px;">
              {{ selectedItem.item.switchMeta.rj45PortCount }}x GbE RJ45 + {{ selectedItem.item.switchMeta.sfpPortCount }}x SFP
              &middot;
              <strong style="color: #22c55e;">
                {{ selectedItem.item.switchMeta.ports.filter((p) => p.linkStatus === 'up').length }}/{{ selectedItem.item.switchMeta.ports.length }} UP
              </strong>
              <template v-if="selectedItem.item.switchMeta.poeSupported">
                &middot;
                <strong style="color: #c084fc;">
                  PoE {{ selectedItem.item.switchMeta.poeUsedWatts || 0 }}W/{{ selectedItem.item.switchMeta.poeBudgetWatts || 192 }}W
                </strong>
              </template>
            </div>
            <div class="rv-custom-row" style="margin-top: 5px;">
              <input
                v-model="selectedSwitchCreds.username"
                class="input mono"
                type="text"
                placeholder="User (admin)"
                style="flex: 1; margin-right: 4px; min-height: 26px; font-size: 10px; padding: 2px 6px;"
              />
              <input
                v-model="selectedSwitchCreds.password"
                class="input mono"
                type="password"
                :placeholder="selectedItem.item.switchMeta && selectedItem.item.switchMeta.hasPassword ? 'Saved (blank=keep)' : 'Password'"
                style="flex: 1; min-height: 26px; font-size: 10px; padding: 2px 6px;"
              />
            </div>
            <button
              type="button"
              class="btn btn-sm"
              style="width: 100%; margin-top: 5px; min-height: 26px; font-size: 10px;"
              :disabled="probingSwitch"
              @click="repollSelectedSwitch"
            >
              {{ probingSwitch ? 'Polling Switch CLI...' : 'Poll Switch via SSH / Telnet' }}
            </button>
          </div>

          <!-- Link / Bind this Rack Unit to any Real / Discovered Device -->
          <div style="margin-top: 8px;">
            <label class="rv-side-heading" style="display: block; margin-bottom: 4px;">
              LINK TO REAL / DISCOVERED DEVICE
            </label>
            <select
              :value="selectedItemLinkKey"
              class="select"
              style="min-height: 32px; font-size: 11px; padding: 3px 8px;"
              @change="onLinkSelectedItemToRealDevice($event)"
            >
              <option value="">— Unlinked (Manual Rack Unit) —</option>
              <option v-for="dev in allRealDevices" :key="dev.key" :value="dev.key">
                [{{ dev.badge }}] {{ dev.name }} ({{ dev.ipAddress || dev.kind }})
              </option>
            </select>
          </div>

          <div class="btn-group" style="margin-top: 8px;">
            <button
              type="button"
              class="btn btn-sm"
              style="min-height: 28px; padding: 2px 8px; font-size: 11px;"
              @click="nudgeSelectedItem(1)"
            >
              &uarr; Up 1U
            </button>
            <button
              type="button"
              class="btn btn-sm"
              style="min-height: 28px; padding: 2px 8px; font-size: 11px;"
              @click="nudgeSelectedItem(-1)"
            >
              &darr; Down 1U
            </button>
            <button
              type="button"
              class="btn btn-sm"
              style="min-height: 28px; padding: 2px 8px; font-size: 11px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.45);"
              @click="flipSelectedItemFace"
            >
              Flip to {{ (selectedItem.item.face || 'front') === 'rear' ? 'Front' : 'Rear' }}
            </button>
            <button
              v-if="selectedItemConsoleTab"
              type="button"
              class="btn btn-sm btn-primary"
              style="min-height: 28px; padding: 2px 8px; font-size: 11px;"
              @click="$emit('navigate', selectedItemConsoleTab)"
            >
              Console &rarr;
            </button>
            <button
              type="button"
              class="btn btn-sm btn-danger"
              style="min-height: 28px; padding: 2px 8px; font-size: 11px;"
              @click="unmountSelectedItem"
            >
              Unmount
            </button>
          </div>
        </div>

        <!-- Bottom Fleet Rack Summary Footer (Matches Reference Screenshot) -->
        <div class="rv-side-stats mono">
          <div class="rv-stat-line">
            <span>Racks</span>
            <strong>{{ racks.length }}</strong>
          </div>
          <div class="rv-stat-line">
            <span>Mounted</span>
            <strong>{{ totalMountedCount }}</strong>
          </div>
          <div class="rv-stat-line">
            <span>Cables</span>
            <strong>{{ totalCablesCount }}</strong>
          </div>
          <div class="rv-stat-line">
            <span>Free</span>
            <strong style="color: #34d399;">{{ freeUnitsCount }}U / {{ totalUnitsCount }}U</strong>
          </div>
        </div>
      </aside>

      <!-- Interactive Multi-Rack Pan/Zoom Canvas with Photorealistic Chassis & Bezier Patch Cables -->
      <div
        ref="stageWrapEl"
        class="rv-stage-wrap"
        @mousedown="onStageMouseDown"
        @mousemove="onStageMouseMove"
        @mouseup="onStageMouseUp"
        @mouseleave="onStageMouseUp"
        @touchstart="onStageTouchStart"
        @touchmove="onStageTouchMove"
        @touchend="onStageTouchEnd"
      >
        <!-- Bottom-Left Floating Zoom Controls (Matches Screenshot) -->
        <div class="rv-zoom-controls">
          <button type="button" class="rv-zoom-btn mono" title="Zoom In" @click="stepZoom(0.12)">+</button>
          <button type="button" class="rv-zoom-btn mono" title="Zoom Out" @click="stepZoom(-0.12)">&minus;</button>
          <button type="button" class="rv-zoom-btn mono" title="Reset Fit" @click="resetZoom">&#x26F6;</button>
        </div>

        <div class="rv-svg-pan-layer" :style="panZoomStyle">
          <svg
            ref="rackSvgEl"
            :width="svgWidth"
            :height="svgHeight"
            :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
            xmlns="http://www.w3.org/2000/svg"
            class="rv-main-svg"
          >
            <defs>
              <filter id="cableGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.75" />
              </filter>
            </defs>

            <!-- Render Each Physical Rack Elevation Column (Front / Rear / Split Side-by-Side) -->
            <g
              v-for="rg in rackGeometries"
              :key="rg.columnKey"
              @click.stop="selectActiveRack(rg.rack.id, rg.face)"
            >
              <!-- Rack Title Header Above Frame + FRONT / REAR Elevation Badge -->
              <text
                :x="rg.x + 6"
                :y="rg.y - 12"
                fill="#f8fafc"
                font-family="sans-serif"
                font-size="14"
                font-weight="800"
              >
                {{ rg.rack.name }} &middot; {{ rg.rack.location }} &middot; {{ rg.rack.totalU }}U
              </text>
              <rect
                :x="rg.x + rg.width - 78"
                :y="rg.y - 26"
                width="74"
                height="18"
                rx="3"
                :fill="rg.face === 'rear' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(34, 211, 238, 0.16)'"
                :stroke="rg.face === 'rear' ? '#f59e0b' : '#22d3ee'"
                stroke-width="1.2"
              />
              <text
                :x="rg.x + rg.width - 41"
                :y="rg.y - 13.5"
                text-anchor="middle"
                :fill="rg.face === 'rear' ? '#fbbf24' : '#22d3ee'"
                font-family="monospace"
                font-size="10"
                font-weight="800"
              >
                {{ rg.face === 'rear' ? 'REAR VIEW' : 'FRONT VIEW' }}
              </text>

              <!-- Outer Rack Cabinet Frame (Cyan Border when Front Active, Amber Border when Rear Active) -->
              <rect
                :x="rg.x"
                :y="rg.y"
                :width="rg.width"
                :height="rg.height"
                rx="4"
                fill="#0b0f17"
                :stroke="
                  activeRackId === rg.rack.id && targetFace === rg.face
                    ? rg.face === 'rear'
                      ? '#f59e0b'
                      : '#22d3ee'
                    : '#2e3c56'
                "
                :stroke-width="activeRackId === rg.rack.id && targetFace === rg.face ? 2.4 : 1.5"
              />

              <!-- Left & Right Perforated Mounting Rails -->
              <rect
                :x="rg.x + 22"
                :y="rg.y + 8"
                width="12"
                :height="rg.height - 16"
                fill="#161f30"
                stroke="#26344d"
                stroke-width="1"
              />
              <rect
                :x="rg.x + rg.width - 20"
                :y="rg.y + 8"
                width="12"
                :height="rg.height - 16"
                fill="#161f30"
                stroke="#26344d"
                stroke-width="1"
              />

              <!-- Per-U Background Grid Lines, U Numbers, Cage Nut Holes & Click-to-Target -->
              <g
                v-for="uRow in rg.uRows"
                :key="`${rg.columnKey}-u-${uRow.u}`"
                style="cursor: pointer;"
                @click.stop="selectRackSlot(rg.rack.id, uRow.u, rg.face)"
              >
                <!-- Subtle U-slot band -->
                <rect
                  :x="rg.innerX"
                  :y="uRow.y"
                  :width="rg.innerW"
                  :height="uHeightPx"
                  :fill="
                    activeRackId === rg.rack.id && targetFace === rg.face && targetU === uRow.u
                      ? rg.face === 'rear'
                        ? 'rgba(245, 158, 11, 0.1)'
                        : 'rgba(34, 211, 238, 0.08)'
                      : 'transparent'
                  "
                  stroke="#151d2a"
                  stroke-width="0.8"
                />
                <!-- U Number Label on Left Rail -->
                <text
                  :x="rg.x + 17"
                  :y="uRow.y + 18"
                  text-anchor="end"
                  fill="#64748b"
                  font-family="monospace"
                  font-size="10"
                  font-weight="700"
                >
                  {{ uRow.u }}
                </text>
                <!-- 3 Square Cage-Nut Holes on Left & Right Rails -->
                <rect :x="rg.x + 26" :y="uRow.y + 4" width="4" height="4" fill="#090d14" />
                <rect :x="rg.x + 26" :y="uRow.y + 12" width="4" height="4" fill="#090d14" />
                <rect :x="rg.x + 26" :y="uRow.y + 20" width="4" height="4" fill="#090d14" />
                <rect :x="rg.x + rg.width - 16" :y="uRow.y + 4" width="4" height="4" fill="#090d14" />
                <rect :x="rg.x + rg.width - 16" :y="uRow.y + 12" width="4" height="4" fill="#090d14" />
                <rect :x="rg.x + rg.width - 16" :y="uRow.y + 20" width="4" height="4" fill="#090d14" />
              </g>

              <!-- Opposite-Face Pass-Through Silhouettes (Shows deep front chassis depth from Rear view & vice-versa when slot is free on this face) -->
              <g
                v-for="pt in rg.passThroughItems"
                :key="`pt-${rg.columnKey}-${pt.item.id}`"
                style="cursor: pointer;"
                opacity="0.52"
                @click.stop="selectMountedItem(rg.rack.id, pt.item)"
              >
                <rect
                  :x="pt.x"
                  :y="pt.y"
                  :width="pt.w"
                  :height="pt.h"
                  rx="2.5"
                  fill="#0c1320"
                  stroke="#334155"
                  stroke-width="1"
                  stroke-dasharray="4,3"
                />
                <text
                  :x="pt.x + 10"
                  :y="pt.y + 16"
                  fill="#64748b"
                  font-family="monospace"
                  font-size="10"
                  font-weight="700"
                >
                  {{ pt.item.name.slice(0, 22) }} ({{ (pt.item.face || 'front').toUpperCase() }} CHASSIS)
                </text>
              </g>

              <!-- Mounted Equipment Chassis Faceplates on This Face -->
              <g
                v-for="m in rg.mountedItems"
                :key="`${rg.columnKey}-${m.item.id}`"
                :style="{ cursor: dragState.active && dragState.itemId === m.item.id ? 'grabbing' : 'grab' }"
                :opacity="dragState.active && dragState.itemId === m.item.id ? 0.92 : 1"
                @mouseenter="hoveredItemId = m.item.id"
                @mouseleave="hoveredItemId = ''"
                @mousedown.stop="onItemMouseDown($event, rg.rack, m, rg.face)"
                @touchstart.stop="onItemTouchStart($event, rg.rack, m, rg.face)"
                @click.stop="selectMountedItem(rg.rack.id, m.item)"
              >
                <!-- Chassis Body -->
                <rect
                  :x="m.x"
                  :y="m.y"
                  :width="m.w"
                  :height="m.h"
                  rx="2.5"
                  :fill="m.fillColor"
                  :stroke="
                    selectedItem && selectedItem.item.id === m.item.id
                      ? '#22d3ee'
                      : m.item.status === 'offline'
                        ? '#ef4444'
                        : '#3b4c6b'
                  "
                  :stroke-width="selectedItem && selectedItem.item.id === m.item.id ? 2 : 1.1"
                />

                <!-- Status LED Dot (except blank panels & cable managers) -->
                <circle
                  v-if="m.item.kind !== 'blank' && m.item.kind !== 'cable-manager'"
                  :cx="m.x + 10"
                  :cy="m.y + 14"
                  r="3.6"
                  :fill="m.item.status === 'offline' ? '#ef4444' : '#22c55e'"
                />

                <!-- Device Name Label -->
                <text
                  v-if="m.item.kind !== 'cable-manager'"
                  :x="m.item.kind === 'blank' ? m.x + m.w / 2 : m.x + 20"
                  :y="m.y + 17"
                  :text-anchor="m.item.kind === 'blank' ? 'middle' : 'start'"
                  :fill="m.item.kind === 'blank' ? '#475569' : '#e2e8f0'"
                  font-family="monospace"
                  font-size="11"
                  font-weight="700"
                >
                  {{ m.item.name.slice(0, m.maxLabelChars) }}
                </text>

                <!-- 1U Cable Manager Slotted Brush Ducts -->
                <g v-if="m.item.kind === 'cable-manager'">
                  <rect
                    v-for="dIdx in 12"
                    :key="`cm-${m.item.id}-${dIdx}`"
                    :x="m.x + 18 + (dIdx - 1) * 32"
                    :y="m.y + 7"
                    width="22"
                    :height="m.h - 14"
                    rx="2"
                    fill="#111723"
                    stroke="#243147"
                    stroke-width="1"
                  />
                </g>

                <!-- UniFi Console / UDM-Pro Signature 1.3" LCM Touchscreen -->
                <g v-if="/\b(udm|dream\s*machine|ucg|unifi)\b/i.test(m.item.name) && m.item.kind !== 'ap'">
                  <rect
                    :x="m.x + m.w - 30"
                    :y="m.y + 4"
                    width="18"
                    :height="Math.max(14, m.h - 8)"
                    rx="2"
                    fill="#0c4a6e"
                    stroke="#38bdf8"
                    stroke-width="1"
                  />
                  <circle
                    :cx="m.x + m.w - 21"
                    :cy="m.y + m.h / 2"
                    r="4"
                    fill="none"
                    stroke="#22d3ee"
                    stroke-width="1.3"
                  />
                </g>

                <!-- UniFi Access Point Saucer Icon -->
                <g v-if="m.item.kind === 'ap' || /\b(uap|u6|u7|unifi.*ap)\b/i.test(m.item.name)">
                  <circle
                    :cx="m.x + m.w - 24"
                    :cy="m.y + m.h / 2"
                    :r="Math.min(9, (m.h - 4) / 2)"
                    fill="#1e293b"
                    stroke="#cbd5e1"
                    stroke-width="1.1"
                  />
                  <circle
                    :cx="m.x + m.w - 24"
                    :cy="m.y + m.h / 2"
                    :r="Math.min(4, (m.h - 8) / 3)"
                    fill="#090d16"
                    stroke="#38bdf8"
                    stroke-width="1.6"
                  />
                </g>

                <!-- NVR Recording Badge & Camera Channel Indicator -->
                <g v-if="m.item.kind === 'nvr'">
                  <circle :cx="m.x + m.w - 58" :cy="m.y + 13" r="3" fill="#ef4444" />
                  <text
                    :x="m.x + m.w - 52"
                    :y="m.y + 16.5"
                    fill="#fca5a5"
                    font-family="monospace"
                    font-size="9"
                    font-weight="700"
                  >
                    REC
                  </text>
                </g>

                <!-- MacBook / Laptop on Shelf -->
                <g v-if="/\b(macbook|mbp|mba|laptop|thinkpad|notebook)\b/i.test(m.item.name)">
                  <rect
                    :x="m.x + m.w - 42"
                    :y="m.y + 3"
                    width="24"
                    :height="Math.max(10, m.h - 10)"
                    rx="1.5"
                    fill="#0f172a"
                    stroke="#94a3b8"
                    stroke-width="1.1"
                  />
                  <line
                    :x1="m.x + m.w - 46"
                    :y1="m.y + m.h - 5"
                    :x2="m.x + m.w - 14"
                    :y2="m.y + m.h - 5"
                    stroke="#cbd5e1"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </g>

                <!-- Smartphone / Mobile Device -->
                <g v-if="/\b(iphone|ipad|android|pixel|phone|mobile)\b/i.test(m.item.name)">
                  <rect
                    :x="m.x + m.w - 26"
                    :y="m.y + 3"
                    width="12"
                    :height="Math.max(14, m.h - 6)"
                    rx="2.2"
                    fill="#0f172a"
                    stroke="#94a3b8"
                    stroke-width="1.1"
                  />
                  <rect
                    :x="m.x + m.w - 24"
                    :y="m.y + 5.5"
                    width="8"
                    :height="Math.max(8, m.h - 11)"
                    rx="1"
                    fill="#1d4ed8"
                    opacity="0.55"
                  />
                </g>

                <!-- UPS Front LCD Readout -->
                <g v-if="m.item.kind === 'ups' && m.h >= 24">
                  <rect
                    :x="m.x + 22"
                    :y="m.y + m.h - 19"
                    width="64"
                    height="13"
                    rx="1.5"
                    fill="#064e3b"
                    stroke="#22c55e"
                    stroke-width="0.9"
                  />
                  <text
                    :x="m.x + 54"
                    :y="m.y + m.h - 9.5"
                    text-anchor="middle"
                    fill="#6ee7b7"
                    font-family="monospace"
                    font-size="8.5"
                    font-weight="700"
                  >
                    100% · OK
                  </text>
                </g>

                <!-- Drive Bays (for NAS / Proxmox / Server / NVR) -->
                <g v-if="m.driveBays.length > 0">
                  <rect
                    v-for="(bay, bIdx) in m.driveBays"
                    :key="`bay-${m.item.id}-${bIdx}`"
                    :x="bay.x"
                    :y="bay.y"
                    :width="bay.w"
                    :height="bay.h"
                    rx="1.5"
                    fill="#111826"
                    stroke="#2c3b57"
                    stroke-width="1"
                  />
                </g>

                <!-- Ventilation Grille Perforations (for UPS / Mini-PC) -->
                <g v-if="m.ventDots.length > 0">
                  <rect
                    v-for="(vd, vIdx) in m.ventDots"
                    :key="`vent-${m.item.id}-${vIdx}`"
                    :x="vd.x"
                    :y="vd.y"
                    width="2.5"
                    height="3.5"
                    fill="#0d131f"
                  />
                </g>

                <!-- Power Outlets (for PDU / UPS) -->
                <g v-if="m.outlets.length > 0">
                  <g v-for="(out, oIdx) in m.outlets" :key="`out-${m.item.id}-${oIdx}`">
                    <rect
                      :x="out.x"
                      :y="out.y"
                      :width="out.w"
                      :height="out.h"
                      rx="1.5"
                      fill="#0d131f"
                      stroke="#475569"
                      stroke-width="1"
                    />
                    <line
                      :x1="out.x + 3"
                      :y1="out.y + out.h / 2"
                      :x2="out.x + out.w - 3"
                      :y2="out.y + out.h / 2"
                      stroke="#64748b"
                      stroke-width="1.2"
                    />
                  </g>
                </g>

                  <!-- Interactive RJ45 / SFP+ / Fiber Network Ports (Supports Dual-Row 24+4 Port T1600G-28TS / T1600G-28PS Switches) -->
                <g
                  v-for="p in m.ports"
                  :key="`${m.item.id}-port-${p.portId}`"
                  style="cursor: crosshair;"
                  @mousedown.stop
                  @touchstart.stop
                  @click.stop="onPortClick(rg.rack.id, m.item, p.portId)"
                >
                  <rect
                    :x="p.x - (p.size || 9) / 2"
                    :y="p.y - (p.size || 9) / 2"
                    :width="p.size || 9"
                    :height="p.size || 9"
                    :rx="p.isSfp ? 1 : 1.8"
                    :fill="p.connectedColor || p.liveStatusColor || '#0d1422'"
                    :stroke="
                      isPortSelected(m.item.id, p.portId)
                        ? '#22d3ee'
                        : p.poeActive
                          ? '#c084fc'
                          : p.connectedColor
                            ? '#f8fafc'
                            : p.isSfp
                              ? '#38bdf8'
                              : '#64748b'
                    "
                    :stroke-width="isPortSelected(m.item.id, p.portId) ? 2.2 : p.poeActive ? 1.6 : 1.1"
                  />
                  <title>{{ p.tooltip || `${m.item.name} · Port ${p.portId}` }}</title>
                </g>
              </g>

              <!-- Live Target U-Slot Drop Outline Preview While Dragging -->
              <g
                v-if="
                  dragState.active &&
                  dragState.targetRackId === rg.rack.id &&
                  dragState.targetFace === rg.face &&
                  dragGhostRect
                "
              >
                <rect
                  :x="dragGhostRect.x"
                  :y="dragGhostRect.y"
                  :width="dragGhostRect.w"
                  :height="dragGhostRect.h"
                  rx="3"
                  :fill="rg.face === 'rear' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(34, 211, 238, 0.14)'"
                  :stroke="rg.face === 'rear' ? '#f59e0b' : '#22d3ee'"
                  stroke-width="2"
                  stroke-dasharray="6,4"
                  pointer-events="none"
                />
                <rect
                  :x="dragGhostRect.x + dragGhostRect.w - 98"
                  :y="dragGhostRect.y + 4"
                  width="92"
                  height="18"
                  rx="3"
                  :fill="rg.face === 'rear' ? '#d97706' : '#0891b2'"
                  pointer-events="none"
                />
                <text
                  :x="dragGhostRect.x + dragGhostRect.w - 52"
                  :y="dragGhostRect.y + 16"
                  text-anchor="middle"
                  fill="#f8fafc"
                  font-family="monospace"
                  font-size="9.5"
                  font-weight="800"
                  pointer-events="none"
                >
                  {{ rg.face.toUpperCase() }} &middot; U{{ dragState.targetU }}
                </text>
              </g>
            </g>

            <!-- Curved Cubic-Bezier Patch Cables Overlay (Intra-Rack & Inter-Rack) -->
            <g v-if="cableVisibility !== 'hidden'">
              <g
                v-for="c in renderedPatchCables"
                :key="c.patch.id"
                :opacity="c.dimmed ? 0.16 : 0.95"
                style="cursor: pointer;"
                @mouseenter="hoveredCableId = c.patch.id"
                @mouseleave="hoveredCableId = ''"
                @click.stop="onCableClick(c.patch)"
              >
                <!-- Dark Casing Under-Stroke for High Contrast -->
                <path
                  :d="c.pathD"
                  fill="none"
                  stroke="#05080f"
                  stroke-width="5"
                  stroke-linecap="round"
                />
                <!-- Colored Patch Cable Curve -->
                <path
                  :d="c.pathD"
                  fill="none"
                  :stroke="c.patch.color || '#22c55e'"
                  :stroke-width="hoveredCableId === c.patch.id ? 3.6 : 2.6"
                  stroke-linecap="round"
                  filter="url(#cableGlow)"
                />
                <!-- Endpoint Plugs -->
                <circle :cx="c.x1" :cy="c.y1" r="3.4" :fill="c.patch.color || '#22c55e'" stroke="#090d16" stroke-width="1" />
                <circle :cx="c.x2" :cy="c.y2" r="3.4" :fill="c.patch.color || '#22c55e'" stroke="#090d16" stroke-width="1" />

                <!-- Cable Midpoint Pill Label (e.g., "10G trunk A<->B", "backup-vlan", "uplink") -->
                <g v-if="c.patch.label && (c.isCrossRack || hoveredCableId === c.patch.id || c.patch.label.length <= 15)">
                  <rect
                    :x="c.mx - (c.patch.label.length * 3.4 + 10)"
                    :y="c.my - 9"
                    :width="c.patch.label.length * 6.8 + 20"
                    height="18"
                    rx="4"
                    fill="#0b111e"
                    :stroke="c.patch.color || '#38bdf8'"
                    stroke-width="1.1"
                  />
                  <text
                    :x="c.mx"
                    :y="c.my + 3.5"
                    text-anchor="middle"
                    fill="#f8fafc"
                    font-family="monospace"
                    font-size="9.5"
                    font-weight="700"
                  >
                    {{ c.patch.label }}
                  </text>
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed, watch } from 'vue';
import type {
  OverviewResponse,
  TopologyDiscoveredDevice,
  TopologyNode,
  TopologyPatchCable,
  TopologyRack,
  TopologyRackSlotItem,
} from '@shared/types';
import { api } from '@/api/client';

interface RealInventoryDevice {
  key: string;
  nodeId?: string;
  discoveryId?: string;
  name: string;
  kind: TopologyRackSlotItem['kind'];
  badge: string;
  ipAddress: string;
  status: 'online' | 'offline' | 'warning';
  heightU: number;
  portCount: number;
  sfpPortCount: number;
  driveBays: number;
  slotsTotal: number;
  consoleTab?: string;
  alreadyMounted: boolean;
}

interface PortCoord {
  portId: string;
  x: number;
  y: number;
  size?: number;
  isSfp: boolean;
  connectedColor?: string;
  liveStatusColor?: string;
  poeActive?: boolean;
  tooltip?: string;
}

interface MountedItemGeometry {
  rackId: string;
  item: TopologyRackSlotItem;
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor: string;
  maxLabelChars: number;
  ports: PortCoord[];
  driveBays: Array<{ x: number; y: number; w: number; h: number }>;
  outlets: Array<{ x: number; y: number; w: number; h: number }>;
  ventDots: Array<{ x: number; y: number }>;
}

interface PassThroughItemGeometry {
  item: TopologyRackSlotItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RackGeometry {
  columnKey: string;
  rack: TopologyRack;
  face: 'front' | 'rear';
  x: number;
  y: number;
  width: number;
  height: number;
  innerX: number;
  innerW: number;
  uRows: Array<{ u: number; y: number }>;
  mountedItems: MountedItemGeometry[];
  passThroughItems: PassThroughItemGeometry[];
}

export default defineComponent({
  name: 'RackStudioCanvas',
  props: {
    racks: { type: Array as () => TopologyRack[], required: true },
    nodes: { type: Array as () => TopologyNode[], default: () => [] },
    discoveryQueue: { type: Array as () => TopologyDiscoveredDevice[], default: () => [] },
    overview: { type: Object as () => OverviewResponse | null, default: null },
  },
  setup(props, { emit }) {
    const uHeightPx = 26;
    const rackWidthPx = 448;
    const rackGapPx = 56;
    const marginTopPx = 42;
    const marginLeftPx = 28;

    const activeRackId = ref(props.racks[0]?.id || '');
    const faceViewMode = ref<'both' | 'front' | 'rear'>('both');
    const targetFace = ref<'front' | 'rear'>('front');
    const targetU = ref(15);
    const patchingMode = ref(false);
    const autoLayingOut = ref(false);
    const cableVisibility = ref<'always' | 'hover' | 'hidden'>('always');
    const creatingRack = ref(false);

    const selectedPort = ref<{ rackId: string; itemId: string; itemName: string; port: string } | null>(null);
    const selectedItem = ref<{ rackId: string; item: TopologyRackSlotItem } | null>(null);
    const hoveredItemId = ref('');
    const hoveredCableId = ref('');

    // Live Drag-and-Drop State for Moving Rack Mounted Devices OR Dragging Unmounted Real Devices into a Rack
    const showAllRealDevices = ref(false);
    const pendingInventoryDevice = ref<RealInventoryDevice | null>(null);

    const dragState = reactive({
      active: false,
      moved: false,
      isFromInventory: false,
      itemId: '',
      itemName: '',
      heightU: 1,
      slotsTotal: 1,
      originRackId: '',
      originStartU: 1,
      originSlotIndex: 0,
      originFace: 'front' as 'front' | 'rear',
      targetRackId: '',
      targetRackName: '',
      targetU: 1,
      targetSlotIndex: 0,
      targetFace: 'front' as 'front' | 'rear',
      startClientX: 0,
      startClientY: 0,
    });

    const zoom = ref(1);
    const panX = ref(0);
    const panY = ref(0);
    const rackSvgEl = ref<SVGSVGElement | null>(null);

    const cablePalette: Array<{
      color: string;
      kind: TopologyPatchCable['cableKind'];
      label: string;
    }> = [
      { color: '#22c55e', kind: 'cat6a', label: 'Green Cat6A LAN' },
      { color: '#f59e0b', kind: 'fiber-om4', label: 'Amber 10G Fiber / Trunk' },
      { color: '#38bdf8', kind: 'dac-sfp+', label: 'Cyan SFP+ DAC Uplink' },
      { color: '#ef4444', kind: 'cat6a', label: 'Red Critical / Backup' },
      { color: '#a855f7', kind: 'poe', label: 'Purple PoE / CCTV VLAN' },
    ];
    const activeCableColor = ref('#22c55e');
    const activeCableKind = ref<TopologyPatchCable['cableKind']>('cat6a');

    const accessoriesPalette: Array<{
      label: string;
      tag: string;
      kind: TopologyRackSlotItem['kind'];
      name: string;
      heightU: number;
      portCount: number;
      sfpPortCount?: number;
      modelPreset?: string;
    }> = [
      {
        label: 'TP-Link T1600G-28TS',
        tag: '24G+4SFP',
        kind: 'switch',
        name: 'T1600G-28TS',
        heightU: 1,
        portCount: 28,
        sfpPortCount: 4,
        modelPreset: 'T1600G-28TS',
      },
      {
        label: 'TP-Link T1600G-28PS PoE+',
        tag: '24PoE+4SFP',
        kind: 'switch',
        name: 'T1600G-28PS',
        heightU: 1,
        portCount: 28,
        sfpPortCount: 4,
        modelPreset: 'T1600G-28PS',
      },
      { label: 'Blank panel 1U', tag: '1U', kind: 'blank', name: 'Blank panel 1U', heightU: 1, portCount: 0 },
      { label: 'Shelf 1U', tag: '1U', kind: 'shelf', name: 'Ventilated Shelf 1U', heightU: 1, portCount: 0 },
      { label: 'Cable manager 1U', tag: '1U', kind: 'cable-manager', name: 'cable-mgr-1u', heightU: 1, portCount: 0 },
      { label: 'Patch panel 24-Port', tag: '24P', kind: 'patch-panel', name: 'patch-24p', heightU: 1, portCount: 24 },
      { label: 'Fiber LC Duplex 1U', tag: 'LC', kind: 'fiber-patch', name: 'fiber-lc', heightU: 1, portCount: 8 },
      { label: 'Rack PDU 8-Outlet', tag: 'PDU', kind: 'pdu', name: 'pdu-1u', heightU: 1, portCount: 0 },
    ];

    const probingSwitch = ref(false);
    const switchProbeForm = reactive({
      modelPreset: 'T1600G-28TS',
      host: '',
      protocol: 'auto' as 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp',
      username: 'admin',
      password: '',
    });

    // Per-switch isolated credentials when selecting & re-polling an existing switch in Rack Studio
    const selectedSwitchCredsById = reactive<
      Record<string, { username: string; password: string; protocol: 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp' }>
    >({});
    const selectedSwitchCreds = reactive({
      username: 'admin',
      password: '',
      protocol: 'auto' as 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp',
    });

    const newRack = reactive({
      name: '',
      location: 'Garage',
      widthInches: 19 as 19 | 10,
      totalU: 24,
    });

    const customItem = reactive({
      name: '',
      kind: 'proxmox' as TopologyRackSlotItem['kind'],
      heightU: 1,
      slotsTotal: 1,
      slotIndex: 0,
    });

    watch(
      () => props.racks,
      (list) => {
        if (list.length > 0 && !list.some((r) => r.id === activeRackId.value)) {
          activeRackId.value = list[0].id;
        }
        if (selectedItem.value) {
          const r = list.find((rk) => rk.id === selectedItem.value!.rackId);
          const it = r?.items.find((i) => i.id === selectedItem.value!.item.id);
          selectedItem.value = r && it ? { rackId: r.id, item: it } : null;
        }
      },
      { immediate: true },
    );

    const activeRack = computed(() =>
      props.racks.find((r) => r.id === activeRackId.value) || props.racks[0] || null,
    );

    const savingRackSize = ref(false);
    const editRackSize = reactive({
      totalU: activeRack.value?.totalU || 24,
      widthInches: (activeRack.value?.widthInches || 19) as 19 | 10,
    });

    watch(
      activeRack,
      (rk) => {
        if (rk) {
          editRackSize.totalU = rk.totalU;
          editRackSize.widthInches = rk.widthInches;
          if (targetU.value > rk.totalU) {
            targetU.value = rk.totalU;
          }
        }
      },
      { immediate: true },
    );

    async function applyRackSize() {
      if (!activeRack.value) return;
      const nextU = Math.max(4, Math.min(48, Math.round(Number(editRackSize.totalU) || 24)));
      const nextWidth: 19 | 10 = Number(editRackSize.widthInches) === 10 ? 10 : 19;
      savingRackSize.value = true;
      try {
        await api.upsertTopologyRack({
          id: activeRack.value.id,
          name: activeRack.value.name,
          location: activeRack.value.location,
          totalU: nextU,
          widthInches: nextWidth,
        });
        if (targetU.value > nextU) targetU.value = nextU;
        emit('updated');
        emit('toast', {
          message: `Updated ${activeRack.value.name} (Front & Rear) to ${nextWidth}" · ${nextU}U`,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to resize rack',
          error: true,
        });
      } finally {
        savingRackSize.value = false;
      }
    }

    async function setRackSizePreset(totalU: number) {
      editRackSize.totalU = totalU;
      await applyRackSize();
    }

    // Build unified catalog of real & discovered devices from Overview (SSH, Proxmox, OPNsense, Hikvision, Tailscale), Topology Nodes, and Discovery Queue
    const allRealDevices = computed<RealInventoryDevice[]>(() => {
      const mountedIps = new Set<string>();
      const mountedNodeIds = new Set<string>();
      const mountedNames = new Set<string>();
      const liveStatusByIp = new Map<string, 'online' | 'offline'>();

      for (const r of props.racks) {
        for (const it of r.items) {
          if (it.ipAddress) mountedIps.add(it.ipAddress.toLowerCase());
          if (it.nodeId) mountedNodeIds.add(it.nodeId);
          mountedNames.add(it.name.toLowerCase());
        }
      }

      const list: RealInventoryDevice[] = [];
      const seenKeys = new Set<string>();

      const pushDevice = (dev: Omit<RealInventoryDevice, 'alreadyMounted'>, extraAliasNames: string[] = []) => {
        const ipKey = dev.ipAddress ? `ip:${dev.ipAddress.trim().toLowerCase()}` : '';
        const nameKey = `name:${dev.name.trim().toLowerCase()}`;
        if ((ipKey && seenKeys.has(ipKey)) || seenKeys.has(nameKey)) return;
        if (ipKey) seenKeys.add(ipKey);
        seenKeys.add(nameKey);
        for (const alias of extraAliasNames) {
          if (alias) seenKeys.add(`name:${alias.trim().toLowerCase()}`);
        }
        if (dev.ipAddress) {
          liveStatusByIp.set(dev.ipAddress.toLowerCase(), dev.status === 'offline' ? 'offline' : 'online');
        }
        const alreadyMounted =
          (Boolean(dev.ipAddress) && mountedIps.has(dev.ipAddress.toLowerCase())) ||
          (Boolean(dev.nodeId) && mountedNodeIds.has(dev.nodeId!)) ||
          mountedNames.has(dev.name.toLowerCase()) ||
          extraAliasNames.some((a) => Boolean(a) && mountedNames.has(a.trim().toLowerCase()));
        list.push({ ...dev, alreadyMounted });
      };

      // 1) Live Rack Panel Telemetry Overview (ONLY real configured devices — never demo hosts; Proxmox favored over SSH)
      if (props.overview) {
        for (const opn of props.overview.opnsense) {
          if (opn.isDemo) continue;
          pushDevice({
            key: `opn:${opn.configId}`,
            name: opn.name,
            kind: 'firewall',
            badge: 'OPNSENSE',
            ipAddress: opn.host,
            status: opn.status === 'online' ? 'online' : 'offline',
            heightU: 1,
            portCount: Math.max(6, opn.interfaces.length || 6),
            sfpPortCount: 2,
            driveBays: 0,
            slotsTotal: 1,
            consoleTab: 'opnsense',
          });
        }
        for (const pve of props.overview.proxmox) {
          if (pve.isDemo) continue;
          if (pve.nodes.length > 0) {
            for (const node of pve.nodes) {
              pushDevice(
                {
                  key: `pve:${pve.configId}:${node.node}`,
                  name: pve.name || node.node,
                  kind: 'proxmox',
                  badge: 'PROXMOX',
                  ipAddress: node.ipAddress || pve.host,
                  status: node.status === 'online' ? 'online' : 'offline',
                  heightU: 2,
                  portCount: 4,
                  sfpPortCount: 2,
                  driveBays: 4,
                  slotsTotal: 1,
                  consoleTab: 'proxmox',
                },
                [pve.name, node.node],
              );
            }
          } else {
            pushDevice({
              key: `pve:${pve.configId}`,
              name: pve.name,
              kind: 'proxmox',
              badge: 'PROXMOX',
              ipAddress: pve.host,
              status: pve.status === 'online' ? 'online' : 'offline',
              heightU: 2,
              portCount: 4,
              sfpPortCount: 2,
              driveBays: 4,
              slotsTotal: 1,
              consoleTab: 'proxmox',
            });
          }
        }
        for (const hik of props.overview.hikvision) {
          if (hik.isDemo) continue;
          pushDevice({
            key: `hik:${hik.configId}`,
            name: hik.model && hik.model !== '-' ? `${hik.name} (${hik.model})` : hik.name,
            kind: 'nvr',
            badge: 'HIK NVR',
            ipAddress: hik.host,
            status: hik.status === 'online' ? 'online' : 'offline',
            heightU: 2,
            portCount: 16,
            sfpPortCount: 2,
            driveBays: Math.max(4, hik.hdds.length || 4),
            slotsTotal: 1,
            consoleTab: 'hikvision',
          });
        }
        for (const srv of props.overview.servers) {
          if (srv.config.isDemo) continue;
          const ip = srv.metrics.ipAddress || srv.config.host;
          const isMini = /pi|nuc|mini|tiny/i.test(srv.config.name);
          pushDevice({
            key: `ssh:${srv.config.id}`,
            name: srv.config.name,
            kind: isMini ? 'mini-pc' : 'server',
            badge: 'SSH HOST',
            ipAddress: ip,
            status: srv.metrics.status === 'online' ? 'online' : 'offline',
            heightU: 1,
            portCount: 2,
            sfpPortCount: 0,
            driveBays: isMini ? 0 : 4,
            slotsTotal: isMini ? 2 : 1,
            consoleTab: 'servers',
          });
        }
      }

      // 2) Topology Canvas Nodes ( excluding virtual guests / cloud ISP )
      for (const n of props.nodes) {
        if (n.kind === 'isp' || n.kind === 'vm' || n.kind === 'lxc' || n.kind === 'docker') continue;
        const heightU = n.kind === 'ai' ? 4 : n.kind === 'nas' || n.kind === 'proxmox' || n.kind === 'nvr' ? 2 : 1;
        pushDevice({
          key: `node:${n.id}`,
          nodeId: n.id,
          name: n.name,
          kind: n.kind,
          badge: n.kind.toUpperCase(),
          ipAddress: n.ipAddress,
          status: n.status === 'offline' ? 'offline' : 'online',
          heightU,
          portCount: n.kind === 'switch' ? 16 : n.kind === 'firewall' || n.kind === 'router' ? 8 : 2,
          sfpPortCount: n.kind === 'switch' ? 4 : n.kind === 'firewall' ? 2 : 0,
          driveBays: n.kind === 'nas' || n.kind === 'proxmox' || n.kind === 'nvr' || n.kind === 'server' ? 4 : 0,
          slotsTotal: 1,
          consoleTab: n.linkedSourceKind === 'ssh' ? 'servers' : n.linkedSourceKind,
        });
      }

      // 3) Subnet Scanner Discovery Queue
      for (const d of props.discoveryQueue) {
        const heightU = d.guessedKind === 'proxmox' || d.guessedKind === 'nas' || d.guessedKind === 'nvr' ? 2 : 1;
        pushDevice({
          key: `disc:${d.id}`,
          discoveryId: d.id,
          name: d.hostname && !d.hostname.startsWith('host-') ? d.hostname : `${d.vendor || 'Device'} (${d.ipAddress})`,
          kind: d.guessedKind,
          badge: 'DISCOVERED',
          ipAddress: d.ipAddress,
          status: 'online',
          heightU,
          portCount: d.guessedKind === 'switch' ? 16 : 2,
          sfpPortCount: d.guessedKind === 'switch' ? 4 : 0,
          driveBays: heightU >= 2 ? 4 : 0,
          slotsTotal: 1,
        });
      }

      return list;
    });

    const unmountedRealDevices = computed(() =>
      allRealDevices.value.filter((d) => !d.alreadyMounted),
    );

    const displayedRealDevices = computed(() =>
      showAllRealDevices.value ? allRealDevices.value : unmountedRealDevices.value,
    );

    const selectedItemLinkKey = computed(() => {
      if (!selectedItem.value) return '';
      const it = selectedItem.value.item;
      const match = allRealDevices.value.find(
        (d) =>
          (it.nodeId && d.nodeId === it.nodeId) ||
          (it.ipAddress && d.ipAddress && it.ipAddress.toLowerCase() === d.ipAddress.toLowerCase()) ||
          it.name.toLowerCase() === d.name.toLowerCase(),
      );
      return match ? match.key : '';
    });

    const selectedItemConsoleTab = computed(() => {
      if (!selectedItem.value) return '';
      const it = selectedItem.value.item;
      if (it.kind === 'proxmox') return 'proxmox';
      if (it.kind === 'firewall') return 'opnsense';
      if (it.kind === 'nvr') return 'hikvision';
      if (it.kind === 'server' || it.kind === 'mini-pc') return 'servers';
      const match = allRealDevices.value.find((d) => d.key === selectedItemLinkKey.value);
      return match?.consoleTab || '';
    });

    // Collect all patches across all racks (deduplicated by patch id)
    const allPatches = computed<TopologyPatchCable[]>(() => {
      const seen = new Set<string>();
      const out: TopologyPatchCable[] = [];
      for (const r of props.racks) {
        for (const p of r.patches) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            out.push(p);
          }
        }
      }
      return out;
    });

    // Map of "itemId:portId" -> connected cable color
    const portColorMap = computed<Record<string, string>>(() => {
      const map: Record<string, string> = {};
      for (const p of allPatches.value) {
        const c = p.color || '#22c55e';
        map[`${p.fromItemId}:${p.fromPort}`] = c;
        map[`${p.toItemId}:${p.toPort}`] = c;
      }
      return map;
    });

    // Compute exact SVG geometry for each rack elevation column (Front, Rear, or Front + Rear side-by-side)
    const rackGeometries = computed<RackGeometry[]>(() => {
      const columns: Array<{ rack: TopologyRack; face: 'front' | 'rear' }> = [];
      for (const rack of props.racks) {
        if (faceViewMode.value === 'both') {
          columns.push({ rack, face: 'front' });
          columns.push({ rack, face: 'rear' });
        } else if (faceViewMode.value === 'rear') {
          columns.push({ rack, face: 'rear' });
        } else {
          columns.push({ rack, face: 'front' });
        }
      }

      let cursorX = marginLeftPx;
      return columns.map(({ rack, face }) => {
        const x = cursorX;
        const y = marginTopPx;
        const width = rack.widthInches === 10 ? 310 : rackWidthPx;
        cursorX += width + rackGapPx;
        const height = rack.totalU * uHeightPx + 16;
        const innerX = x + 36;
        const innerW = width - 58;

        const uRows: Array<{ u: number; y: number }> = [];
        for (let u = rack.totalU; u >= 1; u--) {
          const rowIndexFromTop = rack.totalU - u;
          uRows.push({
            u,
            y: y + 8 + rowIndexFromTop * uHeightPx,
          });
        }

        // Merge items located on THIS face of this rack, applying live drag preview coordinates when an item is being dragged
        const effectiveItems: TopologyRackSlotItem[] = rack.items
          .filter((it) => {
            if (dragState.active && dragState.moved && it.id === dragState.itemId) return false;
            const itemFace = it.face === 'rear' ? 'rear' : 'front';
            return itemFace === face;
          })
          .map((it) => ({ ...it }));

        if (
          dragState.active &&
          dragState.moved &&
          dragState.targetRackId === rack.id &&
          dragState.targetFace === face
        ) {
          let draggedOriginal: TopologyRackSlotItem | undefined;
          for (const r of props.racks) {
            const found = r.items.find((i) => i.id === dragState.itemId);
            if (found) {
              draggedOriginal = found;
              break;
            }
          }
          if (draggedOriginal) {
            effectiveItems.push({
              ...draggedOriginal,
              face,
              startU: dragState.targetU,
              slotIndex: dragState.slotsTotal > 1 ? dragState.targetSlotIndex : draggedOriginal.slotIndex,
            });
          }
        }

        // Track which U slots are occupied on this face so we can show subtle opposite-face pass-through silhouettes on remaining U slots
        const occupiedUsOnThisFace = new Set<number>();
        for (const it of effectiveItems) {
          for (let u = it.startU; u < it.startU + it.heightU; u++) {
            occupiedUsOnThisFace.add(u);
          }
        }

        const passThroughItems: PassThroughItemGeometry[] = rack.items
          .filter((it) => {
            if (dragState.active && dragState.moved && it.id === dragState.itemId) return false;
            const itemFace = it.face === 'rear' ? 'rear' : 'front';
            if (itemFace === face) return false;
            if (it.kind === 'blank' || it.kind === 'cable-manager') return false;
            // Only show pass-through silhouette if none of its U slots are covered by equipment on this face
            for (let u = it.startU; u < it.startU + it.heightU; u++) {
              if (occupiedUsOnThisFace.has(u)) return false;
            }
            return true;
          })
          .map((item) => {
            const topU = item.startU + item.heightU - 1;
            const rowIndexFromTop = rack.totalU - topU;
            const itemY = y + 8 + rowIndexFromTop * uHeightPx + 2;
            const itemH = item.heightU * uHeightPx - 4;
            const slotsTotal = Math.max(1, Number(item.slotsTotal) || 1);
            const slotIndex = Math.max(0, Math.min(slotsTotal - 1, Number(item.slotIndex) || 0));
            const slotGap = 4;
            const slotW = Math.floor((innerW - (slotsTotal - 1) * slotGap) / slotsTotal);
            const itemX = innerX + slotIndex * (slotW + slotGap);
            return {
              item,
              x: itemX,
              y: itemY,
              w: slotW,
              h: itemH,
            };
          });

        const mountedItems: MountedItemGeometry[] = effectiveItems.map((item) => {
          const topU = item.startU + item.heightU - 1;
          const rowIndexFromTop = rack.totalU - topU;
          const itemY = y + 8 + rowIndexFromTop * uHeightPx + 1.5;
          const itemH = item.heightU * uHeightPx - 3;

          const slotsTotal = Math.max(1, Number(item.slotsTotal) || 1);
          const slotIndex = Math.max(0, Math.min(slotsTotal - 1, Number(item.slotIndex) || 0));
          const slotGap = 4;
          const slotW = Math.floor((innerW - (slotsTotal - 1) * slotGap) / slotsTotal);
          const itemX = innerX + slotIndex * (slotW + slotGap);

          const fillColor =
            item.kind === 'blank'
              ? '#111723'
              : item.kind === 'cable-manager'
                ? '#0d131d'
                : item.kind === 'patch-panel'
                  ? '#1a2334'
                  : '#1c2638';

          const maxLabelChars = slotsTotal === 3 ? 10 : slotsTotal === 2 ? 15 : 18;

          // Build interactive ports on this faceplate
          const ports: PortCoord[] = [];
          const totalPorts = Number(item.portCount) || 0;
          const sfpCount = Number(item.sfpPortCount) || 0;
          const portY = itemY + Math.min(14, itemH / 2);

          if (item.kind === 'patch-panel') {
            const count = Math.min(24, Math.max(12, totalPorts || 24));
            const startX = itemX + 96;
            const spacing = Math.min(12.2, (slotW - 106) / count);
            for (let i = 1; i <= count; i++) {
              const pId = String(i);
              ports.push({
                portId: pId,
                x: Math.round(startX + (i - 1) * spacing),
                y: portY,
                isSfp: false,
                connectedColor: portColorMap.value[`${item.id}:${pId}`],
              });
            }
          } else if (item.kind === 'switch') {
            const swMeta = item.switchMeta;
            const sfpPorts = swMeta ? swMeta.sfpPortCount : sfpCount || 4;
            const rjCount = swMeta
              ? swMeta.rj45PortCount
              : totalPorts >= 20
                ? Math.max(16, totalPorts - sfpPorts)
                : Math.min(16, Math.max(4, totalPorts - sfpPorts || 12));

            const buildPortMeta = (pNum: number, isSfpPort: boolean) => {
              const pId = String(pNum);
              const livePort = swMeta?.ports?.find((sp) => sp.portNumber === pNum);
              const liveStatusColor =
                livePort?.linkStatus === 'up'
                  ? /100M|10M/i.test(livePort.speed)
                    ? '#f59e0b'
                    : '#22c55e'
                  : undefined;
              const poeInfo = livePort?.poeActive
                ? ` · PoE+ ${livePort.poeWatts ? livePort.poeWatts + 'W' : 'ON'}`
                : '';
              const peerInfo = livePort?.connectedDeviceName
                ? ` · Connected: ${livePort.connectedDeviceName}`
                : livePort?.connectedMac
                  ? ` · MAC: ${livePort.connectedMac}`
                  : '';
              const tooltip = `${item.name}${swMeta?.model && !item.name.includes(swMeta.model) ? ` (${swMeta.model})` : ''} · Port ${pId}${livePort?.name ? ` (${livePort.name})` : ''}${isSfpPort ? ' [SFP]' : ''}${livePort ? ` · ${livePort.linkStatus.toUpperCase()} (${livePort.speed})` : ''}${poeInfo}${peerInfo}`;
              return {
                pId,
                liveStatusColor,
                poeActive: Boolean(livePort?.poeActive),
                tooltip,
              };
            };

            if (rjCount >= 20) {
              // Authentic Dual-Row 24x RJ45 (3 blocks of 2x4, Odd ports top row, Even ports bottom row) + 4x SFP Cages (T1600G-28TS / T1600G-28PS layout)
              const startX = itemX + 124;
              const topRowY = itemY + 7.5;
              const botRowY = itemY + 16.5;
              const colCount = Math.ceil(rjCount / 2);

              for (let col = 0; col < colCount; col++) {
                const blockGap = Math.floor(col / 4) * 5;
                const px = startX + col * 12.5 + blockGap;

                // Top Row: Odd port (1, 3, 5 ... 23)
                const oddPortNum = col * 2 + 1;
                if (oddPortNum <= rjCount) {
                  const pm = buildPortMeta(oddPortNum, false);
                  ports.push({
                    portId: pm.pId,
                    x: px,
                    y: topRowY,
                    size: 7.4,
                    isSfp: false,
                    connectedColor: portColorMap.value[`${item.id}:${pm.pId}`],
                    liveStatusColor: pm.liveStatusColor,
                    poeActive: pm.poeActive,
                    tooltip: pm.tooltip,
                  });
                }

                // Bottom Row: Even port (2, 4, 6 ... 24)
                const evenPortNum = col * 2 + 2;
                if (evenPortNum <= rjCount) {
                  const pm = buildPortMeta(evenPortNum, false);
                  ports.push({
                    portId: pm.pId,
                    x: px,
                    y: botRowY,
                    size: 7.4,
                    isSfp: false,
                    connectedColor: portColorMap.value[`${item.id}:${pm.pId}`],
                    liveStatusColor: pm.liveStatusColor,
                    poeActive: pm.poeActive,
                    tooltip: pm.tooltip,
                  });
                }
              }

              // 4x SFP Cages on the right (Ports 25, 26, 27, 28)
              const sfpStartX = startX + colCount * 12.5 + Math.floor((colCount - 1) / 4) * 5 + 10;
              for (let s = 1; s <= sfpPorts; s++) {
                const sfpPortNum = rjCount + s;
                const pm = buildPortMeta(sfpPortNum, true);
                ports.push({
                  portId: pm.pId,
                  x: sfpStartX + (s - 1) * 12,
                  y: portY,
                  size: 8.4,
                  isSfp: true,
                  connectedColor: portColorMap.value[`${item.id}:${pm.pId}`],
                  liveStatusColor: pm.liveStatusColor,
                  poeActive: false,
                  tooltip: pm.tooltip,
                });
              }
            } else {
              // Compact Single-Row Switch (8–16 ports)
              const startX = itemX + 102;
              for (let i = 1; i <= rjCount; i++) {
                const pm = buildPortMeta(i, false);
                ports.push({
                  portId: pm.pId,
                  x: startX + (i - 1) * 13,
                  y: portY,
                  isSfp: false,
                  connectedColor: portColorMap.value[`${item.id}:${pm.pId}`],
                  liveStatusColor: pm.liveStatusColor,
                  poeActive: pm.poeActive,
                  tooltip: pm.tooltip,
                });
              }
              const sfpStart = startX + rjCount * 13 + 10;
              for (let s = 1; s <= sfpPorts; s++) {
                const sfpPortNum = rjCount + s;
                const pm = buildPortMeta(sfpPortNum, true);
                ports.push({
                  portId: pm.pId,
                  x: sfpStart + (s - 1) * 14,
                  y: portY,
                  isSfp: true,
                  connectedColor: portColorMap.value[`${item.id}:${pm.pId}`],
                  liveStatusColor: pm.liveStatusColor,
                  poeActive: false,
                  tooltip: pm.tooltip,
                });
              }
            }
          } else if (item.kind === 'fiber-patch' || item.kind === 'firewall' || item.kind === 'router') {
            const count = Math.min(12, Math.max(4, totalPorts || 8));
            const startX = itemX + 115;
            for (let i = 1; i <= count; i++) {
              const pId = String(i);
              ports.push({
                portId: pId,
                x: startX + (i - 1) * 20,
                y: portY,
                isSfp: item.kind === 'fiber-patch' || i > count - 2,
                connectedColor: portColorMap.value[`${item.id}:${pId}`],
              });
            }
          } else if (totalPorts > 0) {
            // Servers, Proxmox nodes, NAS, NVR, Mini-PCs, NUCs, Raspberry Pis: place ports on right side
            const count = Math.min(6, totalPorts);
            for (let i = 1; i <= count; i++) {
              const pId = String(i);
              ports.push({
                portId: pId,
                x: itemX + slotW - 14 - (count - i) * 14,
                y: portY,
                isSfp: false,
                connectedColor: portColorMap.value[`${item.id}:${pId}`],
              });
            }
          }

          // Drive bays (NAS / Proxmox / Server / NVR)
          const driveBays: Array<{ x: number; y: number; w: number; h: number }> = [];
          const bayCount =
            item.driveBays !== undefined
              ? item.driveBays
              : item.kind === 'nas' || item.kind === 'proxmox' || item.kind === 'nvr' || item.kind === 'server'
                ? 4
                : 0;
          if (bayCount > 0 && slotsTotal === 1) {
            const bayStartX = itemX + 118;
            const bayW = 36;
            const bayH = Math.max(14, itemH - 10);
            for (let b = 0; b < Math.min(6, bayCount); b++) {
              driveBays.push({
                x: bayStartX + b * (bayW + 4),
                y: itemY + 5,
                w: bayW,
                h: bayH,
              });
            }
          }

          // Power Outlets (PDU / UPS)
          const outlets: Array<{ x: number; y: number; w: number; h: number }> = [];
          const outCount = item.outletCount || (item.kind === 'pdu' ? 8 : item.kind === 'ups' ? 4 : 0);
          if (outCount > 0) {
            const startOutX = item.kind === 'ups' ? itemX + 225 : itemX + 128;
            const stepOut = item.kind === 'ups' ? 36 : 30;
            for (let o = 0; o < outCount; o++) {
              outlets.push({
                x: startOutX + o * stepOut,
                y: itemY + (itemH - 12) / 2,
                w: item.kind === 'ups' ? 24 : 14,
                h: 12,
              });
            }
          }

          // Ventilation Grille Dots (UPS / Mini-PC)
          const ventDots: Array<{ x: number; y: number }> = [];
          if (item.kind === 'ups') {
            for (let row = 0; row < 3; row++) {
              for (let col = 0; col < 10; col++) {
                ventDots.push({
                  x: itemX + 118 + col * 8,
                  y: itemY + 12 + row * 9,
                });
              }
            }
          } else if (item.kind === 'mini-pc') {
            for (let row = 0; row < 2; row++) {
              for (let col = 0; col < 6; col++) {
                ventDots.push({
                  x: itemX + slotW - 65 + col * 5,
                  y: itemY + 8 + row * 6,
                });
              }
            }
          }

          // Overlay live online/offline status from linked real device if matched by nodeId, IP, or name
          const linkedReal = allRealDevices.value.find(
            (d) =>
              (item.nodeId && d.nodeId === item.nodeId) ||
              (item.ipAddress && d.ipAddress && item.ipAddress.toLowerCase() === d.ipAddress.toLowerCase()) ||
              item.name.toLowerCase() === d.name.toLowerCase(),
          );
          const effectiveStatus = linkedReal ? linkedReal.status : item.status;

          return {
            rackId: rack.id,
            item: effectiveStatus ? { ...item, status: effectiveStatus } : item,
            x: itemX,
            y: itemY,
            w: slotW,
            h: itemH,
            fillColor,
            maxLabelChars,
            ports,
            driveBays,
            outlets,
            ventDots,
          };
        });

        return {
          columnKey: `${rack.id}:${face}`,
          rack,
          face,
          x,
          y,
          width,
          height,
          innerX,
          innerW,
          uRows,
          mountedItems,
          passThroughItems,
        };
      });
    });

    const svgWidth = computed(() => {
      if (rackGeometries.value.length === 0) return 980;
      const last = rackGeometries.value[rackGeometries.value.length - 1];
      return Math.max(980, last.x + last.width + 48);
    });

    const svgHeight = computed(() => {
      let maxH = 680;
      for (const rg of rackGeometries.value) {
        if (rg.y + rg.height + 36 > maxH) maxH = rg.y + rg.height + 36;
      }
      return maxH;
    });

    const dragGhostRect = computed(() => {
      if (!dragState.active || !dragState.moved) return null;
      const rg = rackGeometries.value.find(
        (r) => r.rack.id === dragState.targetRackId && r.face === dragState.targetFace,
      );
      if (!rg) return null;
      const topU = dragState.targetU + dragState.heightU - 1;
      const rowIndexFromTop = rg.rack.totalU - topU;
      const y = rg.y + 8 + rowIndexFromTop * uHeightPx + 1;
      const h = dragState.heightU * uHeightPx - 2;
      const slotsTotal = Math.max(1, dragState.slotsTotal);
      const slotIndex = Math.max(0, Math.min(slotsTotal - 1, dragState.targetSlotIndex));
      const slotGap = 4;
      const w = Math.floor((rg.innerW - (slotsTotal - 1) * slotGap) / slotsTotal);
      const x = rg.innerX + slotIndex * (w + slotGap);
      return { x, y, w, h };
    });

    // Build curved cubic-Bezier SVG path for every patch cable
    const renderedPatchCables = computed(() => {
      // Index all ports by itemId + portId and fallback first port of itemId
      const portIndex = new Map<string, { x: number; y: number; columnKey: string }>();
      for (const rg of rackGeometries.value) {
        for (const m of rg.mountedItems) {
          for (const p of m.ports) {
            portIndex.set(`${m.item.id}:${p.portId}`, { x: p.x, y: p.y, columnKey: rg.columnKey });
            if (!portIndex.has(`${m.item.id}:first`)) {
              portIndex.set(`${m.item.id}:first`, { x: p.x, y: p.y, columnKey: rg.columnKey });
            }
          }
          if (!portIndex.has(`${m.item.id}:first`)) {
            portIndex.set(`${m.item.id}:first`, {
              x: m.x + m.w - 18,
              y: m.y + m.h / 2,
              columnKey: rg.columnKey,
            });
          }
        }
        // Also index passThroughItems fallback coordinates so single-face views still render cross-face cables cleanly
        for (const pt of rg.passThroughItems) {
          if (!portIndex.has(`${pt.item.id}:first`)) {
            portIndex.set(`${pt.item.id}:first`, {
              x: pt.x + pt.w - 18,
              y: pt.y + pt.h / 2,
              columnKey: rg.columnKey,
            });
          }
        }
      }

      return allPatches.value
        .map((patch, idx) => {
          const cleanFromPort = String(patch.fromPort || '1').replace(/[^0-9]/g, '') || '1';
          const cleanToPort = String(patch.toPort || '1').replace(/[^0-9]/g, '') || '1';

          const src =
            portIndex.get(`${patch.fromItemId}:${patch.fromPort}`) ||
            portIndex.get(`${patch.fromItemId}:${cleanFromPort}`) ||
            portIndex.get(`${patch.fromItemId}:first`);
          const dst =
            portIndex.get(`${patch.toItemId}:${patch.toPort}`) ||
            portIndex.get(`${patch.toItemId}:${cleanToPort}`) ||
            portIndex.get(`${patch.toItemId}:first`);

          if (!src || !dst) return null;

          const x1 = src.x;
          const y1 = src.y;
          const x2 = dst.x;
          const y2 = dst.y;
          const isCrossRack = src.columnKey !== dst.columnKey;

          let cx1: number;
          let cy1: number;
          let cx2: number;
          let cy2: number;

          if (isCrossRack) {
            // Sweeping inter-rack trunk curve
            const spanX = x2 - x1;
            cx1 = x1 + spanX * 0.35;
            cy1 = Math.min(y1, y2) - 18;
            cx2 = x1 + spanX * 0.65;
            cy2 = Math.max(y1, y2) + 18;
          } else {
            // Natural hanging/sweeping intra-rack patch cord
            const dy = Math.abs(y2 - y1);
            const dx = x2 - x1;
            const bowX = Math.abs(dx) < 35 ? 24 + (idx % 3) * 8 : dx * 0.15;
            const sagY = Math.min(48, Math.max(14, dy * 0.32));
            cx1 = x1 + bowX;
            cy1 = y1 + sagY;
            cx2 = x2 + bowX;
            cy2 = y2 + (y2 >= y1 ? -sagY * 0.35 : sagY);
          }

          const pathD = `M ${x1} ${y1} C ${Math.round(cx1)} ${Math.round(cy1)}, ${Math.round(cx2)} ${Math.round(cy2)}, ${x2} ${y2}`;
          // Midpoint on cubic Bezier at t = 0.5
          const mx = Math.round(0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2);
          const my = Math.round(0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2);

          const isConnectedToHoverItem =
            !hoveredItemId.value ||
            patch.fromItemId === hoveredItemId.value ||
            patch.toItemId === hoveredItemId.value;
          const dimmed =
            (cableVisibility.value === 'hover' && !hoveredItemId.value && !hoveredCableId.value) ||
            (Boolean(hoveredItemId.value) && !isConnectedToHoverItem);

          return {
            patch,
            x1,
            y1,
            x2,
            y2,
            mx,
            my,
            pathD,
            isCrossRack,
            dimmed,
          };
        })
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
    });

    // Fleet rack summary stats (Racks, Mounted, Cables, Free U / Total U)
    const totalMountedCount = computed(() =>
      props.racks.reduce((acc, r) => acc + r.items.length, 0),
    );

    const totalCablesCount = computed(() => allPatches.value.length);

    const totalUnitsCount = computed(() =>
      props.racks.reduce((acc, r) => acc + r.totalU, 0),
    );

    const freeUnitsCount = computed(() => {
      let occupied = 0;
      for (const r of props.racks) {
        const usedU = new Set<number>();
        for (const it of r.items) {
          for (let u = it.startU; u < it.startU + it.heightU; u++) {
            usedU.add(u);
          }
        }
        occupied += usedU.size;
      }
      return Math.max(0, totalUnitsCount.value - occupied);
    });

    function togglePatchingMode() {
      patchingMode.value = !patchingMode.value;
      if (!patchingMode.value) {
        selectedPort.value = null;
      }
    }

    function selectCablePalette(c: { color: string; kind: TopologyPatchCable['cableKind'] }) {
      activeCableColor.value = c.color;
      activeCableKind.value = c.kind;
    }

    function cycleCableVisibility() {
      if (cableVisibility.value === 'always') cableVisibility.value = 'hover';
      else if (cableVisibility.value === 'hover') cableVisibility.value = 'hidden';
      else cableVisibility.value = 'always';
    }

    function isPortSelected(itemId: string, portId: string): boolean {
      return Boolean(
        selectedPort.value && selectedPort.value.itemId === itemId && selectedPort.value.port === portId,
      );
    }

    async function onPortClick(rackId: string, item: TopologyRackSlotItem, portId: string) {
      patchingMode.value = true;
      if (!selectedPort.value) {
        selectedPort.value = {
          rackId,
          itemId: item.id,
          itemName: item.name,
          port: portId,
        };
        return;
      }

      if (selectedPort.value.itemId === item.id && selectedPort.value.port === portId) {
        selectedPort.value = null;
        return;
      }

      const src = selectedPort.value;
      selectedPort.value = null;
      const isCross = src.rackId !== rackId;

      try {
        await api.upsertTopologyRackPatch(src.rackId, {
          fromRackId: src.rackId,
          fromItemId: src.itemId,
          fromPort: src.port,
          toRackId: rackId,
          toItemId: item.id,
          toPort: portId,
          cableKind: activeCableKind.value,
          color: activeCableColor.value,
          label: isCross ? '10G trunk A<->B' : '',
        });
        emit('updated');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to patch ports', error: true });
      }
    }

    async function onCableClick(patch: TopologyPatchCable) {
      const ownerRackId = patch.rackId || patch.fromRackId || activeRackId.value;
      try {
        await api.deleteTopologyRackPatch(ownerRackId, patch.id);
        emit('updated');
        emit('toast', { message: `Removed patch cable ${patch.label || patch.id}`, error: false });
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to remove cable', error: true });
      }
    }

    function setFaceViewMode(mode: 'both' | 'front' | 'rear') {
      faceViewMode.value = mode;
      if (mode === 'front' || mode === 'rear') {
        targetFace.value = mode;
      }
    }

    function selectActiveRack(rackId: string, face?: 'front' | 'rear') {
      activeRackId.value = rackId;
      if (face) targetFace.value = face;
    }

    function selectRackSlot(rackId: string, u: number, face?: 'front' | 'rear') {
      activeRackId.value = rackId;
      targetU.value = u;
      if (face) targetFace.value = face;
    }

    function selectMountedItem(rackId: string, item: TopologyRackSlotItem) {
      if (selectedItem.value && selectedItem.value.item.kind === 'switch') {
        selectedSwitchCredsById[selectedItem.value.item.id] = {
          username: selectedSwitchCreds.username,
          password: selectedSwitchCreds.password,
          protocol: selectedSwitchCreds.protocol,
        };
      }
      activeRackId.value = rackId;
      targetU.value = item.startU;
      targetFace.value = item.face === 'rear' ? 'rear' : 'front';
      selectedItem.value = { rackId, item };
      if (item.kind === 'switch') {
        const cached = selectedSwitchCredsById[item.id];
        const proto = item.switchMeta?.managementProtocol;
        selectedSwitchCreds.username = cached?.username || item.switchMeta?.username || 'admin';
        selectedSwitchCreds.password = cached?.password || '';
        selectedSwitchCreds.protocol =
          cached?.protocol ||
          (proto === 'ssh' || proto === 'telnet' || proto === 'http' || proto === 'snmp' ? proto : 'auto');
      }
    }

    async function quickMountAccessory(acc: {
      kind: TopologyRackSlotItem['kind'];
      name: string;
      heightU: number;
      portCount: number;
      sfpPortCount?: number;
      modelPreset?: string;
    }) {
      if (!activeRack.value) return;
      try {
        if (acc.kind === 'switch' && acc.modelPreset) {
          await api.probeTopologySwitch({
            host: '',
            name: acc.name,
            modelPreset: acc.modelPreset,
            rackId: activeRack.value.id,
            startU: targetU.value,
            face: targetFace.value,
            mountInRack: true,
          });
        } else {
          await api.upsertTopologyRackItem(activeRack.value.id, {
            name: acc.name,
            kind: acc.kind,
            startU: targetU.value,
            heightU: acc.heightU,
            face: targetFace.value,
            portCount: acc.portCount,
            sfpPortCount: acc.sfpPortCount,
          });
        }
        targetU.value = Math.max(1, targetU.value - 1);
        emit('updated');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to mount accessory', error: true });
      }
    }

    async function probeAndMountSwitch() {
      if (!activeRack.value) return;
      probingSwitch.value = true;
      try {
        const res = await api.probeTopologySwitch({
          host: switchProbeForm.host.trim(),
          protocol: switchProbeForm.protocol,
          username: switchProbeForm.username.trim() || 'admin',
          password: switchProbeForm.password,
          modelPreset: switchProbeForm.modelPreset,
          rackId: activeRack.value.id,
          startU: targetU.value,
          face: targetFace.value,
          mountInRack: true,
        });
        targetU.value = Math.max(1, targetU.value - 1);
        emit('updated');
        emit('toast', {
          message: res.probe.message,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Switch probe failed',
          error: true,
        });
      } finally {
        probingSwitch.value = false;
      }
    }

    async function repollSelectedSwitch() {
      if (!selectedItem.value || selectedItem.value.item.kind !== 'switch') return;
      const it = selectedItem.value.item;
      const host = it.ipAddress || '';
      selectedSwitchCredsById[it.id] = {
        username: selectedSwitchCreds.username,
        password: selectedSwitchCreds.password,
        protocol: selectedSwitchCreds.protocol,
      };
      probingSwitch.value = true;
      try {
        const res = await api.probeTopologySwitch({
          host,
          name: it.name,
          protocol: selectedSwitchCreds.protocol,
          username: selectedSwitchCreds.username.trim() || it.switchMeta?.username || 'admin',
          password: selectedSwitchCreds.password,
          modelPreset: it.switchMeta?.model || 'T1600G-28TS',
          nodeId: it.nodeId,
          rackId: selectedItem.value.rackId,
          rackItemId: it.id,
          startU: it.startU,
          face: it.face,
          mountInRack: true,
        });
        emit('updated');
        emit('toast', {
          message: res.probe.message,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to poll switch',
          error: true,
        });
      } finally {
        probingSwitch.value = false;
      }
    }

    async function mountCustomDevice() {
      if (!activeRack.value || !customItem.name.trim()) return;
      try {
        await api.upsertTopologyRackItem(activeRack.value.id, {
          name: customItem.name.trim(),
          kind: customItem.kind,
          startU: targetU.value,
          heightU: customItem.heightU,
          face: targetFace.value,
          slotsTotal: customItem.slotsTotal,
          slotIndex: customItem.slotsTotal > 1 ? customItem.slotIndex : 0,
        });
        customItem.name = '';
        emit('updated');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to mount device', error: true });
      }
    }

    async function nudgeSelectedItem(deltaU: number) {
      if (!selectedItem.value) return;
      const r = props.racks.find((rk) => rk.id === selectedItem.value!.rackId);
      if (!r) return;
      const it = selectedItem.value.item;
      const nextU = Math.max(1, Math.min(r.totalU - it.heightU + 1, it.startU + deltaU));
      await api.upsertTopologyRackItem(r.id, {
        ...it,
        startU: nextU,
      });
      emit('updated');
    }

    async function flipSelectedItemFace() {
      if (!selectedItem.value) return;
      const r = props.racks.find((rk) => rk.id === selectedItem.value!.rackId);
      if (!r) return;
      const it = selectedItem.value.item;
      const nextFace: 'front' | 'rear' = (it.face || 'front') === 'rear' ? 'front' : 'rear';
      try {
        await api.moveTopologyRackItem({
          fromRackId: r.id,
          toRackId: r.id,
          itemId: it.id,
          startU: it.startU,
          slotIndex: it.slotIndex,
          face: nextFace,
        });
        targetFace.value = nextFace;
        if (faceViewMode.value !== 'both' && faceViewMode.value !== nextFace) {
          faceViewMode.value = 'both';
        }
        emit('updated');
        emit('toast', {
          message: `Flipped ${it.name} to ${nextFace.toUpperCase()} rails (U${it.startU})`,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to flip device rail face',
          error: true,
        });
      }
    }

    async function unmountSelectedItem() {
      if (!selectedItem.value) return;
      await api.deleteTopologyRackItem(selectedItem.value.rackId, selectedItem.value.item.id);
      selectedItem.value = null;
      emit('updated');
    }

    async function handleCreateRack() {
      if (!newRack.name.trim()) return;
      try {
        const created = await api.upsertTopologyRack({
          name: newRack.name.trim(),
          location: newRack.location.trim() || 'Garage',
          widthInches: newRack.widthInches,
          totalU: newRack.totalU,
        });
        newRack.name = '';
        creatingRack.value = false;
        activeRackId.value = created.id;
        emit('updated');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to create rack', error: true });
      }
    }

    // ---- Interactive Drag-to-U-Slot (Mouse + Touch) & Stage Pan/Zoom ----
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;

    function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
      if (!rackSvgEl.value) return null;
      const rect = rackSvgEl.value.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const scaleX = svgWidth.value / rect.width;
      const scaleY = svgHeight.value / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    }

    function beginItemDrag(
      clientX: number,
      clientY: number,
      rack: TopologyRack,
      m: MountedItemGeometry,
      face: 'front' | 'rear',
    ) {
      panning = false;
      const itemFace = face || (m.item.face === 'rear' ? 'rear' : 'front');
      dragState.active = true;
      dragState.moved = false;
      dragState.itemId = m.item.id;
      dragState.itemName = m.item.name;
      dragState.heightU = m.item.heightU || 1;
      dragState.slotsTotal = Math.max(1, Number(m.item.slotsTotal) || 1);
      dragState.originRackId = rack.id;
      dragState.originStartU = m.item.startU;
      dragState.originSlotIndex = Number(m.item.slotIndex) || 0;
      dragState.originFace = itemFace;
      dragState.targetRackId = rack.id;
      dragState.targetRackName = rack.name;
      dragState.targetU = m.item.startU;
      dragState.targetSlotIndex = Number(m.item.slotIndex) || 0;
      dragState.targetFace = itemFace;
      dragState.startClientX = clientX;
      dragState.startClientY = clientY;
      activeRackId.value = rack.id;
      targetFace.value = itemFace;
      selectedItem.value = { rackId: rack.id, item: m.item };
    }

    function onItemMouseDown(
      evt: MouseEvent,
      rack: TopologyRack,
      m: MountedItemGeometry,
      face: 'front' | 'rear',
    ) {
      if (evt.button !== 0) return;
      beginItemDrag(evt.clientX, evt.clientY, rack, m, face);
    }

    function onItemTouchStart(
      evt: TouchEvent,
      rack: TopologyRack,
      m: MountedItemGeometry,
      face: 'front' | 'rear',
    ) {
      if (evt.touches.length !== 1) return;
      beginItemDrag(evt.touches[0].clientX, evt.touches[0].clientY, rack, m, face);
    }

    function updateItemDragPosition(clientX: number, clientY: number) {
      if (!dragState.active) return;
      const dx = clientX - dragState.startClientX;
      const dy = clientY - dragState.startClientY;
      if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        return;
      }
      dragState.moved = true;

      const pt = clientToSvgPoint(clientX, clientY);
      if (!pt) return;

      // Determine closest rack elevation column (Front or Rear) horizontally
      let bestRg = rackGeometries.value[0];
      let bestDist = Infinity;
      for (const rg of rackGeometries.value) {
        const center = rg.x + rg.width / 2;
        const dist = Math.abs(pt.x - center);
        if (dist < bestDist) {
          bestDist = dist;
          bestRg = rg;
        }
      }
      if (!bestRg) return;

      dragState.targetRackId = bestRg.rack.id;
      dragState.targetRackName = bestRg.rack.name;
      dragState.targetFace = bestRg.face;
      activeRackId.value = bestRg.rack.id;
      targetFace.value = bestRg.face;

      // Convert SVG Y into U-slot (top of rack is totalU, bottom is 1)
      const relY = pt.y - (bestRg.y + 8);
      const rowFromTop = Math.floor(relY / uHeightPx);
      const topU = bestRg.rack.totalU - rowFromTop;
      const rawStartU = topU - dragState.heightU + 1;
      const maxStartU = Math.max(1, bestRg.rack.totalU - dragState.heightU + 1);
      const clampedU = Math.max(1, Math.min(maxStartU, rawStartU));
      dragState.targetU = clampedU;
      targetU.value = clampedU;

      // If fractional shelf item (e.g., 1/2 NUC or 1/3 Raspberry Pi), also compute horizontal shelf slot index
      if (dragState.slotsTotal > 1) {
        const relX = Math.max(0, Math.min(bestRg.innerW - 1, pt.x - bestRg.innerX));
        const slotIdx = Math.floor((relX / bestRg.innerW) * dragState.slotsTotal);
        dragState.targetSlotIndex = Math.max(0, Math.min(dragState.slotsTotal - 1, slotIdx));
      }
    }

    async function commitItemDrag() {
      if (!dragState.active) return;
      const wasMoved = dragState.moved;
      const isFromInv = dragState.isFromInventory;
      const invDev = pendingInventoryDevice.value;
      const fromRackId = dragState.originRackId;
      const toRackId = dragState.targetRackId;
      const itemId = dragState.itemId;
      const itemName = dragState.itemName;
      const nextU = dragState.targetU;
      const nextSlot = dragState.targetSlotIndex;
      const nextFace = dragState.targetFace;
      const prevFace = dragState.originFace;

      dragState.active = false;
      dragState.moved = false;
      dragState.isFromInventory = false;
      pendingInventoryDevice.value = null;

      if (isFromInv && invDev && wasMoved && toRackId) {
        await mountRealDeviceInRack(invDev, toRackId, nextU, nextSlot, nextFace);
        return;
      }

      const changed =
        wasMoved &&
        (fromRackId !== toRackId ||
          nextU !== dragState.originStartU ||
          nextFace !== prevFace ||
          (dragState.slotsTotal > 1 && nextSlot !== dragState.originSlotIndex));

      if (!changed) return;

      try {
        await api.moveTopologyRackItem({
          fromRackId,
          toRackId,
          itemId,
          startU: nextU,
          slotIndex: dragState.slotsTotal > 1 ? nextSlot : undefined,
          face: nextFace,
        });
        emit('updated');
        emit('toast', {
          message: `Moved ${itemName} to ${dragState.targetRackName} [${nextFace.toUpperCase()}] · U${nextU}`,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to move rack device',
          error: true,
        });
      }
    }

    function beginInventoryDeviceDrag(clientX: number, clientY: number, dev: RealInventoryDevice) {
      const rack = activeRack.value || props.racks[0];
      if (!rack) return;
      panning = false;
      pendingInventoryDevice.value = dev;
      dragState.active = true;
      dragState.moved = false;
      dragState.isFromInventory = true;
      dragState.itemId = `preview-${dev.key}`;
      dragState.itemName = dev.name;
      dragState.heightU = dev.heightU || 1;
      dragState.slotsTotal = dev.slotsTotal || 1;
      dragState.originRackId = rack.id;
      dragState.originStartU = targetU.value;
      dragState.originSlotIndex = 0;
      dragState.originFace = targetFace.value;
      dragState.targetRackId = rack.id;
      dragState.targetRackName = rack.name;
      dragState.targetU = targetU.value;
      dragState.targetSlotIndex = 0;
      dragState.targetFace = targetFace.value;
      dragState.startClientX = clientX;
      dragState.startClientY = clientY;
    }

    function onInventoryDeviceMouseDown(evt: MouseEvent, dev: RealInventoryDevice) {
      if (evt.button !== 0) return;
      beginInventoryDeviceDrag(evt.clientX, evt.clientY, dev);
    }

    function onInventoryDeviceTouchStart(evt: TouchEvent, dev: RealInventoryDevice) {
      if (evt.touches.length !== 1) return;
      beginInventoryDeviceDrag(evt.touches[0].clientX, evt.touches[0].clientY, dev);
    }

    async function mountRealDeviceInRack(
      dev: RealInventoryDevice,
      rackId: string,
      uSlot: number,
      slotIdx = 0,
      face: 'front' | 'rear' = targetFace.value,
    ) {
      try {
        await api.upsertTopologyRackItem(rackId, {
          nodeId: dev.nodeId,
          name: dev.name,
          kind: dev.kind,
          startU: uSlot,
          heightU: dev.heightU,
          face,
          ipAddress: dev.ipAddress,
          status: dev.status,
          portCount: dev.portCount,
          sfpPortCount: dev.sfpPortCount,
          driveBays: dev.driveBays,
          slotsTotal: dev.slotsTotal,
          slotIndex: dev.slotsTotal > 1 ? slotIdx : 0,
        });
        if (dev.discoveryId) {
          await api.approveTopologyDiscovery(dev.discoveryId).catch(() => {});
        }
        emit('updated');
        emit('toast', {
          message: `Mounted "${dev.name}" on ${face.toUpperCase()} rails at U${uSlot}`,
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to mount real device',
          error: true,
        });
      }
    }

    async function mountRealDeviceAtTarget(dev: RealInventoryDevice) {
      if (!activeRack.value) return;
      await mountRealDeviceInRack(dev, activeRack.value.id, targetU.value, 0, targetFace.value);
      targetU.value = Math.max(1, targetU.value - dev.heightU);
    }

    async function onLinkSelectedItemToRealDevice(evt: Event) {
      if (!selectedItem.value) return;
      const selectEl = evt.target as HTMLSelectElement;
      const chosenKey = selectEl.value;
      const rackId = selectedItem.value.rackId;
      const cur = selectedItem.value.item;

      if (!chosenKey) {
        await api.upsertTopologyRackItem(rackId, {
          ...cur,
          nodeId: undefined,
        });
        emit('updated');
        return;
      }

      const dev = allRealDevices.value.find((d) => d.key === chosenKey);
      if (!dev) return;

      await api.upsertTopologyRackItem(rackId, {
        ...cur,
        nodeId: dev.nodeId,
        name: dev.name,
        kind: dev.kind,
        ipAddress: dev.ipAddress,
        status: dev.status,
        portCount: dev.portCount || cur.portCount,
        sfpPortCount: dev.sfpPortCount || cur.sfpPortCount,
        driveBays: dev.driveBays || cur.driveBays,
      });
      emit('updated');
      emit('toast', {
        message: `Linked rack unit U${cur.startU} to ${dev.name} (${dev.ipAddress || dev.badge})`,
        error: false,
      });
    }

    function onStageMouseDown(evt: MouseEvent) {
      if (dragState.active) return;
      panning = true;
      panStartX = evt.clientX;
      panStartY = evt.clientY;
      panOriginX = panX.value;
      panOriginY = panY.value;
    }

    function onStageMouseMove(evt: MouseEvent) {
      if (dragState.active) {
        updateItemDragPosition(evt.clientX, evt.clientY);
        return;
      }
      if (!panning) return;
      panX.value = panOriginX + (evt.clientX - panStartX);
      panY.value = panOriginY + (evt.clientY - panStartY);
    }

    function onStageMouseUp() {
      if (dragState.active) {
        void commitItemDrag();
      }
      panning = false;
    }

    function onStageTouchStart(evt: TouchEvent) {
      if (dragState.active || evt.touches.length !== 1) return;
      panning = true;
      panStartX = evt.touches[0].clientX;
      panStartY = evt.touches[0].clientY;
      panOriginX = panX.value;
      panOriginY = panY.value;
    }

    function onStageTouchMove(evt: TouchEvent) {
      if (evt.touches.length !== 1) return;
      if (dragState.active) {
        evt.preventDefault();
        updateItemDragPosition(evt.touches[0].clientX, evt.touches[0].clientY);
        return;
      }
      if (!panning) return;
      panX.value = panOriginX + (evt.touches[0].clientX - panStartX);
      panY.value = panOriginY + (evt.touches[0].clientY - panStartY);
    }

    function onStageTouchEnd() {
      if (dragState.active) {
        void commitItemDrag();
      }
      panning = false;
    }

    function stepZoom(delta: number) {
      zoom.value = Math.max(0.55, Math.min(1.5, Math.round((zoom.value + delta) * 100) / 100));
    }

    function resetZoom() {
      zoom.value = 1;
      panX.value = 0;
      panY.value = 0;
    }

    const panZoomStyle = computed(() => ({
      transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
      transformOrigin: '0 0',
    }));

    function exportRackSvg() {
      if (!rackSvgEl.value) return;
      const serializer = new XMLSerializer();
      const rawSvg = serializer.serializeToString(rackSvgEl.value);
      const blob = new Blob([rawSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rackpanel-physical-racks.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function runRackAutoLayout() {
      if (autoLayingOut.value || props.racks.length === 0) return;
      autoLayingOut.value = true;
      try {
        const res = await api.autoLayoutTopologyRacks();
        emit('updated');
        emit('toast', {
          message:
            res.itemsMoved > 0
              ? `Auto-laid out ${res.racksArranged} rack${res.racksArranged === 1 ? '' : 's'} (${res.itemsMoved} device${res.itemsMoved === 1 ? '' : 's'} arranged)`
              : 'Rack layout is already organized',
          error: false,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to auto-layout racks',
          error: true,
        });
      } finally {
        autoLayingOut.value = false;
      }
    }

    return {
      uHeightPx,
      activeRackId,
      activeRack,
      faceViewMode,
      targetFace,
      setFaceViewMode,
      targetU,
      patchingMode,
      autoLayingOut,
      cableVisibility,
      creatingRack,
      selectedPort,
      selectedItem,
      selectedItemLinkKey,
      selectedItemConsoleTab,
      hoveredItemId,
      hoveredCableId,
      dragState,
      dragGhostRect,
      showAllRealDevices,
      allRealDevices,
      unmountedRealDevices,
      displayedRealDevices,
      cablePalette,
      activeCableColor,
      accessoriesPalette,
      savingRackSize,
      editRackSize,
      applyRackSize,
      setRackSizePreset,
      probingSwitch,
      switchProbeForm,
      selectedSwitchCreds,
      probeAndMountSwitch,
      repollSelectedSwitch,
      newRack,
      customItem,
      rackGeometries,
      svgWidth,
      svgHeight,
      renderedPatchCables,
      totalMountedCount,
      totalCablesCount,
      totalUnitsCount,
      freeUnitsCount,
      rackSvgEl,
      panZoomStyle,
      togglePatchingMode,
      runRackAutoLayout,
      selectCablePalette,
      cycleCableVisibility,
      isPortSelected,
      onPortClick,
      onCableClick,
      selectActiveRack,
      selectRackSlot,
      selectMountedItem,
      quickMountAccessory,
      mountCustomDevice,
      nudgeSelectedItem,
      flipSelectedItemFace,
      unmountSelectedItem,
      handleCreateRack,
      onItemMouseDown,
      onItemTouchStart,
      onInventoryDeviceMouseDown,
      onInventoryDeviceTouchStart,
      mountRealDeviceAtTarget,
      onLinkSelectedItemToRealDevice,
      onStageMouseDown,
      onStageMouseMove,
      onStageMouseUp,
      onStageTouchStart,
      onStageTouchMove,
      onStageTouchEnd,
      stepZoom,
      resetZoom,
      exportRackSvg,
    };
  },
});
</script>

<style scoped lang="scss">
.rv-root {
  border: 1px solid #1e2b44;
  border-radius: 6px;
  background: #080c14;
  overflow: hidden;
}

.rv-face-mode-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  border: 1px solid #263654;
  border-radius: 4px;
  overflow: hidden;
  margin-right: 6px;
}

.rv-face-mode-btn {
  background: #0b111e;
  border: none;
  border-right: 1px solid #1e2c46;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 10px;
  cursor: pointer;

  &:last-child {
    border-right: none;
  }

  &.active {
    background: rgba(34, 211, 238, 0.16);
    color: #22d3ee;
  }
}

.rv-face-picker {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.rv-face-pick-btn {
  flex: 1;
  padding: 5px 6px;
  font-size: 10px;
  font-weight: 800;
  background: #0f172a;
  border: 1px solid #23324d;
  border-radius: 4px;
  color: #94a3b8;
  cursor: pointer;

  &:first-child {
    margin-right: 4px;
  }

  &.active {
    background: rgba(34, 211, 238, 0.14);
    border-color: #22d3ee;
    color: #22d3ee;
  }

  &.rv-face-pick-rear.active {
    background: rgba(245, 158, 11, 0.15);
    border-color: #f59e0b;
    color: #fbbf24;
  }
}

.rv-face-pill {
  font-size: 9.5px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 3px;
}

.rv-face-pill-front {
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
  border: 1px solid rgba(34, 211, 238, 0.4);
}

.rv-face-pill-rear {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.45);
}

.rv-rack-size-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #162033;
}

.rv-size-presets {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.rv-size-preset-btn {
  flex: 1;
  margin-right: 3px;
  padding: 3px 0;
  font-size: 10px;
  font-weight: 700;
  background: #0f172a;
  border: 1px solid #23324d;
  border-radius: 3px;
  color: #94a3b8;
  cursor: pointer;

  &:last-child {
    margin-right: 0;
  }

  &.active {
    background: rgba(34, 211, 238, 0.15);
    border-color: #22d3ee;
    color: #22d3ee;
  }
}

.rv-topbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 9px 14px;
  background: #0d1320;
  border-bottom: 1px solid #1c283e;
}

.rv-topbar-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.rv-brand-badge {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #22d3ee;
}

.rv-color-strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 6px;
}

.rv-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  margin: 0 3px;
  cursor: pointer;

  &.active {
    border-color: #f8fafc;
    transform: scale(1.15);
  }
}

.rv-create-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: #0a0f1a;
  border-bottom: 1px solid #1c283e;
}

.rv-workspace {
  display: flex;
  flex-direction: row;
  min-height: 700px;
}

.rv-sidebar {
  width: 236px;
  min-width: 236px;
  background: #0b101b;
  border-right: 1px solid #1b263b;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.rv-side-section {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #162033;
}

.rv-side-heading-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.rv-mini-link {
  background: transparent;
  border: none;
  color: #22d3ee;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.rv-real-device-list {
  max-height: 210px;
  overflow-y: auto;
}

.rv-real-dev-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  margin-bottom: 5px;
  border-radius: 4px;
  background: #101726;
  border: 1px solid #23324d;
  cursor: grab;

  &:hover {
    border-color: #22d3ee;
  }

  &.rv-real-dev-mounted {
    opacity: 0.62;
  }
}

.rv-real-dev-info {
  min-width: 0;
  flex: 1;
  margin-right: 6px;
}

.rv-real-dev-top {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.rv-real-dev-name {
  font-size: 12px;
  font-weight: 700;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rv-real-dev-meta {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rv-real-mount-btn {
  min-height: 26px !important;
  padding: 2px 7px !important;
  font-size: 10px !important;
  color: #22d3ee !important;
  border-color: rgba(34, 211, 238, 0.4) !important;
}

.rv-side-heading {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.1px;
  color: #64748b;
  margin-bottom: 6px;
}

.rv-side-hint {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
  margin-bottom: 8px;
}

.rv-slot-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #cbd5e1;
}

.rv-acc-btn {
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  margin-bottom: 5px;
  border-radius: 4px;
  background: #111827;
  border: 1px solid #23314b;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: #22d3ee;
    color: #f8fafc;
  }
}

.rv-acc-tag {
  font-size: 10px;
  color: #38bdf8;
}

.rv-custom-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.rv-selected-box {
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 4px;
  padding: 8px 10px;
}

.rv-side-stats {
  padding-top: 8px;
  border-top: 1px solid #1b263b;
  font-size: 12px;
}

.rv-stat-line {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 3px 0;
  color: #94a3b8;

  strong {
    color: #f8fafc;
  }
}

.rv-stage-wrap {
  flex: 1;
  position: relative;
  overflow: auto;
  background: #070a10;
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
}

.rv-zoom-controls {
  position: absolute;
  bottom: 14px;
  left: 14px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: #0e1525;
  border: 1px solid #263654;
  border-radius: 4px;
  overflow: hidden;
}

.rv-zoom-btn {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-bottom: 1px solid #1d2a42;
  color: #e2e8f0;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: #17223a;
    color: #22d3ee;
  }
}

.rv-svg-pan-layer {
  min-width: 980px;
  min-height: 680px;
}

.rv-main-svg {
  display: block;
}
</style>
