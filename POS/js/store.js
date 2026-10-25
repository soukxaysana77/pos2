'use strict';
/* =========================================================
   Universal POS — การจัดเก็บ & ซิงก์ข้อมูล
   - เปิดผ่านโปรแกรมที่ติดตั้ง (server.js): บันทึกลงไฟล์บนเครื่อง + สำรองอัตโนมัติ
     และซิงก์ข้อมูลระหว่างหลายเครื่อง; เบราว์เซอร์เก็บสำเนาไว้ใช้ตอนออฟไลน์
   - เปิด index.html ตรง ๆ: เก็บใน localStorage เท่านั้น (โหมดสำรอง)
   ========================================================= */

const BASE_KEY = `${APP_KEY}-base`;
const PENDING_KEY = `${APP_KEY}-pending`;
const DATAID_KEY = `${APP_KEY}-data-id`;
const Store = {
  mode: 'local', rev: 0, dataId: null, base: null, dirty: 0, inflight: false, again: false, replace: false, resetting: false,
  unknown: [], status: '', detail: '', saveTimer: 0, retryTimer: 0,
};

const shareable = (d) => { const { cart, ...rest } = d; return rest; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function lsGet(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

function writeLocal() {
  if (lsSet(APP_KEY, db)) return;
  if (Store.mode === 'local' || Store.status === 'offline') {
    toast('บันทึกข้อมูลในเบราว์เซอร์ไม่สำเร็จ: พื้นที่เต็ม (ลองลบรูปสินค้า หรือส่งออกข้อมูลสำรอง)', 'error', 5000);
  }
}
function writeBase() {
  if (Store.base && !lsSet(BASE_KEY, { rev: Store.rev, data: Store.base })) lsDel(BASE_KEY);
}

/* ---------- Boot ---------- */
async function initStore() {
  let local = lsGet(APP_KEY);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if (location.protocol.startsWith('http')) {
    let server = null;
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (res.ok && res.headers.get('content-type')?.includes('json')) server = await res.json();
    } catch { /* no API — static hosting */ }

    if (server && typeof server.rev === 'number') {
      Store.mode = 'server';
      Store.rev = server.rev;
      Store.dataId = server.dataId || null;
      // ร้านถูกเริ่มต้นใหม่ทั้งหมดที่เครื่องหลัก (restart-pos.bat) → สำเนาในเบราว์เซอร์นี้เป็นของร้านชุดเดิม ห้ามส่งกลับขึ้นไป
      const knownId = lsGet(DATAID_KEY);
      const wasReset = knownId && Store.dataId ? knownId !== Store.dataId : !!server.resetAt && !!local;
      if (wasReset) {
        [APP_KEY, BASE_KEY, PENDING_KEY, CASHIER_KEY].forEach(lsDel);
        local = null;
        setTimeout(() => toast('ร้านถูกเริ่มต้นใหม่ทั้งหมดที่เครื่องหลัก — ล้างข้อมูลร้านเดิมในเบราว์เซอร์นี้แล้ว', 'info', 6000), 600);
      }
      if (Store.dataId) lsSet(DATAID_KEY, Store.dataId);
      const localCart = local && local.cart && Array.isArray(local.cart.lines) ? local.cart : emptyCart();
      const pending = lsGet(PENDING_KEY);
      const recent = server.recent || [];

      const useServer = () => {
        db = migrate(clone(server.data));
        db.cart = localCart;
        Store.base = shareable(migrate(clone(server.data)));
        lsDel(PENDING_KEY);
        writeLocal(); writeBase();
      };

      if (!server.data) {
        // เริ่มใช้งานครั้งแรก: ย้ายข้อมูลที่เคยเก็บในเบราว์เซอร์ขึ้นไฟล์ (ถ้ามี)
        db = local ? migrate(local) : seedDB(false); // ร้านใหม่ → ตัวช่วยตั้งค่าร้านจะเปิดขึ้นมา
        Store.base = null;
        Store.dirty = 1;
        writeLocal();
        await syncNow();
        if (local) toast('ย้ายข้อมูลจากเบราว์เซอร์ไปบันทึกลงไฟล์บนเครื่องแล้ว', 'success', 5000);
      } else if (pending && local) {
        const landed = pending.writeId && recent.includes(pending.writeId);
        const base = lsGet(BASE_KEY);
        if (landed) {
          useServer();
          if (pending.changed) toast('การแก้ไขล่าสุดก่อนปิดโปรแกรมบางส่วนอาจไม่ถูกบันทึก กรุณาตรวจสอบ', 'warn', 6000);
        } else if (base && base.rev === server.rev) {
          db = migrate(local);
          Store.base = base.data;
          Store.dirty = 1;
          syncNow();
        } else if (base) {
          db = migrate(mergeDB(base.data, shareable(local), shareable(clone(server.data))));
          db.cart = localCart;
          Store.base = shareable(migrate(clone(server.data)));
          Store.dirty = 1;
          writeLocal();
          syncNow();
          toast('รวมข้อมูลที่ยังไม่ได้บันทึกเข้ากับข้อมูลในไฟล์แล้ว', 'success', 4000);
        } else {
          useServer();
        }
      } else {
        useServer();
      }

      if (!Store.dirty) setSyncStatus('saved');
      setInterval(pollServer, 3000);
      window.addEventListener('online', syncNow);
      window.addEventListener('beforeunload', (e) => {
        if (Store.dirty || Store.inflight) { e.preventDefault(); e.returnValue = ''; }
      });
      return;
    }
  }

  Store.mode = 'local';
  db = local ? migrate(local) : seedDB(false); // ร้านใหม่ → ตัวช่วยตั้งค่าร้านจะเปิดขึ้นมา
  writeLocal();
  setSyncStatus('local');
  try {
    if (!sessionStorage.getItem('pos-local-warned')) {
      sessionStorage.setItem('pos-local-warned', '1');
      setTimeout(() => toast('⚠ ข้อมูลเก็บอยู่ในเบราว์เซอร์เท่านั้น — ติดตั้งโปรแกรมด้วย Install.cmd เพื่อบันทึกลงไฟล์ถาวร', 'warn', 7000), 600);
    }
  } catch { /* ignore */ }
}

/* ---------- Save / sync ---------- */
function save() {
  writeLocal();
  if (Store.mode !== 'server') return;
  Store.dirty++;
  const p = lsGet(PENDING_KEY) || {};
  lsSet(PENDING_KEY, { writeId: p.writeId || null, changed: true });
  setSyncStatus('saving');
  clearTimeout(Store.saveTimer);
  Store.saveTimer = setTimeout(syncNow, 250);
}

function replaceAllData(data) {
  db = migrate(data);
  Store.replace = true;
  save();
  renderAll();
}

async function syncNow() {
  if (Store.mode !== 'server' || !Store.dirty) return;
  if (Store.inflight) { Store.again = true; return; }
  clearTimeout(Store.retryTimer);
  Store.inflight = true;
  const mark = Store.dirty;
  const writeId = uid();
  const body = JSON.stringify({ baseRev: Store.rev, dataId: Store.dataId, writeId, data: shareable(db) });
  Store.unknown = [...Store.unknown, { id: writeId, body }].slice(-3);
  lsSet(PENDING_KEY, { writeId, changed: false });
  setSyncStatus('saving');

  try {
    const res = await fetch('/api/data', {
      method: 'PUT', body, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(Store.replace ? { 'X-Replace': '1' } : {}) },
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      Store.unknown = [];
      Store.rev = json.rev;
      Store.base = JSON.parse(body).data;
      Store.replace = false;
      if (Store.dirty === mark) { Store.dirty = 0; lsDel(PENDING_KEY); }
      else lsSet(PENDING_KEY, { writeId: null, changed: true });
      writeBase();
      setSyncStatus(Store.dirty ? 'saving' : 'saved');
    } else if (res.status === 409 && json.reset) {
      onDataReset();
    } else if (res.status === 409 && json.data) {
      // มีเครื่องอื่นบันทึกก่อน → รวมการเปลี่ยนแปลงของเครื่องนี้เข้ากับข้อมูลล่าสุด
      if (Store.replace) {
        Store.rev = json.rev;
      } else {
        const hit = [...Store.unknown].reverse().find((u) => (json.recent || []).includes(u.id));
        const base = hit ? JSON.parse(hit.body).data : (Store.base || {});
        const theirs = shareable(migrate(json.data));
        const cart = db.cart;
        db = migrate(mergeDB(clone(base), clone(shareable(db)), clone(theirs)));
        db.cart = cart;
        Store.base = theirs;
        Store.rev = json.rev;
        writeLocal(); writeBase();
        onRemoteChange();
      }
      Store.unknown = [];
      Store.again = true;
    } else {
      Store.unknown.pop();
      throw new Error(json.error || `HTTP ${res.status}`);
    }
  } catch (e) {
    Store.again = false;
    setSyncStatus('offline', e.message);
    Store.retryTimer = setTimeout(syncNow, 5000);
  } finally {
    Store.inflight = false;
    if (Store.again) { Store.again = false; syncNow(); }
  }
}

async function pollServer() {
  if (Store.inflight) return;
  try {
    const res = await fetch('/api/rev', { cache: 'no-store' });
    const { rev, dataId } = await res.json();
    if (dataId && Store.dataId && dataId !== Store.dataId) { onDataReset(); return; }
    if (Store.dirty) { syncNow(); return; }
    if (Store.status !== 'saved') setSyncStatus('saved');
    if (rev !== Store.rev && !modalStack.length) await pullServer();
  } catch (e) {
    setSyncStatus('offline', e.message);
  }
}

// ร้านถูกเริ่มต้นใหม่ทั้งหมดที่เครื่องหลักระหว่างเปิดหน้านี้อยู่ → โหลดหน้าใหม่ (initStore จะล้างสำเนาร้านเดิมให้)
function onDataReset() {
  if (Store.resetting) return;
  Store.resetting = true;
  Store.dirty = 0;
  Store.inflight = false;
  clearTimeout(Store.saveTimer);
  clearTimeout(Store.retryTimer);
  location.reload();
}

async function pullServer() {
  const res = await fetch('/api/data', { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.data || Store.dirty || Store.inflight || modalStack.length) return;
  const cart = db.cart;
  db = migrate(json.data);
  db.cart = cart;
  Store.base = clone(shareable(db));
  Store.rev = json.rev;
  writeLocal(); writeBase();
  onRemoteChange();
}

/* ---------- 3-way merge (base = ข้อมูลที่ซิงก์ล่าสุด, mine = เครื่องนี้, theirs = ในไฟล์) ---------- */
const J = (x) => JSON.stringify(x);

function mergeFields(b = {}, m = {}, t = {}, deltaFields = []) {
  const r = { ...t };
  for (const k of new Set([...Object.keys(m), ...Object.keys(b)])) {
    if (deltaFields.includes(k)) { r[k] = r3(num(t[k]) + num(m[k]) - num(b[k])); continue; }
    if (J(m[k]) !== J(b[k])) { if (m[k] === undefined) delete r[k]; else r[k] = m[k]; }
  }
  return r;
}

function mergeList(b = [], m = [], t = [], mergeItem = (bi, mi, ti) => mergeFields(bi, mi, ti)) {
  const bm = new Map(b.map((x) => [x.id, x]));
  const mm = new Map(m.map((x) => [x.id, x]));
  const out = new Map(t.map((x) => [x.id, x]));
  for (const id of bm.keys()) if (!mm.has(id)) out.delete(id);
  for (const x of m) {
    const bx = bm.get(x.id);
    if (!bx) { out.set(x.id, out.has(x.id) ? mergeItem({}, x, out.get(x.id)) : x); continue; }
    if (J(x) === J(bx)) continue;
    const tx = out.get(x.id);
    out.set(x.id, tx ? mergeItem(bx, x, tx) : x);
  }
  return [...out.values()];
}

function mergeProduct(b, m, t) {
  const r = mergeFields(b, m, t, ['stock']);
  r.variants = J(m.variants) !== J(b.variants)
    ? mergeList(b.variants, m.variants, t.variants, (bv, mv, tv) => mergeFields(bv, mv, tv, ['stock']))
    : (t.variants || []);
  if (r.variants.length) r.stock = r3(sum(r.variants, (v) => num(v.stock)));
  return r;
}

function mergeDB(base, mine, theirs) {
  const out = { ...theirs };
  out.settings = mergeFields(base.settings, mine.settings, theirs.settings);
  out.categories = mergeList(base.categories, mine.categories, theirs.categories);
  out.products = mergeList(base.products, mine.products, theirs.products, mergeProduct);
  out.customers = mergeList(base.customers, mine.customers, theirs.customers, (b, m, t) => mergeFields(b, m, t, ['points']));
  out.sales = mergeList(base.sales, mine.sales, theirs.sales).sort((a, b) => a.date.localeCompare(b.date));
  out.held = mergeList(base.held, mine.held, theirs.held);
  out.shifts = mergeList(base.shifts, mine.shifts, theirs.shifts);
  out.units = mergeList(base.units, mine.units, theirs.units);
  out.sessions = mergeList(base.sessions, mine.sessions, theirs.sessions);
  out.bookings = mergeList(base.bookings, mine.bookings, theirs.bookings);
  out.stockLog = mergeList(base.stockLog, mine.stockLog, theirs.stockLog).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1500);
  out.seq = { sale: Math.max(num(mine.seq?.sale), num(theirs.seq?.sale), 1) };
  ['session', 'booking', 'job'].forEach((k) => { out.seq[k] = Math.max(num(mine.seq?.[k]), num(theirs.seq?.[k])); });

  // บิลที่สองเครื่องออกเลขซ้ำกันพร้อมกัน → ออกเลขใหม่ให้บิลของเครื่องนี้
  const known = new Set([...(base.sales || []), ...(theirs.sales || [])].map((s) => s.id));
  const used = new Set((theirs.sales || []).map((s) => s.no));
  for (const s of out.sales) {
    if (known.has(s.id)) continue;
    if (used.has(s.no)) s.no = `${out.settings.invoicePrefix}${String(out.seq.sale++).padStart(6, '0')}`;
    used.add(s.no);
  }
  // เช่นเดียวกันกับเลขบิลเปิด / เลขงาน / เลขการจอง
  const renumber = (list, baseList = [], theirList = [], seqOf) => {
    const knownIds = new Set([...baseList, ...theirList].map((x) => x.id));
    const usedNos = new Set(theirList.map((x) => x.no));
    for (const x of list) {
      if (!knownIds.has(x.id) && usedNos.has(x.no)) x.no = nextSeq(...seqOf(x), out);
      usedNos.add(x.no);
    }
  };
  renumber(out.sessions, base.sessions, theirs.sessions, (x) => (x.isJob ? ['job', 'J'] : ['session', 'S']));
  renumber(out.bookings, base.bookings, theirs.bookings, () => ['booking', 'B']);
  return out;
}

/* ---------- Status indicator ---------- */
const SYNC_LABELS = {
  saved: ['ok', 'บันทึกแล้ว', 'ข้อมูลถูกบันทึกลงไฟล์บนเครื่องแล้ว'],
  saving: ['warn', 'กำลังบันทึก…', 'กำลังบันทึกลงไฟล์'],
  offline: ['danger', 'ออฟไลน์', 'เชื่อมต่อโปรแกรม POS ไม่ได้ — ข้อมูลเก็บชั่วคราวในเบราว์เซอร์ และจะบันทึกลงไฟล์เมื่อเชื่อมต่อได้'],
  local: ['muted', 'เบราว์เซอร์', 'ข้อมูลเก็บในเบราว์เซอร์เท่านั้น — ติดตั้งด้วย Install.cmd เพื่อบันทึกลงไฟล์'],
};

function paintSyncStatus() {
  const s = SYNC_LABELS[Store.status];
  if (!s) return;
  $$('.sync-status').forEach((el) => {
    el.className = `sync-status ${s[0]}`;
    el.textContent = s[1];
    el.title = s[2] + (Store.detail ? ` (${Store.detail})` : '');
  });
}

function setSyncStatus(status, detail = '') {
  const prev = Store.status;
  Store.status = status;
  Store.detail = detail;
  paintSyncStatus();
  if (status === 'offline' && prev !== 'offline') {
    toast('เชื่อมต่อโปรแกรม POS ไม่ได้ — ขายต่อได้ ข้อมูลจะบันทึกลงไฟล์อัตโนมัติเมื่อเชื่อมต่อได้', 'warn', 5000);
  }
  if (prev === 'offline' && (status === 'saved' || status === 'saving')) toast('เชื่อมต่อได้แล้ว', 'success');
}
