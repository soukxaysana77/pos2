'use strict';
/* =========================================================
   Universal POS — core: utilities, ประเภทร้าน, ข้อมูลตัวอย่าง, การคำนวณราคา, modal
   ========================================================= */

const APP_KEY = 'universal-pos-v1';

const UNITS = ['ชิ้น', 'อัน', 'กล่อง', 'แพ็ค', 'โหล', 'ขวด', 'กระป๋อง', 'ถุง', 'ซอง', 'แผง', 'ชุด', 'คู่', 'ตัว', 'ด้าม', 'เล่ม', 'เครื่อง', 'แก้ว', 'จาน', 'ชาม', 'ที่', 'กก.', 'กรัม', 'ลิตร', 'มล.', 'เมตร', 'ซม.', 'หลา', 'ชั่วโมง', 'ครั้ง', 'คน', 'วัน', 'เดือน'];
const DECIMAL_UNITS = ['กก.', 'กรัม', 'ลิตร', 'มล.', 'เมตร', 'ซม.', 'หลา', 'ชั่วโมง'];
const EMOJIS = ['📦', '☕', '🧋', '🥤', '🍜', '🍛', '🍔', '🍰', '🍞', '🛒', '🥬', '🍎', '🥩', '🐟', '🥚', '🍚', '👕', '👖', '👗', '👟', '👜', '💍', '💄', '🧴', '💊', '📱', '💻', '🎧', '🔌', '🔋', '✏️', '📚', '🧸', '🎮', '🛠️', '✂️', '🚗', '🌸', '🐶', '⚽', '🏠', '🎁'];
const PAY_METHODS = {
  cash: { label: 'เงินสด', icon: '💵' },
  transfer: { label: 'โอน / พร้อมเพย์', icon: '📱' },
  card: { label: 'บัตรเครดิต/เดบิต', icon: '💳' },
  other: { label: 'อื่น ๆ / คูปอง', icon: '🎟️' },
  deposit: { label: 'หักเงินมัดจำ', icon: '🔐', internal: true }, // ใช้ภายใน: นำเงินมัดจำที่รับไว้มาชำระบิล
};
const STOCK_REASONS = { sale: 'ขาย', refund: 'คืนเงิน', receive: 'รับเข้า', remove: 'นำออก', count: 'ตรวจนับ', edit: 'แก้ไขสินค้า', initial: 'ยอดยกมา', import: 'นำเข้า' };
const RANGES = { today: 'วันนี้', yesterday: 'เมื่อวาน', '7d': '7 วัน', '30d': '30 วัน', month: 'เดือนนี้', lastmonth: 'เดือนก่อน', all: 'ทั้งหมด', custom: 'กำหนดเอง' };
const SEARCH_ICON = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

/* ---------- Utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((num(n) + Number.EPSILON) * 1000) / 1000;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function money(n, withSymbol = true) {
  const d = db.settings.decimals;
  const s = num(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
  return withSymbol ? db.settings.currencySymbol + s : s;
}
const fmtQty = (n) => num(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
function toISODate(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }

function ean13(base12) {
  const d = String(base12).padStart(12, '0').slice(0, 12);
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d[i] * (i % 2 ? 3 : 1);
  return d + ((10 - (s % 10)) % 10);
}

function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

function resizeImage(file, max = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
const toCSV = (rows) => '﻿' + rows.map((r) => r.map((v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\r\n');

/* PromptPay (EMVCo) payload */
function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function promptpayPayload(id, amount) {
  const f = (tag, val) => tag + String(val.length).padStart(2, '0') + val;
  let target = String(id).replace(/\D/g, '');
  let sub;
  if (target.length >= 15) sub = f('03', target);
  else if (target.length >= 13) sub = f('02', target);
  else sub = f('01', ('0000000000000' + target.replace(/^0/, '66')).slice(-13));
  const merchant = f('00', 'A000000677010111') + sub;
  const payload = f('00', '01') + f('01', amount ? '12' : '11') + f('29', merchant) + f('53', '764')
    + (amount ? f('54', num(amount).toFixed(2)) : '') + f('58', 'TH') + '6304';
  return payload + crc16(payload);
}

/* ---------- Business types (ใช้ในตัวช่วยตั้งค่าร้าน — เลือกได้หลายแบบ) ---------- */
const CATEGORY_COLORS = ['#8b5cf6', '#f97316', '#10b981', '#ec4899', '#3b82f6', '#14b8a6', '#eab308', '#ef4444', '#64748b'];
const BUSINESS_SECTIONS = [
  ['shop', '🛍️ ขายสินค้า & อาหาร'],
  ['stay', '🏨 ที่พัก'],
  ['rent', '🚗 ให้เช่า'],
  ['time', '⏱️ คิดเงินตามเวลา'],
  ['job', '🧾 บริการ & รับงาน'],
];
// units = ห้อง/โต๊ะ/รถ ที่สร้างให้ตอนตั้งค่า, bookings = ใช้การจองล่วงหน้า, jobs = ใช้งานรับฝาก/ออเดอร์
const BUSINESS_TYPES = {
  retail: {
    section: 'shop', label: 'ร้านค้าปลีก / มินิมาร์ท', icon: '🛒', desc: 'ของชำ เครื่องดื่ม ของใช้ ขายด้วยบาร์โค้ด',
    cats: [['เครื่องดื่ม', '🥤'], ['ขนม & ของว่าง', '🍪'], ['อาหารแห้ง', '🍜'], ['ของใช้ในบ้าน', '🧺'], ['ของใช้ส่วนตัว', '🧴'], ['เครื่องเขียน', '✏️']],
    unit: 'ชิ้น', track: true, demo: ['c-drink', 'c-grocery', 'c-health', 'c-stationery'],
  },
  restaurant: {
    section: 'shop', label: 'ร้านอาหาร', icon: '🍜', desc: 'เปิดโต๊ะ สั่งอาหาร เช็คบิล หรือขายหน้าร้าน',
    cats: [['อาหารจานเดียว', '🍛'], ['กับข้าว', '🍲'], ['ก๋วยเตี๋ยว', '🍜'], ['เครื่องดื่ม', '🥤'], ['ของหวาน', '🍧']],
    unit: 'จาน', track: false, demo: ['c-food', 'c-drink'],
    units: { kind: 'table_tab', count: 10, prefix: 'โต๊ะ ', start: 1, group: 'ในร้าน' },
  },
  cafe: {
    section: 'shop', label: 'คาเฟ่ / ร้านเครื่องดื่ม', icon: '☕', desc: 'กาแฟ ชา เบเกอรี่ เลือกความหวาน/ท็อปปิ้ง',
    cats: [['กาแฟ', '☕'], ['ชา & นม', '🧋'], ['สมูทตี้ & โซดา', '🥤'], ['เบเกอรี่', '🥐']],
    unit: 'แก้ว', track: false, demo: ['c-drink', 'c-food'],
  },
  bar: {
    section: 'shop', label: 'ผับ / บาร์ / ร้านเหล้า', icon: '🍻', desc: 'เปิดโต๊ะ สั่งเครื่องดื่ม เช็คบิลรวม',
    cats: [['เบียร์ & เหล้า', '🍺'], ['เครื่องดื่ม', '🥤'], ['กับแกล้ม & ผลไม้', '🍢']],
    unit: 'ขวด', track: true, demo: ['c-ktv', 'c-drink', 'c-food'],
    units: { kind: 'table_tab', count: 12, prefix: 'โต๊ะ ', start: 1, group: 'ในร้าน' },
  },
  fashion: {
    section: 'shop', label: 'เสื้อผ้า & แฟชั่น', icon: '👕', desc: 'สินค้าหลายไซซ์/หลายสี แยกสต็อกแต่ละแบบ',
    cats: [['เสื้อ', '👕'], ['กางเกง', '👖'], ['ชุดเดรส', '👗'], ['รองเท้า', '👟'], ['กระเป๋า & เครื่องประดับ', '👜']],
    unit: 'ตัว', track: true, demo: ['c-fashion'],
  },
  health: {
    section: 'shop', label: 'ร้านยา / สุขภาพ & ความงาม', icon: '💊', desc: 'ยา เวชภัณฑ์ วิตามิน เครื่องสำอาง',
    cats: [['ยาสามัญ', '💊'], ['วิตามิน & อาหารเสริม', '🧪'], ['เวชภัณฑ์', '🩹'], ['ความงาม', '💄'], ['ของใช้ส่วนตัว', '🧴']],
    unit: 'ชิ้น', track: true, demo: ['c-health'],
  },
  fresh: {
    section: 'shop', label: 'ของสด / ตลาด', icon: '🥬', desc: 'ผัก ผลไม้ เนื้อสัตว์ ขายตามน้ำหนัก',
    cats: [['ผัก', '🥬'], ['ผลไม้', '🍎'], ['เนื้อสัตว์', '🥩'], ['อาหารทะเล', '🐟'], ['ของแห้ง', '🧄']],
    unit: 'กก.', track: true, decimal: true, demo: ['c-fresh', 'c-grocery'],
  },
  general: {
    section: 'shop', label: 'อื่น ๆ / ขายหลายอย่าง', icon: '🏪', desc: 'ใช้ได้กับทุกประเภท ปรับแต่งเองภายหลัง',
    cats: [['ทั่วไป', '📦']], unit: 'ชิ้น', track: true, demo: null,
  },
  hotel: {
    section: 'stay', label: 'โรงแรม / รีสอร์ท', icon: '🏨', desc: 'ห้องพักรายคืน เช็คอิน–เช็คเอาท์ จองล่วงหน้า',
    cats: [['บริการห้องพัก', '🛎️'], ['เครื่องดื่ม', '🥤'], ['อาหาร', '🍳']],
    unit: 'ครั้ง', track: false, demo: ['c-stay', 'c-drink', 'c-food'], bookings: true,
    units: { kind: 'room_night', count: 10, prefix: 'ห้อง ', start: 101, group: 'ห้องสแตนดาร์ด' },
  },
  homestay: {
    section: 'stay', label: 'บ้านพัก / โฮมสเตย์ / พูลวิลล่า', icon: '🏡', desc: 'บ้านทั้งหลังรายคืน ราคาวันหยุดแยกได้',
    cats: [['บริการห้องพัก', '🛎️'], ['เครื่องดื่ม', '🥤'], ['อาหาร', '🍳'], ['กิจกรรม', '🛶']],
    unit: 'ครั้ง', track: false, demo: ['c-stay', 'c-drink', 'c-food'], bookings: true,
    units: { kind: 'house_night', count: 4, prefix: 'บ้านพัก ', start: 1, group: 'บ้านพัก' },
  },
  hostel: {
    section: 'stay', label: 'โฮสเทล / เกสต์เฮาส์', icon: '🛏️', desc: 'ขายรายเตียงหรือรายห้อง',
    cats: [['บริการห้องพัก', '🛎️'], ['เครื่องดื่ม', '🥤'], ['ของว่าง', '🍿']],
    unit: 'ครั้ง', track: false, demo: ['c-stay', 'c-drink'], bookings: true,
    units: { kind: 'bed_night', count: 8, prefix: 'เตียง ', start: 1, group: 'ห้องรวม' },
  },
  camping: {
    section: 'stay', label: 'ลานกางเต็นท์ / แคมป์ปิ้ง', icon: '⛺', desc: 'คิดต่อคนต่อคืน เช่าเต็นท์และอุปกรณ์',
    cats: [['เช่าอุปกรณ์', '⛺'], ['อาหาร', '🍢'], ['เครื่องดื่ม', '🥤'], ['ฟืน & ถ่าน', '🔥']],
    unit: 'ชิ้น', track: false, demo: ['c-stay', 'c-rental', 'c-food'], bookings: true,
    units: { kind: 'tent_night', count: 10, prefix: 'ลาน ', start: 1, group: 'ลานกางเต็นท์' },
  },
  apartment: {
    section: 'stay', label: 'หอพัก / อพาร์ทเมนต์ / ห้องเช่า', icon: '🏢', desc: 'ค่าเช่ารายเดือน ค่าน้ำ–ไฟตามมิเตอร์ เงินประกัน',
    cats: [['ค่าน้ำ ค่าไฟ & ส่วนกลาง', '💡'], ['ค่าบริการอื่น ๆ', '🧾']],
    unit: 'หน่วย', track: false, demo: ['c-utility'],
    units: { kind: 'room_month', count: 10, prefix: 'ห้อง ', start: 101, group: 'ชั้น 1' },
  },
  car_rental: {
    section: 'rent', label: 'รถเช่า', icon: '🚗', desc: 'เช่ารายวัน มัดจำ เลขไมล์ ค่าเกินเวลา',
    cats: [['อุปกรณ์เสริม & ประกัน', '🧰'], ['ค่าบริการเพิ่มเติม', '🧾']],
    unit: 'ครั้ง', track: false, demo: ['c-rental'], bookings: true,
    units: { kind: 'car_day', count: 5, prefix: 'รถคันที่ ', start: 1, group: 'รถยนต์' },
  },
  bike_rental: {
    section: 'rent', label: 'เช่ามอเตอร์ไซค์ / จักรยาน', icon: '🛵', desc: 'เช่ารายวันหรือรายชั่วโมง พร้อมมัดจำ',
    cats: [['อุปกรณ์เสริม & ประกัน', '🧰'], ['ค่าบริการเพิ่มเติม', '🧾']],
    unit: 'ครั้ง', track: false, demo: ['c-rental', 'c-drink'], bookings: true,
    units: { kind: 'bike_day', count: 10, prefix: 'มอเตอร์ไซค์ ', start: 1, group: 'มอเตอร์ไซค์' },
  },
  equipment: {
    section: 'rent', label: 'เช่าอุปกรณ์ / ชุด / กล้อง', icon: '🎒', desc: 'ของให้เช่ารายวัน พร้อมมัดจำและสภาพของ',
    cats: [['อุปกรณ์เสริม & ประกัน', '🧰'], ['ค่าบริการเพิ่มเติม', '🧾']],
    unit: 'ชิ้น', track: false, demo: ['c-rental'], bookings: true,
    units: { kind: 'item_day', count: 5, prefix: 'ชุดที่ ', start: 1, group: 'อุปกรณ์' },
  },
  ktv: {
    section: 'time', label: 'KTV / คาราโอเกะ', icon: '🎤', desc: 'ห้องรายชั่วโมง ราคาตามช่วงเวลา สั่งของเข้าห้อง',
    cats: [['เบียร์ & เหล้า', '🍺'], ['เครื่องดื่ม', '🥤'], ['กับแกล้ม & ผลไม้', '🍢']],
    unit: 'ขวด', track: true, demo: ['c-ktv', 'c-drink', 'c-food'], bookings: true,
    units: { kind: 'ktv_hour', count: 6, prefix: 'KTV ', start: 1, group: 'ห้อง KTV' },
  },
  snooker: {
    section: 'time', label: 'สนุกเกอร์ / พูล', icon: '🎱', desc: 'โต๊ะคิดเวลา สั่งเครื่องดื่มเข้าโต๊ะ',
    cats: [['เครื่องดื่ม', '🥤'], ['ของว่าง', '🍿'], ['อุปกรณ์', '🎱']],
    unit: 'ชิ้น', track: true, demo: ['c-sport', 'c-drink', 'c-ktv'],
    units: { kind: 'table_hour', count: 6, prefix: 'โต๊ะ ', start: 1, group: 'โต๊ะสนุกเกอร์' },
  },
  sports: {
    section: 'time', label: 'สนามกีฬา (แบด ฟุตซอล เทนนิส)', icon: '🏸', desc: 'จองสนามรายชั่วโมง ราคากลางวัน/กลางคืน',
    cats: [['อุปกรณ์กีฬา', '🏸'], ['เครื่องดื่ม', '🥤']],
    unit: 'ชิ้น', track: true, demo: ['c-sport', 'c-drink'], bookings: true,
    units: { kind: 'court_hour', count: 4, prefix: 'คอร์ท ', start: 1, group: 'สนาม' },
  },
  gaming: {
    section: 'time', label: 'ร้านเกม / อินเทอร์เน็ต / Co-working', icon: '🖥️', desc: 'คิดเวลาตามเครื่องหรือที่นั่ง',
    cats: [['เครื่องดื่ม', '🥤'], ['อาหาร', '🍜'], ['ของว่าง', '🍿']],
    unit: 'ชิ้น', track: true, demo: ['c-drink', 'c-food'],
    units: { kind: 'seat_hour', count: 12, prefix: 'เครื่อง ', start: 1, group: 'โซนคอม' },
  },
  meeting: {
    section: 'time', label: 'ห้องประชุม / สตูดิโอ / ห้องซ้อม', icon: '🎙️', desc: 'จองห้องรายชั่วโมง',
    cats: [['เครื่องดื่ม', '🥤'], ['อาหาร', '🍳'], ['อุปกรณ์เสริม', '🎛️']],
    unit: 'ชิ้น', track: false, demo: ['c-drink', 'c-food'], bookings: true,
    units: { kind: 'room_hour', count: 2, prefix: 'ห้อง ', start: 1, group: 'ห้อง' },
  },
  spa: {
    section: 'time', label: 'นวด / สปา', icon: '💆', desc: 'เตียงบริการ คิวนัดหมาย คอร์สนวด',
    cats: [['นวด', '💆'], ['สปา & ทรีตเมนต์', '🧖'], ['สินค้า', '🧴']],
    unit: 'ครั้ง', track: false, demo: ['c-spa', 'c-drink'], bookings: true,
    units: { kind: 'bed_tab', count: 4, prefix: 'เตียง ', start: 1, group: 'เตียงนวด' },
  },
  parking: {
    section: 'time', label: 'ที่จอดรถ', icon: '🅿️', desc: 'คิดค่าจอดรายชั่วโมง บันทึกทะเบียนรถ',
    cats: [['ค่าบริการเพิ่มเติม', '🧾']], unit: 'ครั้ง', track: false, demo: ['c-drink'],
    units: { kind: 'slot_hour', count: 20, prefix: 'ช่อง ', start: 1, group: 'ลานจอด' },
  },
  custom_units: {
    section: 'time', label: 'อื่น ๆ ที่คิดตามเวลา / ให้เช่า', icon: '⏱️', desc: 'ตั้งชื่อ หน่วย และวิธีคิดเงินเองได้ทั้งหมด',
    cats: [['ทั่วไป', '📦']], unit: 'ชิ้น', track: true, demo: ['c-drink', 'c-food'], bookings: true,
    units: { kind: 'custom', count: 3, prefix: 'หน่วยที่ ', start: 1, group: 'ทั่วไป' },
  },
  service: {
    section: 'job', label: 'ร้านทำผม / เสริมสวย / ทำเล็บ', icon: '💇', desc: 'บริการตามคิว นัดหมายล่วงหน้า',
    cats: [['บริการ', '✂️'], ['สินค้า', '🧴']], unit: 'ครั้ง', track: false, demo: ['c-service', 'c-health'], bookings: true,
    units: { kind: 'chair_tab', count: 3, prefix: 'ช่างคนที่ ', start: 1, group: 'ช่าง' },
  },
  repair: {
    section: 'job', label: 'ร้านซ่อม (มือถือ คอม รถ เครื่องใช้)', icon: '🔧', desc: 'รับงาน ออกใบรับงาน ติดตามสถานะ นัดรับ',
    cats: [['ค่าบริการ & ค่าแรง', '🛠️'], ['อะไหล่', '🔩']], unit: 'ครั้ง', track: true, demo: ['c-repair'], jobs: true,
  },
  laundry: {
    section: 'job', label: 'ร้านซักรีด', icon: '🧺', desc: 'รับผ้า คิดตามกิโล/ชิ้น นัดรับผ้า',
    cats: [['ซัก-อบ-รีด', '🧺'], ['ซักแห้ง & งานพิเศษ', '👔']], unit: 'กก.', track: false, decimal: true, demo: ['c-laundry'], jobs: true,
  },
  tailor: {
    section: 'job', label: 'สั่งทำ / ตัดเย็บ / งานพิมพ์', icon: '✂️', desc: 'รับออเดอร์ มัดจำ นัดส่งงาน',
    cats: [['งานสั่งทำ', '🧵'], ['วัสดุ', '📦']], unit: 'ชิ้น', track: false, demo: ['c-tailor'], jobs: true,
  },
};
const businessType = (key) => BUSINESS_TYPES[key] || BUSINESS_TYPES.general;

/* ---------- ห้อง / โต๊ะ / รถ / สนาม: ชนิดของหน่วยและวิธีคิดเงิน ---------- */
const KIND_FAMILY = {
  stay: { open: 'เช็คอิน', close: 'เช็คเอาท์', busy: 'มีผู้เข้าพัก', start: 'เช็คอิน', end: 'เช็คเอาท์' },
  rent: { open: 'ปล่อยเช่า', close: 'รับคืน & คิดเงิน', busy: 'ถูกเช่าอยู่', start: 'รับไป', end: 'กำหนดคืน' },
  time: { open: 'เริ่มใช้งาน', close: 'ปิด & คิดเงิน', busy: 'กำลังใช้งาน', start: 'เริ่ม', end: 'สิ้นสุด' },
  tab: { open: 'เปิดบิล', close: 'เช็คบิล', busy: 'มีลูกค้า', start: 'เปิดเมื่อ', end: 'สิ้นสุด' },
  job: { open: 'รับงาน', close: 'ส่งมอบ & ชำระเงิน', busy: 'รับงานแล้ว', start: 'รับงาน', end: 'นัดรับ' },
};
const STAY_FIELDS = ['เลขบัตรประชาชน / พาสปอร์ต', 'ทะเบียนรถ'];
const UNIT_KINDS = {
  room_night: {
    family: 'stay', icon: '🛏️', noun: 'ห้อง', menu: 'ห้องพัก', label: 'ห้องพัก (รายคืน)', charge: 'ค่าห้องพัก', cleaning: true, fields: STAY_FIELDS,
    pricing: { mode: 'night', price: 1200, weekendPrice: 0, checkinTime: '14:00', checkoutTime: '12:00', graceMinutes: 30, extraHourPrice: 200 },
  },
  house_night: {
    family: 'stay', icon: '🏡', noun: 'หลัง', menu: 'บ้านพัก', label: 'บ้านพัก / วิลล่า (รายคืน)', charge: 'ค่าที่พัก', cleaning: true, fields: STAY_FIELDS,
    pricing: { mode: 'night', price: 2500, weekendPrice: 0, checkinTime: '14:00', checkoutTime: '12:00', graceMinutes: 30, extraHourPrice: 300 },
  },
  bed_night: {
    family: 'stay', icon: '🛌', noun: 'เตียง', menu: 'ห้องพัก', label: 'เตียง / ห้องรวม (รายคืน)', charge: 'ค่าเตียง', cleaning: true, fields: STAY_FIELDS,
    pricing: { mode: 'night', price: 350, weekendPrice: 0, checkinTime: '14:00', checkoutTime: '11:00', graceMinutes: 30, extraHourPrice: 50 },
  },
  tent_night: {
    family: 'stay', icon: '⛺', noun: 'ลาน', menu: 'ลานกางเต็นท์', label: 'ลานกางเต็นท์ (ต่อคนต่อคืน)', charge: 'ค่ากางเต็นท์', fields: ['ทะเบียนรถ'],
    pricing: { mode: 'night', price: 150, weekendPrice: 0, perPerson: true, checkinTime: '12:00', checkoutTime: '12:00', graceMinutes: 60, extraHourPrice: 0 },
  },
  room_month: {
    family: 'stay', icon: '🏢', noun: 'ห้อง', menu: 'ห้องเช่า', label: 'ห้องเช่ารายเดือน', charge: 'ค่าเช่าห้อง', deposit: 3500,
    fields: ['เลขบัตรประชาชน', 'เบอร์ติดต่อฉุกเฉิน', 'มิเตอร์ไฟเริ่มต้น', 'มิเตอร์น้ำเริ่มต้น'],
    labels: { open: 'เข้าพัก / ทำสัญญา', close: 'ย้ายออก & คิดเงิน', busy: 'มีผู้เช่า', start: 'เข้าพัก', end: 'สิ้นสุดสัญญา' },
    pricing: { mode: 'month', price: 3500, graceMinutes: 4320 },
  },
  car_day: {
    family: 'rent', icon: '🚗', noun: 'คัน', menu: 'รถเช่า', label: 'รถยนต์ให้เช่า (รายวัน)', charge: 'ค่าเช่ารถ', deposit: 3000,
    fields: ['เลขใบขับขี่ / บัตรประชาชน', 'เลขไมล์ตอนออก', 'น้ำมันตอนออก', 'เลขไมล์ตอนคืน', 'น้ำมันตอนคืน'],
    pricing: { mode: 'day', price: 1200, graceMinutes: 60, extraHourPrice: 150 },
  },
  bike_day: {
    family: 'rent', icon: '🛵', noun: 'คัน', menu: 'รถเช่า', label: 'มอเตอร์ไซค์ / จักรยาน (รายวัน)', charge: 'ค่าเช่ารถ', deposit: 1000,
    fields: ['เลขใบขับขี่ / บัตรประชาชน', 'เลขไมล์ตอนออก', 'เลขไมล์ตอนคืน'],
    pricing: { mode: 'day', price: 250, graceMinutes: 60, extraHourPrice: 50 },
  },
  item_day: {
    family: 'rent', icon: '🎒', noun: 'ชุด', menu: 'ของให้เช่า', label: 'อุปกรณ์ให้เช่า (รายวัน)', charge: 'ค่าเช่า', deposit: 1000,
    fields: ['เลขบัตรประชาชน', 'สภาพตอนออก', 'สภาพตอนคืน'],
    pricing: { mode: 'day', price: 300, graceMinutes: 60, extraHourPrice: 0 },
  },
  ktv_hour: {
    family: 'time', icon: '🎤', noun: 'ห้อง', menu: 'ห้อง KTV', label: 'ห้องคาราโอเกะ (รายชั่วโมง)', charge: 'ค่าห้อง',
    pricing: { mode: 'hour', price: 200, minMinutes: 60, roundMinutes: 30, graceMinutes: 5, bands: [] },
  },
  table_hour: {
    family: 'time', icon: '🎱', noun: 'โต๊ะ', menu: 'โต๊ะ', label: 'โต๊ะสนุกเกอร์ / พูล (รายชั่วโมง)', charge: 'ค่าโต๊ะ',
    pricing: { mode: 'hour', price: 120, minMinutes: 30, roundMinutes: 15, graceMinutes: 3, bands: [] },
  },
  court_hour: {
    family: 'time', icon: '🏸', noun: 'คอร์ท', menu: 'สนาม', label: 'สนามกีฬา (รายชั่วโมง)', charge: 'ค่าสนาม',
    pricing: { mode: 'hour', price: 200, minMinutes: 60, roundMinutes: 30, graceMinutes: 5, bands: [] },
  },
  seat_hour: {
    family: 'time', icon: '🖥️', noun: 'เครื่อง', menu: 'เครื่อง', label: 'คอมพิวเตอร์ / ที่นั่ง (รายชั่วโมง)', charge: 'ค่าใช้เครื่อง',
    pricing: { mode: 'hour', price: 20, minMinutes: 15, roundMinutes: 15, graceMinutes: 2, bands: [] },
  },
  room_hour: {
    family: 'time', icon: '🚪', noun: 'ห้อง', menu: 'ห้อง', label: 'ห้องประชุม / สตูดิโอ (รายชั่วโมง)', charge: 'ค่าห้อง',
    pricing: { mode: 'hour', price: 500, minMinutes: 60, roundMinutes: 30, graceMinutes: 10, bands: [] },
  },
  slot_hour: {
    family: 'time', icon: '🅿️', noun: 'ช่อง', menu: 'ที่จอดรถ', label: 'ช่องจอดรถ (รายชั่วโมง)', charge: 'ค่าจอดรถ', fields: ['ทะเบียนรถ'],
    labels: { open: 'รถเข้า', close: 'รถออก & คิดเงิน', busy: 'มีรถจอด', start: 'เวลาเข้า', end: 'เวลาออก' },
    pricing: { mode: 'hour', price: 20, minMinutes: 60, roundMinutes: 60, graceMinutes: 15, bands: [] },
  },
  table_tab: {
    family: 'tab', icon: '🍽️', noun: 'โต๊ะ', menu: 'โต๊ะ', label: 'โต๊ะอาหาร / เครื่องดื่ม (ไม่คิดเวลา)', charge: 'ค่าบริการ',
    labels: { open: 'เปิดโต๊ะ' }, pricing: { mode: 'none' },
  },
  bed_tab: {
    family: 'tab', icon: '💆', noun: 'เตียง', menu: 'เตียงนวด', label: 'เตียงนวด / ห้องสปา (ไม่คิดเวลา)', charge: 'ค่าบริการ',
    labels: { open: 'เริ่มให้บริการ', close: 'คิดเงิน', busy: 'กำลังให้บริการ' }, pricing: { mode: 'none' },
  },
  chair_tab: {
    family: 'tab', icon: '💇', noun: 'คิว', menu: 'คิวบริการ', label: 'ช่าง / เก้าอี้บริการ (ไม่คิดเวลา)', charge: 'ค่าบริการ',
    labels: { open: 'เริ่มให้บริการ', close: 'คิดเงิน', busy: 'กำลังให้บริการ' }, pricing: { mode: 'none' },
  },
  custom: {
    family: 'time', icon: '📍', noun: 'หน่วย', menu: 'บริการ', label: 'อื่น ๆ (กำหนดเอง)', charge: 'ค่าบริการ',
    pricing: { mode: 'hour', price: 100, minMinutes: 60, roundMinutes: 30, graceMinutes: 5, bands: [] },
  },
};
const unitKind = (k) => UNIT_KINDS[k] || UNIT_KINDS.custom;
const kindLabels = (k) => (k === 'job' ? KIND_FAMILY.job : { ...KIND_FAMILY[unitKind(k).family], ...(unitKind(k).labels || {}) });
const PRICING_MODES = {
  none: { label: 'ไม่คิดตามเวลา (เปิดบิลอย่างเดียว)', per: '' },
  hour: { label: 'รายชั่วโมง', per: 'ชม.' },
  night: { label: 'รายคืน (เช็คอิน–เช็คเอาท์)', per: 'คืน' },
  day: { label: 'รายวัน (ทุก 24 ชม.)', per: 'วัน' },
  month: { label: 'รายเดือน', per: 'เดือน' },
  flat: { label: 'เหมาจ่ายต่อครั้ง', per: 'ครั้ง' },
};

function presetCategories(types) {
  const list = [];
  [].concat(types).forEach((t) => businessType(t).cats.forEach(([name, icon]) => {
    if (!list.some((c) => c.name === name)) list.push({ id: uid(), name, icon, color: CATEGORY_COLORS[list.length % CATEGORY_COLORS.length] });
  }));
  return list;
}
function applyBusinessDefaults(settings, types) {
  types = [].concat(types).filter((t) => BUSINESS_TYPES[t]);
  if (!types.length) types = ['general'];
  const all = types.map(businessType);
  Object.assign(settings, {
    businessTypes: types, businessType: types[0],
    defaultUnit: all[0].unit, defaultTrackStock: all[0].track, defaultDecimalQty: !!all[0].decimal,
    useUnits: all.some((t) => t.units), useBookings: all.some((t) => t.bookings), useJobs: all.some((t) => t.jobs),
  });
}

function makeUnit(kind, name, extra = {}) {
  const k = unitKind(kind);
  return {
    id: uid(), name, group: '', kind, icon: k.icon, pricing: structuredClone(k.pricing), defaultDeposit: k.deposit || 0,
    status: 'available', note: '', active: true, createdAt: new Date().toISOString(), ...extra,
  };
}
// plan: [{ kind, count, prefix, start, price, group }] — ชื่อซ้ำ (เช่น ห้อง 101 ของโรงแรมและหอพัก) จะเติมชื่อกลุ่มต่อท้าย
function unitsFromPlan(plan, existingNames = (typeof db !== 'undefined' && db ? db.units.map((u) => u.name) : [])) {
  const out = [];
  const used = new Set(existingNames);
  (plan || []).forEach((p) => {
    for (let i = 0; i < Math.min(500, Math.max(0, Math.round(num(p.count)))); i++) {
      let name = `${p.prefix || ''}${num(p.start) + i}`.trim();
      if (used.has(name)) name = `${name} · ${p.group || unitKind(p.kind).menu}`;
      used.add(name);
      const u = makeUnit(p.kind, name, { group: p.group || '' });
      if (u.pricing.mode !== 'none' && p.price !== undefined && p.price !== '') u.pricing.price = num(p.price);
      out.push(u);
    }
  });
  return out;
}
const defaultUnitPlan = (types) => [].concat(types).map((t) => businessType(t).units).filter(Boolean)
  .map((p) => ({ ...p, price: unitKind(p.kind).pricing.price }));

/* ---------- คิดเงินตามเวลา ---------- */
const hhmm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const atTime = (d, s) => { const x = startOfDay(d); x.setMinutes(hhmm(s)); return x; };
const addMinutes = (d, n) => new Date(new Date(d).getTime() + n * 60000);
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) {
  const x = new Date(d), day = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}
function fmtDuration(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d ? `${d} วัน` : '', h ? `${h} ชม.` : '', m || (!d && !h) ? `${m} นาที` : ''].filter(Boolean).join(' ');
}
const fmtTime = (d) => new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const fmtDayShort = (d) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

// สรุปกติกาการคิดเงินเป็นข้อความสั้น ๆ — แสดงให้ผู้ใช้เห็นทุกเงื่อนไข ไม่มีค่าใช้จ่ายซ่อน
function pricingSummary(pr) {
  if (!pr || pr.mode === 'none') return 'ไม่คิดค่าเวลา — คิดตามรายการที่สั่ง';
  const p = (n) => money(n);
  const parts = [`${p(pr.price)}/${PRICING_MODES[pr.mode].per}${pr.perPerson ? '/คน' : ''}`];
  const late = (unit) => (num(pr.extraHourPrice) > 0 ? `ชั่วโมงละ ${p(pr.extraHourPrice)}` : `คิดเพิ่ม 1 ${unit}`);
  if (pr.mode === 'night') {
    if (num(pr.weekendPrice) > 0) parts.push(`คืนศุกร์–เสาร์ ${p(pr.weekendPrice)}`);
    parts.push(`เช็คอิน ${pr.checkinTime || '14:00'} · เช็คเอาท์ ${pr.checkoutTime || '12:00'}`);
    parts.push(`ออกช้าเกิน ${num(pr.graceMinutes)} นาที ${late('คืน')}`);
  } else if (pr.mode === 'day') {
    parts.push(`คืนช้าเกิน ${num(pr.graceMinutes)} นาที ${late('วัน')}`);
  } else if (pr.mode === 'hour') {
    parts.push(`ขั้นต่ำ ${num(pr.minMinutes)} นาที · ปัดทีละ ${num(pr.roundMinutes) || 1} นาที`);
    (pr.bands || []).filter((b) => num(b.price) > 0).forEach((b) => parts.push(`${b.from}–${b.to} ${p(b.price)}/ชม.`));
  } else if (pr.mode === 'month') {
    parts.push(`ผ่อนผัน ${Math.round(num(pr.graceMinutes) / 1440)} วัน`);
  }
  return parts.join(' · ');
}

function timeLine(name, qty, unit, price, note = '') {
  return {
    id: `t-${Math.random().toString(36).slice(2, 9)}`, productId: null, variantId: null, name, variantName: '', options: [], note,
    unit, qty: r3(qty), price: r2(price), cost: 0, discountType: 'amount', discountValue: 0, taxable: true, decimalQty: true, categoryId: '', isTime: true,
  };
}

// คำนวณค่าเวลาตามวิธีคิดเงิน — final = เช็คเอาท์จริง (คิดค่าเกินเวลา), minOne = คิดขั้นต่ำ 1 หน่วย
function computeTimeCharge(pr, fromISO, toISO, guests = 1, { final = true, label = 'ค่าบริการ', minOne = true } = {}) {
  pr = pr || { mode: 'none' };
  const from = new Date(fromISO);
  const to = new Date(Math.max(new Date(toISO).getTime(), from.getTime()));
  const minutes = Math.floor((to - from) / 60000); // นับเป็นนาทีเต็ม ไม่คิดเศษวินาที
  const pax = pr.perPerson ? Math.max(1, Math.round(num(guests))) : 1;
  const out = { lines: [], units: 0, unitLabel: PRICING_MODES[pr.mode]?.per || '', from: from.toISOString(), until: to.toISOString(), minutes };
  const price = num(pr.price);
  const push = (name, qty, unit, p, note) => {
    if (qty <= 0) return;
    const l = timeLine(name, qty, unit, p * pax, note + (pax > 1 ? ` · ${pax} คน` : ''));
    l.taxable = pr.taxable !== false;
    out.lines.push(l);
  };

  if (pr.mode === 'hour') {
    const round = Math.max(1, num(pr.roundMinutes) || 1);
    let billed = Math.ceil(Math.max(0, minutes - num(pr.graceMinutes)) / round) * round;
    if (minOne) billed = Math.max(billed, num(pr.minMinutes));
    out.units = r3(billed / 60);
    const bands = (pr.bands || []).filter((b) => b.from && b.to && num(b.price) > 0);
    const groups = new Map();
    if (!bands.length) groups.set(price, { minutes: billed, band: null });
    else {
      for (let i = 0; i < Math.min(billed, 60 * 24 * 62); i++) {
        const t = new Date(from.getTime() + i * 60000);
        const m = t.getHours() * 60 + t.getMinutes();
        const band = bands.find((b) => { const f = hhmm(b.from), e = hhmm(b.to); return f < e ? m >= f && m < e : m >= f || m < e; });
        const p = band ? num(band.price) : price;
        const g = groups.get(p) || { minutes: 0, band };
        g.minutes++;
        groups.set(p, g);
      }
    }
    groups.forEach((g, p) => push(g.band ? `${label} (${g.band.from}–${g.band.to})` : label, g.minutes / 60, 'ชม.', p,
      `${fmtTime(from)}–${fmtTime(to)} · คิด ${fmtDuration(g.minutes)}`));
  } else if (pr.mode === 'night') {
    const startDay = startOfDay(from);
    let nights = Math.round((startOfDay(to) - startDay) / 864e5);
    let lateMin = 0;
    if (final && nights >= 1) {
      const outMin = hhmm(pr.checkoutTime || '12:00'), toMin = to.getHours() * 60 + to.getMinutes();
      if (toMin > outMin + num(pr.graceMinutes)) lateMin = toMin - outMin;
    }
    if (minOne) nights = Math.max(1, nights);
    const wk = num(pr.weekendPrice);
    const priceOf = (d) => (wk > 0 && [5, 6].includes(d.getDay()) ? wk : price);
    let normal = 0, weekend = 0;
    for (let i = 0; i < nights; i++) { if (priceOf(addDays(startDay, i)) !== price) weekend++; else normal++; }
    const range = `${fmtDayShort(startDay)} – ${fmtDayShort(addDays(startDay, nights))}`;
    push(label, normal, 'คืน', price, range);
    push(`${label} (คืนศุกร์–เสาร์)`, weekend, 'คืน', wk, range);
    out.units = nights;
    if (lateMin > 0) {
      const hours = Math.ceil(lateMin / 60), fee = num(pr.extraHourPrice), nightPrice = priceOf(addDays(startDay, nights));
      if (fee > 0 && hours * fee < nightPrice) push(`${label} (เช็คเอาท์ช้า)`, hours, 'ชม.', fee, `เกินเวลา ${fmtDuration(lateMin)}`);
      else { push(`${label} (เช็คเอาท์ช้า คิดเพิ่ม 1 คืน)`, 1, 'คืน', nightPrice, `เกินเวลา ${fmtDuration(lateMin)}`); out.units++; }
    }
    out.until = atTime(addDays(startDay, nights), pr.checkinTime || '14:00').toISOString();
  } else if (pr.mode === 'day') {
    let days = Math.floor(minutes / 1440);
    const rem = minutes - days * 1440;
    let extraHours = 0;
    if (rem > num(pr.graceMinutes)) {
      const hours = Math.ceil(rem / 60), fee = num(pr.extraHourPrice);
      if (final && days >= 1 && fee > 0 && hours * fee < price) extraHours = hours;
      else days++;
    }
    if (minOne) days = Math.max(1, days);
    push(label, days, 'วัน', price, `${fmtDayShort(from)} ${fmtTime(from)} – ${fmtDayShort(to)} ${fmtTime(to)}`);
    push(`${label} (เกินเวลา)`, extraHours, 'ชม.', num(pr.extraHourPrice), `เกิน ${fmtDuration(rem)}`);
    out.units = days;
    out.until = addMinutes(from, days * 1440).toISOString();
  } else if (pr.mode === 'month') {
    const limit = addMinutes(to, -num(pr.graceMinutes));
    let months = 0;
    while (months < 600 && addMonths(from, months) < limit) months++;
    if (minOne) months = Math.max(1, months);
    const end = addMonths(from, months);
    push(label, months, 'เดือน', price, `${fmtDayShort(from)} – ${fmtDayShort(end)}`);
    out.units = months;
    out.until = end.toISOString();
  } else if (pr.mode === 'flat') {
    if (minOne) { push(label, 1, 'ครั้ง', price, ''); out.units = 1; }
  }
  return out;
}

/* ---------- Data store ---------- */
function defaultSettings() {
  return {
    shopName: 'ร้านของฉัน', branch: '', address: '', phone: '', taxId: '',
    currencySymbol: '฿', decimals: 2,
    taxMode: 'none', taxRate: 7, serviceRate: 0, rounding: 0,
    promptpayId: '', allowNegativeStock: false, defaultLowStock: 5,
    pointsPer: 100, receiptFooter: 'ขอบคุณที่ใช้บริการ', paperWidth: 80, autoPrint: false,
    cashier: 'แคชเชียร์ 1', theme: 'light', invoicePrefix: 'INV',
    setupDone: false, businessType: 'general', businessTypes: ['general'], defaultUnit: 'ชิ้น', defaultTrackStock: true, defaultDecimalQty: false,
    useShifts: true, useUnits: false, useBookings: false, useJobs: false,
  };
}
const emptyCart = () => ({ lines: [], discount: { type: 'amount', value: 0 }, customerId: null, note: '' });
const hasDemoData = () => db.products.some((p) => p.demo) || db.sales.some((s) => s.demo)
  || db.sessions.some((s) => s.demo && s.status === 'open') || db.bookings.some((b) => b.demo && b.status === 'confirmed');
function nextSeq(key, prefix, d = db) {
  d.seq[key] = (d.seq[key] || 0) + 1;
  return `${prefix}${String(d.seq[key]).padStart(5, '0')}`;
}

function migrate(d) {
  if (d && d.data && typeof d.rev === 'number') d = d.data; // backup file from server.js
  const legacy = !d.settings || d.settings.setupDone === undefined;
  d.settings = { ...defaultSettings(), ...(d.settings || {}) };
  ['categories', 'products', 'customers', 'sales', 'held', 'stockLog', 'shifts', 'units', 'sessions', 'bookings'].forEach((k) => { d[k] = Array.isArray(d[k]) ? d[k] : []; });
  d.cart = d.cart && Array.isArray(d.cart.lines) ? d.cart : emptyCart();
  d.seq = d.seq || { sale: d.sales.length + 1 };
  d.products.forEach((p) => { p.variants = p.variants || []; p.optionGroups = p.optionGroups || []; if (p.active === undefined) p.active = true; });
  if (!Array.isArray(d.settings.businessTypes) || !d.settings.businessTypes.length) d.settings.businessTypes = [d.settings.businessType || 'general'];
  d.units.forEach((u) => { u.pricing = u.pricing || { mode: 'none' }; if (!u.status) u.status = 'available'; });
  d.sessions.forEach((s) => {
    if (!s.cart || !Array.isArray(s.cart.lines)) s.cart = { lines: [], discount: { type: 'amount', value: 0 } };
    s.deposits = s.deposits || []; s.saleIds = s.saleIds || []; s.pricing = s.pricing || { mode: 'none' };
  });
  d.bookings.forEach((b) => { b.deposits = b.deposits || []; });
  if (legacy) markLegacyDemo(d);
  return d;
}

// ข้อมูลจากเวอร์ชันก่อนไม่มีป้าย "ตัวอย่าง" — ตรวจจากชื่อสินค้าและหมวดของข้อมูลตัวอย่างเดิม
function markLegacyDemo(d) {
  const cat = demoCatalog();
  const names = new Set(cat.products.map((p) => p.name));
  const catIds = new Set(cat.categories.map((c) => c.id));
  d.products.forEach((p) => { if (names.has(p.name) && catIds.has(p.categoryId)) p.demo = true; });
  const demoIds = new Set(d.products.filter((p) => p.demo).map((p) => p.id));
  d.categories.forEach((c) => { if (catIds.has(c.id)) c.demo = true; });
  d.sales.forEach((s) => { if (s.items.length && s.items.every((i) => demoIds.has(i.productId))) s.demo = true; });
  const demoCust = new Set(cat.customers.map((c) => `${c.name}|${c.phone}`));
  d.customers.forEach((c) => { if (demoCust.has(`${c.name}|${c.phone}`)) c.demo = true; });
  if (d.settings.shopName === 'Universal Store') d.settings.shopName = 'ร้านของฉัน';
  d.settings.setupDone = d.products.some((p) => !p.demo) || d.sales.some((s) => !s.demo);
}

const getCat = (id) => db.categories.find((c) => c.id === id) || { id: '', name: 'ไม่ระบุหมวด', icon: '📦', color: '#94a3b8' };
const totalStock = (p) => (p.variants.length ? sum(p.variants, (v) => num(v.stock)) : num(p.stock));
const variantCost = (p, v) => (v && v.cost !== null && v.cost !== undefined && v.cost !== '' ? num(v.cost) : num(p.cost));

function findByCode(code, includeInactive = false) {
  code = String(code || '').trim();
  if (!code) return null;
  const lc = code.toLowerCase();
  for (const p of db.products) {
    if (!includeInactive && !p.active) continue;
    for (const v of p.variants) {
      if ((v.barcode && v.barcode === code) || (v.sku && v.sku.toLowerCase() === lc)) return { p, v };
    }
    if ((p.barcode && p.barcode === code) || (p.sku && p.sku.toLowerCase() === lc)) return { p, v: null };
  }
  return null;
}
function genBarcode() {
  let b;
  do { b = ean13('20' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0')); } while (findByCode(b, true));
  return b;
}

function applyStock(pid, vid, delta, reason, ref = '', note = '') {
  const p = db.products.find((x) => x.id === pid);
  if (!p || !p.trackStock || !delta) return;
  const target = vid ? p.variants.find((v) => v.id === vid) : p;
  if (!target) return;
  target.stock = r3(num(target.stock) + delta);
  db.stockLog.unshift({
    id: uid(), date: new Date().toISOString(), productId: pid, variantId: vid || null,
    name: p.name + (vid ? ` (${target.name})` : ''), change: r3(delta), after: target.stock, reason, ref, note,
  });
  if (db.stockLog.length > 1500) db.stockLog.length = 1500;
}

/* ---------- Pricing ---------- */
function lineDiscount(l) {
  const gross = num(l.price) * num(l.qty);
  const d = l.discountType === 'percent' ? gross * Math.min(100, num(l.discountValue)) / 100 : num(l.discountValue);
  return Math.min(Math.max(0, d), gross);
}
const lineTotal = (l) => r2(Math.max(0, num(l.price) * num(l.qty) - lineDiscount(l)));

function calcTotals(lines, discount, s) {
  let subtotal = 0, taxableSub = 0;
  for (const l of lines) { const t = lineTotal(l); subtotal += t; if (l.taxable !== false) taxableSub += t; }
  subtotal = r2(subtotal);
  let disc = discount.type === 'percent' ? subtotal * Math.min(100, num(discount.value)) / 100 : num(discount.value);
  disc = r2(Math.min(Math.max(0, disc), subtotal));
  const net = subtotal - disc;
  const ratio = subtotal > 0 ? net / subtotal : 0;
  const sr = num(s.serviceRate) / 100, tr = num(s.taxRate) / 100;
  const service = r2(net * sr);
  const taxBase = taxableSub * ratio * (1 + sr);
  let tax = 0, total = net + service;
  if (s.taxMode === 'exclusive') { tax = r2(taxBase * tr); total += tax; }
  else if (s.taxMode === 'inclusive') tax = r2(taxBase - taxBase / (1 + tr));
  total = r2(total);
  let rounding = 0;
  if (num(s.rounding) > 0) {
    const rt = Math.round(total / num(s.rounding)) * num(s.rounding);
    rounding = r2(rt - total); total = r2(rt);
  }
  return { subtotal, discount: disc, service, tax, rounding, total };
}

function buildSale(lines, discount, s, extra = {}) {
  const t = calcTotals(lines, discount, s);
  return {
    id: uid(), no: '', date: new Date().toISOString(),
    items: lines.map((l) => ({
      productId: l.productId || null, variantId: l.variantId || null, name: l.name, variantName: l.variantName || '',
      options: l.options || [], note: l.note || '', unit: l.unit, qty: l.qty, price: l.price,
      discount: r2(lineDiscount(l)), total: lineTotal(l), cost: num(l.cost), categoryId: l.categoryId || '', taxable: l.taxable !== false,
      ...(l.isTime ? { isTime: true } : {}),
    })),
    billDiscount: { ...discount }, ...t,
    taxMode: s.taxMode, taxRate: s.taxRate, serviceRate: s.serviceRate,
    payments: [], paid: 0, change: 0, customerId: null, customerName: '', cashier: s.cashier, status: 'paid',
    ...extra,
  };
}
const nextInvoiceNo = (d = db) => `${d.settings.invoicePrefix}${String(d.seq.sale++).padStart(6, '0')}`;

/* ---------- Demo data ---------- */
function demoCatalog() {
  const C = (id, name, icon, color) => ({ id, name, icon, color, demo: true });
  const categories = [
    C('c-drink', 'เครื่องดื่ม', '☕', '#8b5cf6'), C('c-food', 'อาหาร', '🍜', '#f97316'),
    C('c-grocery', 'ของชำ', '🛒', '#10b981'), C('c-fresh', 'ผัก ผลไม้ & เนื้อสัตว์', '🥬', '#22c55e'),
    C('c-fashion', 'แฟชั่น', '👕', '#ec4899'), C('c-elec', 'อิเล็กทรอนิกส์', '🔌', '#3b82f6'),
    C('c-health', 'สุขภาพ & ความงาม', '💊', '#14b8a6'), C('c-stationery', 'เครื่องเขียน & ของใช้', '✏️', '#eab308'),
    C('c-service', 'บริการ', '🛠️', '#64748b'),
    C('c-stay', 'บริการห้องพัก', '🛎️', '#0ea5e9'), C('c-rental', 'อุปกรณ์เสริม & ประกัน', '🧰', '#f59e0b'),
    C('c-ktv', 'เบียร์ เหล้า & มิกเซอร์', '🍺', '#d97706'), C('c-sport', 'อุปกรณ์กีฬา', '🏸', '#16a34a'),
    C('c-laundry', 'ซักรีด', '🧺', '#06b6d4'), C('c-repair', 'ซ่อม & อะไหล่', '🔧', '#475569'),
    C('c-utility', 'ค่าน้ำ ค่าไฟ & ส่วนกลาง', '💡', '#eab308'), C('c-spa', 'นวด & สปา', '💆', '#db2777'),
    C('c-tailor', 'สั่งทำ & ตัดเย็บ', '🧵', '#7c3aed'),
  ];
  let bc = 885123400000;
  const code = () => ean13(String(bc++));
  const now = new Date().toISOString();
  const P = (name, categoryId, emoji, price, cost, x = {}) => ({
    id: uid(), name, categoryId, emoji, image: '', sku: '', barcode: '', price, cost, unit: 'ชิ้น',
    decimalQty: false, openPrice: false, trackStock: true, stock: 0, lowStock: 5, taxable: true, active: true,
    variants: [], optionGroups: [], createdAt: now, demo: true, ...x,
  });
  const V = (name, price, stock = 0) => ({ id: uid(), name, price, cost: null, sku: '', barcode: code(), stock });
  const G = (name, options, multi = false, required = false) => ({ name, multi, required, options: options.map((o) => (Array.isArray(o) ? { name: o[0], price: o[1] } : { name: o, price: 0 })) });
  const sweet = G('ความหวาน', ['หวานน้อย', 'หวานปกติ', 'หวานมาก', 'ไม่หวาน'], false, true);

  const products = [
    P('กาแฟอเมริกาโน่', 'c-drink', '☕', 45, 15, { unit: 'แก้ว', trackStock: false, variants: [V('ร้อน', 45), V('เย็น', 50), V('ปั่น', 55)], optionGroups: [sweet, G('เพิ่มเติม', [['ช็อตกาแฟ', 15], ['วิปครีม', 10], ['นมโอ๊ต', 15]], true)] }),
    P('ชาไทย', 'c-drink', '🧋', 40, 12, { unit: 'แก้ว', trackStock: false, optionGroups: [sweet, G('ท็อปปิ้ง', [['ไข่มุก', 10], ['พุดดิ้ง', 10], ['เยลลี่', 10]], true)] }),
    P('น้ำดื่ม 600 มล.', 'c-drink', '💧', 10, 4, { unit: 'ขวด', barcode: code(), stock: 96, lowStock: 24 }),
    P('โคล่า 325 มล.', 'c-drink', '🥤', 17, 12, { unit: 'กระป๋อง', barcode: code(), stock: 48, lowStock: 12 }),
    P('ข้าวกะเพรา', 'c-food', '🍛', 60, 25, { unit: 'จาน', trackStock: false, optionGroups: [G('เนื้อสัตว์', ['หมูสับ', 'ไก่', ['กุ้ง', 20], ['ทะเล', 30]], false, true), G('เพิ่ม', [['ไข่ดาว', 10], ['ไข่เจียว', 15], ['พิเศษ', 10]], true)] }),
    P('ก๋วยเตี๋ยวเรือ', 'c-food', '🍜', 50, 20, { unit: 'ชาม', trackStock: false, variants: [V('ธรรมดา', 50), V('พิเศษ', 60)], optionGroups: [G('เส้น', ['เส้นเล็ก', 'เส้นใหญ่', 'บะหมี่', 'วุ้นเส้น'], false, true)] }),
    P('เค้กช็อกโกแลต', 'c-food', '🍰', 85, 35, { stock: 12, lowStock: 3 }),
    P('บะหมี่กึ่งสำเร็จรูป ต้มยำ', 'c-grocery', '🍜', 7, 5.5, { unit: 'ซอง', barcode: code(), stock: 120, lowStock: 30 }),
    P('ไข่ไก่ เบอร์ 2 (30 ฟอง)', 'c-grocery', '🥚', 135, 110, { unit: 'แผง', barcode: code(), stock: 20 }),
    P('ข้าวหอมมะลิ 5 กก.', 'c-grocery', '🍚', 189, 150, { unit: 'ถุง', barcode: code(), stock: 30 }),
    P('น้ำมันพืช 1 ลิตร', 'c-grocery', '🫒', 55, 45, { unit: 'ขวด', barcode: code(), stock: 3 }),
    P('มะม่วงน้ำดอกไม้', 'c-fresh', '🥭', 80, 50, { unit: 'กก.', decimalQty: true, stock: 25.5, lowStock: 5, taxable: false }),
    P('กล้วยหอม', 'c-fresh', '🍌', 45, 28, { unit: 'กก.', decimalQty: true, stock: 18, taxable: false }),
    P('หมูสามชั้น', 'c-fresh', '🥓', 180, 140, { unit: 'กก.', decimalQty: true, stock: 12.4, lowStock: 3, taxable: false }),
    P('เสื้อยืดคอกลม', 'c-fashion', '👕', 199, 80, { unit: 'ตัว', lowStock: 3, variants: [V('S', 199, 8), V('M', 199, 12), V('L', 199, 10), V('XL', 229, 2)] }),
    P('กางเกงยีนส์', 'c-fashion', '👖', 590, 250, { unit: 'ตัว', lowStock: 2, variants: [V('เอว 28', 590, 4), V('เอว 30', 590, 6), V('เอว 32', 590, 5), V('เอว 34', 620, 1)] }),
    P('รองเท้าผ้าใบ', 'c-fashion', '👟', 1290, 700, { unit: 'คู่', lowStock: 2, variants: [V('ขาว / 40', 1290, 3), V('ขาว / 42', 1290, 2), V('ดำ / 41', 1290, 4), V('ดำ / 43', 1290, 2)] }),
    P('สายชาร์จ USB-C 1 เมตร', 'c-elec', '🔌', 150, 60, { unit: 'เส้น', barcode: code(), sku: 'CBL-USBC-1M', stock: 40 }),
    P('หูฟังบลูทูธ', 'c-elec', '🎧', 890, 450, { variants: [V('สีดำ', 890, 5), V('สีขาว', 890, 3)], lowStock: 2 }),
    P('พาวเวอร์แบงก์ 10000mAh', 'c-elec', '🔋', 590, 320, { barcode: code(), sku: 'PWB-10K', stock: 2 }),
    P('พาราเซตามอล 500 มก.', 'c-health', '💊', 25, 12, { unit: 'แผง', barcode: code(), stock: 50, lowStock: 10, taxable: false }),
    P('ครีมกันแดด SPF50', 'c-health', '🧴', 350, 180, { unit: 'หลอด', barcode: code(), stock: 15 }),
    P('หน้ากากอนามัย (50 ชิ้น)', 'c-health', '😷', 99, 50, { unit: 'กล่อง', barcode: code(), stock: 25 }),
    P('ปากกาลูกลื่น', 'c-stationery', '🖊️', 10, 4, { unit: 'ด้าม', barcode: code(), stock: 200, lowStock: 20, variants: [] }),
    P('สมุดโน้ต A5', 'c-stationery', '📓', 35, 15, { unit: 'เล่ม', barcode: code(), stock: 60 }),
    P('ริบบิ้นผ้าซาติน', 'c-stationery', '🎀', 20, 8, { unit: 'เมตร', decimalQty: true, stock: 150, lowStock: 20 }),
    P('ค่าบริการซ่อม', 'c-service', '🛠️', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false }),
    P('ตัดผม', 'c-service', '✂️', 150, 0, { unit: 'ครั้ง', trackStock: false, variants: [V('ตัดผมชาย', 150), V('ตัด + สระ', 200), V('ตัดผมเด็ก', 100)] }),
    P('ค่าจอดรถ', 'c-service', '🅿️', 20, 0, { unit: 'ชั่วโมง', decimalQty: true, trackStock: false }),
    P('ค่าจัดส่ง', 'c-service', '🚚', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false, taxable: false }),
    // ที่พัก
    P('อาหารเช้า (ต่อท่าน)', 'c-stay', '🍳', 150, 60, { unit: 'ท่าน', trackStock: false }),
    P('เตียงเสริม', 'c-stay', '🛏️', 400, 0, { unit: 'คืน', trackStock: false }),
    P('ซักรีด (ต่อชิ้น)', 'c-stay', '👔', 30, 8, { unit: 'ชิ้น', trackStock: false }),
    P('ค่าเสียหาย / ของหาย', 'c-stay', '⚠️', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false }),
    // ให้เช่า
    P('ประกันภัยเพิ่ม (ต่อวัน)', 'c-rental', '🛡️', 200, 0, { unit: 'วัน', trackStock: false }),
    P('คาร์ซีทเด็ก (ต่อวัน)', 'c-rental', '👶', 100, 0, { unit: 'วัน', trackStock: false }),
    P('หมวกกันน็อคเพิ่ม', 'c-rental', '⛑️', 20, 0, { unit: 'ใบ', trackStock: false }),
    P('ค่าส่ง–รับรถ', 'c-rental', '🚚', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false }),
    P('ค่าน้ำมัน (คืนไม่เต็มถัง)', 'c-rental', '⛽', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false }),
    P('เช่าเต็นท์ 2 คน', 'c-rental', '⛺', 150, 0, { unit: 'คืน', trackStock: false }),
    // KTV / บาร์
    P('เบียร์ขวดใหญ่', 'c-ktv', '🍺', 120, 70, { unit: 'ขวด', stock: 48, lowStock: 12 }),
    P('เหล้า (ขวด)', 'c-ktv', '🥃', 650, 420, { unit: 'ขวด', stock: 12, lowStock: 3 }),
    P('โซดา', 'c-ktv', '🫧', 25, 12, { unit: 'ขวด', stock: 48, lowStock: 12 }),
    P('น้ำแข็ง (ถัง)', 'c-ktv', '🧊', 40, 10, { unit: 'ถัง', trackStock: false }),
    P('ผลไม้รวม', 'c-ktv', '🍉', 150, 60, { unit: 'จาน', trackStock: false }),
    // กีฬา
    P('ลูกแบดมินตัน', 'c-sport', '🏸', 25, 15, { unit: 'ลูก', stock: 100, lowStock: 20 }),
    P('เช่าไม้แบด', 'c-sport', '🏸', 30, 0, { unit: 'อัน', trackStock: false }),
    P('เช่าลูกฟุตบอล', 'c-sport', '⚽', 50, 0, { unit: 'ลูก', trackStock: false }),
    // ซักรีด
    P('ซัก-อบ (กิโล)', 'c-laundry', '🧺', 40, 10, { unit: 'กก.', decimalQty: true, trackStock: false }),
    P('ซัก-อบ-รีด (กิโล)', 'c-laundry', '👕', 60, 15, { unit: 'กก.', decimalQty: true, trackStock: false }),
    P('รีดอย่างเดียว (ชิ้น)', 'c-laundry', '♨️', 12, 2, { unit: 'ชิ้น', trackStock: false }),
    P('ซักผ้านวม / ผ้าห่ม', 'c-laundry', '🛌', 150, 30, { unit: 'ผืน', trackStock: false }),
    P('ซักแห้ง สูท', 'c-laundry', '🤵', 250, 80, { unit: 'ชุด', trackStock: false }),
    // ซ่อม
    P('ค่าตรวจเช็ค', 'c-repair', '🔍', 200, 0, { unit: 'ครั้ง', trackStock: false }),
    P('ค่าแรงซ่อม', 'c-repair', '🛠️', 0, 0, { unit: 'ครั้ง', openPrice: true, trackStock: false }),
    P('ฟิล์มกระจก', 'c-repair', '📱', 150, 40, { unit: 'แผ่น', stock: 30, lowStock: 5 }),
    P('แบตเตอรี่มือถือ', 'c-repair', '🔋', 590, 300, { unit: 'ก้อน', stock: 8, lowStock: 2 }),
    // หอพัก
    P('ค่าไฟฟ้า (หน่วย)', 'c-utility', '💡', 8, 0, { unit: 'หน่วย', decimalQty: true, trackStock: false, taxable: false }),
    P('ค่าน้ำประปา (หน่วย)', 'c-utility', '🚰', 18, 0, { unit: 'หน่วย', decimalQty: true, trackStock: false, taxable: false }),
    P('ค่าส่วนกลาง', 'c-utility', '🏢', 300, 0, { unit: 'เดือน', trackStock: false }),
    P('ค่าอินเทอร์เน็ต', 'c-utility', '📶', 300, 0, { unit: 'เดือน', trackStock: false }),
    // นวด / สปา
    P('นวดแผนไทย', 'c-spa', '💆', 250, 100, { unit: 'ครั้ง', trackStock: false, variants: [V('1 ชั่วโมง', 250), V('2 ชั่วโมง', 450)] }),
    P('นวดน้ำมัน (1 ชม.)', 'c-spa', '🧴', 400, 150, { unit: 'ครั้ง', trackStock: false }),
    P('นวดเท้า (1 ชม.)', 'c-spa', '🦶', 300, 100, { unit: 'ครั้ง', trackStock: false }),
    // สั่งทำ
    P('ตัดชุด (สั่งตัด)', 'c-tailor', '🧵', 0, 0, { unit: 'ชุด', openPrice: true, trackStock: false }),
    P('แก้ไข / ตัดขากางเกง', 'c-tailor', '✂️', 80, 0, { unit: 'ตัว', trackStock: false }),
    P('สกรีนเสื้อ', 'c-tailor', '👕', 150, 60, { unit: 'ตัว', trackStock: false }),
  ];
  const customers = [
    { id: uid(), name: 'คุณสมชาย ใจดี', phone: '0812345678', email: '', note: 'ลูกค้าประจำ', points: 42, createdAt: now, demo: true },
    { id: uid(), name: 'คุณมานี รักเรียน', phone: '0898765432', email: '', note: '', points: 15, createdAt: now, demo: true },
  ];
  return { categories, products, customers };
}

// types = ประเภทธุรกิจที่เลือก (หลายแบบได้), unitPlan = ห้อง/โต๊ะ/รถที่จะสร้าง (null = ตามค่าเริ่มต้นของประเภท)
function seedDB(withDemo = true, types = ['general'], unitPlan = null) {
  types = [].concat(types);
  const d = {
    version: 2, settings: defaultSettings(), categories: [], products: [], customers: [], sales: [], held: [], stockLog: [],
    shifts: [], units: [], sessions: [], bookings: [], cart: emptyCart(), seq: { sale: 1 },
  };
  applyBusinessDefaults(d.settings, types);
  d.units = unitsFromPlan(unitPlan || defaultUnitPlan(types), []);
  if (!withDemo) { d.categories = presetCategories(types); return d; }

  const cat = demoCatalog();
  const keep = new Set(types.flatMap((t) => businessType(t).demo || cat.categories.map((c) => c.id)));
  d.categories = cat.categories.filter((c) => keep.has(c.id));
  d.products = cat.products.filter((p) => keep.has(p.categoryId));
  d.customers = cat.customers;

  // ยอดขายตัวอย่าง 14 วันย้อนหลัง ให้หน้ารายงานมีข้อมูลให้ดู
  const sellable = d.products.filter((p) => !p.openPrice);
  const nowMs = Date.now();
  const demo = [];
  for (let i = 0; i < 90 && sellable.length; i++) {
    const date = new Date(nowMs - Math.floor(Math.random() * 14) * 864e5);
    date.setHours(8 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0);
    if (date.getTime() > nowMs) continue;
    const lines = [];
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const p = sellable[Math.floor(Math.random() * sellable.length)];
      const v = p.variants.length ? p.variants[Math.floor(Math.random() * p.variants.length)] : null;
      lines.push({
        productId: p.id, variantId: v ? v.id : null, name: p.name, variantName: v ? v.name : '', options: [], unit: p.unit,
        qty: p.decimalQty ? r3(0.3 + Math.random() * 2) : 1 + Math.floor(Math.random() * 2),
        price: v ? v.price : p.price, cost: variantCost(p, v), discountType: 'amount', discountValue: 0,
        taxable: p.taxable, categoryId: p.categoryId,
      });
    }
    const methods = ['cash', 'cash', 'cash', 'transfer', 'transfer', 'card'];
    const sale = buildSale(lines, { type: 'amount', value: 0 }, d.settings, { date: date.toISOString(), demo: true });
    sale.payments = [{ method: methods[Math.floor(Math.random() * methods.length)], amount: sale.total }];
    sale.paid = sale.total;
    demo.push(sale);
  }
  demo.sort((a, b) => a.date.localeCompare(b.date)).forEach((s) => { s.no = nextInvoiceNo(d); });
  d.sales = demo;
  seedDemoActivity(d, types);
  return d;
}

// ตัวอย่างบิลเปิด (มีแขก/ถูกเช่า/กำลังใช้งาน), การจองล่วงหน้า และงานรับ — ลบทิ้งได้ด้วย "ลบข้อมูลตัวอย่าง"
function seedDemoActivity(d, types) {
  const now = new Date();
  const [c1, c2] = d.customers;
  const items = d.products.filter((p) => !p.openPrice && !p.decimalQty && !p.variants.length && !p.optionGroups.length);
  const line = (p) => ({
    id: uid(), key: uid(), productId: p.id, variantId: null, name: p.name, variantName: '', options: [], unit: p.unit, qty: 1, price: p.price,
    cost: p.cost, discountType: 'amount', discountValue: 0, taxable: p.taxable, note: '', decimalQty: false, categoryId: p.categoryId,
  });
  const deposit = (amount, method, at) => (amount ? [{ id: uid(), amount, method, at: at.toISOString(), shiftId: null }] : []);
  let sn = 0, bn = 0, jn = 0;
  const baseSession = (extra) => ({
    id: uid(), status: 'open', endAt: null, customerId: c1?.id || null, guestName: c1?.name || '', guestPhone: c1?.phone || '', guests: 2,
    info: {}, note: '', timeOverride: null, cart: { lines: [], discount: { type: 'amount', value: 0 } }, saleIds: [], bookingId: null, demo: true, ...extra,
  });

  const byKind = {};
  d.units.forEach((u) => { (byKind[u.kind] = byKind[u.kind] || []).push(u); });
  Object.values(byKind).forEach((units) => {
    const u = units[0], pr = u.pricing;
    let start = addMinutes(now, -75), end = null;
    if (pr.mode === 'night') { start = atTime(addDays(now, -1), '15:10'); end = atTime(addDays(now, 1), pr.checkoutTime || '12:00'); }
    else if (pr.mode === 'day') { start = addMinutes(now, -26 * 60); end = addMinutes(start, 3 * 1440); }
    else if (pr.mode === 'month') start = startOfDay(addDays(now, -20));
    else if (pr.mode === 'none') start = addMinutes(now, -25);
    const pick = items.slice(0, ['none', 'hour'].includes(pr.mode) ? 3 : 1);
    d.sessions.push(baseSession({
      no: `S${String(++sn).padStart(5, '0')}`, unitId: u.id, unitName: u.name, kind: u.kind, icon: u.icon,
      startAt: start.toISOString(), plannedEndAt: end ? end.toISOString() : null, billedFrom: start.toISOString(),
      deposits: deposit(u.defaultDeposit, 'cash', start), pricing: structuredClone(pr), createdAt: start.toISOString(),
      cart: { lines: pick.map(line), discount: { type: 'amount', value: 0 } },
    }));
    const u2 = units[1];
    if (!u2 || !d.settings.useBookings) return;
    let bs, be;
    if (pr.mode === 'night') { bs = atTime(addDays(now, 1), pr.checkinTime || '14:00'); be = atTime(addDays(now, 3), pr.checkoutTime || '12:00'); }
    else if (pr.mode === 'day') { bs = atTime(addDays(now, 1), '09:00'); be = addDays(bs, 3); }
    else if (pr.mode === 'month') { bs = startOfDay(addDays(now, 5)); be = addMonths(bs, 6); }
    else { bs = addMinutes(now, 180 - now.getMinutes()); be = addMinutes(bs, 120); }
    d.bookings.push({
      id: uid(), no: `B${String(++bn).padStart(5, '0')}`, unitId: u2.id, startAt: bs.toISOString(), endAt: be.toISOString(),
      customerId: c2?.id || null, guestName: c2?.name || '', guestPhone: c2?.phone || '', guests: 2, note: '',
      deposits: deposit(500, 'transfer', now), status: 'confirmed', sessionId: null, createdAt: now.toISOString(), demo: true,
    });
  });

  const jobType = types.find((t) => businessType(t).jobs);
  if (jobType) {
    const titles = { repair: ['ซ่อมจอมือถือ (จอแตก) — iPhone 12', 'เปลี่ยนแบตเตอรี่โน้ตบุ๊ก'], laundry: ['ผ้ารวม 2 ตะกร้า ซัก-อบ-รีด', 'ผ้านวม 2 ผืน'], tailor: ['ชุดไทยสั่งตัด 1 ชุด', 'สกรีนเสื้อทีม 20 ตัว'] }[jobType];
    [['working', 1], ['ready', 0]].forEach(([status, dueDays], i) => {
      const at = addMinutes(now, -(i + 1) * 1440);
      const due = atTime(addDays(now, dueDays), '17:00');
      d.sessions.push(baseSession({
        no: `J${String(++jn).padStart(5, '0')}`, isJob: true, unitId: null, unitName: '', kind: 'job', icon: '🧾',
        startAt: at.toISOString(), plannedEndAt: due.toISOString(), billedFrom: at.toISOString(), createdAt: at.toISOString(),
        customerId: (i ? c2 : c1)?.id || null, guestName: (i ? c2 : c1)?.name || '', guestPhone: (i ? c2 : c1)?.phone || '',
        deposits: deposit(i ? 0 : 300, 'cash', at), pricing: { mode: 'none' },
        job: { title: titles[i], status, dueAt: due.toISOString(), history: [{ status: 'received', at: at.toISOString() }, { status, at: at.toISOString() }] },
      }));
    });
  }
  d.seq.session = sn; d.seq.booking = bn; d.seq.job = jn;
}

/* ---------- Toast & Modal ---------- */
function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, ms);
}

const modalStack = [];
function openModal({ title = '', body = '', footer = '', size = 'md', onClose, dismissible = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${title}</h3>${dismissible ? '<button class="icon-btn" data-close aria-label="ปิด">✕</button>' : ''}</div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const m = { el: wrap, dismissible, onClose, close: () => closeModal(m) };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && dismissible) m.close(); });
  $$('[data-close],[data-cancel]', wrap).forEach((b) => b.addEventListener('click', () => m.close()));
  $('#modal-root').appendChild(wrap);
  modalStack.push(m);
  requestAnimationFrame(() => wrap.classList.add('show'));
  setTimeout(() => { const f = $('[autofocus]', wrap); if (f) { f.focus(); if (f.select) f.select(); } }, 60);
  return m;
}
function closeModal(m) {
  const i = modalStack.indexOf(m);
  if (i < 0) return;
  modalStack.splice(i, 1);
  m.el.remove();
  if (m.onClose) m.onClose();
}

function confirmDialog(message, { title = 'ยืนยัน', okText = 'ตกลง', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'sm', body: `<p class="confirm-msg">${message}</p>`,
      footer: `<button class="btn ghost" data-cancel>ยกเลิก</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${okText}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    const yes = $('[data-yes]', m.el);
    yes.onclick = () => { done = true; resolve(true); m.close(); };
    setTimeout(() => yes.focus(), 70);
  });
}
