import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Configuration, Inject } from '@tsed/di';
import { PlatformApplication } from '@tsed/platform-http';
import { AuthController } from './controllers/AuthController.js';
import { FleetController } from './controllers/FleetController.js';
import { TopologyController } from './controllers/TopologyController.js';
import { AuthMiddleware } from './middlewares/AuthMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidateDistDirs = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(__dirname, '../../../../client/dist'),
];
export const clientDist = candidateDistDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

@Configuration({
  acceptMimes: ['application/json'],
  httpPort: false,
  httpsPort: false,
  logger: {
    level: 'warn',
  },
  mount: {
    '/api': [AuthController, FleetController, TopologyController],
  },
  middlewares: [cors(), express.json({ limit: '1mb' }), AuthMiddleware],
  statics: clientDist
    ? {
        '/': [{ root: clientDist }],
      }
    : {},
})
export class Server {
  constructor(
    @Inject(PlatformApplication)
    private readonly app: PlatformApplication<express.Application>,
  ) {}

  $afterRoutesInit(): void {
    if (clientDist) {
      this.app.get('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
          next();
          return;
        }
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }
}
