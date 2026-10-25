'use strict';
/* =========================================================
   Universal POS — สินค้า, หมวดหมู่, นำเข้า/ส่งออก, สต็อก
   ========================================================= */

/* ---------- Products view ---------- */
function renderProducts() {
  const el = $('#view-products');
  el.innerHTML = `
    <header class="view-head">
      <div><h2>สินค้า & บริการ</h2><p class="muted" id="prod-sub"></p></div>
      <div class="row gap-s wrap">
        <button class="btn" data-act="cats">🗂 จัดการหมวดหมู่</button>
        <button class="btn" data-act="import">⬆ นำเข้า CSV</button>
        <button class="btn" data-act="export">⬇ ส่งออก CSV</button>
        <button class="btn primary" data-act="add">＋ เพิ่มสินค้า</button>
      </div>
    </header>
    <div class="filters">
      <label class="search">${SEARCH_ICON}<input id="prod-search" type="search" placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด" value="${esc(ui.prodSearch)}"></label>
      <select id="prod-cat"><option value="all">ทุกหมวดหมู่</option>${db.categories.map((c) => `<option value="${c.id}" ${ui.prodCat === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
    </div>
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>สินค้า</th><th>หมวดหมู่</th><th>ประเภท</th><th class="num">ราคา</th><th class="num">ต้นทุน</th><th class="num">สต็อก</th><th>สถานะ</th><th></th></tr></thead>
      <tbody id="prod-body"></tbody>
    </table></div>`;
  $('#prod-search', el).addEventListener('input', (e) => { ui.prodSearch = e.target.value; drawProductTable(); });
  $('#prod-cat', el).addEventListener('change', (e) => { ui.prodCat = e.target.value; drawProductTable(); });
  el.querySelector('.view-head').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'add') openProductForm(null);
    if (a === 'cats') openCategoryManager();
    if (a === 'import') openImportProducts();
    if (a === 'export') exportProductsCSV();
  });
  $('#prod-body', el).addEventListener('click', async (e) => {
    const tr = e.target.closest('[data-pid]'); if (!tr) return;
    const p = db.products.find((x) => x.id === tr.dataset.pid);
    if (e.target.closest('[data-dup]')) {
      const c = structuredClone(p);
      c.id = uid(); c.name += ' (สำเนา)'; c.barcode = ''; c.sku = ''; c.stock = 0; c.createdAt = new Date().toISOString();
      c.variants.forEach((v) => { v.id = uid(); v.barcode = ''; v.sku = ''; v.stock = 0; });
      db.products.push(c); save(); drawProductTable(); openProductForm(c);
    } else if (e.target.closest('[data-toggle]')) {
      p.active = !p.active; save(); drawProductTable();
    } else openProductForm(p);
  });
  drawProductTable();
}

function productTypeLabels(p) {
  const t = [];
  if (p.variants.length) t.push(`<span class="pill primary">${p.variants.length} แบบ</span>`);
  if (p.optionGroups.length) t.push('<span class="pill">มีตัวเลือก</span>');
  if (p.decimalQty) t.push(`<span class="pill">ขายต่อ${esc(p.unit)}</span>`);
  if (p.openPrice) t.push('<span class="pill">ระบุราคา</span>');
  if (!p.trackStock) t.push('<span class="pill">ไม่นับสต็อก</span>');
  return t.join(' ') || '<span class="pill">ทั่วไป</span>';
}

function drawProductTable() {
  const q = ui.prodSearch.trim().toLowerCase();
  const list = db.products.filter((p) => (ui.prodCat === 'all' || p.categoryId === ui.prodCat)
    && (!q || [p.name, p.sku, p.barcode, ...p.variants.map((v) => `${v.name} ${v.sku} ${v.barcode}`)].join(' ').toLowerCase().includes(q)));
  $('#prod-sub').textContent = `${db.products.length} รายการ · ${db.categories.length} หมวดหมู่${list.length !== db.products.length ? ` · แสดง ${list.length}` : ''}`;
  $('#prod-body').innerHTML = list.map((p) => {
    const cat = getCat(p.categoryId), stock = totalStock(p);
    const stockCls = stock <= 0 ? 'danger' : stock <= num(p.lowStock) ? 'warn' : '';
    return `<tr class="clickable" data-pid="${p.id}">
      <td><div class="cell-prod"><span class="thumb" style="--cc:${cat.color}">${p.image ? `<img src="${p.image}" alt="">` : esc(p.emoji || '📦')}</span><span><b>${esc(p.name)}</b><small class="muted">${esc(p.sku || p.barcode || '')}</small></span></div></td>
      <td class="nowrap">${esc(cat.icon)} ${esc(cat.name)}</td>
      <td>${productTypeLabels(p)}</td>
      <td class="num">${priceLabel(p)}</td>
      <td class="num muted">${p.openPrice ? '-' : money(p.cost)}</td>
      <td class="num">${p.trackStock ? `<span class="pill ${stockCls}">${fmtQty(stock)} ${esc(p.unit)}</span>` : '<span class="muted">—</span>'}</td>
      <td><span class="pill ${p.active ? 'ok' : ''}">${p.active ? 'เปิดขาย' : 'ปิดขาย'}</span></td>
      <td class="nowrap right"><button class="btn sm ghost" data-toggle>${p.active ? 'ปิดขาย' : 'เปิดขาย'}</button><button class="btn sm ghost" data-dup>คัดลอก</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8"><div class="empty"><div class="empty-ico">📦</div><p>ไม่พบสินค้า</p></div></td></tr>';
}

/* ---------- Product form ---------- */
function openProductForm(product) {
  const isNew = !product || !db.products.includes(product);
  const orig = product ? structuredClone(product) : null;
  const s = db.settings;
  const p = product ? structuredClone(product) : {
    id: uid(), name: '', categoryId: ui.prodCat !== 'all' ? ui.prodCat : (db.categories[0]?.id || ''), emoji: '📦', image: '',
    sku: '', barcode: '', price: 0, cost: 0, unit: s.defaultUnit || 'ชิ้น', decimalQty: !!s.defaultDecimalQty, openPrice: false, trackStock: s.defaultTrackStock !== false, stock: 0,
    lowStock: s.defaultLowStock, taxable: true, active: true, variants: [], optionGroups: [], createdAt: new Date().toISOString(),
  };
  const sw = (id, checked, title, desc) => `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><div><b>${title}</b><small>${desc}</small></div></label>`;
  const m = openModal({
    title: isNew ? 'เพิ่มสินค้า / บริการ' : 'แก้ไขสินค้า', size: 'xl',
    body: `<datalist id="unit-list">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
    <div class="pf">
      <div class="pf-media">
        <div class="pf-preview" id="pf-preview"></div>
        <div>
          <div class="row gap-s"><button class="btn sm grow" id="pf-upload">อัปโหลดรูป</button><button class="btn sm ghost" id="pf-rmimg">ลบรูป</button></div>
          <div class="emoji-row" id="pf-emojis">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
        </div>
      </div>
      <div>
        <div class="fields c3">
          <label class="field span2"><span>ชื่อสินค้า / บริการ *</span><input id="pf-name" value="${esc(p.name)}" placeholder="เช่น เสื้อยืด, กาแฟเย็น, ค่าซ่อม" autofocus></label>
          <label class="field"><span>อีโมจิ</span><input id="pf-emoji" value="${esc(p.emoji)}" maxlength="8"></label>
          <label class="field"><span>หมวดหมู่</span><select id="pf-cat"><option value="">ไม่ระบุ</option>${db.categories.map((c) => `<option value="${c.id}" ${p.categoryId === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>หน่วยนับ</span><input id="pf-unit" list="unit-list" value="${esc(p.unit)}"></label>
          <label class="field"><span>ราคาขาย (${esc(s.currencySymbol)})</span><input id="pf-price" type="number" step="0.01" min="0" value="${p.price}"></label>
          <label class="field"><span>ต้นทุน (${esc(s.currencySymbol)})</span><input id="pf-cost" type="number" step="0.01" min="0" value="${p.cost}"></label>
          <label class="field"><span>SKU / รหัสสินค้า</span><input id="pf-sku" value="${esc(p.sku)}"></label>
          <label class="field"><span>บาร์โค้ด</span><div class="input-group"><input id="pf-barcode" value="${esc(p.barcode)}" placeholder="สแกนหรือพิมพ์"><button class="btn sm" id="pf-genbc" type="button" title="สร้างบาร์โค้ดอัตโนมัติ">สร้าง</button></div></label>
        </div>
        <div class="pf-sec"><h4>รูปแบบการขาย</h4><p>ตั้งค่าให้เข้ากับสินค้าทุกประเภท — ของชิ้น ของชั่งน้ำหนัก บริการ หรือสินค้าราคาไม่ตายตัว</p>
          <div class="switch-grid">
            ${sw('pf-decimal', p.decimalQty, 'ขายตามน้ำหนัก / ปริมาณ', 'จำนวนเป็นทศนิยมได้ เช่น 1.25 กก., 2.5 เมตร')}
            ${sw('pf-open', p.openPrice, 'ระบุราคาตอนขาย', 'สำหรับงานบริการ ค่าซ่อม ราคาไม่ตายตัว')}
            ${sw('pf-tax', p.taxable, 'คิดภาษีมูลค่าเพิ่ม', 'ปิดสำหรับสินค้าที่ได้รับยกเว้น VAT')}
            ${sw('pf-active', p.active, 'เปิดขาย', 'แสดงในหน้าขาย')}
          </div>
        </div>
        <div class="pf-sec"><h4>สต็อก</h4><p>ปิดการนับสต็อกสำหรับอาหารปรุงสด งานบริการ หรือสินค้าที่ไม่ต้องควบคุมจำนวน</p>
          <div class="fields c3">
            ${sw('pf-track', p.trackStock, 'นับสต็อก', 'ตัดสต็อกอัตโนมัติเมื่อขาย')}
            <label class="field"><span>จำนวนคงเหลือ</span><input id="pf-stock" type="number" step="0.001" value="${p.stock}"></label>
            <label class="field"><span>แจ้งเตือนเมื่อเหลือ ≤</span><input id="pf-low" type="number" step="0.001" min="0" value="${p.lowStock}"></label>
          </div>
        </div>
        <div class="pf-sec"><h4>ตัวเลือกย่อย (ขนาด / สี / รุ่น / รสชาติ)</h4><p>แต่ละแบบมีราคา สต็อก และบาร์โค้ดของตัวเองได้ — เว้นว่างถ้าสินค้ามีแบบเดียว</p>
          <div class="table-wrap"><table class="vtable"><thead id="pf-vhead"></thead><tbody id="pf-variants"></tbody></table></div>
          <div class="row gap-s wrap" style="margin-top:8px">
            <button class="btn sm" id="pf-addv" type="button">＋ เพิ่มแบบ</button>
            <input id="pf-bulkv" placeholder="เพิ่มหลายแบบพร้อมกัน เช่น S, M, L, XL" style="max-width:320px;height:32px">
            <button class="btn sm ghost" id="pf-bulkv-btn" type="button">เพิ่ม</button>
          </div>
        </div>
        <div class="pf-sec"><h4>ตัวเลือกเพิ่มเติม (Add-on / ท็อปปิ้ง / ระดับความหวาน)</h4><p>ใส่ตัวเลือกคั่นด้วยจุลภาค และใส่ราคาเพิ่มด้วย + เช่น <code>ไข่มุก+10, พุดดิ้ง+15, ไม่ใส่</code></p>
          <div id="pf-groups"></div>
          <button class="btn sm" id="pf-addg" type="button">＋ เพิ่มกลุ่มตัวเลือก</button>
        </div>
      </div>
    </div>`,
    footer: `${isNew ? '' : '<button class="btn ghost danger-text" id="pf-delete">ลบสินค้า</button>'}<span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="pf-save">บันทึก</button>`,
  });
  const el = m.el;
  const f = (id) => $('#' + id, el);

  const drawPreview = () => {
    const cat = getCat(f('pf-cat').value);
    f('pf-preview').style.setProperty('--cc', cat.color);
    f('pf-preview').innerHTML = p.image ? `<img src="${p.image}" alt="">` : esc(f('pf-emoji').value || '📦');
  };
  const syncVariants = () => {
    $$('#pf-variants tr', el).forEach((tr, i) => {
      const v = p.variants[i];
      v.name = $('.v-name', tr).value; v.price = num($('.v-price', tr).value);
      v.cost = $('.v-cost', tr).value === '' ? null : num($('.v-cost', tr).value);
      v.stock = num($('.v-stock', tr).value); v.sku = $('.v-sku', tr).value.trim(); v.barcode = $('.v-barcode', tr).value.trim();
    });
  };
  const drawVariants = () => {
    const has = p.variants.length > 0;
    f('pf-vhead').innerHTML = has ? '<tr><th>ชื่อแบบ</th><th>ราคา</th><th>ต้นทุน</th><th>สต็อก</th><th>SKU</th><th>บาร์โค้ด</th><th></th></tr>' : '';
    f('pf-variants').innerHTML = p.variants.map((v) => `<tr>
      <td><input class="v-name" value="${esc(v.name)}" placeholder="เช่น M / แดง" style="min-width:120px"></td>
      <td><input class="v-price" type="number" step="0.01" value="${v.price}" style="width:90px"></td>
      <td><input class="v-cost" type="number" step="0.01" value="${v.cost ?? ''}" placeholder="${num(f('pf-cost').value)}" style="width:90px"></td>
      <td><input class="v-stock" type="number" step="0.001" value="${v.stock}" style="width:80px"></td>
      <td><input class="v-sku" value="${esc(v.sku)}" style="width:110px"></td>
      <td><input class="v-barcode" value="${esc(v.barcode)}" style="width:140px"></td>
      <td><button class="icon-btn" data-rmv type="button">✕</button></td></tr>`).join('');
    f('pf-stock').disabled = has;
    if (has) f('pf-stock').value = sum(p.variants, (v) => num(v.stock));
  };
  const syncGroups = () => {
    $$('#pf-groups .og', el).forEach((g, i) => {
      const og = p.optionGroups[i];
      og.name = $('.g-name', g).value.trim();
      og.multi = $('.g-multi', g).value === '1';
      og.required = $('.g-req', g).checked;
      og.options = $('.g-opts', g).value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
        const mm = x.match(/^(.*?)\s*\+\s*(\d+(?:\.\d+)?)$/);
        return mm ? { name: mm[1].trim(), price: num(mm[2]) } : { name: x, price: 0 };
      });
    });
  };
  const drawGroups = () => {
    f('pf-groups').innerHTML = p.optionGroups.map((g) => `<div class="og">
      <div class="og-head">
        <input class="g-name" value="${esc(g.name)}" placeholder="ชื่อกลุ่ม เช่น ความหวาน, ท็อปปิ้ง">
        <select class="g-multi"><option value="0" ${!g.multi ? 'selected' : ''}>เลือกได้ 1 อย่าง</option><option value="1" ${g.multi ? 'selected' : ''}>เลือกได้หลายอย่าง</option></select>
        <label class="chk"><input type="checkbox" class="g-req" ${g.required ? 'checked' : ''}> บังคับเลือก</label>
        <button class="icon-btn" data-rmg type="button">✕</button>
      </div>
      <input class="g-opts" value="${esc(g.options.map((o) => (num(o.price) ? `${o.name}+${o.price}` : o.name)).join(', '))}" placeholder="ตัวเลือก เช่น หวานน้อย, หวานปกติ, ไข่มุก+10">
    </div>`).join('');
  };

  drawPreview(); drawVariants(); drawGroups();
  f('pf-emoji').addEventListener('input', drawPreview);
  f('pf-cat').addEventListener('change', drawPreview);
  f('pf-emojis').onclick = (e) => { const b = e.target.closest('[data-emoji]'); if (b) { f('pf-emoji').value = b.dataset.emoji; p.image = ''; drawPreview(); } };
  f('pf-upload').onclick = async () => {
    const file = await pickFile('image/*'); if (!file) return;
    try { p.image = await resizeImage(file); drawPreview(); } catch { toast('อ่านไฟล์รูปไม่ได้', 'error'); }
  };
  f('pf-rmimg').onclick = () => { p.image = ''; drawPreview(); };
  f('pf-genbc').onclick = () => { f('pf-barcode').value = genBarcode(); };
  f('pf-unit').addEventListener('change', () => { if (DECIMAL_UNITS.includes(f('pf-unit').value.trim())) f('pf-decimal').checked = true; });
  const newVariant = (name = '') => ({ id: uid(), name, price: num(f('pf-price').value), cost: null, sku: '', barcode: '', stock: 0 });
  f('pf-addv').onclick = () => { syncVariants(); p.variants.push(newVariant()); drawVariants(); $$('#pf-variants .v-name', el).pop().focus(); };
  f('pf-bulkv-btn').onclick = () => {
    const names = f('pf-bulkv').value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!names.length) return;
    syncVariants(); names.forEach((n) => p.variants.push(newVariant(n))); f('pf-bulkv').value = ''; drawVariants();
  };
  f('pf-variants').onclick = (e) => {
    const b = e.target.closest('[data-rmv]'); if (!b) return;
    syncVariants(); p.variants.splice($$('#pf-variants tr', el).indexOf(b.closest('tr')), 1); drawVariants();
  };
  f('pf-variants').addEventListener('input', (e) => { if (e.target.matches('.v-stock')) { syncVariants(); f('pf-stock').value = sum(p.variants, (v) => num(v.stock)); } });
  f('pf-addg').onclick = () => { syncGroups(); p.optionGroups.push({ name: '', multi: false, required: false, options: [] }); drawGroups(); $$('#pf-groups .g-name', el).pop().focus(); };
  f('pf-groups').onclick = (e) => {
    const b = e.target.closest('[data-rmg]'); if (!b) return;
    syncGroups(); p.optionGroups.splice($$('#pf-groups .og', el).indexOf(b.closest('.og')), 1); drawGroups();
  };

  if (!isNew) f('pf-delete').onclick = async () => {
    if (!await confirmDialog(`ลบสินค้า <b>${esc(p.name)}</b>?<br><small class="muted">ประวัติการขายเดิมจะยังอยู่</small>`, { danger: true, okText: 'ลบ' })) return;
    db.products = db.products.filter((x) => x.id !== p.id);
    save(); m.close(); refreshAfterProductChange();
  };

  f('pf-save').onclick = () => {
    syncVariants(); syncGroups();
    Object.assign(p, {
      name: f('pf-name').value.trim(), emoji: f('pf-emoji').value.trim() || '📦', categoryId: f('pf-cat').value,
      unit: f('pf-unit').value.trim() || 'ชิ้น', price: r2(f('pf-price').value), cost: r2(f('pf-cost').value),
      sku: f('pf-sku').value.trim(), barcode: f('pf-barcode').value.trim(),
      decimalQty: f('pf-decimal').checked, openPrice: f('pf-open').checked, taxable: f('pf-tax').checked, active: f('pf-active').checked,
      trackStock: f('pf-track').checked, stock: r3(f('pf-stock').value), lowStock: num(f('pf-low').value),
    });
    if (!p.name) { f('pf-name').focus(); return toast('กรุณาใส่ชื่อสินค้า', 'warn'); }
    p.variants = p.variants.filter((v) => v.name.trim());
    p.optionGroups = p.optionGroups.filter((g) => g.name && g.options.length);
    if (p.variants.length) p.stock = r3(sum(p.variants, (v) => num(v.stock)));

    const codes = [p.barcode, p.sku, ...p.variants.flatMap((v) => [v.barcode, v.sku])].filter(Boolean);
    if (new Set(codes).size !== codes.length) return toast('มีบาร์โค้ด/SKU ซ้ำกันในสินค้านี้', 'error');
    for (const c of codes) {
      const hit = findByCode(c, true);
      if (hit && hit.p.id !== p.id) return toast(`รหัส ${c} ซ้ำกับสินค้า "${hit.p.name}"`, 'error');
    }

    // stock movement log
    if (p.trackStock) {
      const before = (vid) => {
        if (!orig || !orig.trackStock) return 0;
        if (!vid) return orig.variants.length ? null : num(orig.stock);
        const ov = orig.variants.find((v) => v.id === vid);
        return ov ? num(ov.stock) : 0;
      };
      const log = (vid, name, after) => {
        const b = before(vid);
        if (b === null || r3(after - b) === 0) return;
        db.stockLog.unshift({ id: uid(), date: new Date().toISOString(), productId: p.id, variantId: vid, name, change: r3(after - b), after, reason: orig ? 'edit' : 'initial', ref: '', note: '' });
      };
      if (p.variants.length) p.variants.forEach((v) => log(v.id, `${p.name} (${v.name})`, num(v.stock)));
      else log(null, p.name, num(p.stock));
    }

    const idx = db.products.findIndex((x) => x.id === p.id);
    if (idx >= 0) db.products[idx] = p; else db.products.push(p);
    save(); m.close(); refreshAfterProductChange();
    toast('บันทึกสินค้าแล้ว', 'success');
  };
}

function refreshAfterProductChange() {
  if (ui.view === 'products') drawProductTable();
  if (ui.view === 'inventory') renderInventory();
  if ($('#pos-grid')) { renderPosCats(); renderPosGrid(); }
  updateBadges();
}

/* ---------- Categories ---------- */
function openCategoryManager() {
  const cats = structuredClone(db.categories);
  const m = openModal({
    title: 'จัดการหมวดหมู่', size: 'md',
    body: `<p class="muted small" style="margin-top:0">สร้างหมวดหมู่ได้ไม่จำกัด — รองรับทุกประเภทธุรกิจ</p><div id="cm-list"></div><button class="btn sm" id="cm-add">＋ เพิ่มหมวดหมู่</button>`,
    footer: `<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="cm-save">บันทึก</button>`,
  });
  const el = m.el;
  const sync = () => $$('.cat-row', el).forEach((r, i) => {
    cats[i].icon = $('.cat-icon', r).value.trim() || '📦';
    cats[i].name = $('.cat-name', r).value.trim();
    cats[i].color = $('.cat-color', r).value;
  });
  const draw = () => {
    $('#cm-list', el).innerHTML = cats.map((c) => {
      const n = db.products.filter((p) => p.categoryId === c.id).length;
      return `<div class="cat-row"><input class="cat-icon" value="${esc(c.icon)}" maxlength="8"><input class="cat-name" value="${esc(c.name)}" placeholder="ชื่อหมวดหมู่"><input type="color" class="cat-color" value="${c.color}"><span class="muted small nowrap">${n} สินค้า</span><button class="icon-btn" data-rm>✕</button></div>`;
    }).join('');
  };
  draw();
  $('#cm-add', el).onclick = () => {
    sync();
    const palette = ['#8b5cf6', '#f97316', '#10b981', '#ec4899', '#3b82f6', '#14b8a6', '#eab308', '#ef4444', '#64748b'];
    cats.push({ id: uid(), name: '', icon: '📦', color: palette[cats.length % palette.length] });
    draw(); $$('.cat-name', el).pop().focus();
  };
  $('#cm-list', el).onclick = (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    sync(); cats.splice($$('.cat-row', el).indexOf(b.closest('.cat-row')), 1); draw();
  };
  $('#cm-save', el).onclick = () => {
    sync();
    const valid = cats.filter((c) => c.name);
    const ids = new Set(valid.map((c) => c.id));
    const orphan = db.products.filter((p) => p.categoryId && !ids.has(p.categoryId));
    orphan.forEach((p) => { p.categoryId = ''; });
    db.categories = valid;
    if (ui.posCat !== 'all' && !ids.has(ui.posCat)) ui.posCat = 'all';
    if (ui.prodCat !== 'all' && !ids.has(ui.prodCat)) ui.prodCat = 'all';
    save(); m.close();
    if (orphan.length) toast(`${orphan.length} สินค้าถูกย้ายไป "ไม่ระบุหมวด"`, 'warn');
    if (ui.view === 'products') renderProducts();
    if ($('#pos-grid')) { renderPosCats(); renderPosGrid(); }
  };
}

/* ---------- CSV import / export ---------- */
const CSV_COLS = ['name', 'category', 'price', 'cost', 'unit', 'sku', 'barcode', 'stock', 'lowStock', 'emoji', 'trackStock', 'decimalQty', 'taxable'];

function exportProductsCSV() {
  const rows = [CSV_COLS];
  db.products.forEach((p) => rows.push([p.name, getCat(p.categoryId).name, p.price, p.cost, p.unit, p.sku, p.barcode, p.variants.length ? totalStock(p) : p.stock, p.lowStock, p.emoji, p.trackStock ? 1 : 0, p.decimalQty ? 1 : 0, p.taxable ? 1 : 0]));
  download(`products-${toISODate(new Date())}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}

function openImportProducts() {
  const m = openModal({
    title: 'นำเข้าสินค้าจากไฟล์ CSV', size: 'md',
    body: `<p style="margin-top:0">ไฟล์ต้องมีหัวคอลัมน์ (ใช้ได้กับ Excel / Google Sheets → บันทึกเป็น CSV UTF-8):</p>
      <p><code>${CSV_COLS.join(', ')}</code></p>
      <ul class="muted small">
        <li>จำเป็นต้องมีอย่างน้อย <b>name</b> และ <b>price</b></li>
        <li>ถ้า <b>sku</b> หรือ <b>barcode</b> ตรงกับสินค้าเดิม จะอัปเดตราคา/ต้นทุน/สต็อกแทนการสร้างใหม่</li>
        <li>หมวดหมู่ที่ยังไม่มีจะถูกสร้างให้อัตโนมัติ</li>
      </ul>`,
    footer: `<button class="btn ghost" id="im-template">ดาวน์โหลดไฟล์ตัวอย่าง</button><span class="grow"></span><button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="im-pick">เลือกไฟล์ CSV</button>`,
  });
  $('#im-template', m.el).onclick = () => download('products-template.csv', toCSV([CSV_COLS, ['เสื้อโปโล', 'แฟชั่น', 350, 150, 'ตัว', 'POLO-01', '', 20, 3, '👕', 1, 0, 1], ['แอปเปิ้ลแดง', 'ผลไม้', 120, 80, 'กก.', '', '', 15.5, 2, '🍎', 1, 1, 0]]), 'text/csv;charset=utf-8');
  $('#im-pick', m.el).onclick = async () => {
    const file = await pickFile('.csv,text/csv'); if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return toast('ไม่พบข้อมูลในไฟล์', 'error');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (r, k) => { const i = head.indexOf(k.toLowerCase()); return i >= 0 ? (r[i] ?? '').trim() : ''; };
    if (!head.includes('name')) return toast('ไม่พบคอลัมน์ name', 'error');
    let created = 0, updated = 0;
    rows.slice(1).forEach((r) => {
      const name = col(r, 'name'); if (!name) return;
      const catName = col(r, 'category');
      let cat = catName ? db.categories.find((c) => c.name === catName) : null;
      if (catName && !cat) { cat = { id: uid(), name: catName, icon: '📦', color: '#64748b' }; db.categories.push(cat); }
      const sku = col(r, 'sku'), barcode = col(r, 'barcode');
      const hit = (barcode && findByCode(barcode, true)) || (sku && findByCode(sku, true));
      const bool = (k, def) => { const v = col(r, k); return v === '' ? def : ['1', 'true', 'yes', 'y', 'ใช่'].includes(v.toLowerCase()); };
      if (hit && !hit.v) {
        const p = hit.p;
        p.price = r2(col(r, 'price') || p.price); p.cost = r2(col(r, 'cost') || p.cost);
        if (col(r, 'stock') !== '' && p.trackStock && !p.variants.length) applyStock(p.id, null, r3(num(col(r, 'stock')) - num(p.stock)), 'import');
        updated++;
      } else {
        const unit = col(r, 'unit') || 'ชิ้น';
        const p = {
          id: uid(), name, categoryId: cat ? cat.id : '', emoji: col(r, 'emoji') || cat?.icon || '📦', image: '', sku, barcode,
          price: r2(col(r, 'price')), cost: r2(col(r, 'cost')), unit, decimalQty: bool('decimalQty', DECIMAL_UNITS.includes(unit)),
          openPrice: false, trackStock: bool('trackStock', true), stock: 0, lowStock: col(r, 'lowStock') === '' ? db.settings.defaultLowStock : num(col(r, 'lowStock')),
          taxable: bool('taxable', true), active: true, variants: [], optionGroups: [], createdAt: new Date().toISOString(),
        };
        db.products.push(p);
        if (p.trackStock && num(col(r, 'stock'))) applyStock(p.id, null, r3(col(r, 'stock')), 'import');
        created++;
      }
    });
    save(); m.close(); renderProducts(); refreshAfterProductChange();
    toast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${created} · อัปเดต ${updated}`, 'success', 4000);
  };
}

/* ---------- Inventory ---------- */
function stockRows() {
  const rows = [];
  db.products.filter((p) => p.trackStock).forEach((p) => {
    if (p.variants.length) p.variants.forEach((v) => rows.push({ p, v, stock: num(v.stock), low: num(p.lowStock), cost: variantCost(p, v), code: v.barcode || v.sku }));
    else rows.push({ p, v: null, stock: num(p.stock), low: num(p.lowStock), cost: num(p.cost), code: p.barcode || p.sku });
  });
  return rows;
}

function renderInventory() {
  const el = $('#view-inventory');
  const rows = stockRows();
  const low = rows.filter((r) => r.stock > 0 && r.stock <= r.low).length;
  const out = rows.filter((r) => r.stock <= 0).length;
  el.innerHTML = `
    <header class="view-head"><div><h2>สต็อกสินค้า</h2><p class="muted">ติดตามจำนวนคงเหลือ รับสินค้าเข้า และตรวจนับ</p></div></header>
    <div class="kpis">
      <div class="card kpi"><span>รายการที่นับสต็อก</span><b>${rows.length}</b><small>SKU / แบบย่อย</small></div>
      <div class="card kpi"><span>มูลค่าสต็อก (ต้นทุน)</span><b>${money(sum(rows, (r) => Math.max(0, r.stock) * r.cost))}</b><small>จำนวนคงเหลือ × ต้นทุน</small></div>
      <div class="card kpi"><span>ใกล้หมด</span><b style="color:var(--warn)">${low}</b><small>ต่ำกว่าจุดแจ้งเตือน</small></div>
      <div class="card kpi"><span>หมดสต็อก</span><b style="color:var(--danger)">${out}</b><small>ต้องสั่งเพิ่ม</small></div>
    </div>
    <div class="filters">
      <div class="seg" id="inv-filter">${[['all', 'ทั้งหมด'], ['low', `ใกล้หมด (${low})`], ['out', `หมด (${out})`]].map(([k, l]) => `<button data-f="${k}" class="${ui.invFilter === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <label class="search">${SEARCH_ICON}<input id="inv-search" type="search" placeholder="ค้นหาสินค้า / บาร์โค้ด" value="${esc(ui.invSearch)}"></label>
    </div>
    <div class="card table-wrap" style="margin-bottom:18px"><table class="table">
      <thead><tr><th>สินค้า</th><th>รหัส</th><th class="num">คงเหลือ</th><th class="num">แจ้งเตือน ≤</th><th class="num">มูลค่า</th><th></th></tr></thead>
      <tbody id="inv-body"></tbody></table></div>
    <h3 style="margin-bottom:10px;font-size:16px">ความเคลื่อนไหวล่าสุด</h3>
    <div class="card table-wrap"><table class="table">
      <thead><tr><th>วันเวลา</th><th>สินค้า</th><th>ประเภท</th><th class="num">เปลี่ยนแปลง</th><th class="num">คงเหลือ</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
      <tbody>${db.stockLog.slice(0, 50).map((l) => `<tr><td class="nowrap muted">${fmtDateTime(l.date)}</td><td>${esc(l.name)}</td><td><span class="pill">${STOCK_REASONS[l.reason] || l.reason}</span></td>
        <td class="num ${l.change < 0 ? 'neg' : 'pos-text'}">${l.change > 0 ? '+' : ''}${fmtQty(l.change)}</td><td class="num">${fmtQty(l.after)}</td><td class="muted">${esc([l.ref, l.note].filter(Boolean).join(' · '))}</td></tr>`).join('')
        || '<tr><td colspan="6"><div class="empty"><p>ยังไม่มีความเคลื่อนไหว</p></div></td></tr>'}</tbody></table></div>`;

  const draw = () => {
    const q = ui.invSearch.trim().toLowerCase();
    const list = stockRows().filter((r) => (ui.invFilter === 'all' || (ui.invFilter === 'low' ? r.stock > 0 && r.stock <= r.low : r.stock <= 0))
      && (!q || `${r.p.name} ${r.v?.name || ''} ${r.code || ''} ${r.p.sku}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.stock - a.low) - (b.stock - b.low));
    $('#inv-body', el).innerHTML = list.map((r) => {
      const cls = r.stock <= 0 ? 'danger' : r.stock <= r.low ? 'warn' : 'ok';
      return `<tr data-pid="${r.p.id}" data-vid="${r.v?.id || ''}">
        <td><div class="cell-prod"><span class="thumb" style="--cc:${getCat(r.p.categoryId).color}">${r.p.image ? `<img src="${r.p.image}" alt="">` : esc(r.p.emoji)}</span><span><b>${esc(r.p.name)}</b>${r.v ? `<small class="muted">${esc(r.v.name)}</small>` : ''}</span></div></td>
        <td class="muted">${esc(r.code || '-')}</td>
        <td class="num"><span class="pill ${cls}">${fmtQty(r.stock)} ${esc(r.p.unit)}</span></td>
        <td class="num muted">${fmtQty(r.low)}</td>
        <td class="num">${money(Math.max(0, r.stock) * r.cost)}</td>
        <td class="nowrap right"><button class="btn sm" data-mode="receive">＋ รับเข้า</button><button class="btn sm ghost" data-mode="count">ปรับยอด</button></td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty"><div class="empty-ico">✅</div><p>ไม่มีรายการ</p></div></td></tr>';
  };
  $('#inv-filter', el).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; ui.invFilter = b.dataset.f; $$('#inv-filter button', el).forEach((x) => x.classList.toggle('active', x === b)); draw(); };
  $('#inv-search', el).addEventListener('input', (e) => { ui.invSearch = e.target.value; draw(); });
  $('#inv-body', el).onclick = (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    const tr = b.closest('tr');
    const p = db.products.find((x) => x.id === tr.dataset.pid);
    openStockAdjust(p, tr.dataset.vid ? p.variants.find((v) => v.id === tr.dataset.vid) : null, b.dataset.mode);
  };
  draw();
}

function openStockAdjust(p, v, mode = 'receive') {
  const cur = v ? num(v.stock) : num(p.stock);
  const modes = { receive: 'รับสินค้าเข้า (+)', remove: 'นำออก / เสียหาย (−)', count: 'ตรวจนับ (ตั้งยอดใหม่)' };
  const m = openModal({
    title: `${esc(p.name)}${v ? ` (${esc(v.name)})` : ''}`, size: 'sm',
    body: `<div class="seg" id="sa-mode" style="margin-bottom:14px">${Object.entries(modes).map(([k, l]) => `<button data-m="${k}" class="${k === mode ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="fields">
        <p style="margin:0">คงเหลือปัจจุบัน <b>${fmtQty(cur)} ${esc(p.unit)}</b></p>
        <label class="field"><span id="sa-label"></span><input id="sa-qty" type="number" step="0.001" min="0" autofocus></label>
        <label class="field" id="sa-cost-wrap"><span>ต้นทุนต่อหน่วยใหม่ (ไม่บังคับ)</span><input id="sa-cost" type="number" step="0.01" min="0" placeholder="${variantCost(p, v)}"></label>
        <label class="field"><span>หมายเหตุ</span><input id="sa-note" placeholder="เช่น เลขที่ใบส่งของ, สินค้าชำรุด"></label>
        <p class="muted" style="margin:0">ยอดใหม่: <b id="sa-after">${fmtQty(cur)}</b> ${esc(p.unit)}</p>
      </div>`,
    footer: `<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn primary" id="sa-save">บันทึก</button>`,
  });
  const el = m.el;
  const delta = () => { const q = num($('#sa-qty', el).value); return mode === 'receive' ? q : mode === 'remove' ? -q : q - cur; };
  const draw = () => {
    $('#sa-label', el).textContent = mode === 'count' ? `จำนวนที่นับได้จริง (${p.unit})` : `จำนวน (${p.unit})`;
    $('#sa-cost-wrap', el).hidden = mode !== 'receive';
    $('#sa-after', el).textContent = fmtQty(r3(cur + delta()));
  };
  $('#sa-mode', el).onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; $$('#sa-mode button', el).forEach((x) => x.classList.toggle('active', x === b)); draw(); };
  $('#sa-qty', el).addEventListener('input', draw);
  const doSave = () => {
    if ($('#sa-qty', el).value === '') return toast('กรุณาระบุจำนวน', 'warn');
    const d = r3(delta());
    const cost = $('#sa-cost', el).value;
    if (mode === 'receive' && cost !== '') { if (v) v.cost = r2(cost); else p.cost = r2(cost); }
    if (d) applyStock(p.id, v ? v.id : null, d, mode, '', $('#sa-note', el).value.trim());
    if (v) p.stock = r3(sum(p.variants, (x) => num(x.stock)));
    save(); m.close(); refreshAfterProductChange();
    toast('บันทึกสต็อกแล้ว', 'success');
  };
  $('#sa-save', el).onclick = doSave;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') doSave(); });
  draw();
}
