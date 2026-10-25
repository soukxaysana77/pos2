'use strict';
/* =========================================================
   Universal POS — navigation, keyboard shortcuts, bootstrap
   ========================================================= */

let db = null; // โหลดใน initStore()
const today = toISODate(new Date());
const ui = {
  view: 'pos', posCat: 'all', posSearch: '', flashLine: null,
  prodCat: 'all', prodSearch: '', invFilter: 'all', invSearch: '',
  salesSearch: '', salesStatus: 'all', salesTab: 'bills', custSearch: '',
  sessionId: null, unitsTab: 'board', unitGroup: 'all', calScale: null, calDate: null, bookingFilter: 'upcoming', jobFilter: 'active', jobSearch: '',
  ranges: { sales: { key: 'today', from: today, to: today }, reports: { key: '7d', from: today, to: today } },
};

const RENDERERS = {
  pos: renderPOS, units: renderUnits, products: renderProducts, inventory: renderInventory, sales: renderSales,
  reports: renderReports, customers: renderCustomers, settings: renderSettings,
};

function go(view) {
  if (view !== 'pos') ui.sessionId = null; // ออกจากหน้าขาย = กลับไปใช้บิลหน้าร้าน
  if (view === 'units' && !unitsEnabled()) view = 'pos';
  const changed = ui.view !== view;
  ui.view = view;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  if (changed) $(`#view-${view}`).scrollTop = 0; // เปลี่ยนเมนูแล้วเริ่มที่ด้านบน
  RENDERERS[view]();
  if (view === 'pos' && matchMedia('(pointer:fine)').matches) $('#pos-search')?.focus();
}

function updateBadges() {
  const n = stockRows().filter((r) => r.stock <= r.low).length;
  const b = $('#inv-badge');
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}

function applySettings() {
  const s = db.settings;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.title = `${s.shopName} · POS`;
  $('.logo').textContent = (s.shopName.trim()[0] || 'U').toUpperCase();
  updateNav();
}

// แสดงเมนูตามสวิตช์ในหน้าตั้งค่า — แต่ถ้ายังมีบิลเปิดค้างอยู่ ต้องเข้าถึงได้เสมอ (ไม่งั้นปิดบิลไม่ได้)
const unitsEnabled = () => db.settings.useUnits || db.settings.useBookings || db.settings.useJobs || db.sessions.some((s) => s.status === 'open');
// เมนูห้อง/โต๊ะ/รถ แสดงเมื่อเปิดใช้ และเปลี่ยนชื่อตามประเภทธุรกิจ (ห้องพัก, รถเช่า, โต๊ะ ...)
function updateNav() {
  const on = unitsEnabled();
  $('#nav-units').hidden = !on;
  if (on) $('#nav-units-label').textContent = unitsMenuTitle();
  if (!on && ui.view === 'units') go('pos');
}

function renderAll() {
  $('#view-pos').dataset.ready = '';
  applySettings();
  go(ui.view);
  updateBadges();
}

// เรียกเมื่อข้อมูลถูกอัปเดตจากเครื่องอื่น
function onRemoteChange() {
  applySettings();
  updateBadges();
  if (ui.view === 'pos') {
    if ($('#pos-grid')) { renderPosCats(); renderPosGrid(); renderCart(); }
    return;
  }
  const active = document.activeElement;
  if (active && active.matches('input, select, textarea') && $('#main').contains(active)) return;
  RENDERERS[ui.view]();
}

document.addEventListener('DOMContentLoaded', async () => {
  await initStore();
  applySettings();
  $('.sidebar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });

  const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 15000);

  // Keyboard shortcuts + barcode scanner (keyboard wedge) when no input is focused
  let scanBuf = '', scanTime = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) {
      const m = modalStack[modalStack.length - 1];
      if (m.dismissible) m.close();
      return;
    }
    if (modalStack.length || ui.view !== 'pos') return;
    const keys = { F2: () => $('#pos-search').focus(), F4: holdBill, F8: () => openCustomerPicker(), F9: () => openPayment() };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); return; }

    const t = e.target;
    if (t.matches('input, textarea, select, [contenteditable]')) return;
    const now = Date.now();
    if (e.key === 'Enter') {
      if (scanBuf.length >= 3 && now - scanTime < 100) { e.preventDefault(); handleScan(scanBuf); }
      scanBuf = '';
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (now - scanTime > 100) scanBuf = '';
      scanBuf += e.key;
      scanTime = now;
    }
  });

  // อัปเดตเวลาที่วิ่งอยู่ (ผังห้อง/โต๊ะ, ค่าเวลาในบิลเปิด) ทุก 20 วินาที
  setInterval(() => {
    if (modalStack.length || document.hidden) return;
    const typing = document.activeElement?.matches('input, textarea, select') && $('#main').contains(document.activeElement);
    if (ui.view === 'units' && ui.unitsTab === 'board' && !typing) drawBoard();
    if (ui.view === 'pos' && activeSession()) renderCart();
  }, 20000);

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });

  go('pos');
  updateBadges();
  if (!db.settings.setupDone) openSetupWizard();
});
