// Builds the single-file app: src/App.jsx + src/shell.html -> index.html
// (GitHub Pages serves index.html from the repo root.)
//   npm install && npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

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
});
// keep a literal "</script" in the bundle from ending the inline tag
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\/script');

// src/shell.html is a fragment: <title>, <style>, <div id="root">, <script src="app.js">.
// GitHub Pages / phones need a real document around it.
const shell = readFileSync('src/shell.html', 'utf8');
const cut = shell.indexOf('<div id="root">');
if (cut < 0) throw new Error('shell.html: <div id="root"> not found');
const ui = readFileSync('src/ui.css', 'utf8');
const head = shell.slice(0, cut).replace(/<\/style>\s*$/, () => `\n/* ---- ui.css ---- */\n${ui}\n</style>\n`);
const body = shell.slice(cut).replace(/<script src="app\.js"><\/script>/, () => `<script>${js}</script>`);
if (!body.includes(js.slice(0, 40))) throw new Error('shell.html: <script src="app.js"> not found');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="River Guide">
<meta name="theme-color" content="#f5eede">
<meta name="robots" content="noindex, nofollow">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-180.png">
${head}</head>
<body data-tab="itinerary">
${body}
</body>
</html>
`;
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);
