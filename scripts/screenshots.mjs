// Renders App Store screenshots (iPhone 6.9": 1320 x 2868) from the store build using Edge/Chrome.
//   node build.mjs app && node scripts/screenshots.mjs
// Output: store/screenshots/*.png. Uses ?shot=1 (fake status bar) and ?tab/open/sub deep links.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Edge/Chrome found. Set BROWSER=/path/to/browser');

const page = pathToFileURL(resolve('www/index.html')).href;
const shots = [
  ['01-trips', 'tab=Trips'],
  ['02-itinerary', 'tab=Trips&open=1&sub=Itinerary'],
  ['03-crew', 'tab=Trips&open=1&sub=Crew%20%26%20Crafts'],
  ['04-gear', 'tab=Trips&open=1&sub=Gear'],
  ['05-shuttle', 'tab=Trips&open=1&sub=Shuttle'],
  ['06-river-map', 'tab=River&sub=Map'],
  ['07-safety', 'tab=General&sub=Medical'],
];
const out = resolve('store/screenshots');
mkdirSync(out, { recursive: true });

// Start the browser ourselves (throwaway profile, debugging port) and attach: launching through
// puppeteer fails on some Edge installs.
const port = 9333 + Math.floor(Math.random() * 500);
const proc = spawn(executablePath, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rg-shots-'))}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let ws = '';
for (let i = 0; i < 60 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
if (!ws) throw new Error('browser did not start');
const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
for (const [name, query] of shots) {
  const ctx = await browser.createBrowserContext(); // fresh storage each time, so the sample trip is seeded
  const p = await ctx.newPage();
  await p.setViewport({ width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await p.goto(`${page}?shot=1&${query}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const file = `${out}/${name}.png`;
  await p.screenshot({ path: file });
  await ctx.close();
  console.log('ok  ', file);
}
await browser.close();
proc.kill();
