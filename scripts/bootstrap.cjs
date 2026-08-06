const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = ['react', 'vite', 'electron', 'adm-zip', 'concurrently', 'wait-on'];
const missing = required.filter((name) => !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));

if (!missing.length) process.exit(0);

console.log(`[bootstrap] Dependências ausentes: ${missing.join(', ')}.`);
console.log('[bootstrap] Executando npm install...');

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'install',
  '--no-audit',
  '--no-fund',
], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error('[bootstrap] Não foi possível iniciar npm install:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
