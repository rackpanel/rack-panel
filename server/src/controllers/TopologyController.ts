import { Controller, Inject } from '@tsed/di';
import { Delete, Get, Post, Put } from '@tsed/schema';
import { Req, Res } from '@tsed/common';
import type express from 'express';
import { autoScanDevices, type AutoScanDeviceKind } from '../services/deviceScanner.js';
import { RackPanelRuntime } from '../runtime.js';

@Controller('/')
export class TopologyController {
  constructor(@Inject(RackPanelRuntime) private readonly rt: RackPanelRuntime) {}

  @Get('/topology/state')
  getState(@Res() res: express.Response): void {
    res.json(this.rt.topology.getState());
  }

  @Post('/topology/reset')
  resetState(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      const rawScope = body.scope;
      const scope = rawScope === 'canvas' || rawScope === 'racks' ? rawScope : 'all';
      const state = this.rt.topology.resetState(scope, {
        resetWires: body.resetWires !== undefined ? Boolean(body.resetWires) : undefined,
        resetCustomNodes: body.resetCustomNodes !== undefined ? Boolean(body.resetCustomNodes) : undefined,
        resetAllNodes: body.resetAllNodes !== undefined ? Boolean(body.resetAllNodes) : undefined,
        resetDiscovery: body.resetDiscovery !== undefined ? Boolean(body.resetDiscovery) : undefined,
        canvasId: body.canvasId ? String(body.canvasId) : undefined,
      });
      res.json({ ok: true, scope, state });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/canvases')
  upsertCanvas(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.createCanvas({
        name: String(req.body?.name || 'New Topology'),
        description: req.body?.description ? String(req.body.description) : undefined,
      });
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/canvases/:id')
  deleteCanvas(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const deleted = this.rt.topology.deleteCanvas(String(req.params.id));
      res.json({ deleted });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/nodes')
  upsertNode(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.upsertNode(req.body ?? {});
      if (saved.ipAddress) {
        void this.rt.topology.runHealthChecks().catch(() => {});
      }
      res.status(req.body?.id ? 200 : 201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/topology/nodes/positions')
  updatePositions(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      this.rt.topology.updateNodePositions(updates);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/topology/nodes/:id')
  updateNode(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.upsertNode({ ...(req.body ?? {}), id: String(req.params.id) });
      if (saved.ipAddress) {
        void this.rt.topology.runHealthChecks().catch(() => {});
      }
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/nodes/:id')
  deleteNode(@Req() req: express.Request, @Res() res: express.Response): void {
    const deleted = this.rt.topology.deleteNode(String(req.params.id));
    res.json({ deleted });
  }

  @Post('/topology/links')
  upsertLink(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      if (!body.sourceId || !body.targetId) {
        res.status(400).json({ error: 'sourceId and targetId are required' });
        return;
      }
      const saved = this.rt.topology.upsertLink(body);
      res.status(body.id ? 200 : 201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/links/:id')
  deleteLink(@Req() req: express.Request, @Res() res: express.Response): void {
    const deleted = this.rt.topology.deleteLink(String(req.params.id));
    res.json({ deleted });
  }

  @Post('/topology/canvases/:id/auto-layout')
  async autoLayout(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const canvasId = String(req.params.id);
      const body = req.body ?? {};
      const hasOptions =
        body.all !== undefined ||
        body.cleanLayout !== undefined ||
        body.autoRouteWires !== undefined ||
        body.pullDiscovered !== undefined ||
        body.deduplicateNodes !== undefined;

      if (!hasOptions) {
        const nodes = this.rt.topology.autoLayoutCanvas(canvasId);
        res.json({ ok: true, nodes });
        return;
      }

      const runAll = Boolean(body.all);
      const result = await this.rt.topology.runAutoLayoutActions(canvasId, this.rt.telemetry.getOverview(), {
        cleanLayout: runAll || Boolean(body.cleanLayout),
        autoRouteWires: runAll || Boolean(body.autoRouteWires),
        pullDiscovered: runAll || Boolean(body.pullDiscovered),
        deduplicateNodes: runAll || Boolean(body.deduplicateNodes),
        subnet: body.subnet ? String(body.subnet) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/topology/canvases/:id/export.svg')
  exportSvg(@Req() req: express.Request, @Res() res: express.Response): void {
    const svg = this.rt.topology.renderCanvasSvg(String(req.params.id));
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rackpanel-topology-${String(req.params.id)}.svg"`);
    res.send(svg);
  }

  @Post('/topology/racks')
  upsertRack(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.upsertRack({
        id: req.body?.id,
        name: String(req.body?.name || 'Rack'),
        widthInches: Number(req.body?.widthInches) === 10 ? 10 : 19,
        totalU: Number(req.body?.totalU) || 42,
        location: String(req.body?.location || ''),
      });
      res.status(req.body?.id ? 200 : 201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/racks/:id')
  deleteRack(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const deleted = this.rt.topology.deleteRack(String(req.params.id));
      res.json({ deleted });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/racks/:id/items')
  upsertRackItem(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.upsertRackItem(String(req.params.id), req.body ?? {});
      res.status(req.body?.id ? 200 : 201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/topology/racks/move-item')
  moveRackItem(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      const state = this.rt.topology.moveRackItem({
        fromRackId: String(body.fromRackId || body.sourceRackId || ''),
        toRackId: String(body.toRackId || body.targetRackId || body.fromRackId || body.sourceRackId || ''),
        itemId: String(body.itemId || ''),
        startU: Number(body.startU ?? body.targetStartU ?? 1),
        face: body.face === 'rear' || body.targetFace === 'rear' ? 'rear' : 'front',
        slotIndex: body.slotIndex !== undefined ? Number(body.slotIndex) : undefined,
      });
      res.json({ ok: true, state });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/racks/auto-layout')
  autoLayoutRacks(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const rackId = req.body?.rackId ? String(req.body.rackId) : undefined;
      const result = this.rt.topology.autoLayoutRacks(rackId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/racks/:id/items/:itemId')
  deleteRackItem(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const deleted = this.rt.topology.deleteRackItem(String(req.params.id), String(req.params.itemId));
      res.json({ deleted });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/racks/:id/patches')
  addRackPatch(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const rack = this.rt.topology.upsertRackPatch(String(req.params.id), req.body ?? {});
      res.status(201).json(rack);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/racks/:id/patches/:patchId')
  deleteRackPatch(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const deleted = this.rt.topology.deleteRackPatch(String(req.params.id), String(req.params.patchId));
      res.json({ deleted });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/docs')
  upsertDoc(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const saved = this.rt.topology.upsertDoc({
        id: req.body?.id,
        title: String(req.body?.title || 'Untitled Note'),
        icon: req.body?.icon ? String(req.body.icon) : undefined,
        nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
        canvasId: req.body?.canvasId ? String(req.body.canvasId) : undefined,
        content: String(req.body?.content || ''),
        tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : undefined,
      });
      res.status(req.body?.id ? 200 : 201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/topology/docs/:id')
  deleteDoc(@Req() req: express.Request, @Res() res: express.Response): void {
    const deleted = this.rt.topology.deleteDoc(String(req.params.id));
    res.json({ deleted });
  }

  @Post('/topology/healthcheck')
  async healthcheck(@Res() res: express.Response): Promise<void> {
    try {
      const nodes = await this.rt.topology.runHealthChecks();
      res.json({ ok: true, checked: nodes.length, nodes });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/scan')
  async scanSubnet(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const subnet = String(req.body?.subnet || '');
      const discovered = await this.rt.topology.scanSubnet(subnet, this.rt.telemetry.getOverview());
      res.json({ ok: true, discovered, state: this.rt.topology.getState() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/devices/autoscan')
  async autoScan(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const rawKind = String(req.body?.kind || 'server');
      const validKinds: AutoScanDeviceKind[] = ['server', 'proxmox', 'opnsense', 'switch', 'hikvision', 'unifi', 'ups'];
      if (!validKinds.includes(rawKind as AutoScanDeviceKind)) {
        res.status(400).json({ error: `Invalid autoscan kind: ${rawKind}` });
        return;
      }
      const subnet = req.body?.subnet ? String(req.body.subnet) : undefined;
      const result = await autoScanDevices(rawKind as AutoScanDeviceKind, subnet);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/switches')
  listSwitches(@Res() res: express.Response): void {
    const state = this.rt.topology.getState();
    const switches = state.nodes.filter((n) => n.kind === 'switch');
    res.json({
      switches,
      racks: state.racks,
      links: state.links,
    });
  }

  @Post('/switches/probe')
  async probeSwitch(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const result = await this.rt.topology.probeAndUpsertSwitch({
        host: String(req.body?.host || ''),
        name: req.body?.name ? String(req.body.name) : undefined,
        protocol:
          req.body?.protocol === 'ssh' ||
          req.body?.protocol === 'telnet' ||
          req.body?.protocol === 'http' ||
          req.body?.protocol === 'snmp'
            ? req.body.protocol
            : 'auto',
        port: req.body?.port ? Number(req.body.port) : undefined,
        username: req.body?.username ? String(req.body.username) : undefined,
        password: req.body?.password ? String(req.body.password) : undefined,
        enablePassword: req.body?.enablePassword ? String(req.body.enablePassword) : undefined,
        snmpCommunity: req.body?.snmpCommunity ? String(req.body.snmpCommunity) : undefined,
        modelPreset: req.body?.modelPreset || 'auto',
        nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
        canvasId: req.body?.canvasId ? String(req.body.canvasId) : undefined,
        rackId: req.body?.rackId ? String(req.body.rackId) : undefined,
        rackItemId: req.body?.rackItemId ? String(req.body.rackItemId) : undefined,
        startU: req.body?.startU ? Number(req.body.startU) : undefined,
        face: req.body?.face === 'rear' ? 'rear' : req.body?.face === 'front' ? 'front' : undefined,
        mountInRack: req.body?.mountInRack !== false,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/switches/:id')
  deleteSwitch(@Req() req: express.Request, @Res() res: express.Response): void {
    const deleted = this.rt.topology.deleteNode(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Switch not found' });
      return;
    }
    res.json({ ok: true });
  }

  @Post('/topology/switches/probe')
  async probeTopologySwitch(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const result = await this.rt.topology.probeAndUpsertSwitch({
        host: String(req.body?.host || ''),
        name: req.body?.name ? String(req.body.name) : undefined,
        protocol:
          req.body?.protocol === 'ssh' ||
          req.body?.protocol === 'telnet' ||
          req.body?.protocol === 'http' ||
          req.body?.protocol === 'snmp'
            ? req.body.protocol
            : 'auto',
        port: req.body?.port ? Number(req.body.port) : undefined,
        username: req.body?.username ? String(req.body.username) : undefined,
        password: req.body?.password ? String(req.body.password) : undefined,
        enablePassword: req.body?.enablePassword ? String(req.body.enablePassword) : undefined,
        snmpCommunity: req.body?.snmpCommunity ? String(req.body.snmpCommunity) : undefined,
        modelPreset: req.body?.modelPreset || 'auto',
        nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
        canvasId: req.body?.canvasId ? String(req.body.canvasId) : undefined,
        rackId: req.body?.rackId ? String(req.body.rackId) : undefined,
        rackItemId: req.body?.rackItemId ? String(req.body.rackItemId) : undefined,
        startU: req.body?.startU ? Number(req.body.startU) : undefined,
        face: req.body?.face === 'rear' ? 'rear' : req.body?.face === 'front' ? 'front' : undefined,
        mountInRack: req.body?.mountInRack !== false,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/analyze-routing')
  analyzeRouting(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const result = this.rt.topology.analyzeRoutingAndConfigs({
        nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
        canvasId: req.body?.canvasId ? String(req.body.canvasId) : undefined,
        rawConfigOrRoutes: String(req.body?.rawConfigOrRoutes || ''),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/discovery/:id/approve')
  approveDiscovery(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const result = this.rt.topology.approveDiscoveredDevice(String(req.params.id), req.body?.canvasId);
      res.json({ ok: true, ...result, state: this.rt.topology.getState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/sync-overview')
  syncOverview(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const result = this.rt.topology.syncFromOverview(this.rt.telemetry.getOverview(), req.body?.canvasId);
      res.json({ ok: true, ...result, state: this.rt.topology.getState() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/import-mesh')
  importMesh(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const kind =
        req.body?.kind === 'zwave-js'
          ? 'zwave-js'
          : req.body?.kind === 'unraid'
            ? 'unraid'
            : 'zigbee2mqtt';
      const result = this.rt.topology.importSmartMeshOrExternal({
        kind,
        canvasId: req.body?.canvasId,
        rawJson: req.body?.rawJson,
      });
      res.json({ ok: true, ...result, state: this.rt.topology.getState() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/topology/git-sync')
  async gitSync(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const result = await this.rt.topology.syncToGit(req.body);
      res.json({ ...result, state: this.rt.topology.getState() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/topology/mcp/tools')
  mcpTools(@Res() res: express.Response): void {
    res.json({ tools: this.rt.topology.getMcpToolsManifest() });
  }

  @Post('/topology/mcp')
  mcpRpc(@Req() req: express.Request, @Res() res: express.Response): void {
    res.json(this.rt.topology.handleMcpJsonRpc(req.body ?? {}));
  }
}
