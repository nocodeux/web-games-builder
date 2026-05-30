// Server-side HTML generation for published pages and games.

// Asset preloader — injects a script that warms the browser cache before the
// runtime starts. Images are loaded via new Image(); audio via new Audio().
// Returns a self-contained <script> block (no external deps).
function assetPreloaderScript({ playBtnId = null } = {}) {
  // language=JS
  return `<script>(function(){
  var a=window.__TUIFY_ASSETS__||{};
  var imgs=[].concat(
    (a.sprites||[]).map(function(x){return x.src||x.url;}),
    (a.tilesets||[]).map(function(x){return x.src||x.url;}),
    (a.backgrounds||[]).map(function(x){return x.src||x.url;})
  ).filter(Boolean);
  var snds=(a.sounds||[]).map(function(x){return x.src||x.url;}).filter(Boolean);
  var total=imgs.length+snds.length;
  var done=0;
  var btn=${playBtnId ? `document.getElementById('${playBtnId}')` : 'null'};
  var loader=${playBtnId ? 'null' : "document.getElementById('_tfy-loader')"};
  var loaderBar=${playBtnId ? 'null' : "document.getElementById('_tfy-loader-bar')"};
  if(!total){
    if(loader){loader.style.opacity='0';setTimeout(function(){loader.style.display='none';},400);}
    return;
  }
  function tick(){
    done++;
    var pct=Math.min(100,Math.round(done/total*100));
    if(btn&&done<total){btn.textContent='Loading '+pct+'%';btn.disabled=true;btn.style.opacity='0.6';}
    else if(btn&&done>=total){btn.innerHTML='&#9654; Play';btn.disabled=false;btn.style.opacity='1';}
    if(loaderBar){loaderBar.style.width=pct+'%';}
    if(loader&&done>=total){loader.style.opacity='0';setTimeout(function(){loader.style.display='none';},400);}
  }
  imgs.forEach(function(u){var i=new Image();i.onload=i.onerror=tick;i.src=u;});
  snds.forEach(function(u){var au=new Audio();au.oncanplaythrough=au.onerror=tick;au.preload='auto';au.src=u;});
})();</script>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Safely embed arbitrary JSON inside a <script> tag.
// JSON.stringify can produce strings like "</script>" or "<!--" that break
// HTML parsing — replace the angle brackets inside string literals only.
function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

const BADGE_CSS = `
.tuify-badge{position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:0;padding:8px 14px;background:rgba(0,0,0,0.82);border:1px solid #33ff33;text-decoration:none;font-family:monospace;z-index:99999;cursor:pointer;transition:background .22s,box-shadow .22s,transform .22s,padding .22s;box-shadow:0 0 8px rgba(51,255,51,.2);overflow:hidden;}
.tuify-badge::before{content:'';position:absolute;inset:0;border:1px solid #33ff33;opacity:0;transition:opacity .22s;transform:translate(3px,3px);pointer-events:none;}
.tuify-badge:hover{background:#33ff33;box-shadow:0 0 22px rgba(51,255,51,.6),0 0 50px rgba(51,255,51,.27);transform:translateY(-3px);padding:12px 18px;}
.tuify-badge:hover::before{opacity:1;}
.tuify-badge-label{font-size:8px;color:#008800;letter-spacing:1.2px;text-transform:uppercase;line-height:1.5;white-space:nowrap;max-height:0;max-width:0;opacity:0;overflow:hidden;margin-bottom:0;transition:max-height .22s ease,max-width .22s ease,opacity .18s ease,margin-bottom .22s,color .18s;}
.tuify-lbl-1,.tuify-lbl-2,.tuify-lbl-3,.tuify-lbl-4{animation:tuify-label-bold 4s linear infinite;}
.tuify-lbl-1{animation-delay:0s;}.tuify-lbl-2{animation-delay:-3s;}.tuify-lbl-3{animation-delay:-2s;}.tuify-lbl-4{animation-delay:-1s;}
@keyframes tuify-label-bold{0%,24.9%{font-weight:bold;}25%,100%{font-weight:normal;}}
.tuify-badge:hover .tuify-badge-label{max-height:24px;max-width:500px;opacity:1;margin-bottom:6px;color:#0a0a0a;}
.tuify-badge-brand{font-size:15px;font-weight:bold;color:#33ff33;display:flex;align-items:center;gap:4px;transition:color .18s;}
.tuify-word{display:flex;align-items:center;}
.tuify-l{max-width:0;overflow:hidden;display:inline-block;animation:tuify-appear 0.01s step-end forwards;}
.tuify-l1{animation-delay:0.5s;}.tuify-l2{animation-delay:0.68s;}.tuify-l3{animation-delay:0.86s;}.tuify-l4{animation-delay:1.04s;}.tuify-l5{animation-delay:1.22s;}
@keyframes tuify-appear{to{max-width:20px;margin-right:2px;}}
.tuify-domain{max-width:0;overflow:hidden;white-space:nowrap;display:inline-block;transition:max-width .22s ease;}
.tuify-badge:hover .tuify-domain{max-width:60px;}
.tuify-badge-cursor{display:inline-block;width:9px;height:15px;background:#33ff33;animation:tuify-blink 1s step-end infinite;transition:background .18s;flex-shrink:0;}
@keyframes tuify-blink{0%,100%{opacity:1}50%{opacity:0}}
.tuify-badge:hover .tuify-badge-brand{color:#0a0a0a;}
.tuify-badge:hover .tuify-badge-cursor{background:#0a0a0a;}
`;

const BADGE_HTML = (origin) => `<a href="${origin || 'https://tuify.app'}" target="_blank" rel="noopener noreferrer" class="tuify-badge"><span class="tuify-badge-label"><span class="tuify-lbl-1">Design</span> &middot; <span class="tuify-lbl-2">Build</span> &middot; <span class="tuify-lbl-3">Deploy</span> &middot; <span class="tuify-lbl-4">Scale with</span></span><span class="tuify-badge-brand"><span class="tuify-word"><span class="tuify-l tuify-l1">T</span><span class="tuify-l tuify-l2">U</span><span class="tuify-l tuify-l3">I</span><span class="tuify-l tuify-l4">F</span><span class="tuify-l tuify-l5">Y</span><span class="tuify-domain">.app</span></span><span class="tuify-badge-cursor"></span></span></a>`;

// ─── Game-only publish ────────────────────────────────────────────────────────
// worlds: array of all world objects from the project (game = full set of worlds)
export function generateGameHtml({ worlds, assets, title, description, origin = '', slug = '' }) {
  const worldsJson = safeJson(worlds);
  const assetsJson = safeJson(assets);
  const pageTitle  = esc(title || worlds[0]?.name || 'TUIFY Game');
  const pageDesc   = esc(description || `Play ${pageTitle} on TUIFY`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${pageDesc}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${pageDesc}">
  <title>${pageTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
    #game-root { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    #game-canvas { display: block; image-rendering: pixelated; }
    #_tfy-loader {
      position: fixed; inset: 0; z-index: 9999;
      background: #0a0a0a; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      font-family: monospace; color: #33ff33;
      transition: opacity 0.4s;
    }
    #_tfy-loader-track {
      width: 200px; height: 2px; background: #1a1a1a; border: 1px solid #33ff33;
    }
    #_tfy-loader-bar { height: 100%; width: 0%; background: #33ff33; transition: width 0.2s; }
    ${BADGE_CSS}
  </style>
</head>
<body>
  <div id="_tfy-loader">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase">Loading</div>
    <div id="_tfy-loader-track"><div id="_tfy-loader-bar"></div></div>
  </div>
  <div id="game-root">
    <div id="game-canvas-wrap" style="position:relative;overflow:hidden;">
      <canvas id="game-canvas"></canvas>
      <div id="hud-overlay" style="position:absolute;inset:0;pointer-events:none;display:none;"></div>
    </div>
  </div>
  ${BADGE_HTML(origin)}
  <script>
    window.__TUIFY_WORLDS__ = ${worldsJson};
    window.__TUIFY_ASSETS__ = ${assetsJson};
    window.__TUIFY_SLUG__   = ${JSON.stringify(slug)};
    window.__TUIFY_WS_URL__ = ${JSON.stringify(origin.replace(/^http/, 'ws') + '/mp')};
  </script>
  ${assetPreloaderScript()}
  <script src="${origin}/runtime/tuify-game.js"></script>
</body>
</html>`;
}

// Rewrite localhost asset URLs to the server's public origin.
// Fixes bgImage and other /uploads/ references when publishing from a local/dev builder.
function rewriteLocalhostUrls(html, origin) {
  if (!origin) return html;
  return html.replace(
    /https?:\/\/(?:localhost|127\.0\.0\.1):\d+(\/uploads\/)/g,
    `${origin}$1`
  );
}

// ─── Page-only publish ────────────────────────────────────────────────────────
// pageHtml is the full HTML string generated by the client's exportHTML logic.
// We just inject the TUIFY powered-by link before </body>.
export function generatePageHtml({ pageHtml, origin = '' }) {
  return rewriteLocalhostUrls(pageHtml, origin);
}

// ─── Page + Game combined publish ─────────────────────────────────────────────
// Injects a floating "▶ Play" button and a fullscreen game overlay into the
// existing page HTML. Everything is self-contained in a single file.
export function generateCombinedHtml({ pageHtml, worlds, assets, title, description, origin = '' }) {
  const worldsJson = safeJson(worlds);
  const assetsJson = safeJson(assets);

  const injection = `
<style>
#_tfy-overlay {
  display:none; position:fixed; inset:0; z-index:9999;
  background:#0a0a0a;
}
#_tfy-overlay.open { display:block; }
#_tfy-back {
  position:fixed; top:12px; left:12px; z-index:10000;
  background:transparent; border:1px solid #33ff33; color:#33ff33;
  font-family:monospace; font-size:11px; padding:4px 10px; cursor:pointer;
  letter-spacing:1px;
}
#_tfy-back:hover { background:rgba(51,255,51,.12); }
#_tfy-play {
  position:fixed; bottom:24px; right:24px; z-index:9998;
  background:transparent; border:2px solid #33ff33; color:#33ff33;
  font-family:monospace; font-size:12px; padding:8px 18px;
  cursor:pointer; letter-spacing:2px; text-transform:uppercase;
  box-shadow:0 0 12px rgba(51,255,51,.3);
}
#_tfy-play:hover { background:rgba(51,255,51,.1); }
#game-root { width:100%; height:100%; }
</style>
<button id="_tfy-play" onclick="document.getElementById('_tfy-overlay').classList.add('open')">&#9654; Play</button>
<div id="_tfy-overlay">
  <button id="_tfy-back" onclick="document.getElementById('_tfy-overlay').classList.remove('open')">&#8592; Back</button>
  <div id="game-root"></div>
</div>
<script>
window.__TUIFY_WORLDS__ = ${worldsJson};
window.__TUIFY_ASSETS__ = ${assetsJson};
</script>
${assetPreloaderScript({ playBtnId: '_tfy-play' })}
<script src="${origin}/runtime/tuify-game.js"></script>`;

  const rewritten = rewriteLocalhostUrls(pageHtml, origin);
  return rewritten.replace(/<\/body>/i, `${injection}\n</body>`);
}
