'use strict';
/* =========================================================
   Universal POS — ตัวช่วยตั้งค่าร้าน (เลือกประเภทธุรกิจได้หลายแบบ) & ข้อมูลตัวอย่าง
   ========================================================= */

// มีข้อมูลที่ร้านใช้งานจริงแล้วหรือไม่ (ถ้ามี ตัวช่วยจะเพิ่มของใหม่ ไม่ลบของเดิม)
const hasRealShopData = () => db.products.some((p) => !p.demo) || db.sales.some((s) => !s.demo)
  || db.sessions.some((s) => !s.demo) || db.units.length > 0;

function openSetupWizard() {
  const s = db.settings;
  const keep = hasRealShopData();
  const prevTypes = keep ? [...(s.businessTypes || [s.businessType || 'general'])] : [];
  const st = {
    step: 0,
    shopName: s.shopName === 'ร้านของฉัน' ? '' : s.shopName,
    phone: s.phone, address: s.address,
    types: s.setupDone ? [...(s.businessTypes || [])] : [],
    taxMode: s.setupDone ? s.taxMode : 'none', taxId: s.taxId, promptpayId: s.promptpayId,
    useShifts: s.useShifts !== false,
    start: 'empty',
    plan: {},
  };
  // ประเภทที่ต้องสร้างห้อง/โต๊ะ/รถ (ถ้ามีข้อมูลเดิมแล้ว สร้างเฉพาะประเภทที่เพิ่มใหม่)
  const planTypes = () => st.types.filter((t) => businessType(t).units && !prevTypes.includes(t));
  const steps = () => [
    ['shop', 'ร้านของคุณ'], ['types', 'ประเภทธุรกิจ'],
    ...(planTypes().length ? [['units', 'ห้อง / โต๊ะ / รถ']] : []),
    ['tax', 'ภาษี & การรับเงิน'],
    ...(keep ? [] : [['start', 'เริ่มต้นใช้งาน']]),
  ];
  const m = openModal({
    title: s.setupDone ? 'ตั้งค่าร้าน & ประเภทธุรกิจ' : 'ตั้งค่าร้านครั้งแรก', size: 'lg', dismissible: !!s.setupDone,
    body: '<div class="wz-steps" id="wz-steps"></div><div id="wz-body"></div>',
    footer: '<button class="btn ghost" id="wz-back">‹ ย้อนกลับ</button><span class="grow"></span><button class="btn primary lg" id="wz-next">ถัดไป ›</button>',
  });
  const el = m.el;
  const body = $('#wz-body', el);
  const choice = (name, value, active, icon, title, desc, extra = '') => `<button type="button" class="choice ${active ? 'active' : ''} ${extra}" data-choice="${name}" data-value="${value}">
    <span class="choice-ico">${icon}</span><span><b>${title}</b><small>${desc}</small></span></button>`;

  const collect = () => {
    $$('[data-f]', body).forEach((i) => { st[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
    $$('.plan-row', body).forEach((r) => {
      const p = st.plan[r.dataset.t] = st.plan[r.dataset.t] || {};
      $$('[data-pf]', r).forEach((i) => { p[i.dataset.pf] = i.value; });
    });
  };

  const paintSteps = () => {
    const list = steps();
    st.step = Math.min(st.step, list.length - 1);
    $('#wz-steps', el).innerHTML = list.map(([, t], i) => `<span class="${i === st.step ? 'active' : i < st.step ? 'done' : ''}"><i>${i < st.step ? '✓' : i + 1}</i>${t}</span>`).join('');
    $('#wz-back', el).style.visibility = st.step ? 'visible' : 'hidden';
    $('#wz-next', el).textContent = st.step === list.length - 1 ? (keep ? 'บันทึก ✓' : 'เริ่มใช้งาน ✓') : 'ถัดไป ›';
    return list[st.step][0];
  };
  const draw = () => {
    const key = paintSteps();

    if (key === 'shop') {
      body.innerHTML = `<div class="wz-intro"><div class="wz-wave">👋</div><div><h2>${s.setupDone ? 'ข้อมูลร้าน' : 'ยินดีต้อนรับ!'}</h2><p class="muted">ตอบคำถามสั้น ๆ ระบบจะตั้งค่าให้เหมาะกับธุรกิจของคุณ (แก้ไขภายหลังได้ที่เมนูตั้งค่า)</p></div></div>
        <div class="fields">
          <label class="field"><span>ชื่อร้าน / ชื่อกิจการ *</span><input data-f="shopName" value="${esc(st.shopName)}" placeholder="เช่น ร้านป้าแดง, บ้านสวนรีสอร์ท, สมชายรถเช่า" autofocus></label>
          <div class="fields c2">
            <label class="field"><span>เบอร์โทร</span><input data-f="phone" type="tel" value="${esc(st.phone)}" placeholder="ไม่บังคับ"></label>
            <label class="field"><span>ที่อยู่ (พิมพ์บนใบเสร็จ)</span><input data-f="address" value="${esc(st.address)}" placeholder="ไม่บังคับ"></label>
          </div>
        </div>`;
    } else if (key === 'types') {
      body.innerHTML = `<p class="wz-q">ธุรกิจของคุณเป็นแบบไหน? <span class="pill primary">เลือกได้มากกว่า 1 แบบ</span></p>
        <p class="muted small">เช่น รีสอร์ทที่มีร้านอาหารและให้เช่ารถ → เลือก "โรงแรม / รีสอร์ท" + "ร้านอาหาร" + "รถเช่า"</p>
        ${BUSINESS_SECTIONS.map(([sec, title]) => `<div class="wz-section"><h4>${title}</h4><div class="choices compact">
          ${Object.entries(BUSINESS_TYPES).filter(([, t]) => t.section === sec).map(([k, t]) => choice('type', k, st.types.includes(k), t.icon, t.label, t.desc, prevTypes.includes(k) ? 'locked' : '')).join('')}
        </div></div>`).join('')}
        <p class="muted small">ไม่เจอธุรกิจของคุณ? เลือก "อื่น ๆ ที่คิดตามเวลา / ให้เช่า" หรือ "อื่น ๆ / ขายหลายอย่าง" แล้วตั้งชื่อและราคาเองได้ทั้งหมด</p>`;
    } else if (key === 'units') {
      body.innerHTML = `<p class="wz-q">มีกี่ห้อง / โต๊ะ / คัน และคิดราคาเท่าไร?</p>
        <p class="muted small">ใส่คร่าว ๆ ก่อนได้ — เปลี่ยนชื่อ ราคา แบ่งกลุ่ม (เช่น ห้องดีลักซ์) และตั้งราคาตามช่วงเวลาได้ภายหลังที่เมนูผัง → จัดการ</p>
        ${planTypes().map((t) => {
          const bt = businessType(t), preset = bt.units, k = unitKind(preset.kind);
          const p = st.plan[t] || { count: preset.count, prefix: preset.prefix, start: preset.start, price: k.pricing.price };
          st.plan[t] = p;
          return `<div class="plan-row" data-t="${t}">
            <div class="plan-head"><span class="choice-ico">${bt.icon}</span><div><b>${esc(bt.label)}</b><small class="muted">${esc(k.label)}</small></div></div>
            <div class="fields c4">
              <label class="field"><span>จำนวน (${esc(k.noun)})</span><input data-pf="count" type="number" min="0" max="500" value="${esc(p.count)}"></label>
              <label class="field"><span>ชื่อขึ้นต้น</span><input data-pf="prefix" value="${esc(p.prefix)}"></label>
              <label class="field"><span>เริ่มที่เลข</span><input data-pf="start" type="number" min="0" value="${esc(p.start)}"></label>
              ${k.pricing.mode !== 'none' ? `<label class="field"><span>ราคา/${PRICING_MODES[k.pricing.mode].per}${k.pricing.perPerson ? '/คน' : ''}</span><input data-pf="price" type="number" min="0" step="0.01" value="${esc(p.price)}"></label>` : '<div class="field"><span>ราคา</span><small class="muted" style="padding-top:10px">คิดจากรายการที่สั่ง</small></div>'}
            </div>
            <p class="plan-rules">📋 กติกาการคิดเงิน: <span data-rules>${esc(pricingSummary({ ...k.pricing, price: num(p.price) }))}</span><br><small class="muted">เปลี่ยนเวลา ค่าออกช้า หรือตั้งราคาตามช่วงเวลาได้ภายหลังที่ ผัง → จัดการ / ราคา</small></p></div>`;
        }).join('')}`;
    } else if (key === 'tax') {
      body.innerHTML = `<p class="wz-q">จดทะเบียนภาษีมูลค่าเพิ่ม (VAT) หรือไม่?</p>
        <div class="choices c1">
          ${choice('taxMode', 'none', st.taxMode === 'none', '🙅', 'ไม่ได้จด VAT', 'ร้านทั่วไปส่วนใหญ่ — ไม่คิดภาษีในบิล')}
          ${choice('taxMode', 'inclusive', st.taxMode === 'inclusive', '🧾', 'จด VAT — ราคาที่ตั้งรวม VAT แล้ว', 'ใบเสร็จแสดง VAT 7% ที่รวมอยู่ในราคา')}
          ${choice('taxMode', 'exclusive', st.taxMode === 'exclusive', '➕', 'จด VAT — บวก VAT เพิ่มตอนคิดเงิน', 'ราคา + 7% ตอนชำระเงิน')}
        </div>
        <div class="fields c2" style="margin-top:14px">
          <label class="field" ${st.taxMode === 'none' ? 'hidden' : ''} id="wz-taxid"><span>เลขประจำตัวผู้เสียภาษี</span><input data-f="taxId" value="${esc(st.taxId)}" inputmode="numeric" placeholder="13 หลัก"></label>
          <label class="field"><span>พร้อมเพย์สำหรับรับโอน</span><input data-f="promptpayId" value="${esc(st.promptpayId)}" inputmode="numeric" placeholder="เบอร์โทรหรือเลขบัตรประชาชน"></label>
        </div>
        <label class="switch" style="margin-top:10px"><input type="checkbox" data-f="useShifts" ${st.useShifts ? 'checked' : ''}>
          <div><b>นับเงินในลิ้นชักเมื่อเปิด–ปิดร้าน (เปิด–ปิดกะ)</b><small>ใส่เงินทอนตอนเปิดร้าน ตอนปิดร้านนับเงินแล้วระบบบอกว่าขาดหรือเกิน</small></div></label>`;
    } else {
      const cats = presetCategories(st.types).map((c) => c.name);
      body.innerHTML = `<p class="wz-q">จะเริ่มต้นอย่างไรดี?</p>
        <div class="choices c1">
          ${choice('start', 'empty', st.start === 'empty', '✨', 'เริ่มใหม่ ใส่สินค้า/บริการเอง', `สร้างหมวดหมู่ให้ ${cats.length} หมวด: ${cats.slice(0, 8).join(', ')}${cats.length > 8 ? ' …' : ''}`)}
          ${choice('start', 'demo', st.start === 'demo', '🧪', 'ลองใช้กับข้อมูลตัวอย่างก่อน', 'มีสินค้า ยอดขาย ห้องที่มีแขก และการจองตัวอย่างให้ลองกด — ลบทิ้งได้ด้วยปุ่มเดียว')}
          ${choice('start', 'restore', st.start === 'restore', '📂', 'มีไฟล์สำรองข้อมูลอยู่แล้ว', 'นำเข้าข้อมูลร้านจากไฟล์ .json ที่ส่งออกไว้')}
        </div>`;
    }
    $('.modal-body', el).scrollTop = 0; // เริ่มแต่ละขั้นที่ด้านบนเสมอ
    setTimeout(() => $('[autofocus]', body)?.focus(), 30);
  };

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-choice]');
    if (!b) return;
    collect();
    const { choice: name, value } = b.dataset;
    if (name === 'type') {
      if (prevTypes.includes(value)) return toast('ประเภทที่ใช้อยู่แล้วเอาออกจากตรงนี้ไม่ได้ — ปิดโมดูลได้ที่หน้าตั้งค่า', 'info', 3500);
      st.types = st.types.includes(value) ? st.types.filter((t) => t !== value) : [...st.types, value];
      b.classList.toggle('active', st.types.includes(value));
      paintSteps();
      return;
    }
    st[name] = value;
    $$(`[data-choice="${name}"]`, body).forEach((x) => x.classList.toggle('active', x === b));
    const taxId = $('#wz-taxid', body);
    if (taxId) taxId.hidden = st.taxMode === 'none';
  });
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('#wz-next', el).click(); });
  // อัปเดตข้อความกติกาการคิดเงินเมื่อแก้ราคา
  body.addEventListener('input', (e) => {
    const row = e.target.closest('.plan-row');
    if (!row || e.target.dataset.pf !== 'price') return;
    const k = unitKind(businessType(row.dataset.t).units.kind);
    $('[data-rules]', row).textContent = pricingSummary({ ...k.pricing, price: num(e.target.value) });
  });
  $('#wz-back', el).onclick = () => { collect(); st.step = Math.max(0, st.step - 1); draw(); };
  $('#wz-next', el).onclick = async () => {
    collect();
    const key = steps()[st.step][0];
    if (key === 'shop' && !st.shopName) { $('[data-f="shopName"]', body).focus(); return toast('กรุณาใส่ชื่อร้าน', 'warn'); }
    if (key === 'types' && !st.types.length) return toast('เลือกประเภทธุรกิจอย่างน้อย 1 แบบ', 'warn');
    if (st.step < steps().length - 1) { st.step++; draw(); return; }
    if (await finishSetup(st, { keep, prevTypes, planTypes: planTypes() })) m.close();
  };
  draw();
}

async function finishSetup(st, { keep, planTypes }) {
  const shopSettings = {
    shopName: st.shopName, phone: st.phone, address: st.address,
    taxMode: st.taxMode, taxId: st.taxMode === 'none' ? '' : st.taxId, promptpayId: st.promptpayId,
    useShifts: !!st.useShifts, setupDone: true,
  };
  const plan = planTypes.map((t) => {
    const preset = businessType(t).units, v = st.plan[t] || {};
    return { kind: preset.kind, group: preset.group, count: v.count ?? preset.count, prefix: v.prefix ?? preset.prefix, start: v.start ?? preset.start, price: v.price ?? unitKind(preset.kind).pricing.price };
  }).filter((p) => num(p.count) > 0);
  ui.posCat = 'all';
  ui.view = plan.length || st.types.some((t) => businessType(t).jobs) ? 'units' : 'pos';
  ui.unitsTab = plan.length ? 'board' : 'jobs';

  if (st.start === 'restore' && !keep) {
    const file = await pickFile('.json,application/json');
    if (!file) return false;
    try {
      const data = migrate(JSON.parse(await file.text()));
      if (!Array.isArray(data.products)) throw new Error('invalid');
      data.settings.setupDone = true;
      ui.view = 'pos';
      replaceAllData(data);
      toast('นำเข้าข้อมูลร้านเรียบร้อย', 'success');
      return true;
    } catch {
      toast('ไฟล์ไม่ถูกต้อง — เลือกไฟล์ .json ที่ได้จากปุ่ม "ส่งออกข้อมูลสำรอง"', 'error', 5000);
      return false;
    }
  }

  if (keep) {
    // มีข้อมูลจริงอยู่แล้ว — ปรับการตั้งค่าและเพิ่มของใหม่ ไม่ลบของเดิม
    const types = [...new Set([...(db.settings.businessTypes || []), ...st.types])];
    const old = { useUnits: db.settings.useUnits, useBookings: db.settings.useBookings, useJobs: db.settings.useJobs };
    Object.assign(db.settings, shopSettings);
    applyBusinessDefaults(db.settings, types);
    ['useUnits', 'useBookings', 'useJobs'].forEach((k) => { db.settings[k] = db.settings[k] || old[k]; });
    presetCategories(types).forEach((c) => { if (!db.categories.some((x) => x.name === c.name)) db.categories.push(c); });
    db.units.push(...unitsFromPlan(plan));
    save(); renderAll();
    toast('บันทึกการตั้งค่าแล้ว', 'success');
    return true;
  }
  const fresh = seedDB(st.start === 'demo', st.types, plan);
  fresh.settings = { ...db.settings, ...shopSettings };
  applyBusinessDefaults(fresh.settings, st.types);
  replaceAllData(fresh);
  showSetupDone(st.start === 'demo');
  return true;
}

function showSetupDone(demo) {
  const s = db.settings;
  const steps = [];
  if (s.useUnits && db.units.length) {
    const L = kindLabels(db.units[0].kind);
    steps.push(`<li><b>เมนู "${esc(unitsMenuTitle())}"</b> — แตะ${esc(unitKind(db.units[0].kind).noun)}ที่ว่างเพื่อ${L.open} แตะ${esc(unitKind(db.units[0].kind).noun)}ที่มีลูกค้าเพื่อเพิ่มรายการหรือ${L.close}</li>`);
  }
  if (s.useBookings) steps.push('<li><b>จองล่วงหน้า</b> — ดูปฏิทินว่าง/ไม่ว่าง รับมัดจำ แล้ว' + 'เช็คอินจากการจองได้ทันที</li>');
  if (s.useJobs) steps.push('<li><b>งานรับ</b> — รับงาน พิมพ์ใบรับงาน อัปเดตสถานะ แล้วส่งมอบพร้อมคิดเงิน</li>');
  steps.push(demo
    ? '<li>เมื่อพร้อมใช้จริง กดปุ่ม <b>"ลบข้อมูลตัวอย่าง"</b> ที่แถบสีเหลืองบนหน้าขาย</li>'
    : '<li><b>เพิ่มสินค้า/บริการ</b> — ที่เมนู "สินค้า" หรือนำเข้าจากไฟล์ Excel (CSV)</li>');
  if (s.useShifts) steps.push('<li>ก่อนรับเงินครั้งแรกของวัน ระบบจะให้ <b>เปิดกะ</b> และใส่เงินทอนในลิ้นชัก</li>');
  const m = openModal({
    title: 'พร้อมใช้งานแล้ว 🎉', size: 'md',
    body: `<div class="done"><div class="done-ico">✓</div><h3>${esc(s.shopName)}</h3>
      <p class="muted">${(s.businessTypes || []).map((t) => `${businessType(t).icon} ${esc(businessType(t).label)}`).join(' · ')}</p></div>
      <ol class="next-steps">${steps.join('')}</ol>`,
    footer: demo || db.products.length
      ? '<button class="btn primary lg" data-cancel>เริ่มใช้งาน</button>'
      : '<button class="btn ghost" data-cancel>เริ่มใช้งาน</button><button class="btn primary lg" id="sd-add">＋ เพิ่มสินค้า/บริการ</button>',
  });
  const add = $('#sd-add', m.el);
  if (add) add.onclick = () => { m.close(); go('products'); openProductForm(null); };
}

/* ---------- ลบข้อมูลตัวอย่าง ---------- */
async function removeDemoData() {
  const ok = await confirmDialog('ลบสินค้า ลูกค้า ยอดขาย บิลเปิด และการจองที่เป็นตัวอย่างทั้งหมด?<br><small class="muted">ห้อง/โต๊ะ/รถ และข้อมูลที่คุณเพิ่มเองจะยังอยู่ครบ</small>', { title: 'ลบข้อมูลตัวอย่าง', okText: 'ลบข้อมูลตัวอย่าง', danger: true });
  if (!ok) return;
  const demoIds = new Set(db.products.filter((p) => p.demo).map((p) => p.id));
  const isDemoSale = (s) => s.demo || (s.items.length && s.items.every((i) => demoIds.has(i.productId)));
  const demoSaleIds = new Set(db.sales.filter(isDemoSale).map((s) => s.id));
  // บิลเปิด/งาน/การจองที่สร้างระหว่างทดลองถูกติดป้าย demo ไว้แล้ว
  const demoSessionIds = new Set(db.sessions.filter((s) => s.demo).map((s) => s.id));
  db.products = db.products.filter((p) => !p.demo);
  db.sales = db.sales.filter((s) => !demoSaleIds.has(s.id));
  db.customers = db.customers.filter((c) => !c.demo);
  db.stockLog = db.stockLog.filter((l) => !demoIds.has(l.productId));
  db.held = db.held.filter((h) => !h.cart.lines.some((l) => demoIds.has(l.productId)));
  db.cart.lines = db.cart.lines.filter((l) => !demoIds.has(l.productId));
  if (db.cart.customerId && !db.customers.some((c) => c.id === db.cart.customerId)) db.cart.customerId = null;
  // บิลเปิด/การจองตัวอย่าง และสินค้าตัวอย่างที่ค้างอยู่ในบิลเปิดของร้าน
  db.sessions = db.sessions.filter((s) => !demoSessionIds.has(s.id));
  db.sessions.forEach((s) => { s.cart.lines = s.cart.lines.filter((l) => !demoIds.has(l.productId)); });
  db.bookings = db.bookings.filter((b) => !b.demo);
  db.units.forEach((u) => { if (u.status === 'cleaning' && !db.sessions.some((s) => s.unitId === u.id)) u.status = 'available'; });
  // กะที่เปิดระหว่างทดลอง ลบทิ้งด้วย
  db.shifts = db.shifts.filter((sh) => !sh.demo);
  // เก็บหมวดตัวอย่างที่มีสินค้าของร้านอยู่ แล้วเติมหมวดมาตรฐานของประเภทร้านที่ยังไม่มี
  db.categories = db.categories.filter((c) => !c.demo || db.products.some((p) => p.categoryId === c.id));
  db.categories.forEach((c) => { delete c.demo; });
  presetCategories(db.settings.businessTypes || db.settings.businessType).forEach((c) => {
    if (!db.categories.some((x) => x.name === c.name)) db.categories.push(c);
  });
  if (!db.sales.length) db.seq.sale = 1;
  ui.posCat = 'all';
  ui.sessionId = null;
  Store.replace = true;
  save(); renderAll();
  toast('ลบข้อมูลตัวอย่างแล้ว — พร้อมใช้งานจริง', 'success', 4000);
}
