import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from './db/schema.js';
import { seedInitialDemoBusiness } from './db/seed.js';
import { authRouter } from './routes/auth.js';
import { mastersRouter } from './routes/masters.js';
import { lotsRouter } from './routes/lots.js';
import { bagsRouter } from './routes/bags.js';
import { productionRouter } from './routes/production.js';
import { inventoryRouter } from './routes/inventory.js';
import { commercialRouter } from './routes/commercial.js';
import { accountingRouter } from './routes/accounting.js';
import { syncAdminRouter } from './routes/syncAdmin.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://hira-agro-rice-mill-erp.vercel.app',
  'https://hira-agro-rice-mill-erp-sayam4.vercel.app',
  'https://hira-agro-rice-mill-erp-git-main-sayam4.vercel.app',
  'http://localhost:5173',
  'http://localhost:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4000',
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / server-to-server / curl
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]);
  if (allowed.has(origin)) return true;
  // Allow private LAN IP access only when running locally (non-Render)
  if (!process.env.RENDER && /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

export function createApp() {
  initSchema();
  seedInitialDemoBusiness();

  const app = express();
  app.set('trust proxy', 1);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS_NOT_ALLOWED'));
        }
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'rice-mill-erp', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', mastersRouter);
  app.use('/api/lots', lotsRouter);
  app.use('/api/bags', bagsRouter);
  app.use('/api/production', productionRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api', commercialRouter);
  app.use('/api/accounting', accountingRouter);
  app.use('/api', syncAdminRouter);

  // Reject disallowed CORS cleanly as 403
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.message === 'CORS_NOT_ALLOWED') {
      res.status(403).json({ error: 'Origin not allowed by CORS security policy.' });
      return;
    }
    next(err);
  });

  // Serve built client static files in production if present
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).includes('index');
if (isMain) {
  const PORT = Number(process.env.PORT || 4000);
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rice Mill ERP API listening on http://localhost:${PORT}`);
  });
}
