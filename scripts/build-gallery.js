'use strict';

/**
 * Build strip_verification gallery assets from store zips.
 * Run: node scripts/build-gallery.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require(path.join('c:', 'Users', 'tgaut', 'eod-api', 'node_modules', 'sharp'));
const { ZipArchive } = require(path.join('c:', 'Users', 'tgaut', 'eod-api', 'node_modules', 'archiver'));

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, '_build', 'raw');
const PHOTOS = path.join(ROOT, 'photos');
const ZIPS_OUT = path.join(ROOT, 'zips');
const THUMB_EDGE = 320;
const FULL_EDGE = 2400;
const WEBP_FULL_Q = 82;
const WEBP_THUMB_Q = 72;

const SOURCE_ZIPS = [
  path.join('c:', 'Users', 'tgaut', 'Downloads', 'Store_459_Renton_P08W2_2026-08-25.zip'),
  path.join('c:', 'Users', 'tgaut', 'Downloads', 'Store_053_Covington_P08W2_2026-08-26.zip'),
  path.join('c:', 'Users', 'tgaut', 'Downloads', 'Store_031_Benson_Plaza_P08W2_2026-08-25.zip'),
];

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function overallLetter(index) {
  // 0 → A, 1 → B, ...
  return String.fromCharCode(65 + index);
}

function parseStoreFolder(name) {
  // Store_031_Benson_Plaza
  const m = String(name).match(/^Store_(\d+)_(.+)$/i);
  if (!m) return { storeNum: 0, storeName: name };
  return { storeNum: parseInt(m[1], 10), storeName: m[2].replace(/_/g, ' ') };
}

function parseSetFolder(name) {
  // S1LIQ_D701_... or YOGURT_-_6_SHELF_..._701_L...
  const raw = String(name);
  // Prefer splitting at first D701_ or 701_ that looks like POG id start
  const pogIdx = raw.search(/_D?701_/i);
  if (pogIdx > 0) {
    return {
      setName: raw.slice(0, pogIdx).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
      pogId: raw.slice(pogIdx + 1),
      folder: raw,
    };
  }
  return { setName: raw.replace(/_/g, ' '), pogId: '', folder: raw };
}

function classifyPhoto(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  if (/^strip/i.test(base)) return { kind: 'strip', sort: base };
  if (/^overall/i.test(base)) {
    const n = base.match(/overall[_\s-]*(\d+)/i);
    return { kind: 'overall', sort: n ? Number(n[1]) : 999, key: base };
  }
  return { kind: 'other', sort: base };
}

async function optimizeToWebp(srcPath, fullOut, thumbOut) {
  const img = sharp(srcPath, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const w = meta.width || FULL_EDGE;
  const h = meta.height || FULL_EDGE;
  const fullScale = Math.min(1, FULL_EDGE / Math.max(w, h));
  const thumbScale = Math.min(1, THUMB_EDGE / Math.max(w, h));

  await img
    .clone()
    .resize(Math.max(1, Math.round(w * fullScale)), Math.max(1, Math.round(h * fullScale)), { fit: 'inside' })
    .webp({ quality: WEBP_FULL_Q, effort: 5 })
    .toFile(fullOut);

  await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize(Math.max(1, Math.round(w * thumbScale)), Math.max(1, Math.round(h * thumbScale)), { fit: 'inside' })
    .webp({ quality: WEBP_THUMB_Q, effort: 5 })
    .toFile(thumbOut);
}

function writeZip(filePath, files) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', reject);
    out.on('close', resolve);
    archive.pipe(out);
    for (const f of files) {
      archive.file(f.abs, { name: f.name });
    }
    archive.finalize();
  });
}

async function main() {
  rmrf(RAW);
  rmrf(PHOTOS);
  mkdirp(RAW);
  mkdirp(PHOTOS);
  mkdirp(ZIPS_OUT);
  mkdirp(path.join(ROOT, 'assets'));

  for (const zip of SOURCE_ZIPS) {
    if (!fs.existsSync(zip)) throw new Error(`Missing zip: ${zip}`);
    console.log('Extracting', path.basename(zip));
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${RAW.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'inherit' });
  }

  const stores = [];
  const storeDirs = fs.readdirSync(RAW).filter((d) => fs.statSync(path.join(RAW, d)).isDirectory());

  let maxOverall = 0;
  const flatPhotos = []; // for lightbox order

  for (const storeDir of storeDirs.sort()) {
    const { storeNum, storeName } = parseStoreFolder(storeDir);
    const storePath = path.join(RAW, storeDir);
    const setDirs = fs.readdirSync(storePath).filter((d) => fs.statSync(path.join(storePath, d)).isDirectory());
    const sets = [];

    for (const setDir of setDirs.sort()) {
      const setMeta = parseSetFolder(setDir);
      const setPath = path.join(storePath, setDir);
      const files = fs.readdirSync(setPath).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

      const strips = [];
      const overalls = [];
      for (const f of files) {
        const c = classifyPhoto(f);
        if (c.kind === 'strip') strips.push({ file: f, sort: c.sort });
        else if (c.kind === 'overall') overalls.push({ file: f, sort: c.sort, key: c.key });
      }
      strips.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
      overalls.sort((a, b) => (a.sort - b.sort) || a.key.localeCompare(b.key));
      maxOverall = Math.max(maxOverall, overalls.length);

      const relBase = `photos/${storeDir}/${setDir}`;
      mkdirp(path.join(PHOTOS, storeDir, setDir));

      const stripPics = [];
      for (let i = 0; i < strips.length; i++) {
        const src = path.join(setPath, strips[i].file);
        const stem = i === 0 ? 'strip' : `strip_${i + 1}`;
        const fullRel = `${relBase}/${stem}.webp`;
        const thumbRel = `${relBase}/${stem}.thumb.webp`;
        await optimizeToWebp(src, path.join(ROOT, fullRel), path.join(ROOT, thumbRel));
        stripPics.push({ full: fullRel, thumb: thumbRel, label: i === 0 ? 'Strip' : `Strip ${i + 1}` });
      }

      const overallPics = [];
      for (let i = 0; i < overalls.length; i++) {
        const src = path.join(setPath, overalls[i].file);
        const letter = overallLetter(i);
        const stem = `overall_${letter.toLowerCase()}`;
        const fullRel = `${relBase}/${stem}.webp`;
        const thumbRel = `${relBase}/${stem}.thumb.webp`;
        await optimizeToWebp(src, path.join(ROOT, fullRel), path.join(ROOT, thumbRel));
        overallPics.push({ full: fullRel, thumb: thumbRel, label: `Overall ${letter}`, letter });
      }

      const setRow = {
        id: `${storeNum}-${setDir}`,
        storeNum,
        storeName,
        setName: setMeta.setName,
        pogId: setMeta.pogId,
        folder: setDir,
        strip: stripPics[0] || null,
        overalls: overallPics,
      };
      sets.push(setRow);

      // lightbox sequence: strip then overalls
      if (stripPics[0]) {
        flatPhotos.push({
          storeNum, storeName, setName: setMeta.setName, pogId: setMeta.pogId,
          label: 'Strip', full: stripPics[0].full, thumb: stripPics[0].thumb, setId: setRow.id,
        });
      }
      for (const o of overallPics) {
        flatPhotos.push({
          storeNum, storeName, setName: setMeta.setName, pogId: setMeta.pogId,
          label: o.label, full: o.full, thumb: o.thumb, setId: setRow.id,
        });
      }
    }

    // Build per-store zip of optimized full-size webps with friendly names
    const zipFiles = [];
    for (const s of sets) {
      const folder = `FM${String(s.storeNum).padStart(3, '0')}_${s.storeName.replace(/\s+/g, '_')}/${s.setName.replace(/\s+/g, '_')}`;
      if (s.strip) {
        zipFiles.push({ abs: path.join(ROOT, s.strip.full), name: `${folder}/Strip.webp` });
      }
      for (const o of s.overalls) {
        zipFiles.push({ abs: path.join(ROOT, o.full), name: `${folder}/Overall_${o.letter}.webp` });
      }
    }
    const zipName = `FM${String(storeNum).padStart(3, '0')}_${storeName.replace(/\s+/g, '_')}_P08W2_strip_verification.zip`;
    const zipPath = path.join(ZIPS_OUT, zipName);
    await writeZip(zipPath, zipFiles);
    console.log('Wrote', zipName, `(${zipFiles.length} files)`);

    stores.push({
      storeNum,
      storeName,
      setCount: sets.length,
      photoCount: sets.reduce((n, s) => n + (s.strip ? 1 : 0) + s.overalls.length, 0),
      zip: `zips/${zipName}`,
      sets,
    });
  }

  stores.sort((a, b) => a.storeNum - b.storeNum);

  // Bulk zip
  const bulkFiles = [];
  for (const st of stores) {
    for (const s of st.sets) {
      const folder = `FM${String(s.storeNum).padStart(3, '0')}_${s.storeName.replace(/\s+/g, '_')}/${s.setName.replace(/\s+/g, '_')}`;
      if (s.strip) bulkFiles.push({ abs: path.join(ROOT, s.strip.full), name: `${folder}/Strip.webp` });
      for (const o of s.overalls) {
        bulkFiles.push({ abs: path.join(ROOT, o.full), name: `${folder}/Overall_${o.letter}.webp` });
      }
    }
  }
  const bulkName = 'District8_P08W2_Strip_Verification_ALL.zip';
  await writeZip(path.join(ZIPS_OUT, bulkName), bulkFiles);
  console.log('Wrote', bulkName);

  // Brand assets
  const logoSrc = path.join('c:', 'Users', 'tgaut', 'OneDrive', 'Documents', 'GitHub', 'the-dump-bin', 'logo.png');
  const bannerSrc = path.join('c:', 'Users', 'tgaut', 'OneDrive', 'Documents', 'GitHub', 'the-dump-bin', 'logo-banner.png');
  if (fs.existsSync(logoSrc)) fs.copyFileSync(logoSrc, path.join(ROOT, 'assets', 'logo.png'));
  if (fs.existsSync(bannerSrc)) fs.copyFileSync(bannerSrc, path.join(ROOT, 'assets', 'logo-banner.png'));

  const manifest = {
    title: 'District 8 Strip Verification',
    periodWeek: 'P08W2',
    brand: 'Retail Odyssey',
    builtAt: new Date().toISOString(),
    maxOverallColumns: maxOverall,
    overallHeaders: Array.from({ length: maxOverall }, (_, i) => `Overall ${overallLetter(i)}`),
    bulkZip: `zips/${bulkName}`,
    stores,
    lightbox: flatPhotos,
  };
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Manifest written:', stores.length, 'stores,', flatPhotos.length, 'lightbox photos, max overall cols', maxOverall);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
