import { Controller, Inject } from '@tsed/di';
import { Delete, Get, Post, Put } from '@tsed/schema';
import { Req, Res } from '@tsed/common';
import type express from 'express';
import type { UserRole } from '../../../shared/types.js';
import { extractBearerToken, RackPanelRuntime, type AuthenticatedRequest } from '../runtime.js';

@Controller('/')
export class AuthController {
  constructor(@Inject(RackPanelRuntime) private readonly rt: RackPanelRuntime) {}

  @Get('/health')
  health(@Res() res: express.Response): void {
    res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
  }

  @Get('/auth/status')
  authStatus(@Req() req: express.Request, @Res() res: express.Response): void {
    const settings = this.rt.store.getSettings();
    const setupRequired = !this.rt.store.hasUsers();
    const token = extractBearerToken(req);
    const found = token ? this.rt.store.getSessionByToken(token) : null;
    const pinLocked = Boolean(found && found.session.pinLocked && settings.splashPinEnabled);
    res.json({
      setupRequired,
      authenticated: Boolean(found),
      pinLocked,
      splashPinEnabled: settings.splashPinEnabled,
      user: found ? found.user : null,
      rackTitle: settings.rackTitle || 'RACK//PANEL',
    });
  }

  @Post('/auth/setup')
  authSetup(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      if (this.rt.store.hasUsers()) {
        res.status(409).json({ error: 'Initial admin account already exists. Please sign in.' });
        return;
      }
      const { username, displayName, password } = req.body ?? {};
      const user = this.rt.store.createUser({
        username: String(username || ''),
        displayName: String(displayName || ''),
        password: String(password || ''),
        role: 'admin',
      });
      const session = this.rt.store.createSession(user.id, req.headers['user-agent']);
      res.status(201).json({
        token: session.token,
        user,
        pinLocked: false,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/auth/login')
  authLogin(@Req() req: express.Request, @Res() res: express.Response): void {
    const { username, password } = req.body ?? {};
    const user = this.rt.store.authenticateUser(String(username || ''), String(password || ''));
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const session = this.rt.store.createSession(user.id, req.headers['user-agent']);
    res.json({
      token: session.token,
      user,
      pinLocked: false,
    });
  }

  @Post('/auth/logout')
  authLogout(@Req() req: express.Request, @Res() res: express.Response): void {
    const token = extractBearerToken(req);
    if (token) {
      this.rt.store.revokeSession(token);
    }
    res.json({ ok: true });
  }

  @Get('/users')
  listUsers(@Res() res: express.Response): void {
    res.json(this.rt.store.listUsersPublic());
  }

  @Post('/users')
  createUser(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    try {
      if (req.auth?.user.role !== 'admin') {
        res.status(403).json({ error: 'Only admin users can create accounts' });
        return;
      }
      const { username, displayName, password, role } = req.body ?? {};
      const validRole: UserRole = role === 'operator' ? 'operator' : 'admin';
      const created = this.rt.store.createUser({
        username: String(username || ''),
        displayName: String(displayName || ''),
        password: String(password || ''),
        role: validRole,
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/users/:id/password')
  updatePassword(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    try {
      const targetId = String(req.params.id);
      if (req.auth?.user.role !== 'admin' && req.auth?.user.id !== targetId) {
        res.status(403).json({ error: 'You can only change your own password' });
        return;
      }
      this.rt.store.updateUserPassword(targetId, String(req.body?.password || ''));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/users/:id')
  deleteUser(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    try {
      if (req.auth?.user.role !== 'admin') {
        res.status(403).json({ error: 'Only admin users can delete accounts' });
        return;
      }
      const deleted = this.rt.store.deleteUser(String(req.params.id));
      res.json({ deleted });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
}
