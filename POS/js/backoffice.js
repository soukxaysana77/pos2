'use strict';
/* =========================================================
   Universal POS — ประวัติการขาย, รายงาน, ลูกค้า, ตั้งค่า
   ========================================================= */

/* ---------- Date range helpers ---------- */
function rangeBounds(r) {
  const now = new Date();
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const t0 = sod(now);
  switch (r.key) {
    case 'today': return [t0, addDays(t0, 1)];
    case 'yesterday': return [addDays(t0, -1), t0];
    case '7d': return [addDays(t0, -6), addDays(t0, 1)];
    case '30d': return [addDays(t0, -29), addDays(t0, 1)];
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
    case 'lastmonth': return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
    case 'custom': return [r.from ? new Date(r.from + 'T00:00') : new Date(0), r.to ? addDays(new Date(r.to + 'T00:00'), 1) : addDays(t0, 1)];
    default: {
      const first = db.sales.length ? sod(db.sales.reduce((a, s) => (s.date < a ? s.date : a), db.sales[0].date)) : t0;
      return [first, addDays(t0, 1)];
    }
  }
}
function salesInRange(r) {
  const [a, b] = rangeBounds(r);
  return db.sales.filter((s) => { const d = new Date(s.date); return d >= a && d < b; });
}
function rangeControlHTML(k) {
  const r = ui.ranges[k];
  return `<div class="range" data-range="${k}">
    <div class="seg">${Object.entries(RANGES).map(([v, l]) => `<button data-rk="${v}" class="${r.key === v ? 'active' : ''}">${l}</button>`).join('')}</div>
    <span class="range" ${r.key === 'custom' ? '' : 'hidden'} data-custom><input type="date" data-from value="${r.from}"> – <input type="date" data-to value="${r.to}"></span>
  </div>`;
}
function bindRange(root, k, cb) {
  const w = $(`[data-range="${k}"]`, root);
  const r = ui.ranges[k];
  w.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rk]'); if (!b) return;
    r.key = b.dataset.rk;
    $$('[data-rk]', w).forEach((x) => x.classList.toggle('active', x === b));
    $('[data-custom]', w).hidden = r.key !== 'custom';
    cb();
  });
  w.addEventListener('change', (e) => {
    if (e.target.matches('[data-from]')) r.from = e.target.value;
    if (e.target.matches('[data-to]')) r.to = e.target.value;
    cb();
  });
}
const payLabel = (s) => [...new Set(s.payments.map((p) => PAY_METHODS[p.method]?.label || p.method))].join(' + ') || '—';

/* ---------- Sales history ---------- */
function renderSales() {
  const el = $('#view-sales');
  const tabs = `<div class="seg" id="sales-tabs" style="margin-bottom:14px"><button data-tab="bills" class="${ui.salesTab !== 'shifts' ? 'active' : ''}">🧾 บิลขาย</button><button data-tab="shifts" class="${ui.salesTab === 'shifts' ? 'active' : ''}">🗄️ กะ & ลิ้นชักเงินสด</button></div>`;
  const bindTabs = () => { $('#sales-tabs', el).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { ui.salesTab = b.dataset.tab; renderSales(); } }; };
  if (ui.salesTab === 'shifts') {
    el.innerHTML = `<header class="view-head"><div><h2>ประวัติการขาย</h2><p class="muted">${db.shifts.length} กะ · แตะเพื่อดูรายละเอียดหรือพิมพ์สรุปกะ</p></div>
      ${db.settings.useShifts ? `<button class="btn primary" id="sh-current">${currentShift() ? 'กะปัจจุบัน / ปิดกะ' : '🔓 เปิดกะ'}</button>` : ''}</header>${tabs}<div id="shift-list"></div>`;
    bindTabs();
    const cur = $('#sh-current', el);
    if (cur) cur.onclick = () => openShiftPanel();
    drawShiftHistory($('#shift-list', el));
    return;
  }
  el.innerHTML = `
    <header class="view-head"><div><h2>ประวัติการขาย</h2><p class="muted" id="sales-sub"></p></div>
      <button class="btn" id="sales-export">⬇ ส่งออก CSV</button></header>${tabs}
    <div class="filters">${rangeControlHTML('sales')}</div>
    <div class="filters">
      <label class="search">${SEARCH_ICON}<input id="sales-search" type="search" placeholder="ค้นหาเลขที่บิล / ลูกค้า / สินค้า" value="${esc(ui.salesSearch)}"></label>
      <select id="sales-status"><option value="all">ทุกสถานะ</option><option value="paid" ${ui.salesStatus === 'paid' ? 'selected' : ''}>สำเร็จ</option><option value="refunded" ${ui.salesStatus === 'refunded' ? 'selected' : ''}>คืนเงินแล้ว</option></select>
    </div>
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>เลขที่</th><th>วันเวลา</th><th>ลูกค้า</th><th class="num">รายการ</th><th>ชำระโดย</th><th class="num">ยอดสุทธิ</th><th>สถานะ</th></tr></thead>
      <tbody id="sales-body"></tbody></table></div>`;
  const filtered = () => {
    const q = ui.salesSearch.trim().toLowerCase();
    return salesInRange(ui.ranges.sales)
      .filter((s) => (ui.salesStatus === 'all' || s.status === ui.salesStatus)
        && (!q || `${s.no} ${s.customerName} ${s.unitName || ''} ${s.sessionNo || ''} ${s.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date));
  };
  const draw = () => {
    const list = filtered();
    const paid = list.filter((s) => s.status === 'paid');
    $('#sales-sub', el).textContent = `${list.length} บิล · ยอดขาย ${money(sum(paid, (s) => s.total))}`;
    $('#sales-body', el).innerHTML = list.slice(0, 500).map((s) => `<tr class="clickable" data-id="${s.id}">
      <td><b>${esc(s.no)}</b></td><td class="nowrap muted">${fmtDateTime(s.date)}</td><td>${esc(s.customerName || '-')}${s.unitName ? `<small class="muted"> · ${esc(s.unitName)}</small>` : ''}${s.sessionNo && s.isJob ? `<small class="muted"> · ${esc(s.sessionNo)}</small>` : ''}</td>
      <td class="num">${s.items.length}</td><td>${esc(payLabel(s))}</td><td class="num"><b>${money(s.total)}</b></td>
      <td><span class="pill ${s.status === 'paid' ? 'ok' : 'danger'}">${s.status === 'paid' ? 'สำเร็จ' : 'คืนเงินแล้ว'}</span></td></tr>`).join('')
      || '<tr><td colspan="7"><div class="empty"><div class="empty-ico">🧾</div><p>ไม่มีรายการขายในช่วงนี้</p></div></td></tr>';
  };
  bindRange(el, 'sales', draw);
  bindTabs();
  $('#sales-search', el).addEventListener('input', (e) => { ui.salesSearch = e.target.value; draw(); });
  $('#sales-status', el).addEventListener('change', (e) => { ui.salesStatus = e.target.value; draw(); });
  $('#sales-body', el).onclick = (e) => { const tr = e.target.closest('[data-id]'); if (tr) openSaleDetail(db.sales.find((s) => s.id === tr.dataset.id)); };
  $('#sales-export', el).onclick = () => {
    const rows = [['เลขที่', 'วันที่', 'ลูกค้า', 'สินค้า', 'แบบ', 'ตัวเลือก', 'จำนวน', 'หน่วย', 'ราคา', 'ส่วนลดรายการ', 'รวมรายการ', 'ยอดสุทธิบิล', 'ภาษี', 'ชำระโดย', 'สถานะ']];
    filtered().forEach((s) => s.items.forEach((it, i) => rows.push([
      s.no, new Date(s.date).toLocaleString('th-TH'), s.customerName, it.name, it.variantName, it.options.map((o) => o.name).join(' / '),
      it.qty, it.unit, it.price, it.discount, it.total, i === 0 ? s.total : '', i === 0 ? s.tax : '', i === 0 ? payLabel(s) : '', s.status,
    ])));
    download(`sales-${toISODate(new Date())}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  };
  draw();
}

function openSaleDetail(sale) {
  const m = openModal({
    title: `บิล ${esc(sale.no)}`, size: 'sm',
    body: `<div class="receipt-preview">${receiptHTML(sale)}</div>`,
    footer: `${sale.status === 'paid' ? '<button class="btn ghost danger-text" id="sd-refund">ยกเลิก / คืนเงิน</button>' : ''}<span class="grow"></span><button class="btn ghost" data-cancel>ปิด</button><button class="btn primary" id="sd-print">🖨 พิมพ์ใบเสร็จ</button>`,
  });
  $('#sd-print', m.el).onclick = () => printReceipt(sale);
  const rf = $('#sd-refund', m.el);
  if (rf) rf.onclick = async () => { if (await refundSale(sale)) { m.close(); if (ui.view !== 'pos') RENDERERS[ui.view](); } };
}

async function refundSale(sale) {
  if (sale.status !== 'paid') return false;
  const ok = await confirmDialog(`ยืนยันยกเลิกบิล <b>${esc(sale.no)}</b> ยอด <b>${money(sale.total)}</b>?<br><small class="muted">สินค้าจะถูกคืนเข้าสต็อก และหักแต้มสะสมของลูกค้า</small>`, { title: 'ยกเลิก / คืนเงิน', okText: 'ยืนยันคืนเงิน', danger: true });
  if (!ok) return false;
  sale.status = 'refunded';
  sale.refundedAt = new Date().toISOString();
  sale.refundShiftId = currentShift()?.id || null;
  sale.items.forEach((it) => applyStock(it.productId, it.variantId, it.qty, 'refund', sale.no));
  const cust = db.customers.find((c) => c.id === sale.customerId);
  if (cust && sale.pointsEarned) cust.points = Math.max(0, (cust.points || 0) - sale.pointsEarned);
  // คืนเงินบิล "เก็บเงินถึงวันนี้" ของแขกที่ยังพักอยู่ → ค่าห้องช่วงนั้นและรายการที่สั่งกลับมาค้างในบิลเปิดอีกครั้ง
  const sess = sale.interim && db.sessions.find((s) => s.id === sale.sessionId && s.status === 'open');
  if (sess) {
    if (sale.stay?.billedUntil && sess.billedFrom === sale.stay.billedUntil) sess.billedFrom = sale.stay.billedFrom;
    sess.saleIds = sess.saleIds.filter((id) => id !== sale.id);
    sess.cart.lines.push(...sale.items.filter((it) => !it.isTime).map((it) => ({
      id: uid(), productId: it.productId, variantId: it.variantId, name: it.name, variantName: it.variantName, options: it.options || [],
      unit: it.unit, qty: it.qty, price: it.price, cost: it.cost, discountType: 'amount', discountValue: it.discount || 0, taxable: it.taxable,
      note: it.note || '', decimalQty: !it.productId || !!db.products.find((p) => p.id === it.productId)?.decimalQty, categoryId: it.categoryId,
    })));
    toast(`รายการในบิลนี้กลับมาค้างชำระในบิล ${sess.unitName} แล้ว`, 'info', 4000);
  }
  save(); updateBadges();
  toast(`คืนเงินบิล ${sale.no} แล้ว`, 'success');
  return true;
}

/* ---------- Reports ---------- */
function renderReports() {
  const el = $('#view-reports');
  el.innerHTML = `
    <header class="view-head"><div><h2>รายงานยอดขาย</h2><p class="muted" id="rep-sub"></p></div></header>
    <div class="filters">${rangeControlHTML('reports')}</div>
    <div id="rep-body"></div>`;
  bindRange(el, 'reports', drawReports);
  drawReports();
}

function barChart(buckets) {
  const W = 760, H = 230, L = 56, B = 26, T = 12, R = 8;
  const max = Math.max(...buckets.map((b) => b.value), 0);
  const step = (() => { if (!max) return 1; const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw); })();
  const top = step * 4;
  const iw = W - L - R, ih = H - T - B, bw = iw / buckets.length;
  const labelEvery = Math.ceil(buckets.length / 14);
  const short = (v) => (v >= 1e6 ? `${r2(v / 1e6)}M` : v >= 1e3 ? `${r2(v / 1e3)}K` : String(r2(v)));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟยอดขาย">`;
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    svg += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis-text" x="${L - 8}" y="${y + 4}" text-anchor="end">${short(step * i)}</text>`;
  }
  buckets.forEach((b, i) => {
    const h = top ? (b.value / top) * ih : 0;
    const x = L + i * bw + bw * 0.15;
    svg += `<rect class="bar" x="${x}" y="${T + ih - h}" width="${Math.max(1, bw * 0.7)}" height="${Math.max(0, h)}" rx="3"><title>${esc(b.title || b.label)}: ${money(b.value)}</title></rect>`;
    if (i % labelEvery === 0) svg += `<text class="axis-text" x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return svg + '</svg>';
}

function drawReports() {
  const r = ui.ranges.reports;
  const [a, b] = rangeBounds(r);
  const all = salesInRange(r);
  const sales = all.filter((s) => s.status === 'paid');
  const refunded = all.filter((s) => s.status === 'refunded');
  const revenue = sum(sales, (s) => s.total);
  const exTax = sum(sales, (s) => s.total - (s.taxMode === 'none' ? 0 : s.tax) - (s.rounding || 0));
  const cost = sum(sales, (s) => sum(s.items, (i) => num(i.cost) * num(i.qty)));
  const profit = exTax - cost - sum(sales, (s) => s.service || 0);
  const discounts = sum(sales, (s) => s.discount + sum(s.items, (i) => i.discount || 0));
  $('#rep-sub').textContent = `${a.toLocaleDateString('th-TH', { dateStyle: 'medium' })} – ${new Date(b.getTime() - 1).toLocaleDateString('th-TH', { dateStyle: 'medium' })}`;

  // Buckets: hours for one day, days for ≤ 62 days, otherwise months
  const spanDays = Math.round((b - a) / 864e5);
  let buckets = [];
  if (spanDays <= 1) {
    buckets = Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, title: `${h}:00–${h}:59 น.`, value: 0 }));
    sales.forEach((s) => { buckets[new Date(s.date).getHours()].value += s.total; });
    buckets = buckets.slice(6, 24);
  } else if (spanDays <= 62) {
    const idx = {};
    for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) { idx[toISODate(d)] = buckets.length; buckets.push({ label: `${d.getDate()}`, title: fmtDate(d), value: 0 }); }
    sales.forEach((s) => { const i = idx[toISODate(s.date)]; if (i !== undefined) buckets[i].value += s.total; });
  } else {
    const idx = {};
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d < b; d.setMonth(d.getMonth() + 1)) {
      idx[`${d.getFullYear()}-${d.getMonth()}`] = buckets.length;
      buckets.push({ label: d.toLocaleDateString('th-TH', { month: 'short' }), title: d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }), value: 0 });
    }
    sales.forEach((s) => { const d = new Date(s.date); const i = idx[`${d.getFullYear()}-${d.getMonth()}`]; if (i !== undefined) buckets[i].value += s.total; });
  }

  // Item-level allocation (proportional share of bill discount)
  const prod = {}, cats = {}, pays = {}, units = {};
  sales.forEach((s) => {
    const ratio = s.subtotal > 0 ? (s.subtotal - s.discount) / s.subtotal : 1;
    s.items.forEach((it) => {
      const val = it.total * ratio;
      // ค่าห้อง/ค่าเช่า/ค่าเวลา: รวมเป็นรายการเดียวต่อประเภท (ยอดแยกห้องดูได้ที่ "ยอดขายตามผัง")
      const key = it.isTime ? `⏱ ${s.unitName ? it.name.replace(` ${s.unitName}`, '') : it.name}`
        : it.name + (it.variantName ? ` (${it.variantName})` : '');
      prod[key] = prod[key] || { name: key, qty: 0, unit: it.unit, value: 0, profit: 0 };
      prod[key].qty += num(it.qty); prod[key].value += val; prod[key].profit += val - num(it.cost) * num(it.qty);
      const cid = it.isTime ? '__time' : it.categoryId || '';
      cats[cid] = (cats[cid] || 0) + val;
    });
    let changeLeft = s.change || 0;
    [...s.payments].reverse().forEach((p) => {
      let amt = p.amount;
      if (p.method === 'cash' && changeLeft) { const d = Math.min(changeLeft, amt); amt -= d; changeLeft -= d; }
      const key = p.method === 'deposit' ? p.via || 'other' : p.method; // ส่วนที่จ่ายด้วยมัดจำ นับตามช่องทางที่รับมัดจำมา
      pays[key] = (pays[key] || 0) + amt;
    });
    if (s.unitName) {
      const u = units[s.unitName] || (units[s.unitName] = { name: s.unitName, value: 0, bills: 0 });
      u.value += s.total; u.bills += s.interim ? 0 : 1;
    }
  });
  const unitRows = Object.values(units).sort((x, y) => y.value - x.value).slice(0, 12);
  const unitTotal = sum(unitRows, (u) => u.value) || 1;
  // อัตราเข้าพัก (โดยประมาณ) = คืนที่ขายได้ ÷ (จำนวนห้องที่คิดรายคืน × จำนวนวัน)
  const nightUnits = db.units.filter((u) => u.pricing?.mode === 'night').length;
  const soldNights = sum(sales.filter((s) => s.stay?.mode === 'night'), (s) => num(s.stay.units));
  const occupancy = nightUnits ? Math.min(100, Math.round((soldNights / (nightUnits * Math.max(1, spanDays))) * 100)) : null;
  const topProducts = Object.values(prod).sort((x, y) => y.value - x.value).slice(0, 10);
  const catRows = Object.entries(cats).sort((x, y) => y[1] - x[1]);
  const catTotal = sum(catRows, (c) => c[1]) || 1;
  const payTotal = sum(Object.values(pays), (v) => v) || 1;

  const share = (label, value, total, color) => `<div class="share-row"><div class="top"><span>${label}</span><span><b>${money(value)}</b> <small class="muted">${Math.round((value / total) * 100)}%</small></span></div><div class="share-bar"><i style="width:${(value / total) * 100}%;--cc:${color}"></i></div></div>`;

  $('#rep-body').innerHTML = `
    <div class="kpis">
      <div class="card kpi"><span>ยอดขายสุทธิ</span><b>${money(revenue)}</b><small>${sales.length} บิล</small></div>
      <div class="card kpi"><span>เฉลี่ยต่อบิล</span><b>${money(sales.length ? revenue / sales.length : 0)}</b><small>${fmtQty(sum(sales, (s) => s.items.length))} รายการสินค้า</small></div>
      <div class="card kpi"><span>กำไรขั้นต้น (โดยประมาณ)</span><b style="color:${profit >= 0 ? 'var(--ok)' : 'var(--danger)'}">${money(profit)}</b><small>มาร์จิ้น ${exTax ? Math.round((profit / exTax) * 100) : 0}% · ไม่รวม VAT</small></div>
      <div class="card kpi"><span>ส่วนลด / คืนเงิน</span><b>${money(discounts)}</b><small>คืนเงิน ${refunded.length} บิล (${money(sum(refunded, (s) => s.total))})</small></div>
      ${occupancy !== null ? `<div class="card kpi"><span>อัตราเข้าพัก (โดยประมาณ)</span><b>${occupancy}%</b><small>ขายได้ ${fmtQty(soldNights)} คืน จาก ${nightUnits} ห้อง × ${Math.max(1, spanDays)} วัน</small></div>` : ''}
    </div>
    <div class="card card-pad" style="margin-bottom:14px"><h3>ยอดขาย${spanDays <= 1 ? 'รายชั่วโมง' : spanDays <= 62 ? 'รายวัน' : 'รายเดือน'}</h3>
      ${sales.length ? `<div class="table-wrap">${barChart(buckets)}</div>` : '<div class="empty"><p>ไม่มียอดขายในช่วงนี้</p></div>'}</div>
    <div class="grid-2">
      <div class="card"><div class="card-pad" style="padding-bottom:0"><h3>สินค้าขายดี 10 อันดับ</h3></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ยอดขาย</th><th class="num">กำไร</th></tr></thead><tbody>
        ${topProducts.map((p, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(p.name)}</td><td class="num">${fmtQty(p.qty)} ${esc(p.unit)}</td><td class="num"><b>${money(p.value)}</b></td><td class="num ${p.profit < 0 ? 'neg' : 'muted'}">${money(p.profit)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>'}
        </tbody></table></div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card card-pad"><h3>ยอดขายตามหมวดหมู่</h3><div class="share">
          ${catRows.map(([cid, v]) => {
            if (cid === '__time') return share('⏱ ค่าห้อง / ค่าเช่า / ค่าเวลา', v, catTotal, 'var(--primary)');
            const c = getCat(cid);
            return share(`${esc(c.icon)} ${esc(cid && !db.categories.find((x) => x.id === cid) ? 'หมวดที่ถูกลบ' : c.name)}`, v, catTotal, c.color);
          }).join('') || '<p class="muted">—</p>'}
        </div></div>
        ${unitRows.length ? `<div class="card card-pad"><h3>ยอดขายตาม${esc(unitsMenuTitle())}</h3><div class="share">
          ${unitRows.map((u) => share(`${esc(u.name)} <small class="muted">${u.bills} บิล</small>`, u.value, unitTotal, 'var(--primary)')).join('')}
        </div></div>` : ''}
        <div class="card card-pad"><h3>ช่องทางการชำระเงิน</h3><div class="share">
          ${Object.entries(pays).sort((x, y) => y[1] - x[1]).map(([k, v]) => share(`${PAY_METHODS[k]?.icon || ''} ${PAY_METHODS[k]?.label || k}`, v, payTotal, 'var(--primary)')).join('') || '<p class="muted">—</p>'}
        </div></div>
      </div>
    </div>`;
}

/* ---------- Customers ---------- */
function customerStats() {
  const st = {};
  db.sales.forEach((s) => {
    if (!s.customerId || s.status !== 'paid') return;
    const x = st[s.customerId] || (st[s.customerId] = { visits: 0, spent: 0, last: '' });
    x.visits++; x.spent += s.total; if (s.date > x.last) x.last = s.date;
  });
  return st;
}

function renderCustomers() {
  const el = $('#view-customers');
  el.innerHTML = `
    <header class="view-head"><div><h2>ลูกค้า & สมาชิก</h2><p class="muted">${db.customers.length} ราย · สะสมแต้ม ${db.settings.pointsPer > 0 ? `ทุก ${money(db.settings.pointsPer)} = 1 แต้ม` : 'ปิดอยู่'}</p></div>
      <button class="btn primary" id="cu-add">＋ เพิ่มลูกค้า</button></header>
    <div class="filters"><label class="search">${SEARCH_ICON}<input id="cu-search" type="search" placeholder="ค้นหาชื่อ / เบอร์โทร" value="${esc(ui.custSearch)}"></label></div>
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>ชื่อ</th><th>โทรศัพท์</th><th class="num">แต้ม</th><th class="num">จำนวนครั้ง</th><th class="num">ยอดซื้อรวม</th><th>ซื้อล่าสุด</th></tr></thead>
      <tbody id="cu-body"></tbody></table></div>`;
  const draw = () => {
    const stats = customerStats();
    const q = ui.custSearch.trim().toLowerCase();
    $('#cu-body', el).innerHTML = db.customers.filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q)).map((c) => {
      const s = stats[c.id] || { visits: 0, spent: 0, last: '' };
      return `<tr class="clickable" data-id="${c.id}"><td><div class="cell-prod"><span class="thumb">👤</span><span><b>${esc(c.name)}</b><small class="muted">${esc(c.note || '')}</small></span></div></td>
        <td>${esc(c.phone || '-')}</td><td class="num"><span class="pill primary">${fmtQty(c.points || 0)}</span></td><td class="num">${s.visits}</td>
        <td class="num"><b>${money(s.spent)}</b></td><td class="muted nowrap">${s.last ? fmtDateTime(s.last) : '-'}</td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty"><div class="empty-ico">👥</div><p>ยังไม่มีลูกค้า</p></div></td></tr>';
  };
  $('#cu-search', el).addEventListener('input', (e) => { ui.custSearch = e.target.value; draw(); });
  $('#cu-add', el).onclick = () => openCustomerForm(null, () => renderCustomers());
  $('#cu-body', el).onclick = (e) => { const tr = e.target.closest('[data-id]'); if (tr) openCustomerForm(db.customers.find((c) => c.id === tr.dataset.id), () => renderCustomers()); };
  draw();
}

function openCustomerForm(cust, onSaved, prefill = '') {
  const isNew = !cust;
  const c = cust ? { ...cust } : { id: uid(), name: /^\d+$/.test(prefill) ? '' : prefill, phone: /^\d+$/.test(prefill) ? prefill : '', email: '', note: '', points: 0, createdAt: new Date().toISOString() };
  const history = isNew ? [] : db.sales.filter((s) => s.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const m = openModal({
    title: isNew ? 'เพิ่มลูกค้า' : 'ข้อมูลลูกค้า', size: 'md',
    body: `<div class="fields c2">
      <label class="field span2"><span>ชื่อ *</span><input id="cf-name" value="${esc(c.name)}" autofocus></label>
      <label class="field"><span>เบอร์โทร</span><input id="cf-phone" type="tel" value="${esc(c.phone)}"></label>
      <label class="field"><span>อีเมล</span><input id="cf-email" type="email" value="${esc(c.email)}"></label>
      <label class="field"><span>แต้มสะสม</span><input id="cf-points" type="number" step="1" min="0" value="${c.points || 0}"></label>
      <label class="field"><span>หมายเหตุ</span><input id="cf-note" value="${esc(c.note)}"></label>
    </div>
    ${history.length ? `<h4 style="margin:18px 0 8px">ประวัติการซื้อล่าสุด</h4><div class="list" style="margin:0">${history.map((s) => `<button class="list-item" data-sale="${s.id}"><span class="grow"><b>${esc(s.no)}</b><small class="muted">${fmtDateTime(s.date)} · ${s.items.length} รายการ</small></span><b>${money(s.total)}</b>${s.status !== 'paid' ? '<span class="pill danger">คืนเงิน</span>' : ''}</button>`).join('')}</div>` : ''}`,
    footer: `${isNew ? '' : '<button class="btn ghost danger-text" id="cf-del">ลบ</button>'}<span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="cf-save">บันทึก</button>`,
  });
  const el = m.el;
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-sale]'); if (b) openSaleDetail(db.sales.find((s) => s.id === b.dataset.sale)); });
  if (!isNew) $('#cf-del', el).onclick = async () => {
    if (!await confirmDialog(`ลบลูกค้า <b>${esc(c.name)}</b>?`, { danger: true, okText: 'ลบ' })) return;
    db.customers = db.customers.filter((x) => x.id !== c.id);
    if (db.cart.customerId === c.id) db.cart.customerId = null;
    save(); m.close(); renderCart(); if (ui.view === 'customers') renderCustomers();
  };
  const doSave = () => {
    c.name = $('#cf-name', el).value.trim();
    if (!c.name) return toast('กรุณาใส่ชื่อลูกค้า', 'warn');
    c.phone = $('#cf-phone', el).value.trim(); c.email = $('#cf-email', el).value.trim();
    c.note = $('#cf-note', el).value.trim(); c.points = Math.max(0, Math.floor(num($('#cf-points', el).value)));
    if (c.phone && db.customers.some((x) => x.id !== c.id && x.phone === c.phone)) return toast('เบอร์โทรนี้มีในระบบแล้ว', 'error');
    const i = db.customers.findIndex((x) => x.id === c.id);
    if (i >= 0) db.customers[i] = c; else db.customers.push(c);
    save(); m.close(); renderCart();
    if (onSaved) onSaved(c);
    toast('บันทึกลูกค้าแล้ว', 'success');
  };
  $('#cf-save', el).onclick = doSave;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') doSave(); });
}

/* ---------- Settings ---------- */
function renderSettings() {
  const s = db.settings;
  const el = $('#view-settings');
  const inp = (label, key, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input data-s="${key}" type="${type}" value="${esc(s[key])}" ${extra}></label>`;
  const sel = (label, key, opts) => `<label class="field"><span>${label}</span><select data-s="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const sw = (key, title, desc) => `<label class="switch"><input type="checkbox" data-s="${key}" ${s[key] ? 'checked' : ''}><div><b>${title}</b><small>${desc}</small></div></label>`;
  const bytes = new Blob([localStorage.getItem(APP_KEY) || '']).size;

  el.innerHTML = `
    <header class="view-head"><div><h2>ตั้งค่า</h2><p class="muted">การเปลี่ยนแปลงจะถูกบันทึกอัตโนมัติ</p></div></header>
    <div class="settings">
      <div class="card card-pad"><h3>🧩 ประเภทธุรกิจ & โมดูล</h3><div class="fields">
        <div class="type-chips">${(s.businessTypes || [s.businessType]).map((t) => `<span class="pill primary">${esc(businessType(t).icon)} ${esc(businessType(t).label)}</span>`).join('')}</div>
        <button class="btn sm" id="rerun-wizard" style="align-self:flex-start">＋ เพิ่ม / เปลี่ยนประเภทธุรกิจ</button>
        ${sw('useUnits', 'ห้อง / โต๊ะ / รถ / สนาม', 'เปิดบิลตามหน่วย เช็คอิน–เช็คเอาท์ คิดค่าเวลาอัตโนมัติ (รายชั่วโมง/คืน/วัน/เดือน)')}
        ${sw('useBookings', 'การจองล่วงหน้า', 'ปฏิทินว่าง/ไม่ว่าง รับมัดจำ เช็คอินจากการจอง')}
        ${sw('useJobs', 'งานรับ / ออเดอร์', 'ซ่อม ซักรีด สั่งทำ — ใบรับงาน ติดตามสถานะ นัดรับ')}
      </div></div>

      <div class="card card-pad"><h3>🏪 ข้อมูลร้าน</h3><div class="fields c2">
        <div class="span2">${inp('ชื่อร้าน', 'shopName')}</div>
        ${inp('สาขา', 'branch')}${inp('โทรศัพท์', 'phone', 'tel')}
        <div class="span2">${inp('ที่อยู่', 'address')}</div>
        ${inp('เลขประจำตัวผู้เสียภาษี', 'taxId')}${inp('ชื่อพนักงานเริ่มต้น', 'cashier')}
      </div></div>

      <div class="card card-pad"><h3>💰 ราคา & ภาษี</h3><div class="fields c2">
        ${sel('รูปแบบ VAT', 'taxMode', [['inclusive', 'ราคารวม VAT แล้ว'], ['exclusive', 'บวก VAT เพิ่มจากราคา'], ['none', 'ไม่คิด VAT']])}
        ${inp('อัตรา VAT (%)', 'taxRate', 'number', 'step="0.01" min="0"')}
        ${inp('ค่าบริการ / Service charge (%)', 'serviceRate', 'number', 'step="0.01" min="0"')}
        ${sel('ปัดเศษยอดสุทธิ', 'rounding', [[0, 'ไม่ปัดเศษ'], [0.25, 'ปัดทีละ 0.25'], [0.5, 'ปัดทีละ 0.50'], [1, 'ปัดเป็นจำนวนเต็ม']])}
        ${inp('สัญลักษณ์สกุลเงิน', 'currencySymbol', 'text', 'maxlength="4"')}
        ${sel('ทศนิยม', 'decimals', [[0, 'ไม่มี (0)'], [2, '2 ตำแหน่ง']])}
      </div></div>

      <div class="card card-pad"><h3>📱 การชำระเงิน</h3><div class="fields">
        ${inp('พร้อมเพย์ (เบอร์โทร / เลขบัตรประชาชน / เลขผู้เสียภาษี)', 'promptpayId', 'text', 'placeholder="เช่น 0812345678" inputmode="numeric"')}
        <small class="muted">เมื่อระบุ ระบบจะสร้าง QR พร้อมเพย์ตามยอดเงินให้ลูกค้าสแกนในหน้าชำระเงิน</small>
      </div></div>

      <div class="card card-pad"><h3>📦 สต็อก & สมาชิก</h3><div class="fields">
        ${sw('allowNegativeStock', 'อนุญาตให้ขายเมื่อสต็อกหมด', 'สต็อกจะติดลบได้ (เหมาะกับสินค้าสั่งผลิต/พรีออเดอร์)')}
        <div class="fields c2">
          ${inp('จุดแจ้งเตือนเริ่มต้นสำหรับสินค้าใหม่', 'defaultLowStock', 'number', 'min="0"')}
          ${inp(`ยอดซื้อทุก ๆ (${esc(s.currencySymbol)}) = 1 แต้ม`, 'pointsPer', 'number', 'min="0" step="1"')}
        </div>
      </div></div>

      <div class="card card-pad"><h3>🗄️ กะ & ค่าเริ่มต้นสินค้าใหม่</h3><div class="fields">
        ${sw('useShifts', 'ใช้ระบบเปิด–ปิดกะ', 'ใส่เงินทอนตอนเปิดร้าน นับเงินตอนปิดร้าน ระบบบอกว่าเงินขาดหรือเกิน')}
        <div class="fields c2">
          <label class="field"><span>หน่วยนับเริ่มต้น</span><input data-s="defaultUnit" list="settings-units" value="${esc(s.defaultUnit)}"><datalist id="settings-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></label>
        </div>
        ${sw('defaultTrackStock', 'นับสต็อกสินค้าใหม่', 'ปิดถ้าส่วนใหญ่ขายอาหารปรุงสดหรืองานบริการ')}
        ${sw('defaultDecimalQty', 'สินค้าใหม่ขายตามน้ำหนัก/ปริมาณ', 'จำนวนเป็นทศนิยมได้ เช่น 1.25 กก.')}
      </div></div>

      <div class="card card-pad"><h3>🧾 ใบเสร็จ</h3><div class="fields c2">
        ${sel('ขนาดกระดาษ', 'paperWidth', [[80, '80 มม.'], [58, '58 มม.']])}
        ${inp('คำนำหน้าเลขที่บิล', 'invoicePrefix')}
        <div class="span2">${inp('ข้อความท้ายใบเสร็จ', 'receiptFooter')}</div>
        <div class="span2">${sw('autoPrint', 'พิมพ์ใบเสร็จอัตโนมัติ', 'สั่งพิมพ์ทันทีหลังชำระเงินสำเร็จ')}</div>
      </div></div>

      <div class="card card-pad"><h3>🎨 การแสดงผล</h3><div class="fields">
        ${sel('ธีม', 'theme', [['light', 'สว่าง'], ['dark', 'มืด'], ['auto', 'ตามระบบ']])}
        <div class="muted small">คีย์ลัดหน้าขาย: <kbd style="background:var(--panel-2)">F2</kbd> ค้นหา · <kbd style="background:var(--panel-2)">F4</kbd> พักบิล · <kbd style="background:var(--panel-2)">F8</kbd> ลูกค้า · <kbd style="background:var(--panel-2)">F9</kbd> ชำระเงิน · <kbd style="background:var(--panel-2)">Esc</kbd> ปิดหน้าต่าง</div>
      </div></div>

      <div class="card card-pad"><h3>💾 การจัดเก็บข้อมูล <span class="sync-status"></span></h3>
        <div id="storage-info">${Store.mode === 'server' ? '<p class="muted small">กำลังโหลด…</p>' : `
          <div class="notice warn"><b>⚠ ตอนนี้ข้อมูลเก็บอยู่ในเบราว์เซอร์เท่านั้น</b> (${(bytes / 1024).toFixed(0)} KB)<br>
            ถ้าล้างข้อมูลเบราว์เซอร์ ข้อมูลร้านจะหาย — เปลี่ยนไปบันทึกลงไฟล์ถาวรได้ดังนี้:
            <ol><li>กด “ส่งออกข้อมูลสำรอง” ด้านล่าง</li><li>ดับเบิลคลิก <code>Install.cmd</code> ในโฟลเดอร์โปรแกรมเพื่อติดตั้ง แล้วเปิดโปรแกรมจากไอคอน <b>Universal POS</b> บนเดสก์ท็อป</li><li>ไปที่ ตั้งค่า → “นำเข้าข้อมูลสำรอง” แล้วเลือกไฟล์จากข้อ 1</li></ol></div>`}</div>
        <div class="data-actions">
          ${hasDemoData() ? '<button class="btn primary" data-act="remove-demo">🧪 ลบข้อมูลตัวอย่าง (เก็บข้อมูลที่เพิ่มเอง)</button>' : ''}
          <button class="btn" data-act="backup">⬇ ส่งออกข้อมูลสำรอง (.json)</button>
          <button class="btn" data-act="restore">⬆ นำเข้าข้อมูลสำรอง</button>
          <button class="btn" data-act="demo">✨ โหลดข้อมูลตัวอย่าง</button>
          <button class="btn danger-text" data-act="clear-sales">🧹 ล้างประวัติการขายทั้งหมด</button>
          <button class="btn danger-text" data-act="reset">⚠ เริ่มต้นใหม่ (ลบข้อมูลทั้งหมด)</button>
        </div>
      </div>
    </div>`;

  el.onchange = (e) => {
    const t = e.target.closest('[data-s]'); if (!t) return;
    const key = t.dataset.s;
    let val = t.type === 'checkbox' ? t.checked : t.value;
    if (typeof defaultSettings()[key] === 'number') val = Math.max(0, num(val));
    db.settings[key] = val;
    save(); applySettings();
    $('#view-pos').dataset.ready = '';
    toast('บันทึกการตั้งค่าแล้ว', 'success', 1200);
  };

  $('.data-actions', el).addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'remove-demo') return removeDemoData();
    if (act === 'backup') download(`pos-backup-${toISODate(new Date())}.json`, JSON.stringify(db), 'application/json');
    if (act === 'restore') {
      const file = await pickFile('.json,application/json'); if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const d = data && data.data && typeof data.rev === 'number' ? data.data : data;
        if (!d || !d.settings || !Array.isArray(d.products)) throw new Error('invalid');
        if (!await confirmDialog('ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยไฟล์สำรอง ดำเนินการต่อ?', { okText: 'นำเข้า', danger: true })) return;
        replaceAllData(d); toast('นำเข้าข้อมูลสำเร็จ', 'success');
      } catch { toast('ไฟล์ไม่ถูกต้อง', 'error'); }
    }
    const undoNote = Store.mode === 'server' ? 'ระบบจะสำรองข้อมูลเดิมไว้ให้ก่อนอัตโนมัติ' : 'ไม่สามารถย้อนกลับได้';
    if (act === 'demo' && await confirmDialog(`แทนที่ข้อมูลทั้งหมดด้วยข้อมูลตัวอย่าง?<br><small class="muted">${undoNote}</small>`, { okText: 'โหลดตัวอย่าง', danger: true })) {
      const demo = seedDB(true, db.settings.businessTypes); demo.settings = { ...db.settings, setupDone: true };
      replaceAllData(demo); toast('โหลดข้อมูลตัวอย่างแล้ว', 'success');
    }
    if (act === 'clear-sales' && await confirmDialog(`ลบประวัติการขายทั้งหมด? (สต็อกจะไม่ถูกคืน)<br><small class="muted">${undoNote}</small>`, { okText: 'ลบประวัติ', danger: true })) {
      db.sales = []; db.seq.sale = 1; Store.replace = true; save(); renderSettings(); toast('ล้างประวัติการขายแล้ว', 'success');
    }
    if (act === 'reset' && await confirmDialog(`<b>ลบสินค้า ลูกค้า ประวัติการขาย และสต็อกทั้งหมด</b><br>การตั้งค่าร้านจะยังอยู่<br><small class="muted">${undoNote}</small>`, { title: 'เริ่มต้นใหม่', okText: 'ลบทั้งหมด', danger: true })) {
      // ห้อง/โต๊ะ/รถ จะถูกสร้างใหม่ในตัวช่วยตั้งค่า
      const fresh = seedDB(false, db.settings.businessTypes, []); fresh.settings = { ...db.settings, setupDone: false };
      replaceAllData(fresh); openSetupWizard();
    }
  });
  $('#rerun-wizard', el).onclick = openSetupWizard;
  paintSyncStatus();
  loadStorageInfo();
}

function backupLabel(name) {
  let m = name.match(/^daily-(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `รายวัน ${+m[3]}/${+m[2]}/${m[1]}`;
  m = name.match(/^hourly-(\d{4})-(\d{2})-(\d{2})_(\d{2})/);
  if (m) return `รายชั่วโมง ${+m[3]}/${+m[2]} ${m[4]}:00 น.`;
  if (name.startsWith('manual-')) return 'ก่อนนำเข้า / รีเซ็ตข้อมูล';
  return name;
}

async function loadStorageInfo() {
  const box = $('#storage-info');
  if (!box || Store.mode !== 'server') return;
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    box.innerHTML = `
      <div class="notice ok"><b>✅ บันทึกลงไฟล์บนเครื่องอัตโนมัติ</b> — ข้อมูลไม่หายแม้ล้างข้อมูลเบราว์เซอร์<br>
        <small>ไฟล์ข้อมูล: <code>${esc(info.dataFile)}</code><br>บันทึกล่าสุด: ${info.savedAt ? fmtDateTime(info.savedAt) : '-'}<br>
        สำรองอัตโนมัติ (รายชั่วโมง 48 ไฟล์ · รายวัน 90 วัน) ที่ <code>${esc(info.backupDir)}</code></small>
        ${info.canOpenFolder ? '<br><button class="btn sm" id="open-data-folder" style="margin-top:8px">📁 เปิดโฟลเดอร์ข้อมูล</button>' : ''}</div>
      ${info.lan.length ? `<div class="notice"><b>📶 เครื่องอื่นในร้านเปิดใช้ได้ที่</b><br>${info.lan.map((u) => `<code>${esc(u)}</code>`).join('<br>')}</div>` : ''}
      ${info.backups.length ? `<details class="backups"><summary>ไฟล์สำรองอัตโนมัติ (${info.backups.length})</summary><div class="list">
        ${info.backups.slice(0, 40).map((b) => `<div class="list-item"><span class="grow"><b>${backupLabel(b.name)}</b><small class="muted">ข้อมูล ณ ${fmtDateTime(b.mtime)} · ${Math.max(1, Math.round(b.size / 1024))} KB</small></span>
          <a class="btn sm ghost" href="/api/backups/${encodeURIComponent(b.name)}" download="${esc(b.name)}" title="ดาวน์โหลด">⬇</a><button class="btn sm" data-restore="${esc(b.name)}">กู้คืน</button></div>`).join('')}
      </div></details>` : ''}`;
    box.onclick = async (e) => {
      if (e.target.closest('#open-data-folder')) {
        fetch('/api/open-data-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        return;
      }
      const b = e.target.closest('[data-restore]');
      if (!b) return;
      if (!await confirmDialog(`กู้คืนข้อมูลจาก <b>${esc(backupLabel(b.dataset.restore))}</b>?<br><small class="muted">ข้อมูลปัจจุบันจะถูกสำรองไว้ก่อนอัตโนมัติ</small>`, { title: 'กู้คืนข้อมูล', okText: 'กู้คืน', danger: true })) return;
      try {
        const file = await (await fetch(`/api/backups/${encodeURIComponent(b.dataset.restore)}`, { cache: 'no-store' })).json();
        replaceAllData(file.data);
        toast('กู้คืนข้อมูลสำเร็จ', 'success');
      } catch { toast('อ่านไฟล์สำรองไม่ได้', 'error'); }
    };
  } catch {
    box.innerHTML = '<div class="notice warn">เชื่อมต่อโปรแกรม POS ไม่ได้ — ตรวจสอบว่าโปรแกรม Universal POS ยังเปิดอยู่ (ไอคอนที่มุมขวาล่างของจอ)</div>';
  }
}
