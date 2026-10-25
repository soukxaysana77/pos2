'use strict';
/* =========================================================
   Universal POS — หน้าขาย: สินค้า, บิล, ตัวเลือก, ชำระเงิน, ใบเสร็จ
   บิลมี 2 แบบ
   - บิลขายหน้าร้าน (db.cart) เก็บในเครื่องนี้
   - บิลเปิดของห้อง/โต๊ะ/รถ/งานรับ (session.cart) แชร์ทุกเครื่อง มีค่าเวลาและเงินมัดจำ
   ========================================================= */

const needsPicker = (p) => p.variants.length || p.optionGroups.length || p.openPrice || p.decimalQty;
const emptyTab = () => ({ lines: [], discount: { type: 'amount', value: 0 } });

/* ---------- บิลที่กำลังทำงาน ---------- */
const openSessions = () => db.sessions.filter((s) => s.status === 'open');
function activeSession() {
  if (!ui.sessionId) return null;
  const s = db.sessions.find((x) => x.id === ui.sessionId && x.status === 'open');
  if (!s) ui.sessionId = null;
  return s || null;
}
const activeCart = () => activeSession()?.cart || db.cart;

// รายการทั้งหมดของบิลที่กำลังทำงาน (ค่าเวลา + สินค้า) — interim = เก็บเงินระหว่างใช้งาน (ยังไม่ปิดบิล)
function billContext({ interim = false } = {}) {
  const s = activeSession();
  if (!s) return { session: null, lines: db.cart.lines, discount: db.cart.discount, customerId: db.cart.customerId, deposits: [], timeLines: [] };
  const endAt = new Date().toISOString();
  const time = sessionTime(s, endAt, { final: !interim });
  return {
    session: s, interim, endAt, time, timeLines: time.lines, lines: [...time.lines, ...s.cart.lines],
    discount: s.cart.discount, customerId: s.customerId, deposits: interim ? [] : s.deposits || [],
  };
}
const cartTotals = (ctx = billContext()) => calcTotals(ctx.lines, ctx.discount, db.settings);

// หักมัดจำตามลำดับที่รับไว้ ส่วนที่เหลือคืนลูกค้าทางช่องทางเดิม
function allocateDeposits(deposits, total) {
  let left = total;
  const applied = [], refunds = [];
  (deposits || []).forEach((d) => {
    const use = r2(Math.min(num(d.amount), Math.max(0, left)));
    left = r2(left - use);
    if (use > 0) applied.push({ method: 'deposit', via: d.method, amount: use });
    const back = r2(num(d.amount) - use);
    if (back > 0) refunds.push({ method: d.method, amount: back });
  });
  return { applied, refunds, appliedTotal: r2(sum(applied, (x) => x.amount)), refundTotal: r2(sum(refunds, (x) => x.amount)) };
}
const payLabel1 = (p) => (p.method === 'deposit' ? `หักเงินมัดจำ${p.via ? ` (${PAY_METHODS[p.via]?.label || p.via})` : ''}` : PAY_METHODS[p.method]?.label || p.method);

function renderPOS() {
  const el = $('#view-pos');
  if (!el.dataset.ready) {
    el.innerHTML = `
      <div class="pos-left">
        <div class="pos-toolbar">
          <label class="search">${SEARCH_ICON}<input id="pos-search" type="search" placeholder="ค้นหาชื่อ / SKU / สแกนบาร์โค้ด  (F2)" autocomplete="off"></label>
          <button class="btn" id="pos-custom" title="ขายรายการที่ไม่มีในระบบ">＋ รายการอื่น</button>
        </div>
        <div class="demo-banner" id="pos-demo" hidden><span>🧪 <b>กำลังใช้ข้อมูลตัวอย่าง</b> — ลองขายได้เลย เมื่อพร้อมใช้จริงให้ลบข้อมูลตัวอย่างออก</span><button class="btn sm" id="btn-rm-demo">ลบข้อมูลตัวอย่าง</button></div>
        <div class="chips" id="pos-cats"></div>
        <div class="grid-products" id="pos-grid"></div>
      </div>
      <aside class="cart" id="cart">
        <div class="cart-head">
          <div class="grow"><div class="cart-title"><span id="cart-title">บิลปัจจุบัน</span> <small class="sync-status"></small></div><div class="muted small" id="cart-sub"></div></div>
          <div class="row gap-s">
            <button class="btn sm" id="btn-back-board" hidden>‹ กลับผัง</button>
            <button class="btn sm ghost" id="btn-held">บิลที่พัก <span class="badge" id="held-count" hidden></span></button>
            <button class="icon-btn" id="cart-close" aria-label="ปิดตะกร้า">✕</button>
          </div>
        </div>
        <div class="cart-session" id="cart-session" hidden></div>
        <button class="shift-bar" id="btn-shift" hidden></button>
        <button class="cart-customer" id="btn-customer"></button>
        <div class="cart-lines" id="cart-lines"></div>
        <div class="cart-summary" id="cart-summary"></div>
        <div class="cart-actions">
          <button class="btn" id="btn-discount">ส่วนลดบิล</button>
          <button class="btn" id="btn-hold">พักบิล <small class="muted">F4</small></button>
          <button class="btn danger-text" id="btn-clear">ล้างบิล</button>
        </div>
        <div class="cart-pay"><button class="btn primary xl" id="btn-pay">ชำระเงิน</button></div>
      </aside>
      <button class="cart-fab" id="cart-fab"></button>`;

    const search = $('#pos-search');
    search.addEventListener('input', () => { ui.posSearch = search.value; renderPosGrid(); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = search.value.trim();
      if (!q) return;
      if (findByCode(q)) { handleScan(q); search.value = ''; ui.posSearch = ''; renderPosGrid(); return; }
      const list = posFilteredProducts();
      if (list.length === 1) { onProductClick(list[0]); search.value = ''; ui.posSearch = ''; renderPosGrid(); }
      else if (!list.length) toast(`ไม่พบสินค้า "${q}"`, 'error');
    });
    $('#pos-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      ui.posCat = b.dataset.cat; renderPosCats(); renderPosGrid();
    });
    $('#pos-grid').addEventListener('click', (e) => {
      if (e.target.closest('[data-add-first]')) { go('products'); openProductForm(null); return; }
      const b = e.target.closest('[data-pid]');
      if (b) onProductClick(db.products.find((p) => p.id === b.dataset.pid));
    });
    $('#btn-rm-demo').onclick = removeDemoData;
    $('#btn-shift').onclick = () => openShiftPanel();
    $('#cart-lines').addEventListener('click', onCartClick);
    $('#cart-lines').addEventListener('change', (e) => {
      if (!e.target.matches('[data-qty]')) return;
      const line = activeCart().lines.find((l) => l.id === e.target.closest('[data-lid]').dataset.lid);
      if (line) setLineQty(line, num(e.target.value));
    });
    $('#cart-session').addEventListener('click', onSessionPanelClick);
    $('#pos-custom').onclick = openCustomItem;
    $('#btn-held').onclick = openHeldBills;
    $('#btn-back-board').onclick = exitSession;
    $('#btn-customer').onclick = (e) => {
      if (e.target.closest('[data-rm-customer]')) { setBillCustomer(null); return; }
      openCustomerPicker();
    };
    $('#btn-discount').onclick = openBillDiscount;
    $('#btn-hold').onclick = () => {
      const s = activeSession();
      if (!s) return holdBill();
      return s.isJob ? openJobForm(s) : openSessionDetails(s);
    };
    $('#btn-clear').onclick = async () => {
      const s = activeSession();
      if (!activeCart().lines.length) return;
      const msg = s ? 'ล้างรายการสินค้า/บริการทั้งหมดในบิลนี้?<br><small class="muted">ค่าเวลาและเงินมัดจำไม่ถูกลบ</small>' : 'ล้างรายการทั้งหมดในบิลนี้?';
      if (!await confirmDialog(msg, { okText: 'ล้างรายการ', danger: true })) return;
      if (s) { s.cart = emptyTab(); saveCart(); } else { db.cart = emptyCart(); saveCart(); }
    };
    $('#btn-pay').onclick = () => openPayment();
    $('#cart-fab').onclick = () => $('#cart').classList.add('open');
    $('#cart-close').onclick = () => $('#cart').classList.remove('open');
    el.dataset.ready = '1';
    paintSyncStatus();
  }
  renderPosCats();
  renderPosGrid();
  renderCart();
}

function posFilteredProducts() {
  const q = ui.posSearch.trim().toLowerCase();
  return db.products.filter((p) => p.active
    && (ui.posCat === 'all' || p.categoryId === ui.posCat)
    && (!q || [p.name, p.sku, p.barcode, ...p.variants.map((v) => `${v.name} ${v.sku || ''} ${v.barcode || ''}`)].join(' ').toLowerCase().includes(q)));
}

function renderPosCats() {
  const counts = {};
  const active = db.products.filter((p) => p.active);
  active.forEach((p) => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });
  $('#pos-cats').innerHTML = `<button class="chip ${ui.posCat === 'all' ? 'active' : ''}" data-cat="all">ทั้งหมด <small>${active.length}</small></button>`
    + db.categories.map((c) => `<button class="chip ${ui.posCat === c.id ? 'active' : ''}" data-cat="${c.id}"><span>${esc(c.icon)}</span>${esc(c.name)} <small>${counts[c.id] || 0}</small></button>`).join('');
}

function priceLabel(p) {
  if (p.openPrice) return 'ระบุราคา';
  let s;
  if (p.variants.length) {
    const ps = p.variants.map((v) => num(v.price));
    const mn = Math.min(...ps), mx = Math.max(...ps);
    s = mn === mx ? money(mn) : `${money(mn)}+`;
  } else s = money(p.price);
  return p.decimalQty ? `${s}/${esc(p.unit)}` : s;
}

function renderPosGrid() {
  const list = posFilteredProducts();
  const grid = $('#pos-grid');
  $('#pos-demo').hidden = !hasDemoData();
  if (!db.products.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">📦</div><p>ยังไม่มีสินค้าในร้าน</p>
      <small>เพิ่มสินค้าทีละชิ้น หรือนำเข้าจากไฟล์ Excel (CSV) ที่เมนู "สินค้า"</small><br><br>
      <button class="btn primary lg" data-add-first>＋ เพิ่มสินค้าชิ้นแรก</button></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-ico">🔍</div><p>ไม่พบสินค้า</p><small>ลองเปลี่ยนคำค้นหาหรือหมวดหมู่</small></div>';
    return;
  }
  grid.innerHTML = list.map((p) => {
    const cat = getCat(p.categoryId);
    const stock = totalStock(p);
    let stockHtml = '';
    if (p.trackStock) {
      const cls = stock <= 0 ? 'out' : stock <= num(p.lowStock) ? 'low' : '';
      stockHtml = `<span class="stock ${cls}">${stock <= 0 ? 'หมด' : 'เหลือ ' + fmtQty(stock)}</span>`;
    }
    const out = p.trackStock && stock <= 0 && !db.settings.allowNegativeStock;
    return `<button class="pcard ${out ? 'is-out' : ''}" data-pid="${p.id}" style="--cc:${cat.color}">
      <div class="pimg">${p.image ? `<img src="${p.image}" alt="">` : `<span>${esc(p.emoji || '📦')}</span>`}${p.variants.length ? `<em class="tag">${p.variants.length} แบบ</em>` : ''}</div>
      <div class="pname">${esc(p.name)}</div>
      <div class="pmeta"><span class="price">${priceLabel(p)}</span>${stockHtml}</div>
    </button>`;
  }).join('');
}

/* ---------- Cart operations ---------- */
// บิลหน้าร้านเก็บในเครื่องนี้ — บิลเปิดของห้อง/โต๊ะต้องบันทึกลงข้อมูลกลางเพื่อให้ทุกเครื่องเห็น
function saveCart() {
  if (activeSession()) save(); else writeLocal();
  renderCart();
}

// จำนวนที่อยู่ในบิลต่าง ๆ แล้ว (บิลหน้าร้าน + บิลเปิดทั้งหมด) เพื่อกันขายเกินสต็อก
function inCartQty(pid, vid, exceptLineId) {
  const carts = [db.cart, ...openSessions().map((s) => s.cart)];
  return sum(carts.flatMap((c) => c.lines), (l) => (l.productId === pid && (l.variantId || null) === (vid || null) && l.id !== exceptLineId ? num(l.qty) : 0));
}

function canSell(p, v, qty, exceptLineId) {
  if (!p || !p.trackStock || db.settings.allowNegativeStock) return true;
  const avail = (v ? num(v.stock) : num(p.stock)) - inCartQty(p.id, v ? v.id : null, exceptLineId);
  if (qty > avail + 1e-9) {
    toast(`สต็อกไม่พอ — ${p.name}${v ? ` (${v.name})` : ''} คงเหลือ ${fmtQty(Math.max(0, avail))} ${p.unit}`, 'error');
    return false;
  }
  return true;
}

function onProductClick(p) {
  if (!p) return;
  if (needsPicker(p)) openItemPicker(p);
  else addToCart(p, null, [], 1, num(p.price));
}

function handleScan(code) {
  const r = findByCode(code);
  if (!r) { toast(`ไม่พบสินค้ารหัส ${code}`, 'error'); return false; }
  const { p, v } = r;
  if (v && !p.optionGroups.length && !p.openPrice && !p.decimalQty) addToCart(p, v, [], 1, num(v.price));
  else if (needsPicker(p)) openItemPicker(p, v);
  else addToCart(p, null, [], 1, num(p.price));
  return true;
}

function addToCart(p, v, options, qty, price, note = '') {
  if (!canSell(p, v, qty)) return false;
  const cart = activeCart();
  const key = [p.id, v ? v.id : '', options.map((o) => `${o.group}:${o.name}`).join('|'), price, note].join('#');
  let line = cart.lines.find((l) => l.key === key);
  if (line) line.qty = r3(num(line.qty) + qty);
  else {
    line = {
      id: uid(), key, productId: p.id, variantId: v ? v.id : null, name: p.name, variantName: v ? v.name : '',
      options, unit: p.unit, qty: r3(qty), price: r2(price), cost: variantCost(p, v),
      discountType: 'amount', discountValue: 0, taxable: p.taxable !== false, note, decimalQty: !!p.decimalQty, categoryId: p.categoryId,
    };
    cart.lines.push(line);
  }
  ui.flashLine = line.id;
  saveCart();
  return true;
}

function removeLine(line) {
  const cart = activeCart();
  cart.lines = cart.lines.filter((l) => l !== line);
  saveCart();
}

function setLineQty(line, q) {
  if (!line.decimalQty) q = Math.round(q);
  q = r3(q);
  if (q <= 0) { removeLine(line); return; }
  const p = db.products.find((x) => x.id === line.productId);
  const v = p && line.variantId ? p.variants.find((x) => x.id === line.variantId) : null;
  if (q > line.qty && !canSell(p, v, q, line.id)) { renderCart(); return; }
  line.qty = q;
  saveCart();
}

function onCartClick(e) {
  if (e.target.closest('[data-time]')) {
    const s = activeSession();
    if (s) openSessionDetails(s);
    return;
  }
  const row = e.target.closest('[data-lid]');
  if (!row) return;
  const line = activeCart().lines.find((l) => l.id === row.dataset.lid);
  if (!line) return;
  const step = line.decimalQty ? 0.1 : 1;
  if (e.target.closest('[data-inc]')) setLineQty(line, num(line.qty) + step);
  else if (e.target.closest('[data-dec]')) setLineQty(line, num(line.qty) - step);
  else if (e.target.closest('.line-main')) openLineEditor(line);
}

function setBillCustomer(id) {
  const s = activeSession();
  const c = db.customers.find((x) => x.id === id);
  if (s) {
    s.customerId = c ? c.id : null;
    s.guestName = c ? c.name : ''; s.guestPhone = c ? c.phone || '' : '';
  } else db.cart.customerId = c ? c.id : null;
  saveCart();
}

/* ---------- แผงข้อมูลบิลเปิด (ห้อง/โต๊ะ/รถ/งานรับ) ---------- */
const canInterim = (s) => !s.isJob && ['night', 'day', 'month'].includes(s.pricing?.mode) && (s.timeOverride == null || s.timeOverride === '');

function sessionPanelHTML(s) {
  const L = kindLabels(s.kind);
  const now = Date.now();
  const late = s.plannedEndAt && new Date(s.plannedEndAt) < now;
  const times = s.isJob
    ? `รับงาน ${fmtDateTime(s.startAt)}${s.job?.dueAt ? ` · นัดรับ ${fmtDateTime(s.job.dueAt)}` : ''}`
    : `${L.start} ${fmtDateTime(s.startAt)}${s.plannedEndAt ? ` · ${L.end} ${fmtDateTime(s.plannedEndAt)}` : ''}`;
  const dep = depositTotal(s);
  const js = s.isJob ? JOB_STATUS[s.job?.status] : null;
  const extra = [
    s.billedFrom && s.billedFrom !== s.startAt ? `✅ ชำระแล้วถึง ${fmtDateTime(s.billedFrom)}` : '',
    dep ? `🔐 มัดจำ ${money(dep)}` : '',
  ].filter(Boolean).join(' · ');
  return `${s.isJob && s.job?.title ? `<div class="sess-title">${js ? `<span class="pill ${js.cls}">${js.label}</span> ` : ''}${esc(s.job.title)}</div>` : ''}
    <div class="sess-times">${times}${late ? ` <span class="pill danger">เกินกำหนด ${fmtDuration((now - new Date(s.plannedEndAt)) / 60000)}</span>` : ''}</div>
    ${extra ? `<div class="sess-times">${extra}</div>` : ''}
    <div class="sess-actions">
      <button class="btn sm" data-sact="details" title="แก้ไขข้อมูล ขยายเวลา ราคาพิเศษ รับมัดจำเพิ่ม">✏️ แก้ไข</button>
      ${s.isJob ? '<button class="btn sm" data-sact="ticket">🖨 ใบรับงาน</button>' : '<button class="btn sm" data-sact="move">⇄ ย้าย</button>'}
      <button class="btn sm" data-sact="prebill">🧾 ใบแจ้งยอด</button>
      ${canInterim(s) ? '<button class="btn sm" data-sact="interim" title="เก็บค่าห้อง/ค่าเช่าถึงตอนนี้ โดยยังไม่ปิดบิล">💵 เก็บเงินถึงวันนี้</button>' : ''}
    </div>`;
}

function onSessionPanelClick(e) {
  const a = e.target.closest('[data-sact]')?.dataset.sact;
  const s = activeSession();
  if (!a || !s) return;
  if (a === 'back') exitSession();
  else if (a === 'details') { if (s.isJob) openJobForm(s); else openSessionDetails(s); }
  else if (a === 'move') openMoveSession(s);
  else if (a === 'prebill') printPreBill();
  else if (a === 'interim') openPayment({ interim: true });
  else if (a === 'ticket') printJobTicket(s);
}

function renderCart() {
  if (!$('#cart-lines')) return;
  const sess = activeSession();
  const ctx = billContext();
  const c = activeCart(), s = db.settings, t = cartTotals(ctx);
  const dep = allocateDeposits(ctx.deposits, t.total);
  const due = r2(t.total - dep.appliedTotal);
  const cust = db.customers.find((x) => x.id === ctx.customerId);
  const L = sess ? kindLabels(sess.kind) : null;

  $('#cart').classList.toggle('is-session', !!sess);
  $('#cart-title').textContent = sess ? `${sess.icon || ''} ${sess.isJob ? `งาน ${sess.no}` : sess.unitName}` : 'บิลปัจจุบัน';
  $('#cart-sub').textContent = sess
    ? `บิลเปิด ${sess.isJob ? '' : sess.no} · ${c.lines.length} รายการ`
    : `${c.lines.length} รายการ · ${fmtQty(sum(c.lines, (l) => l.decimalQty ? 1 : num(l.qty)))} ชิ้น`;
  $('#btn-held').hidden = !!sess;
  const back = $('#btn-back-board');
  back.hidden = !sess;
  if (sess) back.textContent = `‹ กลับ${sess.isJob ? 'งานรับ' : 'ผัง'}`;
  const panel = $('#cart-session');
  panel.hidden = !sess;
  if (sess) panel.innerHTML = sessionPanelHTML(sess);

  // ในบิลห้อง/โต๊ะ ซ่อนแถบกะเพื่อให้เห็นรายการมากขึ้น (ถ้ายังไม่เปิดกะ ระบบจะถามตอนชำระเงิน)
  const sb = $('#btn-shift');
  sb.hidden = !s.useShifts || !!sess;
  if (s.useShifts && !sess) {
    const sh = currentShift();
    sb.classList.toggle('closed', !sh);
    sb.innerHTML = sh
      ? `<span>🟢</span><span class="grow">กะ #${sh.no} · ${esc(sh.cashier)} <small class="muted">เปิด ${fmtTime(sh.openedAt)} น.</small></span><span class="small">นับเงิน / ปิดกะ ›</span>`
      : '<span>🔒</span><span class="grow"><b>ยังไม่ได้เปิดกะ</b> <small>แตะเพื่อเปิดกะและใส่เงินทอน</small></span><span>›</span>';
  }

  const cb = $('#btn-customer');
  const guest = cust || (sess && sess.guestName ? { name: sess.guestName, phone: sess.guestPhone } : null);
  cb.classList.toggle('has', !!guest);
  cb.innerHTML = guest
    ? `<span>👤</span><span class="grow"><b>${esc(guest.name)}</b><small class="muted">${esc(guest.phone || '')}${cust ? ` · ${fmtQty(cust.points || 0)} แต้ม` : ''}</small></span><span class="icon-btn sm" data-rm-customer title="นำออก">✕</span>`
    : `<span>👤</span><span class="grow">เลือกลูกค้า / สมาชิก <small>(F8)</small></span><span>›</span>`;

  const timeHTML = ctx.timeLines.map((l) => `<div class="line time" data-time title="แตะเพื่อแก้ไขเวลา/ราคา">
      <div class="line-main"><div class="line-name">⏱ ${esc(l.name)}</div><div class="line-opts">${esc(l.note)}</div><div class="line-price">${fmtQty(l.qty)} ${esc(l.unit)} × ${money(l.price)}</div></div>
      <div></div><div class="line-total">${money(lineTotal(l))}</div></div>`).join('');
  const itemsHTML = c.lines.map((l) => {
    const opts = l.options.map((o) => o.name + (o.price ? ` +${money(o.price, false)}` : '')).join(', ');
    const disc = lineDiscount(l);
    return `<div class="line ${ui.flashLine === l.id ? 'flash' : ''}" data-lid="${l.id}">
      <div class="line-main" title="แตะเพื่อแก้ไข">
        <div class="line-name">${esc(l.name)} ${l.variantName ? `<small>${esc(l.variantName)}</small>` : ''}</div>
        ${opts || l.note ? `<div class="line-opts">${esc(opts)}${opts && l.note ? ' · ' : ''}${l.note ? '📝 ' + esc(l.note) : ''}</div>` : ''}
        <div class="line-price">${money(l.price)}${l.decimalQty ? ' / ' + esc(l.unit) : ''}${disc ? ` · <span class="neg">ลด ${money(disc)}</span>` : ''}</div>
      </div>
      <div class="qty"><button data-dec aria-label="ลด">−</button><input data-qty value="${fmtQty(l.qty).replace(/,/g, '')}" inputmode="decimal" aria-label="จำนวน"><button data-inc aria-label="เพิ่ม">+</button></div>
      <div class="line-total">${money(lineTotal(l))}</div>
    </div>`;
  }).join('');
  const empty = sess
    ? `<div class="empty small"><p>ยังไม่มีรายการเพิ่มเติม</p><small>แตะสินค้าทางซ้ายเพื่อเพิ่มเข้าบิล${sess.isJob ? 'งานนี้' : ` ${esc(sess.unitName)}`}</small></div>`
    : '<div class="empty"><div class="empty-ico">🧺</div><p>ยังไม่มีสินค้าในบิล</p><small>แตะสินค้าหรือสแกนบาร์โค้ดเพื่อเริ่มขาย</small></div>';
  $('#cart-lines').innerHTML = timeHTML + (itemsHTML || empty);
  ui.flashLine = null;

  const rows = [[`ยอดรวม`, money(t.subtotal)]];
  if (t.discount) rows.push([`ส่วนลดบิล${c.discount.type === 'percent' ? ` ${c.discount.value}%` : ''}`, '−' + money(t.discount), 'neg']);
  if (t.service) rows.push([`ค่าบริการ ${s.serviceRate}%`, money(t.service)]);
  if (s.taxMode === 'exclusive') rows.push([`VAT ${s.taxRate}%`, money(t.tax)]);
  else if (s.taxMode === 'inclusive' && t.tax) rows.push([`(รวม VAT ${s.taxRate}% แล้ว)`, money(t.tax)]);
  if (t.rounding) rows.push(['ปัดเศษ', (t.rounding > 0 ? '+' : '−') + money(Math.abs(t.rounding))]);
  let summary = rows.map(([a, b, cls]) => `<div class="sum-row ${cls || ''}"><span>${a}</span><b>${b}</b></div>`).join('');
  if (dep.appliedTotal || dep.refundTotal) {
    // มีมัดจำ: แสดงยอดสุทธิเป็นบรรทัดปกติ แล้วเน้นยอดที่ต้องชำระเพิ่ม/ต้องคืน เป็นตัวใหญ่ตัวเดียว
    summary += `${rows.length > 1 || t.total !== t.subtotal ? `<div class="sum-row"><span>ยอดสุทธิ</span><b>${money(t.total)}</b></div>` : ''}
      ${dep.appliedTotal ? `<div class="sum-row neg"><span>หักเงินมัดจำ</span><b>−${money(dep.appliedTotal)}</b></div>` : ''}
      <div class="sum-total"><span>${dep.refundTotal ? 'คืนเงินมัดจำ' : 'ต้องชำระเพิ่ม'}</span><b>${money(dep.refundTotal || due)}</b></div>`;
  } else summary += `<div class="sum-total"><span>ยอดสุทธิ</span><b>${money(t.total)}</b></div>`;
  $('#cart-summary').innerHTML = summary;

  const hasBill = !!sess || ctx.lines.length > 0 || ctx.deposits.length > 0;
  const payBtn = $('#btn-pay');
  payBtn.innerHTML = `${sess ? L.close : 'ชำระเงิน'} <span>${!hasBill ? '' : dep.refundTotal ? `(คืนมัดจำ ${money(dep.refundTotal)})` : money(due)}</span><kbd>F9</kbd>`;
  payBtn.disabled = !hasBill;
  $('#btn-hold').innerHTML = sess ? '✏️ รายละเอียด' : 'พักบิล <small class="muted">F4</small>';
  $('#btn-clear').textContent = sess ? 'ล้างรายการ' : 'ล้างบิล';
  const hc = $('#held-count');
  hc.hidden = !db.held.length; hc.textContent = db.held.length;
  const fab = $('#cart-fab');
  fab.innerHTML = sess
    ? `<span>${esc(sess.icon || '')} ${esc(sess.isJob ? sess.no : sess.unitName)}</span><span>${money(due)} ›</span>`
    : `<span>🛒 ${c.lines.length} รายการ</span><span>${money(t.total)} ›</span>`;
  fab.hidden = !sess && !c.lines.length;
}

/* ---------- Item picker (variants / options / weight / open price) ---------- */
function openItemPicker(p, presetVariant = null) {
  const s = db.settings;
  const st = {
    vi: -1,
    sel: p.optionGroups.map((g) => (g.required && !g.multi && g.options.length ? [0] : [])),
  };
  if (p.variants.length) {
    st.vi = presetVariant ? p.variants.indexOf(presetVariant) : p.variants.findIndex((v) => !p.trackStock || num(v.stock) > 0);
    if (st.vi < 0) st.vi = 0;
  }
  const qtyStep = p.decimalQty ? 0.1 : 1;
  const body = `
    ${p.variants.length ? `<div class="pk-sec"><div class="pk-label">เลือกแบบ</div><div class="opt-grid" id="pk-vars">${p.variants.map((v, i) => `
      <button class="opt ${i === st.vi ? 'active' : ''}" data-vi="${i}"><b>${esc(v.name)}</b>${p.openPrice ? '' : `<span>${money(v.price)}</span>`}${p.trackStock ? `<small class="${num(v.stock) <= 0 ? 'out' : ''}">เหลือ ${fmtQty(v.stock)}</small>` : ''}</button>`).join('')}</div></div>` : ''}
    ${p.optionGroups.map((g, gi) => `<div class="pk-sec"><div class="pk-label">${esc(g.name)} ${g.required ? '<span class="req">* จำเป็น</span>' : ''}<span class="muted small">${g.multi ? 'เลือกได้หลายอย่าง' : 'เลือก 1 อย่าง'}</span></div>
      <div class="opt-grid" data-gi="${gi}">${g.options.map((o, oi) => `<button class="opt ${st.sel[gi].includes(oi) ? 'active' : ''}" data-oi="${oi}"><b>${esc(o.name)}</b>${num(o.price) ? `<span>+${money(o.price)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
    <div class="fields c2">
      ${p.openPrice ? `<label class="field"><span>ราคาต่อ${esc(p.unit)} (${esc(s.currencySymbol)})</span><input id="pk-price" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00" autofocus></label>` : ''}
      <label class="field"><span>จำนวน (${esc(p.unit)})</span><div class="stepper"><button type="button" data-step="-1">−</button><input id="pk-qty" type="number" min="0" step="${p.decimalQty ? '0.001' : '1'}" value="1" inputmode="decimal" ${!p.openPrice && p.decimalQty ? 'autofocus' : ''}><button type="button" data-step="1">+</button></div></label>
      ${p.decimalQty ? `<label class="field"><span>หรือคิดตามจำนวนเงิน (${esc(s.currencySymbol)})</span><input id="pk-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="เช่น 50"></label>` : ''}
      <label class="field ${p.decimalQty && !p.openPrice ? '' : 'span2'}"><span>หมายเหตุ</span><input id="pk-note" placeholder="เช่น ไม่ใส่ผัก, ห่อกลับบ้าน"></label>
    </div>`;
  const m = openModal({
    title: `${esc(p.emoji || '')} ${esc(p.name)}`, size: 'md', body,
    footer: `<div class="pk-total">รวม <b id="pk-total"></b></div><span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary lg" id="pk-add">เพิ่มลงบิล</button>`,
  });
  const el = m.el;
  const qtyIn = $('#pk-qty', el), priceIn = $('#pk-price', el), amtIn = $('#pk-amount', el);
  const variant = () => (st.vi >= 0 ? p.variants[st.vi] : null);
  const optionsSel = () => st.sel.flatMap((arr, gi) => arr.map((oi) => ({ group: p.optionGroups[gi].name, name: p.optionGroups[gi].options[oi].name, price: num(p.optionGroups[gi].options[oi].price) })));
  const unitPrice = () => {
    const v = variant();
    const base = p.openPrice ? num(priceIn.value) : v ? num(v.price) : num(p.price);
    return r2(base + sum(optionsSel(), (o) => o.price));
  };
  const update = () => { $('#pk-total', el).textContent = money(unitPrice() * num(qtyIn.value)); };

  el.addEventListener('click', (e) => {
    const vb = e.target.closest('[data-vi]');
    if (vb) {
      st.vi = +vb.dataset.vi;
      $$('#pk-vars .opt', el).forEach((b) => b.classList.toggle('active', +b.dataset.vi === st.vi));
    }
    const ob = e.target.closest('[data-oi]');
    if (ob) {
      const gi = +ob.parentElement.dataset.gi, oi = +ob.dataset.oi, g = p.optionGroups[gi];
      const cur = st.sel[gi];
      if (g.multi) st.sel[gi] = cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi];
      else st.sel[gi] = cur.includes(oi) && !g.required ? [] : [oi];
      $$('.opt', ob.parentElement).forEach((b) => b.classList.toggle('active', st.sel[gi].includes(+b.dataset.oi)));
    }
    const sb = e.target.closest('[data-step]');
    if (sb) { qtyIn.value = Math.max(0, r3(num(qtyIn.value) + qtyStep * +sb.dataset.step)); if (amtIn) amtIn.value = ''; }
    if (vb || ob || sb) { if (amtIn && amtIn.value) syncAmount(); update(); }
  });
  const syncAmount = () => { const up = unitPrice(); if (up > 0 && amtIn.value) qtyIn.value = r3(num(amtIn.value) / up); };
  qtyIn.addEventListener('input', () => { if (amtIn) amtIn.value = ''; update(); });
  if (priceIn) priceIn.addEventListener('input', () => { if (amtIn && amtIn.value) syncAmount(); update(); });
  if (amtIn) amtIn.addEventListener('input', () => { syncAmount(); update(); });

  const add = () => {
    for (let gi = 0; gi < p.optionGroups.length; gi++) {
      if (p.optionGroups[gi].required && !st.sel[gi].length) return toast(`กรุณาเลือก "${p.optionGroups[gi].name}"`, 'warn');
    }
    if (p.openPrice && num(priceIn.value) <= 0) { priceIn.focus(); return toast('กรุณาระบุราคา', 'warn'); }
    let qty = r3(qtyIn.value);
    if (!p.decimalQty) qty = Math.round(qty);
    if (qty <= 0) { qtyIn.focus(); return toast('กรุณาระบุจำนวน', 'warn'); }
    if (addToCart(p, variant(), optionsSel(), qty, unitPrice(), $('#pk-note', el).value.trim())) m.close();
  };
  $('#pk-add', el).onclick = add;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); add(); } });
  update();
}

/* ---------- Line editor ---------- */
function openLineEditor(line) {
  const m = openModal({
    title: `แก้ไขรายการ: ${esc(line.name)}${line.variantName ? ` (${esc(line.variantName)})` : ''}`, size: 'sm',
    body: `<div class="fields">
      <label class="field"><span>จำนวน (${esc(line.unit)})</span><input id="le-qty" type="number" step="${line.decimalQty ? '0.001' : '1'}" min="0" value="${line.qty}" autofocus></label>
      <label class="field"><span>ราคาต่อหน่วย</span><input id="le-price" type="number" step="0.01" min="0" value="${line.price}"></label>
      <div class="field"><span>ส่วนลดรายการ</span>
        <div class="input-group"><input id="le-disc" type="number" step="0.01" min="0" value="${num(line.discountValue) || ''}" placeholder="0">
        <div class="seg" id="le-dtype"><button class="${line.discountType !== 'percent' ? 'active' : ''}" data-t="amount">${esc(db.settings.currencySymbol)}</button><button class="${line.discountType === 'percent' ? 'active' : ''}" data-t="percent">%</button></div></div>
      </div>
      <label class="field"><span>หมายเหตุ</span><input id="le-note" value="${esc(line.note)}"></label>
    </div>`,
    footer: `<button class="btn ghost danger-text" id="le-del">ลบรายการ</button><span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="le-save">บันทึก</button>`,
  });
  const el = m.el;
  let dtype = line.discountType || 'amount';
  $('#le-dtype', el).onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    dtype = b.dataset.t;
    $$('#le-dtype button', el).forEach((x) => x.classList.toggle('active', x === b));
  };
  $('#le-del', el).onclick = () => { removeLine(line); m.close(); };
  const doSave = () => {
    line.price = r2(num($('#le-price', el).value));
    line.discountType = dtype;
    line.discountValue = num($('#le-disc', el).value);
    line.note = $('#le-note', el).value.trim();
    m.close();
    setLineQty(line, num($('#le-qty', el).value));
  };
  $('#le-save', el).onclick = doSave;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') doSave(); });
}

/* ---------- Bill discount ---------- */
function openBillDiscount() {
  const cart = activeCart();
  const d = cart.discount;
  let type = d.type;
  const sym = esc(db.settings.currencySymbol);
  const m = openModal({
    title: 'ส่วนลดท้ายบิล', size: 'sm',
    body: `<div class="seg" id="bd-type" style="margin-bottom:12px"><button data-t="amount" class="${type === 'amount' ? 'active' : ''}">จำนวนเงิน (${sym})</button><button data-t="percent" class="${type === 'percent' ? 'active' : ''}">เปอร์เซ็นต์ (%)</button></div>
      <input id="bd-value" type="number" min="0" step="0.01" class="pay-input" value="${num(d.value) || ''}" placeholder="0" autofocus>
      <div class="quick" id="bd-quick"></div>
      <p class="muted small">ยอดรวมก่อนส่วนลด ${money(cartTotals().subtotal)}</p>`,
    footer: `<button class="btn ghost danger-text" id="bd-remove">ไม่มีส่วนลด</button><span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="bd-save">ใช้ส่วนลด</button>`,
  });
  const el = m.el;
  const drawQuick = () => {
    const vals = type === 'percent' ? [5, 10, 15, 20, 30, 50] : [10, 20, 50, 100, 200, 500];
    $('#bd-quick', el).innerHTML = vals.map((v) => `<button data-v="${v}">${type === 'percent' ? v + '%' : money(v)}</button>`).join('');
  };
  drawQuick();
  $('#bd-type', el).onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    type = b.dataset.t;
    $$('#bd-type button', el).forEach((x) => x.classList.toggle('active', x === b));
    drawQuick();
  };
  $('#bd-quick', el).onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) $('#bd-value', el).value = b.dataset.v; };
  const apply = (value) => { activeCart().discount = { type, value: Math.max(0, value) }; saveCart(); m.close(); };
  $('#bd-remove', el).onclick = () => apply(0);
  $('#bd-save', el).onclick = () => apply(num($('#bd-value', el).value));
  $('#bd-value', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(num(e.target.value)); });
}

/* ---------- Custom (non-catalog) item ---------- */
function openCustomItem() {
  const m = openModal({
    title: 'เพิ่มรายการอื่น ๆ (ไม่มีในระบบ)', size: 'sm',
    body: `<div class="fields">
      <label class="field"><span>ชื่อรายการ</span><input id="ci-name" value="${activeSession() ? 'ค่าบริการอื่น ๆ' : 'สินค้าอื่น ๆ'}"></label>
      <div class="fields c2">
        <label class="field"><span>ราคาต่อหน่วย</span><input id="ci-price" type="number" step="0.01" min="0" autofocus placeholder="0.00"></label>
        <label class="field"><span>จำนวน</span><input id="ci-qty" type="number" step="0.001" min="0" value="1"></label>
      </div>
      <label class="switch"><input type="checkbox" id="ci-tax" checked><div><b>คิดภาษี</b></div></label>
    </div>`,
    footer: `<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="ci-add">เพิ่มลงบิล</button>`,
  });
  const el = m.el;
  const add = () => {
    const price = r2($('#ci-price', el).value), qty = r3($('#ci-qty', el).value);
    if (price <= 0 || qty <= 0) return toast('กรุณาระบุราคาและจำนวน', 'warn');
    activeCart().lines.push({
      id: uid(), key: uid(), productId: null, variantId: null, name: $('#ci-name', el).value.trim() || 'สินค้าอื่น ๆ', variantName: '', options: [],
      unit: 'หน่วย', qty, price, cost: 0, discountType: 'amount', discountValue: 0, taxable: $('#ci-tax', el).checked, note: '', decimalQty: true, categoryId: '',
    });
    saveCart(); m.close();
  };
  $('#ci-add', el).onclick = add;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') add(); });
}

/* ---------- Customers ---------- */
// onPick = ทำอะไรเมื่อเลือกลูกค้า (ค่าเริ่มต้น: ใส่ลูกค้าในบิลที่กำลังทำงาน)
function openCustomerPicker(onPick = setBillCustomer) {
  const m = openModal({
    title: 'เลือกลูกค้า / สมาชิก', size: 'md',
    body: `<div class="row gap-s"><label class="search grow">${SEARCH_ICON}<input id="cp-search" placeholder="ค้นหาชื่อหรือเบอร์โทร" autofocus></label><button class="btn primary" id="cp-new">＋ ลูกค้าใหม่</button></div><div class="list" id="cp-list"></div>`,
  });
  const el = m.el;
  const draw = () => {
    const q = $('#cp-search', el).value.trim().toLowerCase();
    const list = db.customers.filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q));
    $('#cp-list', el).innerHTML = list.map((c) => `<button class="list-item" data-id="${c.id}"><span class="thumb">👤</span><span class="grow"><b>${esc(c.name)}</b><small class="muted">${esc(c.phone || '-')}</small></span><span class="pill primary">${fmtQty(c.points || 0)} แต้ม</span></button>`).join('')
      || '<div class="empty"><p>ไม่พบลูกค้า</p></div>';
  };
  draw();
  $('#cp-search', el).addEventListener('input', draw);
  $('#cp-list', el).onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    m.close(); onPick(b.dataset.id);
  };
  $('#cp-new', el).onclick = () => openCustomerForm(null, (c) => { m.close(); onPick(c.id); }, $('#cp-search', el).value);
}

/* ---------- Held bills ---------- */
function holdBill() {
  if (activeSession()) return;
  if (!db.cart.lines.length) return toast('ไม่มีรายการให้พักบิล', 'warn');
  const cust = db.customers.find((c) => c.id === db.cart.customerId);
  db.held.push({ id: uid(), at: new Date().toISOString(), cart: structuredClone(db.cart), total: cartTotals().total, label: cust ? cust.name : `บิลพัก #${db.held.length + 1}` });
  db.cart = emptyCart();
  save(); renderCart();
  toast('พักบิลแล้ว', 'success');
}

function openHeldBills() {
  if (!db.held.length) return toast('ไม่มีบิลที่พักไว้', 'info');
  const m = openModal({ title: 'บิลที่พักไว้', size: 'md', body: '<div class="list" id="hb-list" style="margin-top:0"></div>' });
  const draw = () => {
    if (!db.held.length) return m.close();
    $('#hb-list', m.el).innerHTML = db.held.map((h) => `<div class="list-item" data-id="${h.id}">
      <span class="grow"><b>${esc(h.label)}</b><small class="muted">${fmtDateTime(h.at)} · ${h.cart.lines.length} รายการ</small></span>
      <b>${money(h.total)}</b><button class="btn sm primary" data-recall>เรียกคืน</button><button class="icon-btn" data-del title="ลบ">🗑</button></div>`).join('');
  };
  draw();
  $('#hb-list', m.el).onclick = async (e) => {
    const row = e.target.closest('[data-id]'); if (!row) return;
    const h = db.held.find((x) => x.id === row.dataset.id);
    if (e.target.closest('[data-del]')) {
      if (await confirmDialog(`ลบ "${esc(h.label)}"?`, { danger: true, okText: 'ลบ' })) { db.held = db.held.filter((x) => x !== h); save(); renderCart(); draw(); }
    } else if (e.target.closest('[data-recall]')) {
      db.held = db.held.filter((x) => x !== h);
      if (db.cart.lines.length) holdBill();
      db.cart = h.cart;
      save(); renderCart(); m.close();
      toast('เรียกคืนบิลแล้ว', 'success');
    }
  };
}

/* ---------- Payment ---------- */
async function openPayment(opts = {}) {
  const ctx = billContext(opts);
  if (!ctx.lines.length && !ctx.deposits.length) {
    if (!ctx.session || opts.interim) return toast('ยังไม่มีรายการในบิล', 'warn');
    // บิลเปิดที่ไม่มียอดค้าง (ชำระล่วงหน้าครบแล้ว / เปิดโต๊ะแต่ไม่ได้สั่ง) — ปิดได้เลยโดยไม่ออกใบเสร็จ
    const s = ctx.session, L = kindLabels(s.kind);
    const msg = s.isJob
      ? `งาน <b>${esc(s.no)}</b> ยังไม่มีค่าบริการ/อะไหล่<br><small class="muted">ถ้าเป็นงานไม่คิดเงิน (เช่น ซ่อมในประกัน) กดส่งมอบได้เลย — หรือกดยกเลิกแล้วเพิ่มรายการก่อน</small>`
      : `${L.close} <b>${esc(s.unitName)}</b>?<br><small class="muted">ไม่มียอดค้างชำระ</small>`;
    if (!await confirmDialog(msg, { okText: s.isJob ? 'ส่งมอบโดยไม่คิดเงิน' : L.close })) return;
    closeSession(s, ctx, null);
    save(); renderCart(); toast(s.isJob ? `ส่งมอบงาน ${s.no} แล้ว` : `${L.close} ${s.unitName} แล้ว`, 'success');
    ui.unitsTab = s.isJob ? 'jobs' : 'board';
    return go('units');
  }
  if (db.settings.useShifts && !currentShift()) return openShiftStart(() => openPayment(opts));
  const t = cartTotals(ctx);
  const dep = allocateDeposits(ctx.deposits, t.total);
  const due = r2(t.total - dep.appliedTotal);
  const sess = ctx.session;
  const title = !sess ? 'ชำระเงิน'
    : opts.interim ? `เก็บเงินถึงตอนนี้ — ${esc(sess.unitName)}`
      : `${kindLabels(sess.kind).close} — ${esc(sess.isJob ? sess.no : sess.unitName)}`;
  const depNote = dep.appliedTotal ? ` · ยอดรวม ${money(t.total)} หักมัดจำ ${money(dep.appliedTotal)}` : '';

  // มัดจำครอบคลุมทั้งหมด — ไม่ต้องรับเงินเพิ่ม (อาจต้องคืนส่วนเกิน)
  if (due <= 0) {
    const m = openModal({
      title, size: 'sm',
      body: `<div class="pay-due"><span>ยอดรวม</span><strong>${money(t.total)}</strong><small style="opacity:.75">หักเงินมัดจำ ${money(dep.appliedTotal)}</small></div>
        ${dep.refundTotal ? `<div class="pay-stat change" style="margin-top:12px"><span>คืนเงินมัดจำให้ลูกค้า<br><small>${dep.refunds.map((r) => `${PAY_METHODS[r.method]?.label} ${money(r.amount)}`).join(' · ')}</small></span><b>${money(dep.refundTotal)}</b></div>` : '<p class="muted">ไม่มียอดที่ต้องชำระเพิ่ม</p>'}`,
      footer: '<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary lg" id="pay-ok" autofocus>ยืนยัน ⏎</button>',
    });
    $('#pay-ok', m.el).onclick = () => { m.close(); completeSale(ctx, [], 0, dep); };
    return;
  }

  const st = { method: 'cash', payments: [], input: '' };
  const m = openModal({
    title, size: 'lg',
    body: `<div class="pay">
      <div>
        <div class="pay-due"><span>ยอดที่ต้องชำระ</span><strong>${money(due)}</strong><small style="opacity:.7">${ctx.lines.length} รายการ${t.discount ? ` · ส่วนลด ${money(t.discount)}` : ''}${depNote}</small></div>
        <div class="pay-list" id="pay-list"></div>
        <div class="pay-status" id="pay-status"></div>
      </div>
      <div>
        <div class="pay-methods" id="pay-methods">${Object.entries(PAY_METHODS).filter(([, v]) => !v.internal).map(([k, v]) => `<button data-m="${k}" class="${k === 'cash' ? 'active' : ''}">${v.icon} ${v.label}</button>`).join('')}</div>
        <input id="pay-input" class="pay-input" inputmode="decimal" placeholder="${money(due, false)}" autocomplete="off" autofocus>
        <div class="quick" id="pay-quick"></div>
        <div class="pay-qr" id="pay-qr" hidden></div>
        <div class="keypad" id="pay-keypad">${['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      </div>
    </div>`,
    footer: `<button class="btn ghost" data-cancel>ยกเลิก</button><span class="grow"></span><button class="btn" id="pay-split" title="บันทึกยอดนี้แล้วชำระส่วนที่เหลือด้วยวิธีอื่น">＋ แบ่งชำระ</button><button class="btn primary lg" id="pay-confirm">ยืนยันการชำระ ⏎</button>`,
  });
  const el = m.el;
  const input = $('#pay-input', el);
  const paid = () => r2(sum(st.payments, (p) => p.amount));
  const remaining = () => r2(Math.max(0, due - paid()));

  const draw = () => {
    const rem = remaining();
    input.placeholder = money(rem, false);
    $('#pay-list', el).innerHTML = st.payments.map((p, i) => `<div class="pay-row"><span>${PAY_METHODS[p.method].icon} ${PAY_METHODS[p.method].label}</span><b>${money(p.amount)}</b><button class="icon-btn sm" data-rm="${i}">✕</button></div>`).join('');
    const tender = st.input === '' ? rem : num(st.input);
    const after = r2(paid() + tender - due);
    let html = '';
    if (st.payments.length) html += `<div class="pay-stat"><span>ชำระแล้ว</span><b>${money(paid())}</b></div>`;
    if (after >= 0) html += st.method === 'cash'
      ? `<div class="pay-stat change"><span>เงินทอน</span><b>${money(after)}</b></div>`
      : '<div class="pay-stat change"><span>ยอดครบแล้ว</span><b>✓</b></div>';
    else html += `<div class="pay-stat remain"><span>ยังขาดอีก</span><b>${money(-after)}</b></div>`;
    $('#pay-status', el).innerHTML = html;

    let quick = [];
    if (st.method === 'cash' && rem > 0) {
      quick = [rem];
      [20, 50, 100, 500, 1000].forEach((n) => { const v = Math.ceil(rem / n) * n; if (v > rem && !quick.includes(v)) quick.push(v); });
      quick = quick.sort((a, b) => a - b).slice(0, 6);
    } else if (rem > 0) quick = [rem];
    $('#pay-quick', el).innerHTML = quick.map((v, i) => `<button data-q="${v}">${i === 0 ? 'พอดี ' : ''}${money(v)}</button>`).join('');

    const qr = $('#pay-qr', el);
    const showQR = st.method === 'transfer' && db.settings.promptpayId && rem > 0;
    qr.hidden = !showQR;
    const amt = st.input === '' ? rem : Math.min(num(st.input), rem);
    if (showQR && qr.dataset.amt !== String(amt)) {
      qr.dataset.amt = String(amt);
      qr.innerHTML = `<b>สแกนจ่ายผ่านพร้อมเพย์</b><div class="qr-box" id="qr-box"></div><small>${esc(db.settings.promptpayId)} · ${money(amt)}</small>`;
      if (window.QRCode) new QRCode($('#qr-box', qr), { text: promptpayPayload(db.settings.promptpayId, amt), width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
      else $('#qr-box', qr).innerHTML = '<small>โหลดตัวสร้าง QR ไม่ได้ (ต้องเชื่อมต่ออินเทอร์เน็ต)</small>';
    }
    $('#pay-confirm', el).textContent = after >= 0 ? 'ยืนยันการชำระ ⏎' : 'บันทึกยอดนี้ ⏎';
  };

  const addPayment = () => {
    const rem = remaining();
    let amt = st.input === '' ? rem : num(st.input);
    if (amt <= 0) return false;
    if (st.method !== 'cash') amt = Math.min(amt, rem);
    st.payments.push({ method: st.method, amount: r2(amt) });
    st.input = ''; input.value = '';
    return true;
  };
  const finish = () => {
    const change = r2(Math.max(0, paid() - due));
    m.close();
    completeSale(ctx, st.payments, change, dep);
  };
  const confirm = () => {
    if (remaining() <= 0 && st.input === '') return finish();
    if (!addPayment()) return toast('กรุณาระบุจำนวนเงิน', 'warn');
    if (paid() + 0.0001 >= due) finish();
    else { draw(); toast(`ยังขาดอีก ${money(remaining())}`, 'warn'); input.focus(); }
  };

  $('#pay-methods', el).onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    st.method = b.dataset.m;
    $$('#pay-methods button', el).forEach((x) => x.classList.toggle('active', x === b));
    draw(); input.focus();
  };
  $('#pay-quick', el).onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; st.input = b.dataset.q; input.value = b.dataset.q; draw(); };
  $('#pay-keypad', el).onclick = (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (k === '⌫') st.input = st.input.slice(0, -1);
    else if (k === '.' && st.input.includes('.')) return;
    else st.input += k;
    input.value = st.input; draw();
  };
  $('#pay-list', el).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { st.payments.splice(+b.dataset.rm, 1); draw(); } };
  input.addEventListener('input', () => { st.input = input.value.replace(/[^\d.]/g, ''); draw(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
  $('#pay-split', el).onclick = () => {
    if (st.input === '' || num(st.input) <= 0) return toast('ระบุจำนวนเงินของวิธีนี้ก่อน แล้วค่อยเลือกวิธีถัดไป', 'warn');
    if (num(st.input) >= remaining()) return confirm();
    addPayment(); draw(); input.focus();
  };
  $('#pay-confirm', el).onclick = confirm;
  draw();
}

function completeSale(ctx, payments, change, dep = { applied: [], refunds: [] }) {
  const s = db.settings;
  const sess = ctx.session;
  const cust = db.customers.find((c) => c.id === ctx.customerId);
  const allPayments = [...dep.applied, ...payments];
  const shiftId = currentShift()?.id || null;
  const sale = buildSale(ctx.lines, ctx.discount, s, {
    no: nextInvoiceNo(), payments: allPayments, paid: r2(sum(allPayments, (p) => p.amount)), change,
    customerId: cust ? cust.id : null, customerName: cust ? cust.name : (sess?.guestName || ''), note: db.cart.note || '',
    cashier: currentCashier(), shiftId,
  });
  if (dep.refunds.length) sale.depositRefunds = dep.refunds.map((r) => ({ ...r, at: sale.date, shiftId }));
  if (sess) {
    Object.assign(sale, { sessionId: sess.id, sessionNo: sess.no, unitId: sess.unitId || null, unitName: sess.isJob ? '' : sess.unitName, isJob: !!sess.isJob, interim: !!ctx.interim });
    if (!sess.isJob && ctx.time) {
      sale.stay = { from: ctx.time.from, to: ctx.endAt, units: ctx.time.units, unitLabel: ctx.time.unitLabel, mode: sess.pricing?.mode };
      // เก็บช่วงที่คิดเงินไว้ เผื่อคืนเงินบิลนี้ภายหลังจะได้คิดค่าห้องช่วงนี้ใหม่
      if (ctx.interim) Object.assign(sale.stay, { billedFrom: sess.billedFrom || sess.startAt, billedUntil: ctx.time.until });
    }
    if (sess.isJob) sale.jobTitle = sess.job?.title || '';
  }
  const demoIds = new Set(db.products.filter((p) => p.demo).map((p) => p.id));
  if (sess?.demo || sale.items.some((i) => demoIds.has(i.productId))) sale.demo = true;
  sale.items.forEach((it) => applyStock(it.productId, it.variantId, -it.qty, 'sale', sale.no));
  if (cust && num(s.pointsPer) > 0) {
    sale.pointsEarned = Math.floor(sale.total / num(s.pointsPer));
    cust.points = (cust.points || 0) + sale.pointsEarned;
  }
  db.sales.push(sale);
  if (sess) { if (ctx.interim) markInterimPaid(sess, ctx, sale); else closeSession(sess, ctx, sale); }
  else db.cart = emptyCart();
  save();
  renderPosGrid(); renderCart(); updateBadges();
  $('#cart')?.classList.remove('open');
  showSaleDone(sale, { backTo: sess && !ctx.interim ? (sess.isJob ? 'jobs' : 'board') : null });
  if (s.autoPrint) printReceipt(sale);
}

function showSaleDone(sale, { backTo = null } = {}) {
  const refund = sum(sale.depositRefunds || [], (r) => r.amount);
  const m = openModal({
    title: sale.interim ? 'เก็บเงินเรียบร้อย' : 'ชำระเงินสำเร็จ', size: 'sm',
    body: `<div class="done">
      <div class="done-ico">✓</div>
      <h3>${money(sale.total)}</h3>
      <div class="muted">เลขที่ ${esc(sale.no)}${sale.unitName || sale.isJob ? ` · ${esc(sale.unitName || sale.sessionNo)}` : ''} ·${sale.payments.map(payLabel1).join(' + ') || '—'}</div>
      ${sale.change > 0 ? `<div class="change-box">เงินทอน<b>${money(sale.change)}</b></div>` : ''}
      ${refund > 0 ? `<div class="change-box">คืนเงินมัดจำ<b>${money(refund)}</b><small>${sale.depositRefunds.map((r) => PAY_METHODS[r.method]?.label).join(' + ')}</small></div>` : ''}
      ${sale.pointsEarned ? `<p class="muted">${esc(sale.customerName)} ได้รับ ${sale.pointsEarned} แต้ม</p>` : ''}
    </div>`,
    footer: `<button class="btn" id="sd-view">ดูใบเสร็จ</button><button class="btn" id="sd-print">🖨 พิมพ์</button><button class="btn primary" id="sd-new" autofocus>${backTo ? `กลับไป${backTo === 'jobs' ? 'งานรับ' : 'หน้าผัง'} ⏎` : sale.interim ? 'กลับไปที่บิล ⏎' : 'บิลใหม่ ⏎'}</button>`,
  });
  $('#sd-print', m.el).onclick = () => printReceipt(sale);
  $('#sd-view', m.el).onclick = () => { m.close(); openSaleDetail(sale); };
  $('#sd-new', m.el).onclick = () => {
    m.close();
    if (backTo) { ui.unitsTab = backTo; go('units'); } else $('#pos-search')?.focus();
  };
}

/* ---------- Receipt / ใบแจ้งยอด ---------- */
function receiptHTML(sale) {
  const s = db.settings;
  const rows = [['รวมเป็นเงิน', money(sale.subtotal, false)]];
  if (sale.discount) rows.push(['ส่วนลด', '-' + money(sale.discount, false)]);
  if (sale.service) rows.push([`ค่าบริการ ${sale.serviceRate}%`, money(sale.service, false)]);
  if (sale.taxMode === 'exclusive') rows.push([`VAT ${sale.taxRate}%`, money(sale.tax, false)]);
  if (sale.rounding) rows.push(['ปัดเศษ', money(sale.rounding, false)]);
  const title = sale.preview ? 'ใบแจ้งยอด (ยังไม่ได้ชำระ)'
    : s.taxId && sale.taxMode !== 'none' ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน';
  const heldDeposit = num(sale.depositHeld);
  return `<div class="receipt ${+s.paperWidth === 58 ? 'w58' : ''}">
    <div class="r-center">
      <div class="r-shop">${esc(s.shopName)}</div>
      ${s.branch ? `<div>${esc(s.branch)}</div>` : ''}
      ${s.address ? `<div>${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div>โทร ${esc(s.phone)}</div>` : ''}
      ${s.taxId ? `<div>เลขประจำตัวผู้เสียภาษี ${esc(s.taxId)}</div>` : ''}
      <div class="r-title">${title}</div>
    </div>
    <div class="r-row"><span>${sale.preview ? '' : `เลขที่ ${esc(sale.no)}`}</span><span>${fmtDateTime(sale.date)}</span></div>
    <div class="r-row"><span>พนักงาน: ${esc(sale.cashier || '-')}</span>${sale.customerName ? `<span>ลูกค้า: ${esc(sale.customerName)}</span>` : ''}</div>
    ${sale.unitName ? `<div class="r-row"><span>${esc(sale.unitName)}</span>${sale.stay ? `<span>${fmtDateTime(sale.stay.from)} – ${fmtDateTime(sale.stay.billedUntil || sale.stay.to)}</span>` : ''}</div>` : ''}
    ${sale.isJob ? `<div class="r-row"><span>เลขที่งาน ${esc(sale.sessionNo || '')}</span></div>${sale.jobTitle ? `<div class="r-sub">${esc(sale.jobTitle)}</div>` : ''}` : ''}
    ${sale.interim ? '<div class="r-sub">* ชำระระหว่างใช้บริการ (ยังไม่ปิดบิล)</div>' : ''}
    <hr class="r-hr">
    ${sale.items.map((it) => `<div>
      <div class="r-row"><span>${esc(it.name)}${it.variantName ? ` (${esc(it.variantName)})` : ''}</span><span>${money(it.total, false)}</span></div>
      <div class="r-sub">${fmtQty(it.qty)} ${esc(it.unit)} × ${money(it.price, false)}${it.discount ? ` ลด ${money(it.discount, false)}` : ''}</div>
      ${it.options.length ? `<div class="r-sub">+ ${esc(it.options.map((o) => o.name).join(', '))}</div>` : ''}
      ${it.note ? `<div class="r-sub">* ${esc(it.note)}</div>` : ''}
    </div>`).join('')}
    <hr class="r-hr">
    ${rows.map(([a, b]) => `<div class="r-row"><span>${a}</span><span>${b}</span></div>`).join('')}
    <div class="r-row r-total"><span>ยอดสุทธิ</span><span>${money(sale.total)}</span></div>
    ${sale.taxMode === 'inclusive' && sale.tax ? `<div class="r-row"><span>มูลค่าก่อน VAT / VAT ${sale.taxRate}%</span><span>${money(sale.total - sale.tax, false)} / ${money(sale.tax, false)}</span></div>` : ''}
    <hr class="r-hr">
    ${sale.preview
      ? `${heldDeposit ? `<div class="r-row"><span>เงินมัดจำที่รับไว้</span><span>${money(heldDeposit, false)}</span></div><div class="r-row r-total"><span>${heldDeposit > sale.total ? 'คืนเงินมัดจำ' : 'ยอดที่ต้องชำระ'}</span><span>${money(Math.abs(sale.total - heldDeposit))}</span></div>` : ''}`
      : `${sale.payments.map((p) => `<div class="r-row"><span>${payLabel1(p)}</span><span>${money(p.amount, false)}</span></div>`).join('')}
        ${sale.change ? `<div class="r-row"><span>เงินทอน</span><span>${money(sale.change, false)}</span></div>` : ''}
        ${(sale.depositRefunds || []).map((r) => `<div class="r-row"><span>คืนเงินมัดจำ (${PAY_METHODS[r.method]?.label || r.method})</span><span>${money(r.amount, false)}</span></div>`).join('')}
        ${sale.pointsEarned ? `<div class="r-row"><span>แต้มสะสมที่ได้รับ</span><span>${sale.pointsEarned}</span></div>` : ''}`}
    ${sale.status === 'refunded' ? '<div class="r-void">*** ยกเลิก / คืนเงินแล้ว ***</div>' : ''}
    ${s.receiptFooter && !sale.preview ? `<div class="r-center r-foot">${esc(s.receiptFooter)}</div>` : ''}
  </div>`;
}

function printReceipt(sale) {
  $('#print-area').innerHTML = receiptHTML(sale);
  setTimeout(() => window.print(), 60);
}

// ใบแจ้งยอด: แสดงยอดปัจจุบันของบิลเปิดก่อนชำระ (เช่น เช็คบิลโต๊ะ, ให้แขกตรวจสอบก่อนเช็คเอาท์)
function printPreBill() {
  const ctx = billContext();
  const sess = ctx.session;
  const sale = buildSale(ctx.lines, ctx.discount, db.settings, {
    no: '', preview: true, cashier: currentCashier(),
    customerName: db.customers.find((c) => c.id === ctx.customerId)?.name || sess?.guestName || '',
    unitName: sess && !sess.isJob ? sess.unitName : '', isJob: !!sess?.isJob, sessionNo: sess?.no, jobTitle: sess?.job?.title,
    stay: sess && !sess.isJob && ctx.time ? { from: ctx.time.from, to: ctx.endAt } : null,
    depositHeld: sum(ctx.deposits, (d) => num(d.amount)),
  });
  printReceipt(sale);
}
