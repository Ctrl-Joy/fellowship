import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app';

const port = Number(process.env.PORT ?? 4000);
// 'localhost' makes Fastify bind both 127.0.0.1 and ::1.
const host = process.env.HOST ?? 'localhost';

const app = await buildApp({ dbPath: process.env.FELLOWSHIP_DB, port, logger: process.env.LOG === '1' });

// In production (`npm run build` then `npm start -w server`) serve the built client too.
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(resolve(clientDist, 'index.html'))) {
  const indexHtml = readFileSync(resolve(clientDist, 'index.html'), 'utf8');
  await app.register(fastifyStatic, { root: clientDist, prefix: '/', wildcard: false, decorateReply: false });
  app.get('/*', (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/files')) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    return reply.type('text/html').send(indexHtml);
  });
}

await app.listen({ port, host });
console.log(`Fellowship API listening on http://localhost:${port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
