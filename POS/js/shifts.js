'use strict';
/* =========================================================
   Universal POS — เปิด–ปิดกะ & นับเงินในลิ้นชัก
   กะเป็นของแต่ละเครื่อง (1 เครื่อง = 1 ลิ้นชัก) แต่ประวัติกะแชร์กันทุกเครื่อง
   ========================================================= */

const DEVICE_KEY = `${APP_KEY}-device`;
const CASHIER_KEY = `${APP_KEY}-cashier`;
const BANKNOTES = [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25];

function deviceId() {
  let id = lsGet(DEVICE_KEY);
  if (!id) { id = uid(); lsSet(DEVICE_KEY, id); }
  return id;
}
const currentShift = () => (db.settings.useShifts ? db.shifts.find((s) => !s.closedAt && s.deviceId === deviceId()) || null : null);
const currentCashier = () => currentShift()?.cashier || lsGet(CASHIER_KEY) || db.settings.cashier;

// เงินสดสุทธิที่เข้าลิ้นชักจากบิลนี้ (หักเงินทอนแล้ว)
function saleCashNet(sale) {
  return r2(Math.max(0, sum(sale.payments.filter((p) => p.method === 'cash'), (p) => p.amount) - (sale.change || 0)));
}

// เงินมัดจำที่รับเข้า/คืนออกในกะนี้ (จากบิลเปิด การจอง และบิลที่ปิดแล้ว)
function shiftDepositFlows(sh) {
  const holders = [...db.sessions, ...db.bookings];
  const received = holders.flatMap((h) => h.deposits || []).filter((d) => d.shiftId === sh.id);
  const refunds = [...db.sales.flatMap((s) => s.depositRefunds || []), ...holders.flatMap((h) => h.depositRefunds || [])].filter((r) => r.shiftId === sh.id);
  return { received, refunds };
}

function shiftSummary(sh) {
  const sales = db.sales.filter((s) => s.shiftId === sh.id && !s.forfeit);
  const refunds = db.sales.filter((s) => s.status === 'refunded' && s.refundShiftId === sh.id);
  const dep = shiftDepositFlows(sh);
  const byMethod = {};
  sales.forEach((s) => {
    let changeLeft = s.change || 0;
    [...s.payments].reverse().forEach((p) => {
      if (p.method === 'deposit') return; // จ่ายด้วยมัดจำที่รับไว้ก่อนแล้ว — ไม่ใช่เงินใหม่ในกะนี้
      let amt = p.amount;
      if (p.method === 'cash' && changeLeft) { const d = Math.min(changeLeft, amt); amt -= d; changeLeft -= d; }
      byMethod[p.method] = r2((byMethod[p.method] || 0) + amt);
    });
  });
  const moves = sh.moves || [];
  const cashSales = sum(sales, saleCashNet);
  // คืนเงินบิลที่เคยหักมัดจำเงินสด → ส่วนมัดจำนั้นก็ออกจากลิ้นชักด้วย
  const cashRefunds = sum(refunds, (s) => saleCashNet(s) + sum(s.payments.filter((p) => p.method === 'deposit' && p.via === 'cash'), (p) => p.amount));
  const cashIn = sum(moves.filter((x) => x.type === 'in'), (x) => x.amount);
  const cashOut = sum(moves.filter((x) => x.type === 'out'), (x) => x.amount);
  // ส่วนของยอดขายที่จ่ายด้วยมัดจำ (รับไว้ก่อนแล้ว) — แสดงแยกให้ยอดตามช่องทางรวมได้เท่ายอดขาย
  const depositApplied = sum(sales.flatMap((s) => s.payments.filter((p) => p.method === 'deposit')), (p) => p.amount);
  const depositIn = sum(dep.received.filter((d) => d.method === 'cash'), (d) => num(d.amount));
  const depositOut = sum(dep.refunds.filter((d) => d.method === 'cash'), (d) => num(d.amount));
  return {
    depositIn: r2(depositIn), depositOut: r2(depositOut), depositApplied: r2(depositApplied),
    depositsReceived: r2(sum(dep.received, (d) => num(d.amount))), depositsRefunded: r2(sum(dep.refunds, (d) => num(d.amount))),
    bills: sales.length,
    total: r2(sum(sales, (s) => s.total)),
    discounts: r2(sum(sales, (s) => s.discount + sum(s.items, (i) => i.discount || 0))),
    byMethod,
    refunds: refunds.length, refundTotal: r2(sum(refunds, (s) => s.total)),
    cashSales: r2(cashSales), cashRefunds: r2(cashRefunds), cashIn: r2(cashIn), cashOut: r2(cashOut),
    expected: r2(num(sh.openingCash) + cashSales - cashRefunds + cashIn - cashOut + depositIn - depositOut),
  };
}

/* ---------- Open shift ---------- */
function openShiftStart(onOpened) {
  const m = openModal({
    title: '🔓 เปิดกะ / เปิดร้าน', size: 'sm',
    body: `<div class="fields">
      <label class="field"><span>ชื่อพนักงาน</span><input id="so-cashier" value="${esc(lsGet(CASHIER_KEY) || db.settings.cashier)}"></label>
      <label class="field"><span>เงินทอนในลิ้นชักตอนเริ่ม (${esc(db.settings.currencySymbol)})</span><input id="so-cash" type="number" min="0" step="0.01" class="pay-input" placeholder="0" autofocus></label>
      <div class="quick" id="so-quick">${[0, 500, 1000, 2000, 3000].map((v) => `<button data-v="${v}">${money(v)}</button>`).join('')}</div>
      <p class="muted small" style="margin:0">นับเงินที่อยู่ในลิ้นชักตอนนี้ ตอนปิดกะระบบจะใช้ตัวเลขนี้คำนวณว่าเงินควรมีเท่าไร</p>
    </div>`,
    footer: '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary lg" id="so-ok">เปิดกะ</button>',
  });
  const el = m.el;
  $('#so-quick', el).onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { $('#so-cash', el).value = b.dataset.v; $('#so-cash', el).focus(); } };
  const ok = () => {
    const cashier = $('#so-cashier', el).value.trim() || db.settings.cashier;
    lsSet(CASHIER_KEY, cashier);
    const sh = {
      id: uid(), no: db.shifts.reduce((mx, s) => Math.max(mx, s.no || 0), 0) + 1, deviceId: deviceId(), cashier,
      openedAt: new Date().toISOString(), openingCash: r2($('#so-cash', el).value), moves: [], demo: hasDemoData(),
    };
    db.shifts.push(sh);
    save(); m.close(); renderCart();
    toast(`เปิดกะ #${sh.no} แล้ว`, 'success');
    if (onOpened) onOpened(sh);
  };
  $('#so-ok', el).onclick = ok;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok(); });
}

/* ---------- Shift panel ---------- */
function openShiftPanel(sh = currentShift()) {
  if (!sh) return openShiftStart();
  const sum_ = shiftSummary(sh);
  const isMine = sh.deviceId === deviceId();
  const rows = (pairs) => pairs.map(([a, b, cls]) => `<div class="sum-row ${cls || ''}"><span>${a}</span><b>${b}</b></div>`).join('');
  const m = openModal({
    title: `กะ #${sh.no} · ${esc(sh.cashier)}`, size: 'md',
    body: `<p class="muted" style="margin-top:0">เปิดเมื่อ ${fmtDateTime(sh.openedAt)}${sh.closedAt ? ` · ปิดเมื่อ ${fmtDateTime(sh.closedAt)}` : ''}${isMine ? '' : ' · <b>กะของเครื่องอื่น</b>'}</p>
      <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
        <div class="card kpi"><span>ยอดขายในกะ</span><b>${money(sum_.total)}</b><small>${sum_.bills} บิล</small></div>
        <div class="card kpi"><span>${sh.closedAt ? 'เงินสดที่นับได้' : 'เงินสดที่ควรมีในลิ้นชัก'}</span><b>${money(sh.closedAt ? sh.countedCash : sum_.expected)}</b>
          <small>${sh.closedAt ? diffLabel(sh.countedCash - sh.expectedCash) : 'รวมเงินทอนตั้งต้น'}</small></div>
      </div>
      <div class="card card-pad"><h3>รายละเอียดเงินสด</h3>${rows([
        ['เงินทอนตั้งต้น', money(sh.openingCash)],
        ['+ รับเงินสดจากการขาย', money(sum_.cashSales)],
        ...(sum_.cashIn ? [['+ นำเงินเข้าลิ้นชัก', money(sum_.cashIn)]] : []),
        ...(sum_.cashOut ? [['− นำเงินออกจากลิ้นชัก', money(sum_.cashOut), 'neg']] : []),
        ...(sum_.cashRefunds ? [['− คืนเงินสดให้ลูกค้า', money(sum_.cashRefunds), 'neg']] : []),
        ...(sum_.depositIn ? [['+ รับเงินมัดจำ (เงินสด)', money(sum_.depositIn)]] : []),
        ...(sum_.depositOut ? [['− คืนเงินมัดจำ (เงินสด)', money(sum_.depositOut), 'neg']] : []),
      ])}<div class="sum-total"><span>เงินสดที่ควรมี</span><b style="font-size:20px">${money(sh.closedAt ? sh.expectedCash : sum_.expected)}</b></div></div>
      <div class="card card-pad" style="margin-top:12px"><h3>ยอดตามช่องทางชำระเงิน</h3>
        ${rows([
          ...Object.entries(sum_.byMethod).map(([k, v]) => [`${PAY_METHODS[k]?.icon || ''} ${PAY_METHODS[k]?.label || k}`, money(v)]),
          ...(sum_.depositApplied ? [['🔐 หักจากเงินมัดจำ (รับไว้ก่อนแล้ว)', money(sum_.depositApplied)]] : []),
        ]) || '<p class="muted small">ยังไม่มียอดขาย</p>'}
        ${sum_.depositsReceived ? rows([[`รับเงินมัดจำในกะนี้ (ทุกช่องทาง)`, money(sum_.depositsReceived), 'muted']]) : ''}
        ${sum_.refunds ? rows([[`คืนเงิน ${sum_.refunds} บิล`, money(sum_.refundTotal), 'neg']]) : ''}</div>
      ${(sh.moves || []).length ? `<div class="card card-pad" style="margin-top:12px"><h3>เงินเข้า–ออกลิ้นชัก</h3>${rows(sh.moves.map((x) => [`${fmtDateTime(x.at)} · ${esc(x.note || (x.type === 'in' ? 'นำเงินเข้า' : 'นำเงินออก'))}`, `${x.type === 'in' ? '+' : '−'}${money(x.amount)}`, x.type === 'out' ? 'neg' : '']))}</div>` : ''}`,
    footer: sh.closedAt
      ? '<span class="grow"></span><button class="btn ghost" data-cancel>ปิด</button><button class="btn primary" id="sp-print">🖨 พิมพ์สรุปกะ</button>'
      : `<button class="btn" id="sp-in">＋ นำเงินเข้า</button><button class="btn" id="sp-out">− นำเงินออก</button><button class="btn ghost" id="sp-print" title="พิมพ์ยอดระหว่างกะ">🖨</button><span class="grow"></span><button class="btn primary" id="sp-close">🔒 ปิดกะ & นับเงิน</button>`,
  });
  const el = m.el;
  $('#sp-print', el).onclick = () => printShiftReport(sh);
  const reopen = () => { m.close(); openShiftPanel(db.shifts.find((x) => x.id === sh.id)); };
  if (!sh.closedAt) {
    $('#sp-in', el).onclick = () => openCashMove(sh, 'in', reopen);
    $('#sp-out', el).onclick = () => openCashMove(sh, 'out', reopen);
    $('#sp-close', el).onclick = () => { m.close(); openShiftClose(sh); };
  }
}

const diffLabel = (d) => {
  d = r2(d);
  if (!d) return '✅ ตรงพอดี';
  return d > 0 ? `เกิน ${money(d)}` : `ขาด ${money(-d)}`;
};

function openCashMove(sh, type, done) {
  const m = openModal({
    title: type === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก', size: 'sm',
    body: `<div class="fields">
      <label class="field"><span>จำนวนเงิน</span><input id="cm-amt" type="number" min="0" step="0.01" class="pay-input" autofocus></label>
      <label class="field"><span>เหตุผล</span><input id="cm-note" placeholder="${type === 'in' ? 'เช่น แลกเหรียญเพิ่ม' : 'เช่น จ่ายค่าน้ำแข็ง, นำเงินไปฝาก'}"></label>
    </div>`,
    footer: '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="cm-ok">บันทึก</button>',
  });
  const ok = () => {
    const amount = r2($('#cm-amt', m.el).value);
    if (amount <= 0) return toast('กรุณาระบุจำนวนเงิน', 'warn');
    sh.moves = sh.moves || [];
    sh.moves.push({ id: uid(), at: new Date().toISOString(), type, amount, note: $('#cm-note', m.el).value.trim() });
    save(); m.close();
    toast('บันทึกแล้ว', 'success');
    if (done) done();
  };
  $('#cm-ok', m.el).onclick = ok;
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok(); });
}

/* ---------- Close shift ---------- */
function openShiftClose(sh) {
  const s = shiftSummary(sh);
  const useNotes = db.settings.currencySymbol === '฿';
  const m = openModal({
    title: `🔒 ปิดกะ #${sh.no} — นับเงินในลิ้นชัก`, size: 'md',
    body: `${useNotes ? `<p class="muted small" style="margin-top:0">ใส่จำนวนธนบัตร/เหรียญแต่ละชนิด ระบบจะรวมให้ — หรือพิมพ์ยอดรวมในช่องด้านล่างเลยก็ได้</p>
      <div class="notes">${BANKNOTES.map((v) => `<label class="note-row"><span>${v >= 1 ? money(v, false).replace(/\.00$/, '') : v === 0.5 ? '50 สต.' : '25 สต.'}</span><em>×</em><input type="number" min="0" step="1" data-note="${v}" inputmode="numeric" placeholder="0"><b data-sub="${v}"></b></label>`).join('')}</div>` : ''}
      <label class="field" style="margin-top:12px"><span>ยอดเงินสดที่นับได้ทั้งหมด</span><input id="sc-total" type="number" min="0" step="0.01" class="pay-input" ${useNotes ? '' : 'autofocus'}></label>
      <div class="close-compare" id="sc-compare"></div>
      <label class="field" style="margin-top:12px"><span>หมายเหตุ (ถ้ามี)</span><input id="sc-note" placeholder="เช่น ทอนเงินผิด 20 บาท"></label>`,
    footer: '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary lg" id="sc-ok">ยืนยันปิดกะ</button>',
  });
  const el = m.el;
  const totalIn = $('#sc-total', el);
  let typedTotal = false;
  const draw = () => {
    const counted = num(totalIn.value);
    const d = r2(counted - s.expected);
    $('#sc-compare', el).innerHTML = `
      <div class="sum-row"><span>เงินสดที่ควรมี</span><b>${money(s.expected)}</b></div>
      <div class="sum-row"><span>นับได้จริง</span><b>${totalIn.value === '' ? '—' : money(counted)}</b></div>
      ${totalIn.value === '' ? '' : `<div class="pay-stat ${d === 0 ? 'change' : 'remain'}"><span>${d === 0 ? 'ตรงพอดี' : d > 0 ? 'เงินเกิน' : 'เงินขาด'}</span><b>${money(Math.abs(d))}</b></div>`}`;
  };
  $$('[data-note]', el).forEach((inp) => inp.addEventListener('input', () => {
    let total = 0;
    $$('[data-note]', el).forEach((x) => {
      const sub = num(x.dataset.note) * Math.max(0, Math.floor(num(x.value)));
      total += sub;
      $(`[data-sub="${x.dataset.note}"]`, el).textContent = sub ? money(sub, false) : '';
    });
    if (!typedTotal) totalIn.value = r2(total) || '';
    draw();
  }));
  totalIn.addEventListener('input', () => { typedTotal = totalIn.value !== ''; draw(); });
  if (useNotes) setTimeout(() => $('[data-note]', el).focus(), 60);
  draw();

  $('#sc-ok', el).onclick = async () => {
    if (totalIn.value === '') { totalIn.focus(); return toast('กรุณาใส่ยอดเงินที่นับได้', 'warn'); }
    if (db.cart.lines.length && sh.deviceId === deviceId()
      && !await confirmDialog('ยังมีรายการค้างอยู่ในบิลปัจจุบัน — ปิดกะต่อหรือไม่?<br><small class="muted">บิลที่ค้างจะยังอยู่ ขายต่อได้เมื่อเปิดกะใหม่</small>', { okText: 'ปิดกะต่อ' })) return;
    Object.assign(sh, {
      closedAt: new Date().toISOString(), countedCash: r2(totalIn.value), expectedCash: s.expected,
      difference: r2(num(totalIn.value) - s.expected), closeNote: $('#sc-note', el).value.trim(), summary: s,
    });
    save(); m.close(); renderCart();
    const done = openModal({
      title: `ปิดกะ #${sh.no} เรียบร้อย`, size: 'sm',
      body: `<div class="done"><div class="done-ico">✓</div><h3>ยอดขาย ${money(s.total)}</h3><p class="muted">${s.bills} บิล · เงินสด ${diffLabel(sh.difference)}</p></div>`,
      footer: '<button class="btn ghost" data-cancel>ปิด</button><button class="btn primary" id="sd-print">🖨 พิมพ์สรุปกะ</button>',
    });
    $('#sd-print', done.el).onclick = () => printShiftReport(sh);
    if (ui.view === 'sales') renderSales();
  };
}

/* ---------- Shift report (print) ---------- */
function shiftReportHTML(sh) {
  const st = db.settings;
  const s = sh.closedAt && sh.summary ? sh.summary : shiftSummary(sh);
  const row = (a, b) => `<div class="r-row"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="receipt ${+st.paperWidth === 58 ? 'w58' : ''}">
    <div class="r-center"><div class="r-shop">${esc(st.shopName)}</div>
      <div class="r-title">${sh.closedAt ? 'สรุปปิดกะ' : 'สรุปยอดระหว่างกะ'} #${sh.no}</div></div>
    ${row('พนักงาน', esc(sh.cashier))}
    ${row('เปิดกะ', fmtDateTime(sh.openedAt))}
    ${row(sh.closedAt ? 'ปิดกะ' : 'พิมพ์เมื่อ', fmtDateTime(sh.closedAt || new Date().toISOString()))}
    <hr class="r-hr">
    ${row('จำนวนบิล', s.bills)}
    ${row('ยอดขายรวม', money(s.total, false))}
    ${s.discounts ? row('ส่วนลดรวม', money(s.discounts, false)) : ''}
    ${Object.entries(s.byMethod).map(([k, v]) => row(`  ${PAY_METHODS[k]?.label || k}`, money(v, false))).join('')}
    ${s.depositApplied ? row('  หักจากเงินมัดจำ', money(s.depositApplied, false)) : ''}
    ${s.depositsReceived ? row('รับเงินมัดจำ (ทุกช่องทาง)', money(s.depositsReceived, false)) : ''}
    ${s.refunds ? row(`คืนเงิน ${s.refunds} บิล`, `-${money(s.refundTotal, false)}`) : ''}
    <hr class="r-hr">
    ${row('เงินทอนตั้งต้น', money(sh.openingCash, false))}
    ${row('รับเงินสดจากการขาย', money(s.cashSales, false))}
    ${s.cashIn ? row('นำเงินเข้า', money(s.cashIn, false)) : ''}
    ${s.cashOut ? row('นำเงินออก', `-${money(s.cashOut, false)}`) : ''}
    ${s.cashRefunds ? row('คืนเงินสด', `-${money(s.cashRefunds, false)}`) : ''}
    ${s.depositIn ? row('รับเงินมัดจำ (เงินสด)', money(s.depositIn, false)) : ''}
    ${s.depositOut ? row('คืนเงินมัดจำ (เงินสด)', `-${money(s.depositOut, false)}`) : ''}
    <div class="r-row r-total"><span>เงินสดที่ควรมี</span><span>${money(sh.closedAt ? sh.expectedCash : s.expected)}</span></div>
    ${sh.closedAt ? `${row('นับได้จริง', money(sh.countedCash, false))}<div class="r-row r-total"><span>ส่วนต่าง</span><span>${diffLabel(sh.difference)}</span></div>` : ''}
    ${sh.closeNote ? `<div class="r-sub">หมายเหตุ: ${esc(sh.closeNote)}</div>` : ''}
    <div class="r-center r-foot">ลงชื่อ ..............................</div>
  </div>`;
}
function printShiftReport(sh) {
  $('#print-area').innerHTML = shiftReportHTML(sh);
  setTimeout(() => window.print(), 60);
}

/* ---------- Shift history (หน้าประวัติขาย) ---------- */
function drawShiftHistory(container) {
  const list = [...db.shifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  container.innerHTML = `<div class="card table-wrap"><table class="table">
    <thead><tr><th>กะ</th><th>พนักงาน</th><th>เปิด</th><th>ปิด</th><th class="num">บิล</th><th class="num">ยอดขาย</th><th class="num">เงินสดที่ควรมี</th><th class="num">นับได้</th><th>ส่วนต่าง</th></tr></thead>
    <tbody>${list.map((sh) => {
      const s = sh.closedAt && sh.summary ? sh.summary : shiftSummary(sh);
      const d = sh.closedAt ? r2(sh.difference) : null;
      return `<tr class="clickable" data-shift="${sh.id}"><td><b>#${sh.no}</b></td><td>${esc(sh.cashier)}</td>
        <td class="nowrap muted">${fmtDateTime(sh.openedAt)}</td><td class="nowrap muted">${sh.closedAt ? fmtDateTime(sh.closedAt) : '<span class="pill primary">เปิดอยู่</span>'}</td>
        <td class="num">${s.bills}</td><td class="num"><b>${money(s.total)}</b></td>
        <td class="num">${money(sh.closedAt ? sh.expectedCash : s.expected)}</td><td class="num">${sh.closedAt ? money(sh.countedCash) : '—'}</td>
        <td>${d === null ? '' : `<span class="pill ${d === 0 ? 'ok' : d > 0 ? 'warn' : 'danger'}">${diffLabel(d)}</span>`}</td></tr>`;
    }).join('') || `<tr><td colspan="9"><div class="empty"><div class="empty-ico">🗄️</div><p>ยังไม่มีประวัติกะ</p><small>${db.settings.useShifts ? 'เปิดกะได้ที่แถบด้านบนของบิลในหน้าขาย' : 'เปิดใช้งานระบบกะได้ที่เมนูตั้งค่า'}</small></div></td></tr>`}</tbody></table></div>`;
  container.onclick = (e) => {
    const tr = e.target.closest('[data-shift]');
    if (tr) openShiftPanel(db.shifts.find((x) => x.id === tr.dataset.shift));
  };
}
