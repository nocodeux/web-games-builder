// Shared helpers for treating either a Tileset asset OR a Sprite Sheet
// asset as a "tile grid". Both have cells in a uniform pattern; the only
// differences are field names and that sprite sheets also carry
// offsets/gaps. This module normalizes them into a single shape so
// consumers (Inspector palette, LevelCanvas tile background) don't have
// to care which kind of asset the user picked.

export function gapAt(gap, axisIdx, gapIdx) {
  if (Array.isArray(gap)) {
    if (Array.isArray(gap[0])) return Number(gap[axisIdx]?.[gapIdx]) || 0;
    return Number(gap[gapIdx]) || 0;
  }
  return Number(gap) || 0;
}

// Compute the source (sx, sy) of cell (col, row) within a normalized view.
export function cellOrigin(view, col, row) {
  const offLeft = Array.isArray(view.offsetLeft) ? Number(view.offsetLeft[row]) || 0 : Number(view.offsetLeft) || 0;
  const offTop  = Array.isArray(view.offsetTop)  ? Number(view.offsetTop[col])  || 0 : Number(view.offsetTop)  || 0;
  let x = offLeft;
  for (let i = 0; i < col; i++) x += view.tileWidth + gapAt(view.gapX, row, i);
  let y = offTop;
  for (let i = 0; i < row; i++) y += view.tileHeight + gapAt(view.gapY, col, i);
  return { x, y };
}

// Build a normalized tileset view from an asset. Returns null if not found.
// Accepts either a tileset (top-level tileWidth/cols/rows) or a sprite
// sheet (nested frame with width/cols/rows + offsets/gaps).
export function resolveTilesetView(assets, assetId) {
  if (!assetId || !assets) return null;
  const t = (assets.tilesets || []).find(x => x.id === assetId);
  if (t) {
    return {
      kind: 'tileset',
      id: t.id,
      name: t.name,
      src: t.src,
      tileWidth: Number(t.tileWidth) || 32,
      tileHeight: Number(t.tileHeight) || 32,
      cols: Math.max(1, Number(t.cols) || 1),
      rows: Math.max(1, Number(t.rows) || 1),
      offsetLeft: t.offsetLeft ?? 0,
      offsetTop:  t.offsetTop  ?? 0,
      gapX: t.gapX ?? 0,
      gapY: t.gapY ?? 0,
      transparentColor: t.transparentColor || null,
      transparentTolerance: t.transparentTolerance ?? 0,
    };
  }
  const s = (assets.sprites || []).find(x => x.id === assetId);
  if (s?.frame) {
    return {
      kind: 'spriteSheet',
      id: s.id,
      name: s.name,
      src: s.src,
      tileWidth: Number(s.frame.width) || 32,
      tileHeight: Number(s.frame.height) || 32,
      cols: Math.max(1, Number(s.frame.cols) || 1),
      rows: Math.max(1, Number(s.frame.rows) || 1),
      offsetLeft: s.frame.offsetLeft ?? s.frame.offsetX ?? 0,
      offsetTop:  s.frame.offsetTop  ?? s.frame.offsetY ?? 0,
      gapX: s.frame.gapX ?? 0,
      gapY: s.frame.gapY ?? 0,
      transparentColor: s.frame.transparentColor || null,
      transparentTolerance: s.frame.transparentTolerance ?? 0,
    };
  }
  return null;
}

// Flat list of all assets usable as a tileset, in display order:
// dedicated tilesets first, then sprite sheets that have a grid.
export function listTileSources(assets) {
  return [
    ...(assets?.tilesets || []).map(t => ({ id: t.id, name: t.name, kind: 'tileset' })),
    ...(assets?.sprites  || []).filter(s => s.frame?.cols && s.frame?.rows).map(s => ({ id: s.id, name: s.name, kind: 'spriteSheet' })),
  ];
}
