import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');

const backendDir = path.join(repoRoot, 'backend');
const frontendDir = path.join(repoRoot, 'frontend');
const targetAppDir = path.join(desktopRoot, 'app');

// Remove variáveis herdadas de `npm run ... --prefix desktop` para não confundir
// o npm filho ao compilar backend/ e frontend/ no Windows.
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key.toLowerCase() === 'npm_config_prefix' || key === 'INIT_CWD') {
    delete cleanEnv[key];
  }
}

console.log('[desktop:prepare] Compilando backend...');
execSync('npm run build', { cwd: backendDir, env: cleanEnv, stdio: 'inherit' });

console.log('[desktop:prepare] Compilando frontend...');
execSync('npm run build', { cwd: frontendDir, env: cleanEnv, stdio: 'inherit' });

console.log('[desktop:prepare] Copiando artefatos para desktop/app...');
fs.rmSync(targetAppDir, { recursive: true, force: true });
fs.mkdirSync(path.join(targetAppDir, 'backend'), { recursive: true });

fs.cpSync(path.join(backendDir, 'dist'), path.join(targetAppDir, 'backend', 'dist'), {
  recursive: true,
});
fs.cpSync(
  path.join(backendDir, 'src', 'db', 'migrations'),
  path.join(targetAppDir, 'backend', 'migrations'),
  { recursive: true },
);
fs.cpSync(path.join(frontendDir, 'dist'), path.join(targetAppDir, 'frontend'), {
  recursive: true,
});

console.log('[desktop:prepare] Concluído com sucesso!');
