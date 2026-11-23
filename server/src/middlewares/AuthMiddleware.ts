import { Inject } from '@tsed/di';
import { Middleware, type MiddlewareMethods } from '@tsed/platform-middlewares';
import { Req, Res } from '@tsed/common';
import type express from 'express';
import { extractBearerToken, RackPanelRuntime, type AuthenticatedRequest } from '../runtime.js';

@Middleware()
export class AuthMiddleware implements MiddlewareMethods {
  constructor(@Inject(RackPanelRuntime) private readonly rt: RackPanelRuntime) {}

  use(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    const originalUrl = req.originalUrl || req.url || '';
    if (!originalUrl.startsWith('/api')) {
      return;
    }

    const apiPath = originalUrl.split('?')[0];
    if (
      apiPath === '/api/health' ||
      apiPath === '/api/auth/status' ||
      apiPath === '/api/auth/setup' ||
      apiPath === '/api/auth/login' ||
      apiPath === '/api/auth/logout'
    ) {
      return;
    }

    const token = extractBearerToken(req);
    const found = token ? this.rt.store.getSessionByToken(token) : null;
    if (!found) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const settings = this.rt.store.getSettings();
    const pinLocked = Boolean(found.session.pinLocked && settings.splashPinEnabled);
    req.auth = {
      token: found.session.token,
      user: found.user,
      pinLocked,
    };

    if (pinLocked) {
      const p = apiPath.replace(/^\/api/, '');
      const isAllowedWhileLocked =
        (req.method === 'GET' && (p === '/overview' || p === '/settings')) ||
        (req.method === 'POST' && (p === '/settings/verify-pin' || p === '/settings/lock'));
      if (!isAllowedWhileLocked) {
        res.status(423).json({
          error: 'Panel is PIN-locked. Enter your 4-digit PIN to unlock controls.',
          pinLocked: true,
        });
        return;
      }
    }
  }
}
