'use strict';

/**
 * Office gallery for the live FM019 Auburn strip verification (d8-p10w2).
 * Downloads the submitted store zip, writes fm019/photos, fm019/zips, fm019/manifest.json.
 * Run: node scripts/build-fm019.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const sharp = require(path.join('c:', 'Users', 'tgaut', 'eod-api', 'node_modules', 'sharp'));
const { ZipArchive } = require(path.join('c:', 'Users', 'tgaut', 'eod-api', 'node_modules', 'archiver'));

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'fm019');
const RAW = path.join(OUT, '_raw');
const PHOTOS = path.join(OUT, 'photos');
const ZIPS_OUT = path.join(OUT, 'zips');
const PERIOD = 'P10W2';
const THUMB_EDGE = 320;
const FULL_EDGE = 2400;
const WEBP_FULL_Q = 82;
const WEBP_THUMB_Q = 72;

const SET_ORDER = [
  { pogId: 'D701_L00000_D03_C351_V311_F008_MX', setName: 'CAT TREATS_W COMPLEMENTS_8 SHELF' },
  { pogId: 'D701_L00019_D01_C020_V401_F018_MX', setName: 'DOG TREATS' },
  { pogId: 'D701_L00000_D03_C095_V842_F032_MX', setName: 'DRY CAT_4 SHELF_75IN_MADIX LOZIER' },
  { pogId: 'D701_L00000_D01_C156_V121_F004_MX', setName: 'FROZEN PET FREEZER SLIM_GDM43-SL-HC-TSL01' },
  { pogId: 'D701_L00000_D01_C009_V301_F016_MX', setName: 'WET DOG FOOD_7 & 8 SHELF' },
];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function overallLetter(index) {
  return String.fromCharCode(65 + index);
}

function parseStoreFolder(name) {
  const m = String(name).match(/^Store_(\d+)_(.+)$/i);
  if (!m) return { storeNum: 0, storeName: name };
  return { storeNum: parseInt(m[1], 10), storeName: m[2].replace(/_/g, ' ') };
}

function matchSet(folder) {
  const hit = SET_ORDER.find((row) => folder.includes(row.pogId));
  if (hit) {
    return {
      setName: hit.setName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
      pogId: hit.pogId,
      order: SET_ORDER.indexOf(hit),
    };
  }
  return { setName: folder.replace(/_/g, ' '), pogId: '', order: 999 };
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
    for (const f of files) archive.file(f.abs, { name: f.name });
    archive.finalize();
  });
}

function fetchToken() {
  const js = [
    "'use strict';",
    "const { query, pool } = require('./src/lib/db');",
    '(async () => {',
    '  const { rows } = await query(',
    "    `SELECT sub.download_token AS token",
    '       FROM strip_verification_store_submissions sub',
    '       JOIN strip_verification_campaigns c ON c.id = sub.campaign_id',
    "      WHERE c.slug = 'd8-p10w2' AND sub.store_num = 19`,",
    '  );',
    "  if (!rows[0] || !rows[0].token) throw new Error('no download token');",
    '  process.stdout.write(String(rows[0].token));',
    '  await pool.end();',
    "})().catch((e) => { console.error(e.message || e); process.exit(1); });",
  ].join('\n');
  const b64 = Buffer.from(js, 'utf8').toString('base64');
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `railway ssh --service eod-api --environment production -- node -e "eval(Buffer.from('${b64}','base64').toString())"`,
  ], {
    cwd: 'C:/Users/tgaut/eod-api',
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const token = String(out).split(/\s+/).filter((part) => /^[A-Za-z0-9_-]{20,}$/.test(part)).pop();
  if (!token) throw new Error('download token missing from ssh output');
  return token;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('zip download status ' + res.statusCode));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.rmSync(PHOTOS, { recursive: true, force: true });
  fs.rmSync(ZIPS_OUT, { recursive: true, force: true });
  mkdirp(RAW);
  mkdirp(PHOTOS);
  mkdirp(ZIPS_OUT);

  console.log('Fetching submitted store zip');
  const token = fetchToken();
  const zipPath = path.join(RAW, 'source.zip');
  await download('https://eod-api.the-dump-bin.com/api/strip-verification/download/' + token + '.zip', zipPath);
  const zipStat = fs.statSync(zipPath);
  if (zipStat.size < 1000) throw new Error('zip too small: ' + zipStat.size);
  console.log('Zip bytes', zipStat.size);

  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${path.join(RAW, 'unzip').replace(/'/g, "''")}' -Force`,
  ], { stdio: 'inherit' });

  const unzip = path.join(RAW, 'unzip');
  let storeDirs = fs.readdirSync(unzip).filter((d) => fs.statSync(path.join(unzip, d)).isDirectory());
  if (storeDirs.length === 1) {
    const nested = path.join(unzip, storeDirs[0]);
    const inner = fs.readdirSync(nested).filter((d) => fs.statSync(path.join(nested, d)).isDirectory());
    if (inner.some((d) => /^Store_\d+/i.test(d))) storeDirs = inner.map((d) => path.join(storeDirs[0], d));
  }

  const stores = [];
  const flatPhotos = [];
  let maxOverall = 0;

  for (const storeRel of storeDirs) {
    const storeDir = path.basename(storeRel);
    const { storeNum, storeName } = parseStoreFolder(storeDir);
    if (storeNum !== 19) continue;
    const storePath = path.join(unzip, storeRel);
    const setDirs = fs.readdirSync(storePath).filter((d) => fs.statSync(path.join(storePath, d)).isDirectory());
    const sets = [];

    for (const setDir of setDirs) {
      const setMeta = matchSet(setDir);
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
      overalls.sort((a, b) => (a.sort - b.sort) || String(a.key).localeCompare(String(b.key)));
      maxOverall = Math.max(maxOverall, overalls.length);

      const relBase = `photos/${storeDir}/${setDir}`;
      mkdirp(path.join(OUT, 'photos', storeDir, setDir));

      let stripPic = null;
      if (strips[0]) {
        const fullRel = `${relBase}/strip.webp`;
        const thumbRel = `${relBase}/strip.thumb.webp`;
        await optimizeToWebp(path.join(setPath, strips[0].file), path.join(OUT, fullRel), path.join(OUT, thumbRel));
        stripPic = { full: fullRel, thumb: thumbRel, label: 'Strip' };
      }

      const overallPics = [];
      for (let i = 0; i < overalls.length; i++) {
        const letter = overallLetter(i);
        const stem = `overall_${letter.toLowerCase()}`;
        const fullRel = `${relBase}/${stem}.webp`;
        const thumbRel = `${relBase}/${stem}.thumb.webp`;
        await optimizeToWebp(path.join(setPath, overalls[i].file), path.join(OUT, fullRel), path.join(OUT, thumbRel));
        overallPics.push({ full: fullRel, thumb: thumbRel, label: `Overall ${letter}`, letter });
      }

      const setRow = {
        id: `${storeNum}-${setDir}`,
        storeNum,
        storeName,
        setName: setMeta.setName,
        pogId: setMeta.pogId,
        folder: setDir,
        order: setMeta.order,
        strip: stripPic,
        overalls: overallPics,
      };
      sets.push(setRow);
    }

    sets.sort((a, b) => a.order - b.order || a.setName.localeCompare(b.setName));
    for (const setRow of sets) {
      if (setRow.strip) {
        flatPhotos.push({
          storeNum, storeName, setName: setRow.setName, pogId: setRow.pogId,
          label: 'Strip', full: setRow.strip.full, thumb: setRow.strip.thumb, setId: setRow.id,
        });
      }
      for (const o of setRow.overalls) {
        flatPhotos.push({
          storeNum, storeName, setName: setRow.setName, pogId: setRow.pogId,
          label: o.label, full: o.full, thumb: o.thumb, setId: setRow.id,
        });
      }
    }

    const zipFiles = [];
    for (const s of sets) {
      const folder = `FM019_Auburn/${s.setName.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')}`;
      if (s.strip) zipFiles.push({ abs: path.join(OUT, s.strip.full), name: `${folder}/Strip.webp` });
      for (const o of s.overalls) {
        zipFiles.push({ abs: path.join(OUT, o.full), name: `${folder}/Overall_${o.letter}.webp` });
      }
    }
    const zipName = 'FM019_Auburn_P10W2_strip_verification.zip';
    await writeZip(path.join(ZIPS_OUT, zipName), zipFiles);

    stores.push({
      storeNum,
      storeName,
      setCount: sets.length,
      photoCount: sets.reduce((n, s) => n + (s.strip ? 1 : 0) + s.overalls.length, 0),
      zip: `zips/${zipName}`,
      sets: sets.map(({ order, ...rest }) => rest),
    });
  }

  if (!stores.length) throw new Error('store 19 folder not found in zip');
  const photoCount = flatPhotos.length;
  if (photoCount !== 16) throw new Error('expected 16 photos, got ' + photoCount);

  const manifest = {
    title: 'FM019 Auburn Strip Verification',
    periodWeek: PERIOD,
    brand: 'Retail Odyssey',
    storeNum: 19,
    storeName: 'Auburn',
    builtAt: new Date().toISOString(),
    maxOverallColumns: maxOverall,
    overallHeaders: Array.from({ length: maxOverall }, (_, i) => `Overall ${overallLetter(i)}`),
    bulkZip: stores[0].zip,
    stores,
    lightbox: flatPhotos,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('FM019 gallery:', stores[0].setCount, 'sets,', photoCount, 'photos, overall columns', maxOverall);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
