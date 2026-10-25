#!/usr/bin/env node
'use strict';
/* =========================================================
   Universal POS — เซิร์ฟเวอร์บนเครื่อง (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
   - เปิดหน้าเว็บ POS
   - บันทึกข้อมูลลงไฟล์ data/pos-data.json (เขียนแบบปลอดภัย กันไฟล์เสียเมื่อไฟดับ)
   - สำรองข้อมูลอัตโนมัติ รายชั่วโมง / รายวัน / ก่อนนำเข้าหรือรีเซ็ต
   - หลายเครื่องในร้านใช้ข้อมูลชุดเดียวกันได้ (เปิดด้วย --lan)

   ใช้งาน:  node server.js [--open] [--lan] [--port 8080] [--data <โฟลเดอร์ข้อมูล>]
   ========================================================= */

const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { exec, execFile } = require('node:child_process');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(process.env.PORT || opt('--port') || 8080);
const LAN = argv.includes('--lan') || process.env.POS_LAN === '1';
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = path.resolve(opt('--data') || process.env.POS_DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'pos-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = { hourly: 48, daily: 90, manual: 30 };
const MAX_BODY = 100 * 1024 * 1024;
const PUBLIC = ['/index.html', '/css/', '/js/'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const CONTROL_TOKEN = process.env.POS_CONTROL_TOKEN || ''; // ตั้งโดยโปรแกรมที่มุมจอ (tray) ใช้สั่งปิดเซิร์ฟเวอร์
const LOG_FILE = opt('--log');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// เมื่อรันเบื้องหลัง (ไม่มีหน้าต่าง) ให้เขียน log ลงไฟล์แทน
if (LOG_FILE) {
  try { if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`); } catch { /* no log yet */ }
  const out = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const write = (level, args) => out.write(`${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  console.log = (...a) => write('INFO', a);
  console.warn = (...a) => write('WARN', a);
  console.error = (...a) => write('ERROR', a);
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hour: pad(d.getHours()),
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  };
}

/* ---------- Load ---------- */
function readState() {
  let sawCorrupt = false;
  for (const file of [DATA_FILE, `${DATA_FILE}.bak`]) {
    if (!fs.existsSync(file)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof s.rev !== 'number') throw new Error('invalid format');
      if (file !== DATA_FILE) console.warn(`⚠ ไฟล์ข้อมูลหลักเสียหาย — ใช้ข้อมูลจากไฟล์สำรอง ${file}`);
      return {
        rev: s.rev, savedAt: s.savedAt || null, recent: Array.isArray(s.recent) ? s.recent : [], data: s.data ?? null,
        dataId: s.dataId || null, resetAt: s.resetAt || null,
      };
    } catch (e) {
      sawCorrupt = true;
      const bad = `${file}.corrupt-${Date.now()}`;
      fs.copyFileSync(file, bad);
      console.error(`⚠ อ่านไฟล์ ${file} ไม่ได้ (${e.message}) — เก็บสำเนาไว้ที่ ${bad}`);
    }
  }
  if (sawCorrupt) {
    console.error('✖ ไม่พบไฟล์ข้อมูลที่อ่านได้ กรุณากู้คืนจากโฟลเดอร์ backups ก่อนเริ่มโปรแกรม');
    console.error(`  (คัดลอกไฟล์สำรองที่ต้องการไปวางแทน ${DATA_FILE})`);
    process.exit(1);
  }
  return { rev: 0, savedAt: null, recent: [], data: null, dataId: null, resetAt: null };
}

let state = readState();
let queue = Promise.resolve();

/* ---------- Save & backups ---------- */
async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); }
    catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }
}

async function prune() {
  const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const [kind, keep] of Object.entries(KEEP)) {
    for (const f of files.filter((x) => x.startsWith(`${kind}-`)).slice(keep)) {
      await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
    }
  }
}

// Copies the file as it is *before* this write, so every backup is a complete earlier state.
async function backupCurrent(reason) {
  if (!fs.existsSync(DATA_FILE)) return;
  const s = stamp();
  const names = [`daily-${s.day}.json`, `hourly-${s.day}_${s.hour}.json`];
  if (reason) names.push(`manual-${s.day}_${s.time}-${reason}.json`);
  for (const name of names) {
    const dest = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(dest)) await fsp.copyFile(DATA_FILE, dest);
  }
  await prune();
}

function persist(snapshot, reason) {
  const job = queue.then(async () => {
    await backupCurrent(reason);
    const tmp = `${DATA_FILE}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(snapshot));
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (fs.existsSync(DATA_FILE)) await fsp.copyFile(DATA_FILE, `${DATA_FILE}.bak`);
    await renameRetry(tmp, DATA_FILE);
  });
  queue = job.catch(() => {});
  return job;
}

/* ---------- HTTP ---------- */
function send(res, status, body, headers = {}) {
  const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('ข้อมูลมีขนาดใหญ่เกินไป'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanUrls() {
  if (!LAN) return [];
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
}

async function saveData(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'invalid json' }); }
  if (!payload || !payload.data || typeof payload.data !== 'object' || !Array.isArray(payload.data.products)) {
    return send(res, 400, { error: 'invalid data' });
  }
  // เครื่องที่ยังถือข้อมูลร้านชุดก่อนเริ่มต้นใหม่ ห้ามเขียนทับร้านชุดใหม่
  if (payload.dataId !== state.dataId && (payload.dataId || state.resetAt)) return send(res, 409, { rev: state.rev, dataId: state.dataId, reset: true });
  if (payload.baseRev !== state.rev) return send(res, 409, { rev: state.rev, data: state.data, recent: state.recent });

  const prev = state;
  state = {
    ...prev,
    rev: prev.rev + 1,
    savedAt: new Date().toISOString(),
    recent: [...prev.recent, payload.writeId].filter(Boolean).slice(-100),
    data: payload.data,
  };
  try {
    await persist(state, req.headers['x-replace'] === '1' ? 'before-replace' : '');
    send(res, 200, { rev: state.rev, savedAt: state.savedAt });
  } catch (e) {
    if (state.rev === prev.rev + 1) state = prev;
    console.error('✖ บันทึกไฟล์ไม่สำเร็จ:', e);
    send(res, 500, { error: `บันทึกไฟล์ไม่สำเร็จ: ${e.message}` });
  }
}

async function serveStatic(req, res, pathname) {
  if (pathname.includes('\\') || pathname.includes('\0')) return send(res, 404, { error: 'not found' });
  pathname = path.posix.normalize(pathname);
  if (pathname === '/') pathname = '/index.html';
  const allowed = PUBLIC.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
  const file = path.join(ROOT, pathname);
  if (!allowed || !file.startsWith(ROOT + path.sep)) return send(res, 404, { error: 'not found' });
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': buf.length });
    res.end(buf);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// กันเว็บไซต์ภายนอกแอบอ่าน/เขียนข้อมูลร้านผ่านเบราว์เซอร์ (DNS rebinding / CSRF)
function allowedHost(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (host === 'localhost' || net.isIP(host)) return true;
  const hn = os.hostname().toLowerCase();
  return LAN && (host === hn || host === `${hn}.local`);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function openFolder(dir) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [dir], () => {});
}

async function handle(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(res, 400, { error: 'bad url' }); }
  if (!allowedHost(req)) return send(res, 403, { error: 'forbidden host' });
  if (req.method !== 'GET') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden origin' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'json required' });
  }

  if (pathname === '/api/rev' && req.method === 'GET') return send(res, 200, { rev: state.rev, dataId: state.dataId });
  if (pathname === '/api/data' && req.method === 'GET') return send(res, 200, state);
  if (pathname === '/api/data' && req.method === 'PUT') return saveData(req, res);

  if (pathname === '/api/shutdown' && req.method === 'POST') {
    if (!CONTROL_TOKEN || req.headers['x-pos-token'] !== CONTROL_TOKEN || !isLoopback(req)) return send(res, 403, { error: 'forbidden' });
    send(res, 200, { ok: true });
    setTimeout(shutdown, 50);
    return;
  }
  if (pathname === '/api/open-data-folder' && req.method === 'POST') {
    if (!isLoopback(req)) return send(res, 403, { error: 'forbidden' });
    openFolder(DATA_DIR);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/info' && req.method === 'GET') {
    const names = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json'));
    const backups = await Promise.all(names.map(async (name) => {
      const st = await fsp.stat(path.join(BACKUP_DIR, name));
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    }));
    backups.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return send(res, 200, { dataFile: DATA_FILE, backupDir: BACKUP_DIR, rev: state.rev, savedAt: state.savedAt, lan: lanUrls(), backups, canOpenFolder: isLoopback(req) });
  }

  const m = pathname.match(/^\/api\/backups\/([\w.-]+\.json)$/);
  if (m && req.method === 'GET') {
    try {
      const buf = await fsp.readFile(path.join(BACKUP_DIR, m[1]));
      return send(res, 200, buf.toString('utf8'), { 'Content-Disposition': `attachment; filename="${m[1]}"` });
    } catch {
      return send(res, 404, { error: 'not found' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);
  return send(res, 405, { error: 'method not allowed' });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const url = `http://localhost:${PORT}`;
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  });
});

function alreadyRunning() {
  console.log(`โปรแกรม POS กำลังทำงานอยู่แล้ว (พอร์ต ${PORT}) — เปิด ${url}`);
  console.log('ถ้าต้องการปิดแล้วเปิดโปรแกรมใหม่ ใช้ restart-pos.bat');
  if (argv.includes('--open')) openBrowser(url);
  setTimeout(() => process.exit(0), 800);
}

// Windows ยอมให้เปิดพอร์ตเดียวกันซ้อนได้ถ้าคนละที่อยู่ (127.0.0.1 กับ 0.0.0.0 ของ --lan)
// → จะมี POS สองตัวเขียนไฟล์ข้อมูลทับกัน จึงต้องเช็กก่อนว่ามีตัวไหนเปิดอยู่แล้วหรือไม่
function isPosRunning() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/rev', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(typeof JSON.parse(body).rev === 'number'); } catch { resolve(false); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    alreadyRunning();
  } else {
    console.error(e);
    process.exit(1);
  }
});

isPosRunning().then((running) => running ? alreadyRunning() : server.listen(PORT, HOST, () => {
  // รหัสชุดข้อมูลร้าน — เปลี่ยนเมื่อเริ่มต้นใหม่ทั้งหมด (restart-pos.bat) เบราว์เซอร์จะได้รู้ว่าสำเนาที่ถืออยู่เป็นของร้านชุดเดิม
  // ไฟล์รุ่นเก่า/ยังไม่มีไฟล์ → สร้างรหัสแล้วบันทึกทันที ให้คงที่แม้ปิดเปิดโปรแกรม
  if (!state.dataId) {
    state.dataId = crypto.randomUUID();
    persist(state).catch((e) => console.error('✖ บันทึกไฟล์ไม่สำเร็จ:', e));
  }
  console.log('');
  console.log('  ✅ Universal POS พร้อมใช้งาน');
  console.log(`  เปิดในเบราว์เซอร์:  ${url}`);
  lanUrls().forEach((u) => console.log(`  เครื่องอื่นในร้าน:   ${u}`));
  console.log(`  ไฟล์ข้อมูล:         ${DATA_FILE}`);
  console.log(`  ไฟล์สำรอง:          ${BACKUP_DIR}`);
  console.log('');
  if (!LOG_FILE) {
    console.log('  ** เปิดหน้าต่างนี้ไว้ระหว่างใช้งาน — ปิดหน้าต่างเมื่อเลิกใช้ **');
    console.log('');
  }
  if (argv.includes('--open')) openBrowser(url);
}));

async function shutdown() {
  server.close();
  await queue;
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
