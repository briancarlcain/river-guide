// Regenerates the iOS app icon and splash from resources/icon.svg.  node resources/make-assets.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('resources/icon.svg');
const set = 'ios/App/App/Assets.xcassets';
await sharp(svg).resize(1024, 1024).flatten({ background: '#c8643a' }).png().toFile(`${set}/AppIcon.appiconset/AppIcon-512@2x.png`);
const mark = await sharp(svg).resize(720, 720).png().toBuffer();
const rounded = await sharp(mark)
  .composite([{ input: Buffer.from('<svg width="720" height="720"><rect width="720" height="720" rx="160"/></svg>'), blend: 'dest-in' }])
  .png()
  .toBuffer();
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#f5eede' } }).composite([{ input: rounded, gravity: 'center' }]).png().toBuffer();
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(`${set}/Splash.imageset/${f}`, splash);
console.log('icon and splash written');
