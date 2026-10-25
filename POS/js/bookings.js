'use strict';
/* =========================================================
   Universal POS — การจองล่วงหน้า: ปฏิทิน, รายการจอง, มัดจำ, เช็คอินจากการจอง
   ========================================================= */

const BOOKING_STATUS = {
  confirmed: ['ยืนยันแล้ว', 'primary'],
  'checked-in': ['เข้าใช้บริการแล้ว', 'ok'],
  completed: ['เสร็จสิ้น', ''],
  cancelled: ['ยกเลิก', 'danger'],
  'no-show': ['ไม่มาตามนัด', 'warn'],
};
const CAL_HOUR_START = 8; // ปฏิทินรายชั่วโมงเริ่ม 08:00 ถึง 08:00 ของวันถัดไป

function bookingWhen(b) {
  const u = unitById(b.unitId), mode = u?.pricing?.mode;
  if (mode === 'night') {
    const n = Math.max(1, Math.round((startOfDay(b.endAt) - startOfDay(b.startAt)) / 864e5));
    return `${fmtDayShort(b.startAt)} – ${fmtDayShort(b.endAt)} (${n} คืน)`;
  }
  if (isHourScale(u) && startOfDay(b.startAt).getTime() === startOfDay(b.endAt).getTime()) return `${fmtDayShort(b.startAt)} ${fmtTime(b.startAt)}–${fmtTime(b.endAt)}`;
  return `${fmtDayShort(b.startAt)} ${fmtTime(b.startAt)} – ${fmtDayShort(b.endAt)} ${fmtTime(b.endAt)}`;
}

/* ---------- ฟอร์มการจอง ---------- */
function openBookingForm(b, preset = {}) {
  const isNew = !b;
  const units = db.units.filter((u) => u.active !== false);
  if (!units.length) return toast('ยังไม่มีห้อง / โต๊ะ / รถ ให้จอง — เพิ่มที่เมนูผังก่อน', 'warn');
  const d = b ? structuredClone(b) : { unitId: preset.unitId || units[0].id, startAt: preset.startAt || null, endAt: null, guestName: '', guestPhone: '', guests: 1, note: '', customerId: null, deposits: [] };
  const st = { customerId: d.customerId };
  const groups = [...new Set(units.map((u) => u.group || ''))];
  const optUnits = groups.map((g) => `<optgroup label="${esc(g || 'ไม่ระบุกลุ่ม')}">${units.filter((u) => (u.group || '') === g).map((u) => `<option value="${u.id}" ${u.id === d.unitId ? 'selected' : ''}>${esc(u.icon)} ${esc(u.name)}</option>`).join('')}</optgroup>`).join('');
  const [stLabel, stCls] = BOOKING_STATUS[d.status || 'confirmed'];
  const m = openModal({
    title: isNew ? '📅 จองล่วงหน้า' : `การจอง ${esc(b.no)} <span class="pill ${stCls}">${stLabel}</span>`, size: 'md',
    body: `<div class="fields c2">
        <label class="field span2"><span>ห้อง / โต๊ะ / รถ</span><select id="bk-unit">${optUnits}</select></label>
        <div class="span2 fields c2" id="bk-times"></div>
        ${guestFieldsHTML('bk', d.guestName, d.guestPhone)}
        <label class="field"><span>จำนวนคน</span><input id="bk-guests" type="number" min="1" step="1" value="${d.guests || 1}"></label>
        <div class="field span2"><span>เงินมัดจำ${depositTotal(d) ? ` <small class="muted">(รับแล้ว ${money(depositTotal(d))})</small>` : ''}</span>
          <div class="input-group"><input id="bk-dep" type="number" min="0" step="0.01" placeholder="${depositTotal(d) ? 'รับเพิ่ม' : '0'}">${depositMethodSeg('bk-depm', 'transfer')}</div></div>
        <label class="field span2"><span>หมายเหตุ</span><input id="bk-note" value="${esc(d.note || '')}" placeholder="เช่น ขอห้องชั้นล่าง, มารับรถที่สนามบิน"></label>
      </div>
      <div class="estimate" id="bk-est"></div>`,
    footer: isNew
      ? '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="bk-save">บันทึกการจอง</button>'
      : `${d.status === 'confirmed' ? '<button class="btn ghost danger-text" id="bk-cancel">ยกเลิกการจอง</button><button class="btn ghost" id="bk-noshow">ไม่มาตามนัด</button>' : ''}<span class="grow"></span>
         <button class="btn ghost" data-cancel>ปิด</button>${d.status === 'confirmed' ? `<button class="btn" id="bk-checkin">${kindLabels(unitById(d.unitId)?.kind).open}</button><button class="btn primary" id="bk-save">บันทึก</button>` : ''}`,
  });
  const el = m.el;
  bindGuestPick(el, 'bk', st);
  const depMethod = bindSeg(el, 'bk-depm');
  const unit = () => unitById($('#bk-unit', el).value);

  // ช่องวันเวลา: รายคืนใช้วันที่ (เวลาเช็คอิน–เช็คเอาท์ตามที่ตั้งไว้) นอกนั้นใช้วัน+เวลา
  const drawTimes = (keep = true) => {
    const u = unit(), pr = u.pricing || {};
    const prevStart = keep ? readTimes()?.startAt : null;
    const start = new Date(prevStart || d.startAt || (pr.mode === 'night' ? atTime(new Date(), pr.checkinTime || '14:00') : addMinutes(startOfDay(new Date()), (new Date().getHours() + 1) * 60)));
    let end = d.endAt && !prevStart ? new Date(d.endAt) : (applyEndQuick(pr, start, pr.mode === 'hour' ? 120 : 1) || addMinutes(start, 120));
    const quick = endQuickOptions(pr.mode);
    $('#bk-times', el).innerHTML = pr.mode === 'night'
      ? `<label class="field"><span>วันที่เข้าพัก <small class="muted">(${esc(pr.checkinTime || '14:00')})</small></span><input id="bk-d1" type="date" value="${toISODate(start)}"></label>
         <label class="field"><span>วันที่ออก <small class="muted">(${esc(pr.checkoutTime || '12:00')})</small></span><input id="bk-d2" type="date" value="${toISODate(end)}"></label>`
      : `<label class="field"><span>เริ่ม</span><input id="bk-s" type="datetime-local" value="${toLocalInput(start)}"></label>
         <label class="field"><span>สิ้นสุด</span><input id="bk-e" type="datetime-local" value="${toLocalInput(end)}"></label>`;
    if (quick.length) $('#bk-times', el).insertAdjacentHTML('beforeend', `<div class="quick span2" id="bk-quick">${quick.map(([v, l]) => `<button type="button" data-q="${v}">${l}</button>`).join('')}</div>`);
  };
  const readTimes = () => {
    const u = unit(), pr = u?.pricing || {};
    if ($('#bk-d1', el)) {
      const d1 = $('#bk-d1', el).value, d2 = $('#bk-d2', el).value;
      if (!d1 || !d2) return null;
      return { startAt: atTime(new Date(`${d1}T00:00`), pr.checkinTime || '14:00').toISOString(), endAt: atTime(new Date(`${d2}T00:00`), pr.checkoutTime || '12:00').toISOString() };
    }
    if ($('#bk-s', el)) {
      const s = fromLocalInput($('#bk-s', el).value), e = fromLocalInput($('#bk-e', el).value);
      return s && e ? { startAt: s, endAt: e } : null;
    }
    return null;
  };
  const estimate = () => {
    const box = $('#bk-est', el), t = readTimes(), u = unit();
    if (!t) { box.innerHTML = ''; return; }
    if (t.endAt <= t.startAt) { box.innerHTML = '<span class="neg">เวลาสิ้นสุดต้องหลังเวลาเริ่ม</span>'; return; }
    const c = findConflict(u.id, t.startAt, t.endAt, { excludeBooking: b?.id, excludeSession: b?.sessionId });
    const r = computeTimeCharge(u.pricing, t.startAt, t.endAt, num($('#bk-guests', el).value), { final: false, label: '' });
    box.innerHTML = `${c ? `<div class="neg">⚠ ${conflictText(c)}</div>` : '<div class="pos-text">✓ ว่างในช่วงเวลานี้</div>'}
      ${u.pricing?.mode !== 'none' ? `<div>ประมาณการ: <b>${money(sum(r.lines, lineTotal))}</b> <span class="muted">(${fmtQty(r.units)} ${r.unitLabel})</span></div>` : ''}`;
  };
  drawTimes(false);
  estimate();
  $('#bk-unit', el).onchange = () => { drawTimes(); estimate(); };
  $('#bk-times', el).addEventListener('input', estimate);
  $('#bk-times', el).addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]'); if (!q) return;
    const t = readTimes(), u = unit(); if (!t) return;
    const end = applyEndQuick(u.pricing, new Date(t.startAt), num(q.dataset.q));
    if ($('#bk-d2', el)) $('#bk-d2', el).value = toISODate(end); else $('#bk-e', el).value = toLocalInput(end);
    estimate();
  });
  $('#bk-guests', el).addEventListener('input', estimate);

  const collect = () => {
    const t = readTimes();
    if (!t) { toast('กรุณาระบุวันเวลา', 'warn'); return null; }
    if (t.endAt <= t.startAt) { toast('เวลาสิ้นสุดต้องหลังเวลาเริ่ม', 'warn'); return null; }
    const name = $('#bk-name', el).value.trim(), phone = $('#bk-phone', el).value.trim();
    if (!name && !phone && !st.customerId) { $('#bk-name', el).focus(); toast('กรุณาใส่ชื่อหรือเบอร์โทรผู้จอง', 'warn'); return null; }
    const c = findConflict(unit().id, t.startAt, t.endAt, { excludeBooking: b?.id, excludeSession: b?.sessionId });
    if (c) { toast(conflictText(c).replace(/<[^>]+>/g, ''), 'error', 4500); return null; }
    const cust = ensureCustomer(name, phone, st.customerId);
    return { ...t, unitId: unit().id, customerId: cust?.id || null, guestName: cust?.name || name, guestPhone: cust?.phone || phone, guests: Math.max(1, Math.round(num($('#bk-guests', el).value))), note: $('#bk-note', el).value.trim() };
  };
  const doSave = () => {
    const v = collect(); if (!v) return;
    const dep = num($('#bk-dep', el).value);
    withShiftForCash(depMethod(), dep, () => {
      let target = b;
      if (!target) {
        target = { id: uid(), no: nextSeq('booking', 'B'), status: 'confirmed', sessionId: null, deposits: [], createdAt: new Date().toISOString(), cashier: currentCashier(), demo: hasDemoData() };
        db.bookings.push(target);
      }
      Object.assign(target, v);
      if (dep > 0) target.deposits.push(newDeposit(dep, depMethod()));
      save(); m.close(); refreshUnitsView();
      toast(isNew ? `บันทึกการจอง ${target.no} แล้ว` : 'บันทึกแล้ว', 'success');
    });
  };
  const saveBtn = $('#bk-save', el);
  if (saveBtn) saveBtn.onclick = doSave;
  if (!isNew && d.status === 'confirmed') {
    $('#bk-cancel', el).onclick = async () => { if (await cancelBooking(b, 'cancelled')) m.close(); };
    $('#bk-noshow', el).onclick = async () => { if (await cancelBooking(b, 'no-show')) m.close(); };
    $('#bk-checkin', el).onclick = () => { m.close(); checkInBooking(b); };
  }
}

async function checkInBooking(b) {
  const u = unitById(b.unitId);
  if (!u) return toast('ไม่พบห้อง/โต๊ะ/รถของการจองนี้', 'error');
  const busy = sessionOfUnit(u.id);
  if (busy) return toast(`${u.name} ยังมีบิลเปิดอยู่ (${busy.guestName || '-'}) — เช็คเอาท์ก่อน หรือแก้ไขการจองไปที่อื่น`, 'error', 4500);
  if (new Date(b.startAt) - Date.now() > 864e5 && !await confirmDialog(`การจองนี้เริ่ม ${bookingWhen(b)} — ต้องการเริ่มใช้งานตอนนี้เลยหรือไม่?`, { okText: 'เริ่มเลย' })) return;
  openSessionStart(u, { booking: b });
}

async function cancelBooking(b, status) {
  const label = status === 'no-show' ? 'บันทึกว่าไม่มาตามนัด' : 'ยกเลิกการจอง';
  if (!await confirmDialog(`${label} <b>${esc(b.no)}</b> (${esc(b.guestName || '-')})?`, { title: label, danger: true, okText: label })) return false;
  const dep = depositTotal(b);
  if (dep > 0) {
    const choice = await depositDecision(dep);
    if (!choice) return false;
    if (choice === 'refund') b.depositRefunds = refundRecords(b.deposits);
    else b.forfeitSaleId = forfeitDeposits(b.deposits, `ริบเงินมัดจำ (${status === 'no-show' ? 'ไม่มาตามนัด' : 'ยกเลิกการจอง'} ${b.no})`, { bookingId: b.id, unitName: unitById(b.unitId)?.name || '', customerName: b.guestName || '', demo: !!b.demo })?.id || null;
  }
  b.status = status;
  b.cancelledAt = new Date().toISOString();
  save(); refreshUnitsView();
  toast(`${label}แล้ว`, 'success');
  return true;
}

/* ---------- รายการจอง ---------- */
function drawBookingList() {
  $('#units-actions').innerHTML = '<button class="btn primary" data-uact="book">＋ จองใหม่</button>';
  const now = Date.now(), t0 = startOfDay(now).getTime(), t1 = t0 + 864e5;
  const filters = {
    today: ['เข้าวันนี้', (b) => b.status === 'confirmed' && new Date(b.startAt) < t1 && new Date(b.endAt) > now],
    upcoming: ['ที่จะมาถึง', (b) => b.status === 'confirmed'],
    all: ['ทั้งหมด', () => true],
    closed: ['ยกเลิก / ไม่มา', (b) => ['cancelled', 'no-show'].includes(b.status)],
  };
  if (!filters[ui.bookingFilter]) ui.bookingFilter = 'upcoming';
  const list = db.bookings.filter(filters[ui.bookingFilter][1])
    .sort((a, b) => (ui.bookingFilter === 'all' ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt)));
  const arrivals = db.bookings.filter(filters.today[1]).length;
  $('#units-sub').textContent = `จองที่ยืนยันแล้ว ${db.bookings.filter((b) => b.status === 'confirmed').length} รายการ · เข้าวันนี้ ${arrivals}`;
  const body = $('#units-body');
  body.innerHTML = `<div class="filters"><div class="seg" id="bk-filter">${Object.entries(filters).map(([k, [l]]) => `<button data-f="${k}" class="${ui.bookingFilter === k ? 'active' : ''}">${l}${k === 'today' && arrivals ? ` (${arrivals})` : ''}</button>`).join('')}</div></div>
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>เลขที่</th><th>ห้อง / โต๊ะ / รถ</th><th>ผู้จอง</th><th>ช่วงเวลา</th><th class="num">มัดจำ</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${list.map((b) => {
        const u = unitById(b.unitId), [sl, sc] = BOOKING_STATUS[b.status] || ['-', ''];
        return `<tr class="clickable" data-bk="${b.id}"><td><b>${esc(b.no)}</b></td><td class="nowrap">${esc(u?.icon || '')} ${esc(u?.name || '(ลบแล้ว)')}</td>
          <td>${esc(b.guestName || '-')}<small class="muted"> ${esc(b.guestPhone || '')}</small></td><td class="nowrap">${bookingWhen(b)}</td>
          <td class="num">${depositTotal(b) ? money(depositTotal(b)) : '-'}</td><td><span class="pill ${sc}">${sl}</span></td>
          <td class="right">${b.status === 'confirmed' ? `<button class="btn sm primary" data-ci="${b.id}">${kindLabels(u?.kind).open}</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="7"><div class="empty"><div class="empty-ico">📒</div><p>ไม่มีรายการจอง</p></div></td></tr>'}</tbody></table></div>`;
  $('#bk-filter', body).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { ui.bookingFilter = b.dataset.f; drawBookingList(); } };
  body.querySelector('tbody').onclick = (e) => {
    const ci = e.target.closest('[data-ci]');
    if (ci) return checkInBooking(db.bookings.find((b) => b.id === ci.dataset.ci));
    const tr = e.target.closest('[data-bk]');
    if (tr) openBookingForm(db.bookings.find((b) => b.id === tr.dataset.bk));
  };
}

/* ---------- ปฏิทิน (timeline) ---------- */
function drawCalendar() {
  $('#units-actions').innerHTML = '<button class="btn primary" data-uact="book">＋ จองใหม่</button>';
  const units = db.units.filter((u) => u.active !== false);
  const hasDay = units.some((u) => !isHourScale(u)), hasHour = units.some((u) => isHourScale(u));
  if (!ui.calScale || (ui.calScale === 'day' && !hasDay) || (ui.calScale === 'hour' && !hasHour)) ui.calScale = hasDay ? 'day' : 'hour';
  const day = ui.calScale === 'day';
  const rows = units.filter((u) => isHourScale(u) !== day);
  // รายวันเริ่มที่เมื่อวาน (เห็นแขกที่พักอยู่ต่อเนื่อง)
  // รายชั่วโมงใช้ "วันทำการ" 08:00–08:00 — หลังเที่ยงคืนก่อน 08:00 ยังนับเป็นของเมื่อวาน (เช่น KTV เปิดถึงตี 2)
  const businessToday = new Date().getHours() < CAL_HOUR_START ? addDays(new Date(), -1) : new Date();
  const base = startOfDay(ui.calDate || (day ? addDays(new Date(), -1) : businessToday));
  const rangeStart = day ? base : addMinutes(base, CAL_HOUR_START * 60);
  const cols = day ? 14 : 24, colMin = day ? 1440 : 60, cellW = day ? 76 : 58;
  const rangeEnd = addMinutes(rangeStart, cols * colMin);
  const W = cols * cellW;
  const x = (t) => ((new Date(t) - rangeStart) / 60000 / colMin) * cellW;
  const now = new Date();
  $('#units-sub').textContent = day
    ? `${rangeStart.toLocaleDateString('th-TH', { dateStyle: 'medium' })} – ${addDays(rangeStart, cols - 1).toLocaleDateString('th-TH', { dateStyle: 'medium' })}`
    : base.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const head = Array.from({ length: cols }, (_, i) => {
    const t = addMinutes(rangeStart, i * colMin);
    if (!day) return `<div class="tl-cell">${String(t.getHours()).padStart(2, '0')}:00</div>`;
    const we = [0, 6].includes(t.getDay()), today = toISODate(t) === toISODate(now);
    return `<div class="tl-cell ${we ? 'we' : ''} ${today ? 'today' : ''}"><small>${t.toLocaleDateString('th-TH', { weekday: 'short' })}</small><b>${t.getDate()}</b></div>`;
  }).join('');

  const bar = (cls, start, end, label, attrs) => {
    const l = Math.max(0, x(start)), r = Math.min(W, x(end));
    if (r <= 0 || l >= W || r - l < 1) return '';
    return `<div class="tl-bar ${cls}" style="left:${l}px;width:${Math.max(r - l, 8)}px" ${attrs} title="${esc(label)}">${esc(label)}</div>`;
  };
  const rowHTML = (u) => {
    const items = [
      ...db.bookings.filter((b) => b.unitId === u.id && b.status === 'confirmed')
        .map((b) => bar('bk', b.startAt, b.endAt, `${b.guestName || b.no}`, `data-bk="${b.id}"`)),
      ...db.sessions.filter((s) => s.unitId === u.id && s.status !== 'cancelled')
        .map((s) => {
          const end = s.status === 'open' ? new Date(Math.max(Date.now(), new Date(s.plannedEndAt || 0).getTime())) : s.endAt;
          return bar(s.status === 'open' ? 'ss' : 'done', s.startAt, end, `${s.guestName || s.no}`, `data-ss="${s.id}"`);
        }),
    ].join('');
    return `<div class="tl-name" title="${esc(u.group || '')}"><span>${esc(u.icon)}</span>${esc(u.name)}</div>
      <div class="tl-track" data-unit="${u.id}" style="width:${W}px;background-size:${cellW}px 100%">${items}</div>`;
  };
  const nowX = x(now);
  const body = $('#units-body');
  body.innerHTML = `
    <div class="filters cal-ctrl">
      ${hasDay && hasHour ? `<div class="seg" id="cal-scale"><button data-s="day" class="${day ? 'active' : ''}">รายวัน</button><button data-s="hour" class="${!day ? 'active' : ''}">รายชั่วโมง</button></div>` : ''}
      <div class="row gap-s"><button class="btn sm" data-cal="-1">‹</button><button class="btn sm" data-cal="0">วันนี้</button><button class="btn sm" data-cal="1">›</button></div>
      <input type="date" id="cal-date" value="${toISODate(base)}" style="width:auto">
      <span class="tl-legend"><i class="bk"></i>จองแล้ว <i class="ss"></i>กำลังใช้งาน <i class="done"></i>เสร็จแล้ว</span>
    </div>
    ${rows.length ? `<div class="card tl"><div class="tl-grid" style="grid-template-columns:150px ${W}px">
      <div class="tl-corner"></div><div class="tl-head" style="width:${W}px">${head}</div>
      ${rows.map(rowHTML).join('')}
      ${nowX > 0 && nowX < W ? `<div class="tl-now" style="left:${150 + nowX}px"></div>` : ''}
    </div></div><p class="muted small">แตะช่องว่างเพื่อจอง · แตะแถบเพื่อดูรายละเอียด</p>`
    : '<div class="card"><div class="empty"><p>ไม่มีหน่วยสำหรับมุมมองนี้</p></div></div>'}`;

  const sc = $('#cal-scale', body);
  if (sc) sc.onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { ui.calScale = b.dataset.s; drawCalendar(); } };
  body.querySelector('.cal-ctrl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]'); if (!b) return;
    const step = day ? 7 : 1;
    ui.calDate = b.dataset.cal === '0' ? null : addDays(base, step * num(b.dataset.cal));
    drawCalendar();
  });
  $('#cal-date', body).onchange = (e) => { if (e.target.value) { ui.calDate = new Date(`${e.target.value}T00:00`); drawCalendar(); } };
  const grid = $('.tl-grid', body);
  if (grid) grid.onclick = (e) => {
    const bk = e.target.closest('[data-bk]');
    if (bk) return openBookingForm(db.bookings.find((b) => b.id === bk.dataset.bk));
    const ss = e.target.closest('[data-ss]');
    if (ss) {
      const s = db.sessions.find((x) => x.id === ss.dataset.ss);
      if (s.status === 'open') return enterSession(s.id);
      const sale = db.sales.find((x) => x.id === s.saleIds[s.saleIds.length - 1]);
      return sale ? openSaleDetail(sale) : null;
    }
    const track = e.target.closest('.tl-track');
    if (!track) return;
    const u = unitById(track.dataset.unit);
    const off = e.clientX - track.getBoundingClientRect().left;
    const col = Math.floor(off / cellW);
    let start = addMinutes(rangeStart, col * colMin);
    if (day) start = atTime(start, u.pricing?.mode === 'night' ? u.pricing.checkinTime || '14:00' : '09:00');
    openBookingForm(null, { unitId: u.id, startAt: start.toISOString() });
  };
  // เลื่อนให้เห็น "ตอนนี้"
  const tl = $('.tl', body);
  if (tl && nowX > 0 && nowX < W) tl.scrollLeft = Math.max(0, nowX - 200);
}
