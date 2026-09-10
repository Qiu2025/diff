/**
 * Prepares the self-hosted OCR assets in `public/ocr/`.
 *
 * OCR is optional and its assets are large, so they are neither committed to
 * the repository nor bundled by default. Run `npm run prepare-ocr` to make OCR
 * available; the Docker image runs it during the build.
 *
 * Nothing here is fetched at page load from a third party. Tesseract.js
 * defaults to a CDN for its engine and language data, which would send a
 * request to someone else's server every time a user runs OCR. The application
 * always points it at these local copies instead, and reports OCR as
 * unavailable when they are missing rather than falling back to the network.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'public', 'ocr');

/**
 * Language data is not distributed on npm. `tessdata_fast` is the smallest
 * model Tesseract publishes for its LSTM engine.
 */
const LANGUAGE_SOURCE =
  'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata';

/**
 * All three LSTM cores are hosted because the browser picks one by feature
 * detection; each visitor downloads exactly one of them. Only the `.wasm.js`
 * files are needed: this is a single-file Emscripten build that carries its
 * WebAssembly inline, so the sibling `.wasm` files are never requested.
 */
const CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

function version(name) {
  return JSON.parse(fs.readFileSync(path.join(packageDir(name), 'package.json'), 'utf8')).version;
}

async function copyFile(from, to) {
  await fsp.copyFile(from, to);
  return (await fsp.stat(to)).size;
}

async function downloadLanguage(target) {
  if (fs.existsSync(target)) {
    console.log(`Reusing ${path.basename(target)}`);
    return (await fsp.stat(target)).size;
  }

  console.log(`Downloading ${LANGUAGE_SOURCE}`);
  const response = await fetch(LANGUAGE_SOURCE);
  if (!response.ok) {
    throw new Error(`Language data request failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(target, bytes);
  return bytes.length;
}

async function main() {
  await fsp.mkdir(outputDir, { recursive: true });

  const coreDir = packageDir('tesseract.js-core');
  const workerSource = path.join(packageDir('tesseract.js'), 'dist', 'worker.min.js');
  const files = {};

  for (const name of CORE_FILES) {
    files[name] = await copyFile(path.join(coreDir, name), path.join(outputDir, name));
  }
  files['worker.min.js'] = await copyFile(workerSource, path.join(outputDir, 'worker.min.js'));
  files['eng.traineddata'] = await downloadLanguage(path.join(outputDir, 'eng.traineddata'));

  const manifest = {
    engine: 'tesseract.js',
    engineVersion: version('tesseract.js'),
    coreVersion: version('tesseract.js-core'),
    languages: ['eng'],
    languageSource: LANGUAGE_SOURCE,
    /** Bytes a browser downloads for one OCR session: one core plus the model. */
    approximateDownloadBytes: files['tesseract-core-simd-lstm.wasm.js']
      + files['worker.min.js']
      + files['eng.traineddata'],
    files,
  };
  await fsp.writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const total = Object.values(files).reduce((sum, size) => sum + size, 0);
  console.log(`Prepared ${Object.keys(files).length} files in public/ocr (${(total / 1e6).toFixed(1)} MB on disk).`);
  console.log(`One browser downloads about ${(manifest.approximateDownloadBytes / 1e6).toFixed(1)} MB.`);
}

await main();
