'use strict';
/* =========================================================
   Universal POS — งานรับฝาก / ออเดอร์ (ซ่อม ซักรีด สั่งทำ)
   งาน = บิลเปิดที่ไม่ผูกกับห้อง/โต๊ะ มีสถานะ นัดรับ มัดจำ และใบรับงาน
   ========================================================= */

const JOB_STATUS = {
  received: { label: 'รับงานแล้ว', cls: '', next: 'working' },
  working: { label: 'กำลังดำเนินการ', cls: 'primary', next: 'ready' },
  ready: { label: 'เสร็จแล้ว รอรับ', cls: 'ok', next: null },
  delivered: { label: 'ส่งมอบแล้ว', cls: '' },
  cancelled: { label: 'ยกเลิก', cls: 'danger' },
};
const NEXT_LABEL = { working: '▶ เริ่มดำเนินการ', ready: '✓ เสร็จแล้ว แจ้งลูกค้า' };
const jobSessions = () => db.sessions.filter((s) => s.isJob);

function drawJobs() {
  $('#units-actions').innerHTML = '<button class="btn primary" data-uact="newjob">＋ รับงานใหม่</button>';
  const all = jobSessions();
  const isOpen = (s) => s.status === 'open';
  const filters = {
    active: ['ยังไม่ส่งมอบ', isOpen],
    received: ['รับงานแล้ว', (s) => isOpen(s) && s.job.status === 'received'],
    working: ['กำลังทำ', (s) => isOpen(s) && s.job.status === 'working'],
    ready: ['เสร็จ รอรับ', (s) => isOpen(s) && s.job.status === 'ready'],
    done: ['ส่งมอบแล้ว', (s) => s.status === 'closed'],
    cancelled: ['ยกเลิก', (s) => s.status === 'cancelled'],
  };
  if (!filters[ui.jobFilter]) ui.jobFilter = 'active';
  const q = (ui.jobSearch || '').trim().toLowerCase();
  const now = Date.now();
  const list = all.filter(filters[ui.jobFilter][1])
    .filter((s) => !q || `${s.no} ${s.job?.title} ${s.guestName} ${s.guestPhone}`.toLowerCase().includes(q))
    .sort((a, b) => (isOpen(a) ? (a.job.dueAt || '9').localeCompare(b.job.dueAt || '9') : (b.endAt || '').localeCompare(a.endAt || '')));
  const late = all.filter((s) => isOpen(s) && s.job.dueAt && new Date(s.job.dueAt) < now && s.job.status !== 'ready').length;
  $('#units-sub').textContent = `งานที่ยังไม่ส่งมอบ ${all.filter(isOpen).length} งาน${late ? ` · เลยกำหนด ${late}` : ''} · เสร็จรอรับ ${all.filter(filters.ready[1]).length}`;
  const body = $('#units-body');
  body.innerHTML = `<div class="filters">
      <div class="seg" id="job-filter">${Object.entries(filters).map(([k, [l, f]]) => `<button data-f="${k}" class="${ui.jobFilter === k ? 'active' : ''}">${l}${['active', 'ready'].includes(k) ? ` (${all.filter(f).length})` : ''}</button>`).join('')}</div>
      <label class="search">${SEARCH_ICON}<input id="job-search" type="search" placeholder="ค้นหาเลขที่งาน / ลูกค้า / เบอร์" value="${esc(ui.jobSearch || '')}"></label>
    </div>
    <div class="jgrid">${list.map((s) => jobCardHTML(s, now)).join('') || '<div class="card" style="grid-column:1/-1"><div class="empty"><div class="empty-ico">🧾</div><p>ไม่มีงานในรายการนี้</p></div></div>'}</div>`;
  $('#job-filter', body).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { ui.jobFilter = b.dataset.f; drawJobs(); } };
  $('#job-search', body).addEventListener('input', (e) => {
    ui.jobSearch = e.target.value;
    const pos = e.target.selectionStart;
    drawJobs();
    const i = $('#job-search'); i.focus(); i.setSelectionRange(pos, pos);
  });
  $('.jgrid', body).onclick = (e) => {
    const card = e.target.closest('[data-job]'); if (!card) return;
    const s = db.sessions.find((x) => x.id === card.dataset.job);
    const a = e.target.closest('[data-jact]')?.dataset.jact;
    if (a === 'next') return advanceJob(s);
    if (a === 'ticket') return printJobTicket(s);
    if (a === 'deliver') return deliverJob(s);
    if (s.status === 'open') enterSession(s.id);
    else { const sale = db.sales.find((x) => x.id === s.saleIds[s.saleIds.length - 1]); if (sale) openSaleDetail(sale); }
  };
}

function jobCardHTML(s, now = Date.now()) {
  const js = JOB_STATUS[s.job?.status] || JOB_STATUS.received;
  const open = s.status === 'open';
  const t = calcTotals(s.cart.lines, s.cart.discount, db.settings).total;
  const dep = depositTotal(s);
  const late = open && s.job.dueAt && new Date(s.job.dueAt) < now && s.job.status !== 'ready';
  const next = open ? js.next : null;
  return `<div class="card jcard ${late ? 'late' : ''}" data-job="${s.id}">
    <div class="jtop"><b>${esc(s.no)}</b><span class="pill ${js.cls}">${js.label}</span></div>
    <div class="jtitle">${esc(s.job?.title || '(ไม่ระบุรายละเอียด)')}</div>
    <div class="muted small">👤 ${esc(s.guestName || '-')} ${s.guestPhone ? `· ${esc(s.guestPhone)}` : ''}</div>
    <div class="small ${late ? 'neg' : 'muted'}">📅 ${open ? `นัดรับ ${s.job.dueAt ? fmtDateTime(s.job.dueAt) : '-'}${late ? ' (เลยกำหนด)' : ''}` : `ส่งมอบ ${fmtDateTime(s.endAt)}`}</div>
    <div class="jmoney"><span>${s.cart.lines.length} รายการ · ${money(t)}</span>${dep ? `<span>มัดจำ ${money(dep)}</span>` : ''}</div>
    ${open ? `<div class="jactions">
      ${next ? `<button class="btn sm" data-jact="next">${NEXT_LABEL[next]}</button>` : ''}
      <button class="btn sm ghost" data-jact="ticket">🖨 ใบรับงาน</button>
      <button class="btn sm primary" data-jact="deliver">ส่งมอบ & ชำระ</button>
    </div>` : ''}
  </div>`;
}

function advanceJob(s) {
  const next = JOB_STATUS[s.job.status]?.next;
  if (!next) return;
  s.job.status = next;
  s.job.history.push({ status: next, at: new Date().toISOString() });
  save(); refreshUnitsView(); renderCart();
  toast(`${s.no}: ${JOB_STATUS[next].label}`, 'success');
}

function deliverJob(s) {
  enterSession(s.id);
  openPayment();
}

/* ---------- ฟอร์มรับงาน ---------- */
function openJobForm(job) {
  const isNew = !job;
  const st = { customerId: job?.customerId || null };
  const due = job?.job?.dueAt || atTime(addDays(new Date(), 2), '17:00').toISOString();
  const m = openModal({
    title: isNew ? '🧾 รับงานใหม่' : `งาน ${esc(job.no)}`, size: 'md',
    body: `<div class="fields c2">
        ${guestFieldsHTML('jb', job?.guestName, job?.guestPhone)}
        <label class="field span2"><span>รายละเอียดงาน *</span><textarea id="jb-title" rows="3" placeholder="เช่น ซ่อมจอ iPhone 12 สีดำ (จอแตกมุมขวา), ผ้ารวม 2 ตะกร้า, ชุดไทยสั่งตัด">${esc(job?.job?.title || '')}</textarea></label>
        <div class="field"><span>นัดรับ</span><input id="jb-due" type="datetime-local" value="${toLocalInput(due)}">
          <div class="quick" id="jb-quick">${[['วันนี้', 0], ['พรุ่งนี้', 1], ['3 วัน', 3], ['7 วัน', 7]].map(([l, n]) => `<button type="button" data-d="${n}">${l}</button>`).join('')}</div></div>
        ${isNew ? '' : `<label class="field"><span>สถานะ</span><select id="jb-status">${['received', 'working', 'ready'].map((k) => `<option value="${k}" ${job.job.status === k ? 'selected' : ''}>${JOB_STATUS[k].label}</option>`).join('')}</select></label>`}
        <div class="field ${isNew ? '' : 'span2'}"><span>เงินมัดจำ${!isNew && depositTotal(job) ? ` <small class="muted">(รับแล้ว ${money(depositTotal(job))})</small>` : ''}</span>
          <div class="input-group"><input id="jb-dep" type="number" min="0" step="0.01" placeholder="${!isNew && depositTotal(job) ? 'รับเพิ่ม' : '0'}">${depositMethodSeg('jb-depm')}</div></div>
        <label class="field span2"><span>หมายเหตุ / อุปกรณ์ที่ลูกค้าฝากไว้</span><input id="jb-note" value="${esc(job?.note || '')}" placeholder="เช่น ฝากที่ชาร์จมาด้วย, รหัสเครื่อง 1234"></label>
      </div>`,
    footer: isNew
      ? '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="jb-save">รับงาน</button>'
      : '<button class="btn ghost danger-text" id="jb-cancel">ยกเลิกงาน</button><button class="btn ghost" id="jb-ticket">🖨 ใบรับงาน</button><span class="grow"></span><button class="btn ghost" data-cancel>ปิด</button><button class="btn primary" id="jb-save">บันทึก</button>',
  });
  const el = m.el;
  bindGuestPick(el, 'jb', st);
  const depMethod = bindSeg(el, 'jb-depm');
  $('#jb-quick', el).onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) $('#jb-due', el).value = toLocalInput(atTime(addDays(new Date(), num(b.dataset.d)), '17:00')); };
  if (!isNew) {
    $('#jb-ticket', el).onclick = () => printJobTicket(job);
    $('#jb-cancel', el).onclick = async () => { if (await cancelSession(job)) { m.close(); refreshUnitsView(); if (ui.view === 'pos') exitSession(); } };
  }
  const doSave = () => {
    const title = $('#jb-title', el).value.trim();
    if (!title) { $('#jb-title', el).focus(); return toast('กรุณาใส่รายละเอียดงาน', 'warn'); }
    const name = $('#jb-name', el).value.trim(), phone = $('#jb-phone', el).value.trim();
    const cust = ensureCustomer(name, phone, st.customerId);
    const dueAt = fromLocalInput($('#jb-due', el).value);
    const dep = num($('#jb-dep', el).value);
    withShiftForCash(depMethod(), dep, () => {
      let s = job;
      if (!s) {
        const now = new Date().toISOString();
        s = {
          id: uid(), no: nextSeq('job', 'J'), isJob: true, unitId: null, unitName: '', kind: 'job', icon: '🧾', status: 'open',
          startAt: now, billedFrom: now, endAt: null, guests: 1, info: {}, deposits: [], pricing: { mode: 'none' }, timeOverride: null,
          cart: emptyTab(), saleIds: [], bookingId: null, cashier: currentCashier(), deviceId: deviceId(), createdAt: now, demo: hasDemoData(),
          job: { title, status: 'received', dueAt, history: [{ status: 'received', at: now }] },
        };
        db.sessions.push(s);
      }
      Object.assign(s, { customerId: cust?.id || null, guestName: cust?.name || name, guestPhone: cust?.phone || phone, note: $('#jb-note', el).value.trim(), plannedEndAt: dueAt });
      s.job.title = title;
      s.job.dueAt = dueAt;
      const stSel = $('#jb-status', el);
      if (stSel && stSel.value !== s.job.status) { s.job.status = stSel.value; s.job.history.push({ status: stSel.value, at: new Date().toISOString() }); }
      if (dep > 0) s.deposits.push(newDeposit(dep, depMethod()));
      save(); m.close(); refreshUnitsView(); renderCart();
      if (isNew) jobCreated(s); else toast('บันทึกแล้ว', 'success');
    });
  };
  $('#jb-save', el).onclick = doSave;
}

function jobCreated(s) {
  const m = openModal({
    title: `รับงาน ${esc(s.no)} แล้ว`, size: 'sm',
    body: `<div class="done"><div class="done-ico">🧾</div><h3>${esc(s.no)}</h3><p class="muted">${esc(s.job.title)}</p></div>
      <p class="muted small">พิมพ์ใบรับงานให้ลูกค้าเก็บไว้ แล้วเพิ่มค่าบริการ/อะไหล่ได้ทันที หรือเพิ่มภายหลังก็ได้</p>`,
    footer: '<button class="btn" id="jc-print">🖨 พิมพ์ใบรับงาน</button><button class="btn" id="jc-items">＋ เพิ่มค่าบริการ</button><button class="btn primary" data-cancel>เสร็จ</button>',
  });
  $('#jc-print', m.el).onclick = () => printJobTicket(s);
  $('#jc-items', m.el).onclick = () => { m.close(); enterSession(s.id); };
}

/* ---------- ใบรับงาน ---------- */
function jobTicketHTML(s) {
  const st = db.settings;
  const t = calcTotals(s.cart.lines, s.cart.discount, st);
  const dep = depositTotal(s);
  const row = (a, b) => `<div class="r-row"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="receipt ${+st.paperWidth === 58 ? 'w58' : ''}">
    <div class="r-center"><div class="r-shop">${esc(st.shopName)}</div>${st.phone ? `<div>โทร ${esc(st.phone)}</div>` : ''}
      <div class="r-title">ใบรับงาน</div><div class="r-big">${esc(s.no)}</div></div>
    ${row('วันที่รับ', fmtDateTime(s.startAt))}
    ${row('ลูกค้า', esc(s.guestName || '-'))}
    ${s.guestPhone ? row('โทร', esc(s.guestPhone)) : ''}
    ${row('นัดรับ', s.job?.dueAt ? fmtDateTime(s.job.dueAt) : '-')}
    <hr class="r-hr">
    <div><b>รายละเอียดงาน</b></div><div class="r-pre">${esc(s.job?.title || '')}</div>
    ${s.note ? `<div class="r-sub">หมายเหตุ: ${esc(s.note)}</div>` : ''}
    ${s.cart.lines.length ? `<hr class="r-hr">${s.cart.lines.map((l) => row(`${esc(l.name)} × ${fmtQty(l.qty)}`, money(lineTotal(l), false))).join('')}${row('<b>ยอดประเมิน</b>', `<b>${money(t.total)}</b>`)}` : ''}
    ${dep ? `<hr class="r-hr">${row('รับมัดจำแล้ว', money(dep, false))}${s.cart.lines.length ? row('คงเหลือชำระ', money(Math.max(0, t.total - dep), false)) : ''}` : ''}
    <div class="r-center r-foot">กรุณานำใบนี้มาแสดงเมื่อรับงาน</div>
    <div class="r-sign"><span>ผู้รับงาน ...............</span><span>ลูกค้า ...............</span></div>
  </div>`;
}
function printJobTicket(s) {
  $('#print-area').innerHTML = jobTicketHTML(s);
  setTimeout(() => window.print(), 60);
}
