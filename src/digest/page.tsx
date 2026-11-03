import { Hono } from 'hono';
import type { ReadNight } from './types.js';
import { lane } from '../lane.js';
import { Layout } from '../views/layout.js';
import { DigestPage } from '../views/digest.js';

export function createDigestPage(readNight: ReadNight, runsDir: string) {
  const router = new Hono();

  router.get('/:night', (c) => {
    const digest = readNight(runsDir, c.req.param('night'));
    if (digest === null) return c.text('Not found', 404);

    return c.html(
      <Layout title={`digest · ${digest.night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });

  return router;
}
