import { Hono } from 'hono';
import { readNight } from './digest/reader.js';
import { createDigestPage } from './digest/page.js';
import { createDigestApi } from './digest/api.js';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.route('/digest', createDigestPage(readNight, config.runsDir));
  app.route('/api/digest', createDigestApi(config.runsDir, readNight));

  return app;
}
