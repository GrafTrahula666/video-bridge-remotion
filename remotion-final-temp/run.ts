import chromium from '@sparticuz/chromium';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {mkdir, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import os from 'node:os';

function ensureLoopbackInterfaceForRestrictedSandboxes() {
  try { os.networkInterfaces(); } catch {
    Object.defineProperty(os, 'networkInterfaces', {
      configurable: true,
      value: () => ({lo: [{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]}),
    });
  }
}

const main = async () => {
  const root = resolve(process.cwd(), 'remotion-final-temp');
  const publicDir = join(root, 'public');
  const outputDir = join(root, 'output');
  await mkdir(publicDir, {recursive:true});
  await mkdir(outputDir, {recursive:true});

  const firstFrames = Number(process.env.FIRST_FRAMES || 361);
  const secondFrames = Number(process.env.SECOND_FRAMES || 361);
  const overlapFrames = Number(process.env.OVERLAP_FRAMES || 1);
  const inputProps = {firstFrames, secondFrames, overlapFrames};

  ensureLoopbackInterfaceForRestrictedSandboxes();
  const serveUrl = await bundle({entryPoint: join(root, 'index.ts'), publicDir});
  const browserExecutable = await chromium.executablePath();
  const composition = await selectComposition({serveUrl, id:'RitualFinal', inputProps, browserExecutable, chromeMode:'headless-shell'});
  const outputLocation = join(outputDir, 'shaman-ritual-final.mp4');
  await rm(outputLocation, {force:true});
  await renderMedia({
    composition,
    serveUrl,
    codec:'h264',
    outputLocation,
    inputProps,
    browserExecutable,
    chromeMode:'headless-shell',
    concurrency:1,
    overwrite:true,
    crf:14,
    audioBitrate:'320k',
    pixelFormat:'yuv420p',
  });
  const s = await stat(outputLocation);
  console.log(JSON.stringify({ok:true, output:outputLocation, bytes:s.size, inputProps}, null, 2));
};

main().catch((e) => { console.error(e); process.exitCode=1; });
