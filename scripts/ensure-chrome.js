// Downloads puppeteer's bundled Chrome if not already present.
// Runs as part of `npm run build` so Chrome is available before server starts.
import { executablePath } from 'puppeteer';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const chromePath = executablePath();

if (existsSync(chromePath)) {
  console.log('[chrome] Chrome found at', chromePath);
} else {
  console.log('[chrome] Chrome not found, downloading...');
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  console.log('[chrome] Chrome installed at', executablePath());
}
