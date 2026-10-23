import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const env = { ...process.env, HOST: '127.0.0.1', PORT: '0' };
delete env.SPOTV_LINEUP_PASSWORD;
const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10000);
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  const get = path => fetch(address + path);
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.doesNotMatch(await index.text(), /password-input|login-form/);
  assert.deepEqual(await (await get('/api/session')).json(), { authenticated: true });
  assert.equal((await get('/api/games?date=invalid')).status, 400, 'API validation must be reachable without credentials');
  assert.equal((await get('/runtime/roster-sources.json')).status, 404);
  assert.equal((await get('/api/download/unknown')).status, 404);
  assert.equal((await get('/')).headers.get('set-cookie'), null);
  console.log('PASS no password required to start, open home, or reach API; private files still not served');
} finally {
  child.kill();
  await once(child, 'exit');
}
