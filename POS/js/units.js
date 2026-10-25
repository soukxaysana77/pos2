'use strict';
/* =========================================================
   Universal POS — ห้อง / โต๊ะ / รถ / สนาม
   ผังสถานะ, เปิดบิล (เช็คอิน/ปล่อยเช่า/เปิดโต๊ะ), คิดเงินตามเวลา, มัดจำ, ย้าย, จัดการหน่วย
   ========================================================= */

const unitById = (id) => db.units.find((u) => u.id === id);
const sessionOfUnit = (id) => db.sessions.find((s) => s.status === 'open' && s.unitId === id);
const depositTotal = (x) => r2(sum(x?.deposits || [], (d) => num(d.amount)));
const isMobile = () => matchMedia('(max-width: 860px)').matches;
const isHourScale = (u) => !['night', 'day', 'month'].includes(u?.pricing?.mode);
function toLocalInput(d) {
  if (!d) return '';
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const priceTag = (pr) => (pr?.mode && pr.mode !== 'none' ? `${money(pr.price)}/${PRICING_MODES[pr.mode].per}${pr.perPerson ? '/คน' : ''}` : '');

function unitsMenuTitle() {
  const menus = [...new Set(db.units.filter((u) => u.active !== false).map((u) => unitKind(u.kind).menu))];
  if (menus.length === 1) return menus[0];
  if (menus.length > 1) return 'ผังบริการ';
  return db.settings.useJobs ? 'งานรับ' : 'การจอง';
}

// ค่าเวลาของบิลเปิด — คิดจากจุดที่ยังไม่ได้เก็บเงิน (billedFrom) ถึงเวลาที่กำหนด
function sessionTime(s, endISO, { final = true } = {}) {
  const label = `${unitKind(s.kind).charge} ${s.unitName || ''}`.trim();
  const from = s.billedFrom || s.startAt;
  if (final && s.timeOverride != null && s.timeOverride !== '') {
    const amt = num(s.timeOverride);
    const l = timeLine(`${label} (ราคาตกลง)`, 1, 'ครั้ง', amt, `${fmtDateTime(from)} – ${fmtDateTime(endISO)}`);
    l.taxable = s.pricing?.taxable !== false;
    return { lines: amt > 0 ? [l] : [], units: 1, unitLabel: 'ครั้ง', from, until: endISO, minutes: (new Date(endISO) - new Date(from)) / 60000 };
  }
  const firstBill = !(s.saleIds || []).length;
  return computeTimeCharge(s.pricing, from, endISO, s.guests, { final, label, minOne: !final || firstBill });
}
const sessionRunningTotal = (s, now = new Date()) => calcTotals([...sessionTime(s, now.toISOString()).lines, ...s.cart.lines], s.cart.discount, db.settings).total;

function nextBookingFor(u, now = Date.now()) {
  const limit = isHourScale(u) ? now + 3 * 3600e3 : addDays(startOfDay(now), 1).getTime();
  return db.bookings.filter((b) => b.unitId === u.id && b.status === 'confirmed' && new Date(b.startAt) < limit && new Date(b.endAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] || null;
}
function unitState(u, now = Date.now()) {
  const s = sessionOfUnit(u.id);
  if (s) return { key: s.plannedEndAt && new Date(s.plannedEndAt) < now ? 'late' : 'busy', session: s };
  if (u.status === 'maintenance') return { key: 'off' };
  if (u.status === 'cleaning') return { key: 'cleaning' };
  const b = nextBookingFor(u, now);
  return b ? { key: 'reserved', booking: b } : { key: 'free' };
}
function sessionTimeInfo(s, now = Date.now()) {
  const mode = s.pricing?.mode;
  if (mode === 'night' || mode === 'month') return `📅 ${fmtDayShort(s.startAt)}${s.plannedEndAt ? ` → ${fmtDayShort(s.plannedEndAt)}` : ''}`;
  if (mode === 'day') return `📅 ${fmtDayShort(s.startAt)} ${fmtTime(s.startAt)}${s.plannedEndAt ? ` → ${fmtDayShort(s.plannedEndAt)} ${fmtTime(s.plannedEndAt)}` : ''}`;
  return `⏱ ${fmtDuration((now - new Date(s.startAt)) / 60000)}${s.plannedEndAt ? ` · ถึง ${fmtTime(s.plannedEndAt)}` : ''}`;
}

/* ---------- หน้าผัง ---------- */
function unitTabs() {
  const s = db.settings, tabs = [];
  const open = db.sessions.filter((x) => x.status === 'open');
  if (s.useUnits || open.some((x) => !x.isJob)) tabs.push(['board', '🗺️ ผังสถานะ']);
  if (s.useBookings) tabs.push(['calendar', '📅 ปฏิทินการจอง'], ['bookings', '📒 รายการจอง']);
  if (s.useJobs || open.some((x) => x.isJob)) tabs.push(['jobs', '🧾 งานรับ / ออเดอร์']);
  return tabs.length ? tabs : [['board', '🗺️ ผังสถานะ']];
}

function renderUnits() {
  const el = $('#view-units');
  const tabs = unitTabs();
  if (!tabs.some(([k]) => k === ui.unitsTab)) ui.unitsTab = tabs[0][0];
  el.innerHTML = `
    <header class="view-head"><div><h2>${esc(unitsMenuTitle())}</h2><p class="muted" id="units-sub"></p></div>
      <div class="row gap-s wrap" id="units-actions"></div></header>
    ${tabs.length > 1 ? `<div class="seg tabs" id="units-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${ui.unitsTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div id="units-body"></div>`;
  const t = $('#units-tabs', el);
  if (t) t.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { ui.unitsTab = b.dataset.tab; renderUnits(); } };
  $('#units-actions', el).onclick = (e) => {
    const a = e.target.closest('[data-uact]')?.dataset.uact;
    if (a === 'add') openUnitsBulk();
    if (a === 'manage') openUnitsManager();
    if (a === 'book') openBookingForm(null);
    if (a === 'newjob') openJobForm(null);
  };
  ({ board: drawBoard, calendar: drawCalendar, bookings: drawBookingList, jobs: drawJobs })[ui.unitsTab]();
}
const refreshUnitsView = () => { if (ui.view === 'units') renderUnits(); };

function drawBoard() {
  const body = $('#units-body');
  const units = db.units.filter((u) => u.active !== false);
  $('#units-actions').innerHTML = `${db.settings.useBookings ? '<button class="btn" data-uact="book">📅 จองล่วงหน้า</button>' : ''}
    <button class="btn" data-uact="manage">⚙ จัดการ / ราคา</button><button class="btn primary" data-uact="add">＋ เพิ่ม</button>`;
  if (!units.length) {
    $('#units-sub').textContent = '';
    body.innerHTML = `<div class="card"><div class="empty"><div class="empty-ico">🗺️</div><p>ยังไม่มีห้อง / โต๊ะ / รถ</p>
      <small>เพิ่มหน่วยที่ให้บริการ เช่น ห้องพัก 101–110, โต๊ะ 1–10, รถเช่า หรือสนาม แล้วกำหนดวิธีคิดเงิน</small><br><br>
      <button class="btn primary lg" data-uact2="add">＋ เพิ่มห้อง / โต๊ะ / รถ</button></div></div>`;
    $('[data-uact2]', body).onclick = openUnitsBulk;
    return;
  }
  const groups = [...new Set(units.map((u) => u.group || ''))];
  if (ui.unitGroup !== 'all' && !groups.includes(ui.unitGroup)) ui.unitGroup = 'all';
  const now = Date.now();
  const states = units.filter((u) => ui.unitGroup === 'all' || (u.group || '') === ui.unitGroup).map((u) => ({ u, st: unitState(u, now) }));
  const count = (k) => states.filter((x) => x.st.key === k).length;
  const held = depositTotal({ deposits: openSessions().flatMap((s) => s.deposits || []) });
  $('#units-sub').textContent = `${units.length} รายการ · ใช้งานอยู่ ${count('busy') + count('late')}${held ? ` · มัดจำที่ถือไว้ ${money(held)}` : ''}`;
  const legend = [['free', 'ว่าง'], ['busy', 'ใช้งาน'], ['late', 'เกินกำหนด'], ['reserved', 'จองวันนี้'], ['cleaning', 'รอทำความสะอาด'], ['off', 'ปิดปรับปรุง']]
    .filter(([k]) => count(k) || k === 'free' || k === 'busy');
  const section = (list) => `<div class="ugrid">${list.map(({ u, st }) => unitCardHTML(u, st, now)).join('')}</div>`;
  const byGroup = ui.unitGroup === 'all' && groups.length > 1
    ? groups.map((g) => { const list = states.filter((x) => (x.u.group || '') === g); return list.length ? `<h3 class="ugroup-title">${esc(g || 'ไม่ระบุกลุ่ม')}</h3>${section(list)}` : ''; }).join('')
    : section(states);
  body.innerHTML = `
    ${groups.length > 1 ? `<div class="chips" style="margin-bottom:10px"><button class="chip ${ui.unitGroup === 'all' ? 'active' : ''}" data-group="all">ทั้งหมด</button>${groups.map((g) => `<button class="chip ${ui.unitGroup === g ? 'active' : ''}" data-group="${esc(g)}">${esc(g || 'ไม่ระบุกลุ่ม')}</button>`).join('')}</div>` : ''}
    <div class="ustats">${legend.map(([k, l]) => `<span class="ustat st-${k}"><i></i>${l} <b>${count(k)}</b></span>`).join('')}</div>
    ${byGroup}`;
  body.onclick = async (e) => {
    const g = e.target.closest('[data-group]');
    if (g) { ui.unitGroup = g.dataset.group; drawBoard(); return; }
    const card = e.target.closest('[data-unit]');
    if (!card) return;
    const u = unitById(card.dataset.unit);
    const st = unitState(u);
    if (st.session) return enterSession(st.session.id);
    if (st.key === 'cleaning') {
      if (await confirmDialog(`${esc(u.name)} ทำความสะอาดเสร็จแล้ว?`, { title: 'พร้อมให้บริการ', okText: 'พร้อมใช้งาน' })) { u.status = 'available'; save(); drawBoard(); }
      return;
    }
    if (st.key === 'off') return openUnitForm(u);
    // โต๊ะอาหาร/เตียงนวด (ไม่คิดเวลา): แตะแล้วเปิดบิลทันที ไม่ต้องกรอกฟอร์ม — แก้ข้อมูลภายหลังได้ที่ "รายละเอียด"
    if (u.pricing?.mode === 'none' && st.key === 'free') return quickOpenSession(u);
    openSessionStart(u);
  };
}

function quickOpenSession(u) {
  const now = new Date().toISOString();
  const s = {
    id: uid(), no: nextSeq('session', 'S'), unitId: u.id, unitName: u.name, kind: u.kind, icon: u.icon || unitKind(u.kind).icon,
    status: 'open', startAt: now, plannedEndAt: null, billedFrom: now, endAt: null, customerId: null, guestName: '', guestPhone: '', guests: 1,
    info: {}, note: '', deposits: [], pricing: structuredClone(u.pricing), timeOverride: null, cart: emptyTab(), saleIds: [], bookingId: null,
    cashier: currentCashier(), deviceId: deviceId(), createdAt: now, demo: hasDemoData(),
  };
  db.sessions.push(s);
  save();
  toast(`${u.name}: เปิดบิลแล้ว — แตะสินค้าเพื่อสั่ง`, 'success');
  enterSession(s.id);
}

function unitCardHTML(u, st, now) {
  const L = kindLabels(u.kind);
  let label = 'ว่าง', body = '', foot = '';
  if (st.session) {
    const s = st.session;
    label = st.key === 'late' ? 'เกินกำหนด' : L.busy;
    body = `<div class="uguest">${esc(s.guestName || 'ไม่ระบุชื่อ')}</div><div class="utime">${sessionTimeInfo(s, now)}</div>`;
    foot = `<span>${s.cart.lines.length ? `${s.cart.lines.length} รายการ` : ''}${depositTotal(s) ? ' 🔐' : ''}</span><b>${money(sessionRunningTotal(s, new Date(now)))}</b>`;
  } else if (st.key === 'reserved') {
    label = 'จองไว้';
    body = `<div class="uguest">${esc(st.booking.guestName || '')}</div><div class="utime">📅 ${bookingWhen(st.booking)}</div>`;
    foot = `<span class="uprice">${priceTag(u.pricing)}</span>`;
  } else if (st.key === 'cleaning') {
    label = 'รอทำความสะอาด';
    body = '<div class="utime">แตะเมื่อทำความสะอาดเสร็จ</div>';
  } else if (st.key === 'off') {
    label = 'ปิดปรับปรุง';
    body = `<div class="utime">${esc(u.note || '')}</div>`;
  } else foot = `<span class="uprice">${priceTag(u.pricing)}</span>`;
  return `<button class="ucard st-${st.key}" data-unit="${u.id}">
    <div class="ucard-top"><span class="uicon">${esc(u.icon || unitKind(u.kind).icon)}</span><b class="uname">${esc(u.name)}</b></div>
    <span class="ustate">${label}</span>${body}${foot ? `<div class="ucard-foot">${foot}</div>` : ''}</button>`;
}

function enterSession(id) {
  ui.sessionId = id;
  ui.posSearch = '';
  go('pos');
  if (isMobile()) $('#cart')?.classList.add('open');
}
function exitSession() {
  const s = activeSession();
  ui.sessionId = null;
  if (s?.isJob) ui.unitsTab = 'jobs';
  else if (ui.unitsTab === 'jobs') ui.unitsTab = 'board';
  go('units');
}

/* ---------- เปิดบิล (เช็คอิน / ปล่อยเช่า / เปิดโต๊ะ) ---------- */
function endQuickOptions(mode) {
  return {
    night: [[1, '1 คืน'], [2, '2 คืน'], [3, '3 คืน'], [7, '7 คืน']],
    day: [[1, '1 วัน'], [2, '2 วัน'], [3, '3 วัน'], [7, '7 วัน']],
    hour: [[60, '1 ชม.'], [120, '2 ชม.'], [180, '3 ชม.'], [240, '4 ชม.']],
    month: [[1, '1 เดือน'], [3, '3 เดือน'], [6, '6 เดือน'], [12, '1 ปี']],
  }[mode] || [];
}
function applyEndQuick(pr, start, v) {
  if (pr.mode === 'night') return atTime(addDays(start, v), pr.checkoutTime || '12:00');
  if (pr.mode === 'day') return addMinutes(start, v * 1440);
  if (pr.mode === 'hour') return addMinutes(start, v);
  if (pr.mode === 'month') return addMonths(start, v);
  return null;
}
const defaultEnd = (pr, start) => (['night', 'day'].includes(pr.mode) ? applyEndQuick(pr, start, 1) : null);
function depositMethodSeg(id, method = 'cash') {
  return `<div class="seg" id="${id}">${['cash', 'transfer', 'card'].map((k) => `<button type="button" data-m="${k}" class="${k === method ? 'active' : ''}" title="${PAY_METHODS[k].label}">${PAY_METHODS[k].icon} ${k === 'cash' ? 'เงินสด' : k === 'transfer' ? 'โอน' : 'บัตร'}</button>`).join('')}</div>`;
}
function bindSeg(root, id) {
  const seg = $(`#${id}`, root);
  if (seg) seg.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) $$('button', seg).forEach((x) => x.classList.toggle('active', x === b)); });
  return () => $(`#${id} .active`, root)?.dataset.m || 'cash';
}
// ใช้ลูกค้าเดิม หรือสร้างลูกค้าใหม่อัตโนมัติเมื่อมีเบอร์โทร
function ensureCustomer(name, phone, pickedId) {
  if (pickedId) return db.customers.find((c) => c.id === pickedId) || null;
  phone = (phone || '').trim(); name = (name || '').trim();
  if (!phone) return null;
  let c = db.customers.find((x) => x.phone === phone);
  if (!c && name) {
    c = { id: uid(), name, phone, email: '', note: '', points: 0, createdAt: new Date().toISOString() };
    db.customers.push(c);
  }
  return c || null;
}
// ต้องเปิดกะก่อนรับเงินสดเข้าลิ้นชัก
function withShiftForCash(method, amount, fn) {
  if (amount > 0 && method === 'cash' && db.settings.useShifts && !currentShift()) return openShiftStart(() => fn());
  return fn();
}
const newDeposit = (amount, method) => ({ id: uid(), amount: r2(amount), method, at: new Date().toISOString(), shiftId: currentShift()?.id || null });

function findConflict(unitId, startAt, endAt, { excludeBooking = null, excludeSession = null } = {}) {
  const a = new Date(startAt).getTime(), b = Math.max(new Date(endAt || startAt).getTime(), a + 60000);
  const overlap = (s, e) => s < b && e > a;
  const bk = db.bookings.find((x) => x.unitId === unitId && x.status === 'confirmed' && x.id !== excludeBooking
    && overlap(new Date(x.startAt).getTime(), new Date(x.endAt).getTime()));
  if (bk) return { kind: 'booking', item: bk };
  const ss = db.sessions.find((x) => x.unitId === unitId && x.status === 'open' && x.id !== excludeSession
    && overlap(new Date(x.startAt).getTime(), Math.max(Date.now(), new Date(x.plannedEndAt || 0).getTime())));
  return ss ? { kind: 'session', item: ss } : null;
}
const conflictText = (c) => (c.kind === 'booking'
  ? `ทับกับการจอง ${c.item.no} (${esc(c.item.guestName || '-')} · ${bookingWhen(c.item)})`
  : `${esc(unitById(c.item.unitId)?.name || '')} มีบิลเปิดอยู่ (${esc(c.item.guestName || '-')})`);

// ช่องกรอกลูกค้า: ชื่อ + เบอร์ + ปุ่มค้นหาลูกค้าเดิม
function guestFieldsHTML(prefix, name = '', phone = '') {
  return `<div class="field span2"><span>ลูกค้า</span><div class="input-group">
    <input id="${prefix}-name" placeholder="ชื่อลูกค้า" value="${esc(name)}"><input id="${prefix}-phone" type="tel" placeholder="เบอร์โทร" value="${esc(phone)}">
    <button class="btn" id="${prefix}-pick" type="button" title="ค้นหาลูกค้าเดิม">🔍</button></div></div>`;
}
function bindGuestPick(root, prefix, state) {
  $(`#${prefix}-pick`, root).onclick = () => openCustomerPicker((id) => {
    const c = db.customers.find((x) => x.id === id);
    if (!c) return;
    state.customerId = c.id;
    $(`#${prefix}-name`, root).value = c.name;
    $(`#${prefix}-phone`, root).value = c.phone || '';
  });
  $(`#${prefix}-name`, root).addEventListener('input', () => { state.customerId = null; });
}

function openSessionStart(u, { booking = null } = {}) {
  const k = unitKind(u.kind), L = kindLabels(u.kind), pr = u.pricing || { mode: 'none' };
  const now = new Date();
  const soon = booking ? null : nextBookingFor(u);
  const b = booking;
  const quick = endQuickOptions(pr.mode);
  const bookedDep = depositTotal(b);
  const st = { customerId: b?.customerId || null };
  const m = openModal({
    title: `${esc(u.icon || k.icon)} ${L.open} — ${esc(u.name)}`, size: 'md',
    body: `${soon ? `<div class="notice row gap-s"><span class="grow">📅 มีการจอง <b>${esc(soon.no)}</b> ${esc(soon.guestName || '')} · ${bookingWhen(soon)}</span><button class="btn sm primary" id="ss-frombook" type="button">${L.open}จากการจองนี้</button></div>` : ''}
      ${b ? `<div class="notice ok">📅 ${L.open}จากการจอง <b>${esc(b.no)}</b> · ${bookingWhen(b)}</div>` : ''}
      <div class="fields c2">
        ${guestFieldsHTML('ss', b?.guestName, b?.guestPhone)}
        <label class="field"><span>${L.start}</span><input id="ss-start" type="datetime-local" value="${toLocalInput(now)}"></label>
        <label class="field"><span>จำนวนคน</span><input id="ss-guests" type="number" min="1" step="1" value="${b?.guests || (pr.perPerson ? 2 : 1)}"></label>
        ${pr.mode !== 'none' ? `<div class="field span2"><span>${L.end} <small class="muted">(ไม่บังคับ)</small></span>
          <input id="ss-end" type="datetime-local" value="${toLocalInput(b ? b.endAt : defaultEnd(pr, now))}">
          ${quick.length ? `<div class="quick" id="ss-quick">${quick.map(([v, l]) => `<button type="button" data-q="${v}">${l}</button>`).join('')}</div>` : ''}</div>` : ''}
        ${(k.fields || []).filter((f) => !/ตอนคืน/.test(f)).map((f) => `<label class="field"><span>${esc(f)}</span><input data-info="${esc(f)}"></label>`).join('')}
        <div class="field span2"><span>เงินมัดจำ${bookedDep ? ` <small class="muted">(รับไว้ตอนจองแล้ว ${money(bookedDep)} — ใส่เฉพาะที่รับเพิ่ม)</small>` : ''}</span>
          <div class="input-group"><input id="ss-dep" type="number" min="0" step="0.01" placeholder="0" value="${!b && u.defaultDeposit ? u.defaultDeposit : ''}">${depositMethodSeg('ss-depm')}</div></div>
        <label class="field span2"><span>หมายเหตุ</span><input id="ss-note" value="${esc(b?.note || '')}"></label>
      </div>
      <div class="estimate" id="ss-est"></div>`,
    footer: `<span class="muted small grow" title="${esc(pricingSummary(pr))}">${esc(pricingSummary(pr))}</span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary lg" id="ss-ok">${L.open}</button>`,
  });
  const el = m.el;
  bindGuestPick(el, 'ss', st);
  const depMethod = bindSeg(el, 'ss-depm');
  const startIn = $('#ss-start', el), endIn = $('#ss-end', el), guestsIn = $('#ss-guests', el);
  const est = () => {
    const box = $('#ss-est', el);
    if (!endIn || !endIn.value || pr.mode === 'none') { box.innerHTML = ''; return; }
    const r = computeTimeCharge(pr, fromLocalInput(startIn.value), fromLocalInput(endIn.value), num(guestsIn.value), { final: false, label: k.charge });
    const total = sum(r.lines, lineTotal);
    box.innerHTML = `ประมาณการ${esc(k.charge)}: <b>${money(total)}</b> <span class="muted">(${fmtQty(r.units)} ${r.unitLabel} · ไม่รวมรายการอื่น)</span>`;
  };
  if (endIn) endIn.addEventListener('input', est);
  startIn.addEventListener('input', est);
  guestsIn.addEventListener('input', est);
  const q = $('#ss-quick', el);
  if (q) q.onclick = (e) => {
    const btn = e.target.closest('[data-q]'); if (!btn) return;
    endIn.value = toLocalInput(applyEndQuick(pr, new Date(fromLocalInput(startIn.value) || now), num(btn.dataset.q)));
    est();
  };
  est();
  const fb = $('#ss-frombook', el);
  if (fb) fb.onclick = () => { m.close(); openSessionStart(u, { booking: soon }); };

  const doOpen = async () => {
    if (sessionOfUnit(u.id)) return toast(`${u.name} มีบิลเปิดอยู่แล้ว`, 'error');
    const startAt = fromLocalInput(startIn.value) || now.toISOString();
    const endAt = endIn && endIn.value ? fromLocalInput(endIn.value) : null;
    if (endAt && endAt <= startAt) return toast(`${L.end}ต้องหลัง${L.start}`, 'warn');
    const c = findConflict(u.id, startAt, endAt || startAt, { excludeBooking: b?.id });
    if (c && !await confirmDialog(`${conflictText(c)}<br>ต้องการ${L.open}ต่อหรือไม่?`, { okText: `${L.open}ต่อ` })) return;
    const name = $('#ss-name', el).value.trim(), phone = $('#ss-phone', el).value.trim();
    const cust = ensureCustomer(name, phone, st.customerId);
    const info = {};
    $$('[data-info]', el).forEach((i) => { if (i.value.trim()) info[i.dataset.info] = i.value.trim(); });
    const sess = {
      id: uid(), no: nextSeq('session', 'S'), unitId: u.id, unitName: u.name, kind: u.kind, icon: u.icon || k.icon,
      status: 'open', startAt, plannedEndAt: endAt, billedFrom: startAt, endAt: null,
      customerId: cust?.id || null, guestName: cust?.name || name, guestPhone: cust?.phone || phone, guests: Math.max(1, Math.round(num(guestsIn.value))),
      info, note: $('#ss-note', el).value.trim(), deposits: [], pricing: structuredClone(pr), timeOverride: null,
      cart: emptyTab(), saleIds: [], bookingId: b?.id || null, cashier: currentCashier(), deviceId: deviceId(),
      createdAt: new Date().toISOString(), demo: !!b?.demo || hasDemoData(),
    };
    if (b) { sess.deposits = [...(b.deposits || [])]; b.deposits = []; b.status = 'checked-in'; b.sessionId = sess.id; }
    const dep = num($('#ss-dep', el).value);
    if (dep > 0) sess.deposits.push(newDeposit(dep, depMethod()));
    db.sessions.push(sess);
    u.status = 'available';
    save(); m.close();
    toast(`${L.open} ${u.name} แล้ว`, 'success');
    if (['none', 'hour', 'flat'].includes(pr.mode)) enterSession(sess.id);
    else refreshUnitsView();
  };
  $('#ss-ok', el).onclick = () => withShiftForCash(depMethod(), num($('#ss-dep', el).value), doOpen);
}

/* ---------- รายละเอียดบิลเปิด ---------- */
function openSessionDetails(s) {
  const k = unitKind(s.kind), L = kindLabels(s.kind), pr = s.pricing || { mode: 'none' };
  const st = { customerId: s.customerId };
  const fields = [...new Set([...(k.fields || []), ...Object.keys(s.info || {})])];
  const quick = endQuickOptions(pr.mode);
  const m = openModal({
    title: `${esc(s.icon || '')} ${esc(s.unitName)} · ${esc(s.no)}`, size: 'md',
    body: `<div class="fields c2">
        ${guestFieldsHTML('sd', s.guestName, s.guestPhone)}
        <label class="field"><span>${L.start}</span><input id="sd-start" type="datetime-local" value="${toLocalInput(s.startAt)}"></label>
        <label class="field"><span>จำนวนคน</span><input id="sd-guests" type="number" min="1" step="1" value="${s.guests || 1}"></label>
        ${pr.mode !== 'none' ? `<div class="field span2"><span>${L.end}</span><input id="sd-end" type="datetime-local" value="${toLocalInput(s.plannedEndAt)}">
          ${quick.length ? `<div class="quick" id="sd-quick"><small class="muted">ขยายเวลา:</small>${quick.map(([v, l]) => `<button type="button" data-q="${v}">+${l}</button>`).join('')}</div>` : ''}</div>` : ''}
        ${fields.map((f) => `<label class="field"><span>${esc(f)}</span><input data-info="${esc(f)}" value="${esc(s.info?.[f] || '')}"></label>`).join('')}
        <label class="field span2"><span>หมายเหตุ</span><input id="sd-note" value="${esc(s.note || '')}"></label>
      </div>
      ${pr.mode !== 'none' ? `<div class="pf-sec"><h4>ราคาครั้งนี้</h4><p>เปลี่ยนเฉพาะบิลนี้ ไม่กระทบราคาปกติของ${esc(k.noun)}</p>
        <div class="fields c2">
          <label class="field"><span>ราคาต่อ${PRICING_MODES[pr.mode].per}</span><input id="sd-price" type="number" min="0" step="0.01" value="${num(pr.price)}"></label>
          <label class="field"><span>หรือกำหนดค่า${esc(k.charge.replace(/^ค่า/, ''))}ทั้งหมดเอง</span><input id="sd-override" type="number" min="0" step="0.01" placeholder="ไม่กำหนด" value="${s.timeOverride ?? ''}"></label>
        </div></div>` : ''}
      <div class="pf-sec"><h4>เงินมัดจำ</h4>
        <div class="list" id="sd-deps" style="margin:6px 0 8px"></div>
        <div class="input-group"><input id="sd-dep" type="number" min="0" step="0.01" placeholder="รับมัดจำเพิ่ม">${depositMethodSeg('sd-depm')}<button class="btn" id="sd-depadd" type="button">รับมัดจำ</button></div>
      </div>`,
    footer: `${s.saleIds.length ? '' : '<button class="btn ghost danger-text" id="sd-cancel">ยกเลิกบิลนี้</button>'}<span class="grow"></span><button class="btn ghost" data-cancel>ปิด</button><button class="btn primary" id="sd-save">บันทึก</button>`,
  });
  const el = m.el;
  bindGuestPick(el, 'sd', st);
  const depMethod = bindSeg(el, 'sd-depm');
  const drawDeps = () => {
    $('#sd-deps', el).innerHTML = (s.deposits || []).map((d) => `<div class="pay-row"><span>${PAY_METHODS[d.method]?.icon} ${fmtDateTime(d.at)}</span><b>${money(d.amount)}</b></div>`).join('')
      || '<p class="muted small" style="margin:0">ยังไม่ได้รับมัดจำ</p>';
  };
  drawDeps();
  $('#sd-depadd', el).onclick = () => {
    const amt = num($('#sd-dep', el).value);
    if (amt <= 0) return toast('ระบุจำนวนเงินมัดจำ', 'warn');
    withShiftForCash(depMethod(), amt, () => {
      s.deposits.push(newDeposit(amt, depMethod()));
      $('#sd-dep', el).value = '';
      save(); drawDeps(); renderCart();
      toast('รับมัดจำแล้ว', 'success');
    });
  };
  const q = $('#sd-quick', el);
  if (q) q.onclick = (e) => {
    const btn = e.target.closest('[data-q]'); if (!btn) return;
    const endIn = $('#sd-end', el);
    const base = endIn.value ? new Date(fromLocalInput(endIn.value)) : new Date();
    endIn.value = toLocalInput(pr.mode === 'night' ? atTime(addDays(base, num(btn.dataset.q)), pr.checkoutTime || '12:00') : applyEndQuick(pr, base, num(btn.dataset.q)));
  };
  const c = $('#sd-cancel', el);
  if (c) c.onclick = async () => { if (await cancelSession(s)) { m.close(); exitSession(); } };
  $('#sd-save', el).onclick = () => {
    const name = $('#sd-name', el).value.trim(), phone = $('#sd-phone', el).value.trim();
    const cust = ensureCustomer(name, phone, st.customerId);
    const oldStart = s.startAt;
    s.customerId = cust?.id || null; s.guestName = cust?.name || name; s.guestPhone = cust?.phone || phone;
    s.startAt = fromLocalInput($('#sd-start', el).value) || s.startAt;
    if (s.billedFrom === oldStart) s.billedFrom = s.startAt;
    s.guests = Math.max(1, Math.round(num($('#sd-guests', el).value)));
    const endIn = $('#sd-end', el);
    if (endIn) s.plannedEndAt = endIn.value ? fromLocalInput(endIn.value) : null;
    s.note = $('#sd-note', el).value.trim();
    s.info = {};
    $$('[data-info]', el).forEach((i) => { if (i.value.trim()) s.info[i.dataset.info] = i.value.trim(); });
    if ($('#sd-price', el)) {
      s.pricing.price = r2($('#sd-price', el).value);
      const ov = $('#sd-override', el).value;
      s.timeOverride = ov === '' ? null : r2(ov);
    }
    save(); m.close(); renderCart(); refreshUnitsView();
    toast('บันทึกแล้ว', 'success');
  };
}

/* ---------- มัดจำ: คืน หรือ ริบเป็นรายได้ ---------- */
function depositDecision(amount) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: 'เงินมัดจำ', size: 'sm',
      body: `<p class="confirm-msg">มีเงินมัดจำ <b>${money(amount)}</b> — จะคืนให้ลูกค้าหรือไม่?</p>`,
      footer: '<button class="btn ghost" data-cancel>ย้อนกลับ</button><span class="grow"></span><button class="btn" data-d="forfeit">ไม่คืน (เป็นรายได้)</button><button class="btn primary" data-d="refund">คืนเงินมัดจำ</button>',
      onClose: () => { if (!done) resolve(null); },
    });
    $$('[data-d]', m.el).forEach((b) => { b.onclick = () => { done = true; resolve(b.dataset.d); m.close(); }; });
  });
}
const refundRecords = (deposits) => deposits.map((d) => ({ amount: d.amount, method: d.method, at: new Date().toISOString(), shiftId: currentShift()?.id || null }));
function forfeitDeposits(deposits, name, extra = {}) {
  const total = r2(sum(deposits, (d) => num(d.amount)));
  if (total <= 0) return null;
  const line = { id: uid(), productId: null, variantId: null, name, variantName: '', options: [], unit: 'ครั้ง', qty: 1, price: total, cost: 0, discountType: 'amount', discountValue: 0, taxable: false, note: '', decimalQty: false, categoryId: '' };
  const sale = buildSale([line], { type: 'amount', value: 0 }, { ...db.settings, serviceRate: 0, rounding: 0 }, {
    no: nextInvoiceNo(), payments: deposits.map((d) => ({ method: 'deposit', via: d.method, amount: num(d.amount) })), paid: total,
    cashier: currentCashier(), shiftId: currentShift()?.id || null, forfeit: true, ...extra,
  });
  db.sales.push(sale);
  return sale;
}

async function cancelSession(s) {
  if (s.saleIds.length) { toast('บิลนี้มีการเก็บเงินไปแล้ว — ใช้การเช็คเอาท์/ปิดบิลแทน', 'warn'); return false; }
  if (!await confirmDialog(`ยกเลิกบิลเปิด <b>${esc(s.isJob ? s.no : s.unitName)}</b>?<br><small class="muted">รายการในบิลจะถูกลบ ไม่มีการคิดเงิน</small>`, { title: 'ยกเลิกบิล', danger: true, okText: 'ยกเลิกบิล' })) return false;
  const b = db.bookings.find((x) => x.id === s.bookingId);
  if (b) {
    // เปิดผิด — คืนสถานะการจองพร้อมมัดจำ
    b.status = 'confirmed'; b.sessionId = null; b.deposits = [...(b.deposits || []), ...s.deposits]; s.deposits = [];
  } else if (depositTotal(s) > 0) {
    const choice = await depositDecision(depositTotal(s));
    if (!choice) return false;
    if (choice === 'refund') s.depositRefunds = refundRecords(s.deposits);
    else forfeitDeposits(s.deposits, `ริบเงินมัดจำ (ยกเลิก ${s.isJob ? s.no : s.unitName})`, { sessionId: s.id, unitName: s.unitName, demo: !!s.demo });
  }
  s.status = 'cancelled';
  s.endAt = new Date().toISOString();
  if (s.isJob && s.job) { s.job.status = 'cancelled'; s.job.history.push({ status: 'cancelled', at: s.endAt }); }
  if (ui.sessionId === s.id) ui.sessionId = null;
  save();
  toast('ยกเลิกบิลแล้ว', 'success');
  return true;
}

// เรียกจาก completeSale
function closeSession(s, ctx, sale) {
  s.status = 'closed';
  s.endAt = ctx.endAt;
  if (sale) s.saleIds.push(sale.id);
  const u = unitById(s.unitId);
  if (u && unitKind(u.kind).cleaning) u.status = 'cleaning';
  if (s.isJob && s.job) { s.job.status = 'delivered'; s.job.history.push({ status: 'delivered', at: ctx.endAt }); }
  const b = db.bookings.find((x) => x.id === s.bookingId);
  if (b) b.status = 'completed';
  ui.sessionId = null;
}
function markInterimPaid(s, ctx, sale) {
  s.billedFrom = ctx.time.until;
  s.cart = emptyTab();
  s.saleIds.push(sale.id);
}

function openMoveSession(s) {
  const k = unitKind(s.kind);
  const free = db.units.filter((u) => u.active !== false && u.id !== s.unitId && !sessionOfUnit(u.id) && u.status !== 'maintenance');
  if (!free.length) return toast('ไม่มีหน่วยว่างให้ย้าย', 'warn');
  const m = openModal({
    title: `ย้าย${esc(k.noun)} — ${esc(s.unitName)}`, size: 'md',
    body: `<label class="switch" style="margin-bottom:10px"><input type="checkbox" id="mv-price" checked><div><b>ใช้ราคาของ${esc(k.noun)}ใหม่</b><small>นับเวลาต่อเนื่องจากเดิม ราคาเปลี่ยนเป็นของที่ย้ายไป</small></div></label>
      <div class="ugrid compact">${free.map((u) => `<button class="ucard st-${unitState(u).key}" data-unit="${u.id}"><div class="ucard-top"><span class="uicon">${esc(u.icon)}</span><b class="uname">${esc(u.name)}</b></div><span class="ustate">${esc(u.group || '')}</span><div class="ucard-foot"><span class="uprice">${priceTag(u.pricing)}</span></div></button>`).join('')}</div>`,
  });
  m.el.addEventListener('click', (e) => {
    const card = e.target.closest('[data-unit]'); if (!card) return;
    const to = unitById(card.dataset.unit), from = unitById(s.unitId);
    if (from && unitKind(from.kind).cleaning) from.status = 'cleaning';
    const old = s.unitName;
    Object.assign(s, { unitId: to.id, unitName: to.name, kind: to.kind, icon: to.icon });
    if ($('#mv-price', m.el).checked) s.pricing = structuredClone(to.pricing);
    s.note = `${s.note ? `${s.note} · ` : ''}ย้ายจาก ${old}`;
    save(); m.close(); renderCart();
    toast(`ย้ายไป ${to.name} แล้ว`, 'success');
  });
}

/* ---------- จัดการห้อง / โต๊ะ / รถ ---------- */
function openUnitsManager() {
  const m = openModal({
    title: 'จัดการห้อง / โต๊ะ / รถ & ราคา', size: 'lg',
    body: '<div class="list" id="um-list" style="margin-top:0;max-height:60vh"></div>',
    footer: '<button class="btn" id="um-bulk">＋ เพิ่มหลายรายการ</button><button class="btn" id="um-one">＋ เพิ่ม 1 รายการ</button><span class="grow"></span><button class="btn primary" data-cancel>เสร็จ</button>',
  });
  const el = m.el;
  const draw = () => {
    const units = [...db.units].sort((a, b) => (a.group || '').localeCompare(b.group || '', 'th') || a.name.localeCompare(b.name, 'th', { numeric: true }));
    $('#um-list', el).innerHTML = units.map((u) => `<div class="list-item" data-id="${u.id}"><span class="thumb">${esc(u.icon)}</span>
      <span class="grow"><b>${esc(u.name)}</b><small class="muted">${esc(u.group || 'ไม่ระบุกลุ่ม')} · ${esc(pricingSummary(u.pricing))}${u.status === 'maintenance' ? ' · ปิดปรับปรุง' : ''}</small></span>
      <button class="btn sm" data-edit>แก้ไข</button></div>`).join('') || '<div class="empty"><p>ยังไม่มีรายการ</p></div>';
  };
  draw();
  $('#um-list', el).onclick = (e) => { const r = e.target.closest('[data-id]'); if (r) openUnitForm(unitById(r.dataset.id), draw); };
  $('#um-one', el).onclick = () => openUnitForm(null, draw);
  $('#um-bulk', el).onclick = () => openUnitsBulk(draw);
}

function pricingFieldsHTML(pr) {
  const f = (label, key, type = 'number', extra = 'min="0" step="1"') => `<label class="field"><span>${label}</span><input data-p="${key}" type="${type}" value="${esc(pr[key] ?? '')}" ${extra}></label>`;
  if (pr.mode === 'none') return '<p class="muted small span2" style="margin:0">ไม่คิดค่าเวลา — เปิดบิลแล้วเพิ่มรายการอาหาร/บริการเข้าไป</p>';
  let h = f(`ราคาต่อ${PRICING_MODES[pr.mode].per} (${esc(db.settings.currencySymbol)})`, 'price', 'number', 'min="0" step="0.01"');
  if (pr.mode === 'night') {
    h += f('ราคาคืนศุกร์–เสาร์ (0 = เท่าราคาปกติ)', 'weekendPrice', 'number', 'min="0" step="0.01"')
      + f('เวลาเช็คอิน', 'checkinTime', 'time', '') + f('เวลาเช็คเอาท์', 'checkoutTime', 'time', '')
      + f('ผ่อนผันเช็คเอาท์ช้า (นาที)', 'graceMinutes') + f('ค่าเช็คเอาท์ช้า/ชม. (0 = คิดเพิ่ม 1 คืน)', 'extraHourPrice', 'number', 'min="0" step="0.01"');
  } else if (pr.mode === 'day') {
    h += f('ผ่อนผันคืนช้า (นาที)', 'graceMinutes') + f('ค่าเกินเวลา/ชม. (0 = คิดเพิ่ม 1 วัน)', 'extraHourPrice', 'number', 'min="0" step="0.01"');
  } else if (pr.mode === 'hour') {
    h += f('คิดขั้นต่ำ (นาที)', 'minMinutes')
      + `<label class="field"><span>ปัดเวลาทีละ</span><select data-p="roundMinutes">${[1, 5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${num(pr.roundMinutes || 1) === v ? 'selected' : ''}>${v === 1 ? 'นาที (คิดตามจริง)' : `${v} นาที`}</option>`).join('')}</select></label>`
      + f('ไม่คิดเงินถ้าเกินไม่เกิน (นาที)', 'graceMinutes')
      + `<div class="field span2"><span>ราคาตามช่วงเวลา <small class="muted">(เช่น หลัง 18:00 ชั่วโมงละ 300)</small></span><div id="bands">${(pr.bands || []).map(bandRowHTML).join('')}</div>
         <button class="btn sm" type="button" id="band-add" style="align-self:flex-start">＋ เพิ่มช่วงเวลา</button></div>`;
  } else if (pr.mode === 'month') {
    h += `<label class="field"><span>ผ่อนผันจ่ายช้า (วัน)</span><input data-p="graceDays" type="number" min="0" value="${Math.round(num(pr.graceMinutes) / 1440)}"></label>`;
  }
  h += `<label class="switch span2"><input type="checkbox" data-p="perPerson" ${pr.perPerson ? 'checked' : ''}><div><b>คิดต่อคน</b><small>คูณราคาด้วยจำนวนคน (เช่น ลานกางเต็นท์ บุฟเฟต์)</small></div></label>`;
  return h;
}
const bandRowHTML = (b = {}) => `<div class="band-row"><input type="time" data-bf value="${esc(b.from || '18:00')}"><span>–</span><input type="time" data-bt value="${esc(b.to || '23:00')}"><input type="number" data-bp min="0" step="0.01" placeholder="ราคา/ชม." value="${esc(b.price ?? '')}"><button class="icon-btn" type="button" data-brm>✕</button></div>`;
function readPricing(root, mode, old = {}) {
  const pr = { mode, taxable: old.taxable !== false };
  $$('[data-p]', root).forEach((i) => {
    const k = i.dataset.p;
    if (i.type === 'checkbox') pr[k] = i.checked;
    else if (i.type === 'time') pr[k] = i.value;
    else pr[k] = num(i.value);
  });
  if (mode === 'month') { pr.graceMinutes = num(pr.graceDays) * 1440; delete pr.graceDays; }
  if (mode === 'hour') pr.bands = $$('.band-row', root).map((r) => ({ from: $('[data-bf]', r).value, to: $('[data-bt]', r).value, price: num($('[data-bp]', r).value) })).filter((b) => b.from && b.to && b.price > 0);
  return pr;
}

function openUnitForm(u, onSaved) {
  const isNew = !u;
  const d = u ? structuredClone(u) : makeUnit(db.units[0]?.kind || 'custom', '', { group: db.units[0]?.group || '' });
  const groups = [...new Set(db.units.map((x) => x.group).filter(Boolean))];
  const m = openModal({
    title: isNew ? 'เพิ่มห้อง / โต๊ะ / รถ' : `แก้ไข ${esc(u.name)}`, size: 'lg',
    body: `<datalist id="uf-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="fields c3">
        <label class="field"><span>ชื่อ *</span><input id="uf-name" value="${esc(d.name)}" placeholder="เช่น ห้อง 101, โต๊ะ 5, กข-1234" autofocus></label>
        <label class="field"><span>กลุ่ม / โซน / ประเภทห้อง</span><input id="uf-group" list="uf-groups" value="${esc(d.group || '')}" placeholder="เช่น ห้องดีลักซ์, ชั้น 2"></label>
        <label class="field"><span>ไอคอน</span><input id="uf-icon" value="${esc(d.icon)}" maxlength="8"></label>
        <label class="field span2"><span>ชนิด</span><select id="uf-kind">${Object.entries(UNIT_KINDS).map(([k, v]) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
        <label class="field"><span>สถานะ</span><select id="uf-status">${[['available', 'พร้อมใช้งาน'], ['cleaning', 'รอทำความสะอาด'], ['maintenance', 'ปิดปรับปรุง']].map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="pf-sec"><h4>วิธีคิดเงิน</h4>
        <div class="fields c3"><label class="field"><span>คิดค่าเวลาแบบ</span><select id="uf-mode">${Object.entries(PRICING_MODES).map(([k, v]) => `<option value="${k}" ${d.pricing.mode === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
          <label class="field"><span>มัดจำเริ่มต้น</span><input id="uf-dep" type="number" min="0" step="0.01" value="${d.defaultDeposit || ''}" placeholder="0"></label></div>
        <div class="fields c3" id="uf-pricing" style="margin-top:12px"></div>
      </div>
      <label class="field" style="margin-top:14px"><span>หมายเหตุ / รายละเอียด</span><input id="uf-note" value="${esc(d.note || '')}" placeholder="เช่น เตียงคิงไซซ์ วิวทะเล, รถเกียร์ออโต้ 5 ที่นั่ง"></label>`,
    footer: `${isNew ? '' : '<button class="btn ghost danger-text" id="uf-del">ลบ</button>'}<span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="uf-save">บันทึก</button>`,
  });
  const el = m.el;
  let pr = d.pricing;
  const drawPricing = () => {
    $('#uf-pricing', el).innerHTML = pricingFieldsHTML(pr);
    const add = $('#band-add', el);
    if (add) add.onclick = () => $('#bands', el).insertAdjacentHTML('beforeend', bandRowHTML());
  };
  drawPricing();
  $('#uf-pricing', el).addEventListener('click', (e) => { const b = e.target.closest('[data-brm]'); if (b) b.closest('.band-row').remove(); });
  $('#uf-kind', el).onchange = (e) => {
    const k = unitKind(e.target.value);
    pr = structuredClone(k.pricing);
    $('#uf-mode', el).value = pr.mode;
    $('#uf-icon', el).value = k.icon;
    $('#uf-dep', el).value = k.deposit || '';
    drawPricing();
  };
  $('#uf-mode', el).onchange = (e) => {
    const mode = e.target.value;
    const kindDefault = Object.values(UNIT_KINDS).find((k) => k.pricing.mode === mode)?.pricing || { mode };
    pr = { ...structuredClone(kindDefault), price: num(readPricing(el, pr.mode).price) || kindDefault.price || 0, mode };
    drawPricing();
  };
  if (!isNew) $('#uf-del', el).onclick = async () => {
    if (sessionOfUnit(u.id)) return toast('มีบิลเปิดอยู่ — ปิดบิลก่อนลบ', 'error');
    if (db.bookings.some((b) => b.unitId === u.id && b.status === 'confirmed')) return toast('มีการจองล่วงหน้าอยู่ — ยกเลิกหรือย้ายการจองก่อนลบ', 'error');
    if (!await confirmDialog(`ลบ <b>${esc(u.name)}</b>?<br><small class="muted">ประวัติการขายเดิมยังอยู่</small>`, { danger: true, okText: 'ลบ' })) return;
    db.units = db.units.filter((x) => x.id !== u.id);
    save(); m.close(); refreshUnitsView(); updateNav();
    if (onSaved) onSaved();
  };
  $('#uf-save', el).onclick = () => {
    const name = $('#uf-name', el).value.trim();
    if (!name) { $('#uf-name', el).focus(); return toast('กรุณาใส่ชื่อ', 'warn'); }
    if (db.units.some((x) => x.id !== d.id && x.name === name)) return toast(`มี "${name}" อยู่แล้ว`, 'error');
    Object.assign(d, {
      name, group: $('#uf-group', el).value.trim(), icon: $('#uf-icon', el).value.trim() || unitKind($('#uf-kind', el).value).icon,
      kind: $('#uf-kind', el).value, status: $('#uf-status', el).value, note: $('#uf-note', el).value.trim(),
      defaultDeposit: num($('#uf-dep', el).value), pricing: readPricing(el, $('#uf-mode', el).value, d.pricing),
    });
    const i = db.units.findIndex((x) => x.id === d.id);
    if (i >= 0) db.units[i] = d; else db.units.push(d);
    if (!db.settings.useUnits) db.settings.useUnits = true;
    save(); m.close(); refreshUnitsView(); updateNav();
    if (onSaved) onSaved();
    toast('บันทึกแล้ว', 'success');
  };
}

function openUnitsBulk(onSaved) {
  const first = db.units[0];
  const m = openModal({
    title: 'เพิ่มห้อง / โต๊ะ / รถ หลายรายการ', size: 'md',
    body: `<div class="fields c2">
      <label class="field span2"><span>ชนิด</span><select id="ub-kind">${Object.entries(UNIT_KINDS).map(([k, v]) => `<option value="${k}" ${first?.kind === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
      <label class="field"><span>ชื่อขึ้นต้น</span><input id="ub-prefix" value="ห้อง "></label>
      <label class="field"><span>เริ่มที่เลข</span><input id="ub-start" type="number" min="0" value="1"></label>
      <label class="field"><span>จำนวน</span><input id="ub-count" type="number" min="1" max="500" value="5"></label>
      <label class="field"><span>ราคา</span><input id="ub-price" type="number" min="0" step="0.01"></label>
      <label class="field span2"><span>กลุ่ม / โซน</span><input id="ub-group" placeholder="เช่น ห้องสแตนดาร์ด, ชั้น 2, รถตู้"></label>
    </div>
    <p class="muted small" id="ub-preview"></p>`,
    footer: '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="ub-ok">เพิ่ม</button>',
  });
  const el = m.el;
  const applyKind = () => {
    const kind = $('#ub-kind', el).value, k = unitKind(kind);
    $('#ub-prefix', el).value = `${{ car_day: 'รถคันที่', bike_day: 'มอเตอร์ไซค์', item_day: 'ชุดที่', room_night: 'ห้อง', house_night: 'บ้านพัก' }[kind] || k.noun} `;
    $('#ub-price', el).value = k.pricing.price ?? '';
    $('#ub-price', el).closest('.field').hidden = k.pricing.mode === 'none';
    $('#ub-price', el).previousElementSibling.textContent = k.pricing.mode === 'none' ? 'ราคา' : `ราคาต่อ${PRICING_MODES[k.pricing.mode].per}`;
    preview();
  };
  const preview = () => {
    const p = $('#ub-prefix', el).value, s = num($('#ub-start', el).value), n = Math.max(1, Math.round(num($('#ub-count', el).value)));
    $('#ub-preview', el).textContent = `จะได้: ${p}${s}, ${p}${s + 1}${n > 2 ? ` … ${p}${s + n - 1}` : ''} (${n} รายการ)`;
  };
  $('#ub-kind', el).onchange = applyKind;
  ['ub-prefix', 'ub-start', 'ub-count'].forEach((id) => $(`#${id}`, el).addEventListener('input', preview));
  applyKind();
  $('#ub-ok', el).onclick = () => {
    const kind = $('#ub-kind', el).value;
    const units = unitsFromPlan([{ kind, count: $('#ub-count', el).value, prefix: $('#ub-prefix', el).value, start: $('#ub-start', el).value, price: $('#ub-price', el).value, group: $('#ub-group', el).value.trim() || unitKind(kind).menu }]);
    const dup = units.find((u) => db.units.some((x) => x.name === u.name));
    if (dup) return toast(`มี "${dup.name}" อยู่แล้ว — เปลี่ยนเลขเริ่มต้นหรือชื่อขึ้นต้น`, 'error');
    db.units.push(...units);
    db.settings.useUnits = true;
    save(); m.close(); refreshUnitsView(); updateNav();
    if (onSaved) onSaved();
    toast(`เพิ่ม ${units.length} รายการแล้ว`, 'success');
  };
}
