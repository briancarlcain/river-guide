// Builds the single-file app from src/App.jsx + src/shell.html + src/ui.css.
//   node build.mjs        web build  -> index.html        (GitHub Pages; includes the private Grand Canyon 2026 trip)
//   node build.mjs app    store build -> www/index.html   (Capacitor / App Store; fictional sample trip only)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const store = process.argv[2] === 'app';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// The store build must not ship the crew's real trip: swap the seed files for the sample.
const swapSeed = {
  name: 'swap-seed',
  setup(b) {
    if (!store) return;
    b.onResolve({ filter: /data\/trip\.json$/ }, () => ({ path: resolve('src/stubs/seed-trip.json') }));
    b.onResolve({ filter: /data\/trips\/gc2026-ref\.json$/ }, () => ({ path: resolve('src/stubs/seed-ref.json') }));
    // the gear catalog came from one outfitter's price sheet: drop its own product lines and name mentions
    b.onLoad({ filter: /data[\\/]gear\.json$/ }, (args) => {
      const drop = /Ceiba|^Truck & Trailer|^Van Passenger|^Shuttle -|^Vehicle Shuttle|Gear (Pickup|Delivery) Tip|^Parking -|^Hualapai/i;
      const items = JSON.parse(readFileSync(args.path, 'utf8'))
        .filter((g) => !drop.test(g.n))
        .map((g) => ({ ...g, n: g.n.replace(/\s*\([^)]*Ceiba[^)]*\)/gi, '') }));
      return { contents: JSON.stringify(items), loader: 'json' };
    });
  },
};

const result = await build({
  entryPoints: ['src/App.jsx'],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.json': 'json' },
  minify: true,
  write: false,
  outfile: 'app.js',
  legalComments: 'none',
  plugins: [swapSeed],
  define: { __STORE__: String(store), __VERSION__: JSON.stringify(pkg.version) },
});
// keep a literal "</script" in the bundle from ending the inline tag
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// src/shell.html is a fragment: <title>, <style>, <div id="root">, <script src="app.js">.
const shell = readFileSync('src/shell.html', 'utf8');
const cut = shell.indexOf('<div id="root">');
if (cut < 0) throw new Error('shell.html: <div id="root"> not found');
const ui = readFileSync('src/ui.css', 'utf8');
const head = shell.slice(0, cut).replace(/<\/style>\s*$/, () => `\n/* ---- ui.css ---- */\n${ui}\n</style>\n`);
const body = shell.slice(cut).replace(/<script src="app\.js"><\/script>/, () => `<script>${js}</script>`);
if (!body.includes(js.slice(0, 40))) throw new Error('shell.html: <script src="app.js"> not found');

const web = `<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="River Guide">
<meta name="robots" content="noindex, nofollow">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-180.png">`;
const app = `<meta name="format-detection" content="telephone=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' capacitor: data: blob: 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' capacitor: https://nhplgoetehrydaeoyrgz.supabase.co">`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5eede">
${store ? app : web}
${head}</head>
<body data-tab="itinerary">
${body}
</body>
</html>
`;

if (store) {
  mkdirSync('www', { recursive: true });
  writeFileSync('www/index.html', html);
} else {
  writeFileSync('index.html', html);
}
console.log(`${store ? 'www/index.html' : 'index.html'} written (${(html.length / 1024).toFixed(0)} KB, ${store ? 'store' : 'web'} build)`);
