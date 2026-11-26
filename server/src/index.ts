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

export function createApp() {
  initSchema();
  seedInitialDemoBusiness();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

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
