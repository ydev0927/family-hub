// Local development server. Uses a JSON file for state.
// MODEL_PROVIDER=fixture answers with fixed text instead of calling Amazon Nova.
import http from 'node:http';
import { createApp } from './src/app.mjs';
import { respond } from './src/respond.mjs';
import { config } from './src/config.mjs';
import { fileStore } from './src/store/file.mjs';
import { fixtureModel } from './src/model/fixture.mjs';
import { bedrockModel } from './src/model/bedrock.mjs';

const port = Number(process.env.PORT ?? 8787);
const provider = process.env.MODEL_PROVIDER;
if (provider !== 'fixture' && provider !== 'bedrock') {
  throw new Error('Set MODEL_PROVIDER to "fixture" or "bedrock"');
}
const model =
  provider === 'fixture'
    ? fixtureModel()
    : bedrockModel({ textModelId: process.env.TEXT_MODEL_ID, visionModelId: process.env.VISION_MODEL_ID });

const timeShiftMinutes = Number(process.env.TIME_SHIFT_MINUTES ?? 0);
if (!Number.isFinite(timeShiftMinutes)) throw new Error('TIME_SHIFT_MINUTES must be a number');
const handle = createApp({
  config: { ...config, devTools: true, timeShiftMinutes },
  model,
  store: fileStore(process.env.STATE_FILE ?? './dev-state.json'),
});

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://localhost');
      const text = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Body is not valid JSON' }));
        return;
      }
      const out = await respond(handle, {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      });
      console.log(req.method, url.pathname, out.status, req.headers['user-agent'] ?? '-');
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  })
  .listen(port, () => console.log(`Family Hub API (${provider}) on http://localhost:${port}${timeShiftMinutes ? ` (clock shifted ${timeShiftMinutes} min)` : ''}`));
