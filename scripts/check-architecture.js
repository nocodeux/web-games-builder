#!/usr/bin/env node
// Architectural guard for the Game Builder layer.
// Enforces the rules from docs/GAME_BUILDER_PRD.md §16 and docs/GAME_BUILDER_DECISIONS.md (Q4, Q5).
// Run: node scripts/check-architecture.js
// Exits 1 on any violation.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// The components that existed before the Game Builder work began. Until
// Phase 5 explicitly opens them, frozen files must remain untouched vs
// main. EXCEPTION: Window.jsx was unfrozen in Phase 3b after explicit user
// approval to add background-image props for game-style HUDs/menus.
const FROZEN_COMPONENTS = [
  'Button.jsx', 'CheckBox.jsx', 'ComboBox.jsx', 'Data.jsx', 'DataRepeater.jsx',
  'Form.jsx', 'Frame.jsx', 'Image.jsx', 'Line.jsx', 'ListBox.jsx',
  'Loader.jsx', 'Overlay.jsx', 'PictureBox.jsx', 'RadioButton.jsx', 'Row.jsx',
  'ScrollBar.jsx', 'Shape.jsx', 'Table.jsx', 'Tabs.jsx', 'Text.jsx',
  'TextBox.jsx', 'Timer.jsx',
];

const BASE_REF = process.env.ARCH_BASE_REF || 'main';
const violations = [];

function rel(p) { return p.replace(repoRoot + '/', ''); }

function checkFrozenComponents() {
  let baseExists = true;
  try {
    execSync(`git rev-parse --verify ${BASE_REF}`, { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    baseExists = false;
  }
  if (!baseExists) {
    console.log(`[skip] base ref "${BASE_REF}" not found — skipping frozen-component diff`);
    return;
  }
  for (const file of FROZEN_COMPONENTS) {
    const path = `src/components/Componentes/${file}`;
    let diff = '';
    try {
      diff = execSync(`git diff ${BASE_REF} -- ${path}`, { cwd: repoRoot, encoding: 'utf-8' });
    } catch (e) {
      violations.push(`could not diff ${path}: ${e.message}`);
      continue;
    }
    if (diff.trim().length > 0) {
      violations.push(`frozen file modified vs ${BASE_REF}: ${path}`);
    }
  }
}

function checkLevelCanvasIsolation() {
  const path = join(repoRoot, 'src/components/LevelCanvas.jsx');
  if (!existsSync(path)) return; // not yet created — Phase 3
  const src = readFileSync(path, 'utf-8');
  if (/import\s+[^;]*LayoutRow/.test(src)) {
    violations.push(`${rel(path)} must not import LayoutRow — coordinate systems must stay isolated`);
  }
  // Match an import path that ends in /Canvas (the flexbox-based root canvas)
  // but allow sibling files like ./LevelCanvas, ./TileMapCanvas.
  if (/from\s+['"][^'"]*\/Canvas['"]/.test(src)) {
    violations.push(`${rel(path)} must not import the root Canvas — coordinate systems must stay isolated`);
  }
}

function checkGameEntityHasNoLayoutProps() {
  const path = join(repoRoot, 'src/components/Componentes/GameEntity.jsx');
  if (!existsSync(path)) return; // not yet created — Phase 3
  const src = readFileSync(path, 'utf-8');
  const forbidden = ['widthMode', 'heightMode', 'paddingLinked', 'flexDirection'];
  for (const token of forbidden) {
    if (src.includes(token)) {
      violations.push(`${rel(path)} references "${token}" — game entities use absolute positioning, not layout props`);
    }
  }
}

checkFrozenComponents();
checkLevelCanvasIsolation();
checkGameEntityHasNoLayoutProps();

if (violations.length === 0) {
  console.log('architecture check: ok');
  process.exit(0);
}
console.error('architecture check: FAILED');
for (const v of violations) console.error('  -', v);
process.exit(1);
