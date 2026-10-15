// Tượng Kỳ — dựng toàn bộ màn hình sửa được vào trang "✏️ Thiết kế sửa được".
// Chạy được nhiều lần: lần sau xoá các màn do plugin tạo trước đó rồi dựng lại.
'use strict';

const PAGE_ID = '2:2';
const ID = {
  navSet: '4:84', btnSet: '4:93', tag: '4:94', side: '9:63', top: '9:68',
  pieces: '12:212', board: '13:156', banners: '13:305', oldHome: '6:8',
};
const ICON_ID = {
  'trang-chu': '4:24', 'choi': '4:27', 'ai': '4:31', 'xep-hang': '4:34', 'giai-dau': '4:38', 'ban-be': '4:43',
  'tui-do': '4:47', 'ho-so': '4:51', 'xu': '4:56', 'chuong': '4:60', 'qua': '4:64', 'bieu-do': '4:68', 'khoa': '4:72',
  'canh-bao': '10:325', 'cam': '10:326', 'sach': '10:327', 'goi-y': '10:328', 'lich': '10:329', 'tro-chuyen': '10:330',
  'dung': '10:331', 'mui-ten-phai': '10:332', 'dong-ho': '10:333', 'sao-chep': '10:334', 'vuong-mien': '10:335',
  'mui-ten-xuong': '10:336', 'tai-xuong': '10:337', 'cau-hoa': '10:338', 'sua': '10:339', 'xem': '10:340', 'lua': '10:341',
  've-dau': '10:342', 'dau-hang': '10:343', 'luoi': '10:344', 'anh': '10:345', 'thong-tin': '10:346', 've-cuoi': '10:347',
  'lien-ket': '10:348', 'dang-xuat': '10:349', 'menu': '10:350', 'them-nua': '10:351', 'tiep': '10:352', 'quan-co': '10:353',
  'cong': '10:354', 'lui': '10:355', 'co-the': '10:356', 'tim': '10:357', 'chia-se': '10:358', 'cua-hang': '10:359',
  'sao': '10:360', 'kiem': '10:361', 'muc-tieu': '10:362', 'di-lai': '10:363', 'them-ban': '10:364', 'mat-mang': '10:365', 'dong': '10:366',
};
const ILL_ID = { cup: '10:368', cupNho: '10:369', dongXu: '10:370', canhXu: '10:371', banCoNho: '10:372', haiNguoi: '10:373', canhBan: '10:374' };
const HASH = {
  bg: '189ce0cf0e0955807110bea6ead49419a2c4b15f', board: '6cdee38fa69df404ee52972c789c79bd2297d5f0',
  logo: '48a255025b51969c003b51c990c040c71c6420b2', piece: 'a4ccf1fab710328aa829212e233205b0af27c5b9',
};
// Toạ độ giao điểm trên ảnh bàn gỗ 1280×1280
const BXS = [57, 216, 361, 502, 641, 781, 922, 1064, 1217];
const BYS = [53, 188, 319, 448, 575, 705, 835, 963, 1093, 1225];
const MARK = 'tk-screens';

// ---------- Phông chữ ----------
const F = {};
async function loadFonts() {
  const want = {
    r: ['Be Vietnam Pro', 'Regular'], m: ['Be Vietnam Pro', 'Medium'], sb: ['Be Vietnam Pro', 'SemiBold'],
    b: ['Be Vietnam Pro', 'Bold'], xb: ['Be Vietnam Pro', 'ExtraBold'], serif: ['Noto Serif', 'Bold'],
    serifR: ['Noto Serif', 'Regular'], han: ['Noto Serif TC', 'Bold'],
  };
  const fallback = { r: 'Regular', m: 'Medium', sb: 'Semi Bold', b: 'Bold', xb: 'Extra Bold', serif: 'Bold', serifR: 'Regular', han: 'Bold' };
  for (const k of Object.keys(want)) {
    const f = { family: want[k][0], style: want[k][1] };
    try { await figma.loadFontAsync(f); F[k] = f; }
    catch (e) {
      const g = { family: 'Inter', style: fallback[k] };
      try { await figma.loadFontAsync(g); F[k] = g; } catch (e2) { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); F[k] = { family: 'Inter', style: 'Regular' }; }
    }
  }
}

// ---------- Màu ----------
const VAR = {};
function hex(h) { return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }; }
function solid(h, o) { const p = { type: 'SOLID', color: hex(h) }; if (o != null) p.opacity = o; return p; }
// fp('chữ/chính') → màu gắn biến; fp('#c61d1d') → màu thường; fp({...}) → giữ nguyên
function fp(c, o) {
  if (typeof c !== 'string') return c;
  if (c[0] === '#') return solid(c, o);
  const v = VAR[c];
  if (!v) return solid('#ff00ff');
  const p = figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', v);
  return o != null ? Object.assign({}, p, { opacity: o }) : p;
}
function lin(stops, angle) {
  // angle: 'v' trên→dưới (mặc định), 'h' trái→phải
  const t = angle === 'h' ? [[1, 0, 0], [0, 1, 0]] : [[0, 1, 0], [-1, 0, 1]];
  return { type: 'GRADIENT_LINEAR', gradientTransform: t, gradientStops: stops.map((s, i) => ({ position: s[1] != null ? s[1] : i / (stops.length - 1), color: Object.assign(hex(s[0]), { a: s[2] != null ? s[2] : 1 }) })) };
}
function rad(stops) {
  return { type: 'GRADIENT_RADIAL', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: stops.map((s, i) => ({ position: s[1] != null ? s[1] : i / (stops.length - 1), color: Object.assign(hex(s[0]), { a: s[2] != null ? s[2] : 1 }) })) };
}
function shadow(y, blur, a, col) { return { type: 'DROP_SHADOW', color: Object.assign(hex(col || '#3c230f'), { a: a }), offset: { x: 0, y: y }, radius: blur, spread: 0, visible: true, blendMode: 'NORMAL' }; }

// ---------- Khung & chữ ----------
function pad(f, t, r, b, l) { f.paddingTop = t; f.paddingRight = r != null ? r : t; f.paddingBottom = b != null ? b : t; f.paddingLeft = l != null ? l : (r != null ? r : t); }
// AL('V'|'H', tên, tuỳ chọn) → frame auto layout
function AL(dir, name, o) {
  o = o || {};
  const f = figma.createFrame();
  f.resize(1, 1); // khung mới mặc định 100×100 — thu nhỏ để auto layout ôm đúng nội dung
  f.name = name || (dir === 'H' ? 'Hàng' : 'Cột');
  f.layoutMode = dir === 'H' ? 'HORIZONTAL' : 'VERTICAL';
  f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  f.fills = []; f.clipsContent = false;
  f.itemSpacing = o.gap || 0;
  if (o.pad != null) { const p = [].concat(o.pad); pad(f, p[0], p[1], p[2], p[3]); }
  if (o.align) f.counterAxisAlignItems = o.align;
  if (o.justify) f.primaryAxisAlignItems = o.justify;
  if (o.fill) f.fills = [].concat(o.fill).map((x) => fp(x));
  if (o.stroke) { f.strokes = [fp(o.stroke)]; f.strokeWeight = o.sw || 1; }
  if (o.dash) f.dashPattern = o.dash;
  if (o.r != null) f.cornerRadius = o.r;
  if (o.clip) f.clipsContent = true;
  if (o.fx) f.effects = [].concat(o.fx);
  if (o.wrap) { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = o.wrapGap != null ? o.wrapGap : (o.gap || 0); }
  return f;
}
// Khung tự do (không auto layout)
function FR(name, w, h, o) {
  o = o || {};
  const f = figma.createFrame(); f.name = name; f.resize(w, h); f.fills = o.fill ? [].concat(o.fill).map((x) => fp(x)) : [];
  f.clipsContent = !!o.clip; if (o.r != null) f.cornerRadius = o.r;
  if (o.stroke) { f.strokes = [fp(o.stroke)]; f.strokeWeight = o.sw || 1; }
  if (o.fx) f.effects = [].concat(o.fx);
  return f;
}
// Thêm con vào cha; h/v: 'FILL' | 'HUG' | 'FIXED'
function add(p, c, h, v) {
  p.appendChild(c);
  if (h) c.layoutSizingHorizontal = h;
  if (v) c.layoutSizingVertical = v;
  return c;
}
function size(f, w, h) { f.resize(w, h); if (f.layoutMode && f.layoutMode !== 'NONE') { f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; } return f; }
function fixW(f, w) { f.resize(w, Math.max(1, f.height)); f.layoutSizingHorizontal = 'FIXED'; return f; }
function fixH(f, h) { f.resize(Math.max(1, f.width), h); f.layoutSizingVertical = 'FIXED'; return f; }
// T(chữ, kiểu, cỡ, màu, tuỳ chọn) → TextNode
function T(s, st, sz, col, o) {
  o = o || {};
  const t = figma.createText();
  t.fontName = F[st] || F.r; t.fontSize = sz; t.characters = String(s);
  t.fills = [fp(col || 'chữ/chính')];
  if (o.lh) t.lineHeight = { unit: 'PIXELS', value: o.lh };
  if (o.ls) t.letterSpacing = { unit: 'PERCENT', value: o.ls };
  if (o.align) t.textAlignHorizontal = o.align;
  if (o.name) t.name = o.name;
  if (o.upper) t.textCase = 'UPPER';
  if (o.underline) t.textDecoration = 'UNDERLINE';
  return t;
}
// Chữ xuống dòng theo bề rộng cha
function TW(p, t) { add(p, t); t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL'; return t; }
// Tô đậm / đổi màu một đoạn
function bold(t, part, st, col) {
  const i = t.characters.indexOf(part); if (i < 0) return t;
  t.setRangeFontName(i, i + part.length, F[st || 'b']);
  if (col) t.setRangeFills(i, i + part.length, [fp(col)]);
  return t;
}
function grow(p) { const g = FR('đẩy', 1, 1); add(p, g); g.layoutGrow = 1; return g; }
function spacer(p, h) { const g = FR('khoảng', 1, h); add(p, g); return g; }
function dot(col, s) { const e = figma.createEllipse(); e.name = 'chấm'; e.resize(s || 8, s || 8); e.fills = [fp(col)]; return e; }
function line(w, col) { const r = figma.createRectangle(); r.name = 'đường kẻ'; r.resize(w || 10, 1); r.fills = [fp(col || 'viền/mảnh')]; return r; }
function hr(p, col) { const r = line(10, col); add(p, r, 'FILL'); return r; }
function svg(str, name) { const n = figma.createNodeFromSvg(str); if (name) n.name = name; return n; }

// ---------- Thành phần có sẵn trong file ----------
const C = {}; // node component đã nạp
async function node(id, nameFallback) {
  let n = null;
  try { n = await figma.getNodeByIdAsync(id); } catch (e) { n = null; }
  if (!n && nameFallback) n = figma.currentPage.findOne((x) => (x.type === 'COMPONENT' || x.type === 'COMPONENT_SET') && x.name === nameFallback);
  return n;
}
async function loadComponents() {
  C.navSet = await node(ID.navSet, 'Mục menu');
  C.btnSet = await node(ID.btnSet, 'Nút');
  C.tag = await node(ID.tag, 'Nhãn đỏ');
  C.side = await node(ID.side, 'Khung · Menu trái');
  C.top = await node(ID.top, 'Khung · Thanh trên');
  C.pieces = await node(ID.pieces, 'Quân cờ');
  C.board = await node(ID.board, 'Bàn cờ · khai cuộc');
  C.banners = await node(ID.banners, 'Cờ phướn');
  C.icons = {};
  for (const k of Object.keys(ICON_ID)) C.icons[k] = await node(ICON_ID[k], 'Biểu tượng/' + k);
  C.ill = {};
  for (const k of Object.keys(ILL_ID)) C.ill[k] = await node(ILL_ID[k]);
  const missing = ['navSet', 'btnSet', 'tag', 'side', 'top', 'pieces', 'board', 'banners'].filter((k) => !C[k]);
  if (missing.length) throw new Error('Thiếu thành phần: ' + missing.join(', ') + ' — hãy chạy plugin trong đúng file Tượng Kỳ.');
}

const DARK = hex('#1d1612');
function isDark(c) { return Math.abs(c.r - DARK.r) < 0.03 && Math.abs(c.g - DARK.g) < 0.03 && Math.abs(c.b - DARK.b) < 0.03; }
// Đổi màu nét của biểu tượng
function tint(n, col) {
  const p = fp(col);
  const kids = n.findAll ? n.findAll((x) => x.type === 'VECTOR' || x.type === 'ELLIPSE' || x.type === 'RECTANGLE' || x.type === 'LINE' || x.type === 'POLYGON' || x.type === 'STAR' || x.type === 'BOOLEAN_OPERATION') : [];
  for (const k of kids) {
    if (k.strokes && k.strokes.length) k.strokes = [p];
    if (k.fills && k.fills.length && k.fills[0].type === 'SOLID' && isDark(k.fills[0].color)) k.fills = [p];
  }
  return n;
}
// Biểu tượng (instance) cỡ s, màu col
function ic(name, s, col) {
  const c = C.icons[name];
  if (!c) { const f = FR('biểu tượng ' + name, s || 18, s || 18); return f; }
  const i = c.createInstance();
  const k = (s || 18) / i.width; if (Math.abs(k - 1) > 0.001) i.rescale(k);
  if (col) tint(i, col);
  return i;
}
function ill(name, w) { const c = C.ill[name]; if (!c) return FR('minh hoạ ' + name, w, w); const i = c.createInstance(); i.rescale(w / i.width); return i; }

// Nút (component "Nút"): kind 'Chính' | 'Sáng'
function btn(kind, label, icon) {
  const v = C.btnSet.children.find((c) => c.name === 'Kiểu=' + kind) || C.btnSet.children[0];
  const i = v.createInstance();
  const p = {};
  for (const k of Object.keys(i.componentProperties)) {
    if (k.indexOf('Nhãn') === 0) p[k] = label;
    if (k.indexOf('Có biểu tượng') === 0) p[k] = !!icon;
    if (icon && k.indexOf('Biểu tượng') === 0 && C.icons[icon]) p[k] = C.icons[icon].id;
  }
  i.setProperties(p);
  if (icon) tint(i, kind === 'Chính' ? '#ffffff' : 'chữ/chính');
  return i;
}
// Nút tự vẽ (vàng, đen, viền…)
function pbtn(label, o) {
  o = o || {};
  const b = AL('H', 'Nút · ' + label, { gap: 8, align: 'CENTER', justify: 'CENTER', pad: o.pad || [11, 18], r: o.r != null ? o.r : 10, fill: o.fill || 'nhấn/đỏ son', stroke: o.stroke, fx: o.fx });
  if (o.icon) add(b, ic(o.icon, o.is || 16, o.color || '#ffffff'));
  add(b, T(label, o.st || 'b', o.size || 15, o.color || '#ffffff'));
  if (o.chev) add(b, ic('mui-ten-phai', 15, o.color || '#ffffff'));
  if (o.opacity) b.opacity = o.opacity;
  return b;
}
const GOLD_BTN = { fill: [lin([['#f9dc8a'], ['#e9b44c']])], color: '#5a3410', st: 'serif', stroke: '#c98a22', fx: [shadow(4, 10, 0.25)] };
const RED_BTN = { fill: [lin([['#d93a2b'], ['#a3150f']])], color: '#ffffff', st: 'serif', fx: [shadow(4, 10, 0.25)] };
const DARK_BTN = { fill: [lin([['#3a2c24'], ['#1d1612']])], color: '#f6e1b0', st: 'serif', stroke: '#8a6a3a' };

// Nhãn tròn nhỏ (pill)
function pill(text, o) {
  o = o || {};
  const p = AL('H', 'Nhãn · ' + text, { gap: 6, align: 'CENTER', pad: o.pad || [4, 10], r: 999, fill: o.fill || 'nền/thẻ phụ', stroke: o.stroke });
  if (o.icon) add(p, ic(o.icon, o.is || 13, o.color || 'chữ/phụ'));
  add(p, T(text, o.st || 'sb', o.size || 12, o.color || 'chữ/phụ'));
  return p;
}
function redTag(text) {
  const i = C.tag.createInstance();
  const p = {}; for (const k of Object.keys(i.componentProperties)) if (k.indexOf('Nhãn') === 0) p[k] = text;
  i.setProperties(p); return i;
}
// Công tắc
function toggle(on, o) {
  o = o || {};
  const w = o.w || 40, h = o.h || 22;
  const f = FR(on ? 'Công tắc · bật' : 'Công tắc · tắt', w, h, { r: h / 2, fill: on ? (o.on || 'nhấn/đỏ son') : '#e4ddd3' });
  const k = figma.createEllipse(); k.name = 'núm'; k.resize(h - 6, h - 6); k.x = on ? w - h + 3 : 3; k.y = 3; k.fills = [solid('#ffffff')]; k.effects = [shadow(1, 2, 0.25, '#000000')];
  f.appendChild(k); return f;
}
function check(on, col) {
  const f = AL('H', on ? 'Ô chọn · có' : 'Ô chọn · không', { align: 'CENTER', justify: 'CENTER', r: 4, fill: on ? (col || 'nhấn/đỏ son') : '#ffffff', stroke: on ? null : '#b9ab9b' });
  size(f, 16, 16); if (on) add(f, ic('dung', 12, '#ffffff')); return f;
}
function radio(on) {
  const f = FR(on ? 'Chọn · có' : 'Chọn · không', 20, 20, { r: 10, stroke: on ? 'nhấn/đỏ son' : '#b9ab9b', sw: 2, fill: '#ffffff' });
  if (on) { const d = dot('nhấn/đỏ son', 10); d.x = 5; d.y = 5; f.appendChild(d); }
  return f;
}
// Ô nhập
function input(value, o) {
  o = o || {};
  const f = AL('H', 'Ô nhập', { gap: 8, align: o.multi ? 'MIN' : 'CENTER', pad: o.pad || [11, 12], r: 8, fill: '#ffffff', stroke: o.stroke || '#d8cfc4' });
  const t = T(value, 'r', o.size || 14.5, o.ph ? 'chữ/mờ' : 'chữ/chính', { lh: o.multi ? 21 : null });
  if (o.multi) { TW(f, t); } else add(f, t);
  if (o.select) { grow(f); add(f, ic('mui-ten-xuong', 15, 'chữ/phụ')); }
  if (o.h) { f.counterAxisSizingMode = 'FIXED'; f.resize(f.width, o.h); }
  return f;
}
function field(p, label, value, o) {
  const g = AL('V', 'Trường · ' + label, { gap: 7 }); add(p, g, 'FILL');
  TW(g, T(label, 'sb', 13.5, 'chữ/chính'));
  const i = input(value, o); add(g, i, 'FILL');
  if (o && o.h) i.layoutSizingVertical = 'FIXED';
  if (o && o.hint) TW(g, T(o.hint, 'r', 12, 'chữ/mờ', { lh: 17 }));
  return g;
}
// Thẻ trắng
function card(p, name, o) {
  o = o || {};
  const c = AL('V', name, { gap: o.gap != null ? o.gap : 12, pad: o.pad || [20, 20], r: o.r != null ? o.r : 14, fill: o.fill || 'nền/thẻ', stroke: o.stroke === false ? null : (o.stroke || 'viền/mảnh'), fx: o.fx || [shadow(6, 18, 0.06)] });
  if (p) add(p, c, o.h || 'FILL', o.v);
  return c;
}
function cardHead(p, title, sub, right, o) {
  o = o || {};
  const h = AL('H', 'Đầu thẻ', { gap: 10, align: 'MIN' }); add(p, h, 'FILL');
  const l = AL('V', 'Tiêu đề', { gap: 3 }); add(h, l, 'FILL');
  TW(l, T(title, o.serif ? 'serif' : 'b', o.size || 17, o.color || 'chữ/chính'));
  if (sub) TW(l, T(sub, 'r', 12.5, o.subColor || 'chữ/mờ', { lh: 18 }));
  if (right) add(h, typeof right === 'string' ? T(right, 'b', 13, 'nhấn/đỏ son') : right);
  return h;
}
// Danh sách gạch đầu dòng; mục có thể là 'chữ' hoặc ['phần đậm', ' phần thường']
function bullets(p, items, o) {
  o = o || {};
  const g = AL('V', 'Danh sách', { gap: o.gap || 6 }); add(p, g, 'FILL');
  for (const it of items) {
    const r = AL('H', 'Mục', { gap: 8 }); add(g, r, 'FILL');
    const dw = AL('V', 'chấm', { pad: [Math.round((o.lh || 20) / 2) - 3, 0, 0, 0] }); add(r, dw); add(dw, dot(o.dot || '#c98a22', 5));
    const s = Array.isArray(it) ? it[0] + it[1] : it;
    const t = T(s, 'r', o.size || 13, o.color || 'chữ/phụ', { lh: o.lh || 20 }); TW(r, t);
    if (Array.isArray(it)) bold(t, it[0], 'b', o.boldColor || o.color || 'chữ/chính');
  }
  return g;
}
function avatar(text, s, o) {
  o = o || {};
  const a = AL('H', 'Ảnh đại diện', { align: 'CENTER', justify: 'CENTER', r: o.r != null ? o.r : Math.round(s * 0.24), fill: o.fill || 'nhấn/đỏ nhạt', stroke: o.stroke, sw: o.sw });
  size(a, s, s); add(a, T(text, o.st || 'b', o.size || Math.round(s * 0.36), o.color || 'nhấn/đỏ son'));
  if (o.fx) a.effects = o.fx;
  return a;
}
function coinPill(v, o) {
  o = o || {};
  const p = AL('H', 'Số xu', { gap: 6, align: 'CENTER', pad: o.pad || [6, 12], r: 999, fill: o.fill || 'vàng/nhạt', stroke: o.stroke });
  add(p, ic('xu', o.is || 15, '#8a6214')); add(p, T(v, 'b', o.size || 14, '#8a6214'));
  return p;
}
function progress(p, frac, o) {
  o = o || {};
  const w = 300, h = o.h || 8;
  const b = FR('Tiến độ', w, h, { r: h / 2, fill: o.bg || 'nền/thẻ phụ' });
  const f = figma.createRectangle(); f.name = 'đã đạt'; f.resize(Math.max(1, w * frac), h); f.cornerRadius = h / 2;
  f.fills = [o.fill || lin([['#b8862b'], ['#c61d1d']], 'h')]; f.constraints = { horizontal: 'SCALE', vertical: 'STRETCH' }; b.appendChild(f);
  add(p, b, 'FILL'); return b;
}

// ---------- Bàn cờ & quân cờ ----------
const SIDE = { r: 'Đỏ', b: 'Đen' };
const QN = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };
function piece(side, q, s) {
  const v = C.pieces.children.find((c) => c.name === 'Màu=' + SIDE[side] + ', Quân=' + QN[q]) || C.pieces.children[0];
  const i = v.createInstance(); i.rescale(s / i.width); return i;
}
function startPos() {
  const out = [];
  const order = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];
  order.forEach((q, c) => { out.push(['b', q, c, 0]); out.push(['r', q, c, 9]); });
  for (const c of [1, 7]) { out.push(['b', 'C', c, 2]); out.push(['r', 'C', c, 7]); }
  for (const c of [0, 2, 4, 6, 8]) { out.push(['b', 'P', c, 3]); out.push(['r', 'P', c, 6]); }
  return out;
}
// Bàn cờ gỗ khai cuộc (instance của component)
function boardInst(s) { const i = C.board.createInstance(); i.rescale(s / i.width); return i; }
// Bàn gỗ với thế cờ tuỳ ý: pos = [[side, quân, cột, hàng], ...]
function woodBoard(s, pos, o) {
  o = o || {};
  const f = FR(o.name || 'Bàn cờ', s, s, { fill: { type: 'IMAGE', imageHash: HASH.board, scaleMode: 'FILL' }, r: o.r != null ? o.r : 4 });
  f.clipsContent = false;
  const k = s / 1280, ps = s * (o.ps || 50) / 480;
  for (const p of pos) {
    const i = piece(p[0], p[1], ps); i.x = BXS[p[2]] * k - ps / 2; i.y = BYS[p[3]] * k - ps / 2;
    i.name = SIDE[p[0]] + ' ' + QN[p[1]]; f.appendChild(i);
  }
  return f;
}
// Bàn vẽ (bảng màu) — dùng cho các mẫu bàn trong Cửa hàng
const PAL = {
  classic: { bg: ['#e9c98f', '#d9a95f', '#cf9d52'], line: '#5a3a1a', text: '#6b4423' },
  thidau: { bg: ['#fbf6ec', '#f3eadb', '#ece0cc'], line: '#3d2f24', text: '#8a7a68' },
  tram: { bg: ['#8a5a36', '#6e4426', '#5b371e'], line: '#f1d9b5', text: '#f6dcb2' },
  truc: { bg: ['#e4ecc8', '#d3e0ad', '#c2d396'], line: '#3f5a2a', text: '#55703a' },
  ngoc: { bg: ['#e8f6ef', '#cfeadc', '#b6dcc8'], line: '#24604a', text: '#2f7a5c' },
  devuong: { bg: ['#a82020', '#8f1717', '#741010'], line: '#f2cf72', text: '#f7d98a' },
};
function drawnBoard(s, pal, pos, o) {
  o = o || {};
  const P = PAL[pal];
  const W = 900, H = 1000, m = 50, cx = (W - 2 * m) / 8, cy = (H - 2 * m) / 9;
  let g = '';
  for (let r = 0; r < 10; r++) g += `<line x1="${m}" y1="${m + r * cy}" x2="${W - m}" y2="${m + r * cy}"/>`;
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) g += `<line x1="${m + c * cx}" y1="${m}" x2="${m + c * cx}" y2="${H - m}"/>`;
    else { g += `<line x1="${m + c * cx}" y1="${m}" x2="${m + c * cx}" y2="${m + 4 * cy}"/><line x1="${m + c * cx}" y1="${m + 5 * cy}" x2="${m + c * cx}" y2="${H - m}"/>`; }
  }
  const X = (c) => m + c * cx, Y = (r) => m + r * cy;
  g += `<line x1="${X(3)}" y1="${Y(0)}" x2="${X(5)}" y2="${Y(2)}"/><line x1="${X(5)}" y1="${Y(0)}" x2="${X(3)}" y2="${Y(2)}"/>`;
  g += `<line x1="${X(3)}" y1="${Y(7)}" x2="${X(5)}" y2="${Y(9)}"/><line x1="${X(5)}" y1="${Y(7)}" x2="${X(3)}" y2="${Y(9)}"/>`;
  const str = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g stroke="${P.line}" stroke-width="4" fill="none">${g}</g></svg>`;
  const w = s, h = s * H / W;
  const f = FR(o.name || 'Bàn cờ vẽ', w, h, { fill: lin([[P.bg[0]], [P.bg[1]], [P.bg[2]]]), r: 4 });
  const n = svg(str, 'Lưới'); n.rescale(w / W); n.x = 0; n.y = 0; f.appendChild(n);
  const rv = T('楚 河          漢 界', 'han', Math.max(7, s * 0.045), P.text); rv.name = 'Sông'; f.appendChild(rv);
  rv.x = (w - rv.width) / 2; rv.y = (Y(4) + Y(5)) / 2 * (w / W) - rv.height / 2;
  const ps = cx * (w / W) * 0.86;
  for (const p of (pos || startPos())) { const i = piece(p[0], p[1], ps); i.x = X(p[2]) * (w / W) - ps / 2; i.y = Y(p[3]) * (w / W) - ps / 2; f.appendChild(i); }
  return f;
}

// ---------- Khung trang ----------
const NAV = ['Trang chủ', 'Chơi', 'AI', 'Xếp hạng', 'Giải đấu', 'Bạn bè', 'Túi đồ', 'Hồ sơ kỳ thủ'];
const NAV_IC = ['trang-chu', 'choi', 'ai', 'xep-hang', 'giai-dau', 'ban-be', 'tui-do', 'ho-so'];

function screenFrame(name) {
  const s = AL('H', name); size(s, 1440, 900);
  s.fills = [fp('nền/trang')]; s.clipsContent = true;
  s.setPluginData(MARK, '1');
  return s;
}
function navItems(n) { return n.findAll((x) => x.type === 'INSTANCE' && x.componentProperties && Object.prototype.hasOwnProperty.call(x.componentProperties, 'Trạng thái')); }
function sceneMain(screen, plain) {
  const m = AL('V', 'Vùng chính');
  m.fills = plain ? [fp('nền/trang')] : [{ type: 'IMAGE', imageHash: HASH.bg, scaleMode: 'FILL' }, lin([['#faf4e9', 0, 0.1], ['#faf4e9', 0.5, 0.22], ['#faf4e9', 1, 0.1]], 'h')];
  add(screen, m, 'FILL', 'FILL'); m.clipsContent = true;
  return m;
}
function setTopTitle(top, title) {
  const p = {}; for (const k of Object.keys(top.componentProperties)) if (k.indexOf('Tên trang') === 0) p[k] = title;
  top.setProperties(p);
}
// Màn người chơi: menu trái + thanh trên + vùng nội dung
function playerShell(name, o) {
  o = o || {};
  const screen = screenFrame(name);
  let side = C.side.createInstance();
  add(screen, side, null, 'FILL');
  if (o.nav != null && o.nav >= 0) { const it = navItems(side)[o.nav]; if (it) it.setProperties({ 'Trạng thái': 'Đang chọn' }); }
  if (o.guest) side = guestSide(side);
  const main = sceneMain(screen);
  let top = C.top.createInstance(); add(main, top, 'FILL');
  setTopTitle(top, o.crumb || name);
  if (o.guest) guestTop(top.detachInstance());
  const content = AL('V', 'Nội dung', { gap: o.gap != null ? o.gap : 16, pad: o.pad || [22, 32, 24, 32] });
  add(main, content, 'FILL', 'FILL');
  return { screen: screen, main: main, content: content };
}
function guestSide(inst) {
  const side = inst.detachInstance();
  const items = navItems(side);
  [1, 3, 4, 5, 6, 7].forEach((i) => {
    const it = items[i]; if (!it) return;
    const l = ic('khoa', 14, '#7d6d60'); side.appendChild(l); l.layoutPositioning = 'ABSOLUTE';
    l.x = side.width - 40; l.y = it.y + (it.height - 14) / 2; l.name = 'Khoá';
  });
  const uc = side.findOne((x) => x.name === 'Thẻ kỳ thủ');
  const box = AL('V', 'Hộp đăng nhập', { gap: 12, pad: [14, 12], r: 12, fill: '#ffffff', stroke: '#3a2c24' });
  box.fills = [solid('#ffffff', 0.05)];
  TW(box, T('Đăng nhập để lưu Elo, xu và lịch sử ván.', 'r', 12.5, '#a8998a', { lh: 18 }));
  add(box, pbtn('Đăng nhập', { pad: [11, 14] }), 'FILL');
  if (uc) { const idx = side.children.indexOf(uc); side.insertChild(idx, box); uc.remove(); } else side.appendChild(box);
  box.layoutSizingHorizontal = 'FILL';
  return side;
}
function guestTop(top) {
  top.name = 'Thanh trên · khách';
  const g = top.findOne((x) => x.name === 'đẩy phải');
  const idx = g ? top.children.indexOf(g) : top.children.length - 1;
  top.children.slice(idx + 1).forEach((c) => c.remove());
  add(top, T('Đăng nhập', 'sb', 14.5, 'chữ/chính'));
  add(top, pbtn('Đăng ký', { pad: [10, 18] }));
  return top;
}
// Menu thu gọn (trong trận)
function slimSide(screen, active) {
  const s = AL('V', 'Menu thu gọn', { gap: 8, align: 'CENTER', pad: [18, 10, 18, 10] });
  s.fills = [lin([['#1d1612'], ['#140f0c']])];
  add(screen, s, null, 'FILL'); fixW(s, 76);
  const logo = figma.createRectangle(); logo.name = 'Logo'; logo.resize(42, 40); logo.fills = [{ type: 'IMAGE', imageHash: HASH.logo, scaleMode: 'FIT' }];
  add(s, logo); spacer(s, 18);
  NAV_IC.forEach((k, i) => {
    const b = AL('H', 'Mục · ' + NAV[i], { align: 'CENTER', justify: 'CENTER', r: 10 }); size(b, 54, 44);
    if (i === active) { b.fills = [lin([['#d23a2c'], ['#a3150f']])]; b.effects = [shadow(4, 12, 0.35, '#7a0d08')]; }
    add(b, ic(k, 19, i === active ? '#ffffff' : '#a89887')); add(s, b);
  });
  return s;
}
function gameShell(name, crumb, active) {
  const screen = screenFrame(name);
  slimSide(screen, active);
  const main = sceneMain(screen);
  const top = C.top.createInstance(); add(main, top, 'FILL'); setTopTitle(top, crumb);
  const content = AL('V', 'Nội dung', { gap: 10, pad: [10, 16, 14, 16] }); add(main, content, 'FILL', 'FILL');
  return { screen: screen, main: main, content: content };
}
// Đầu trang: ‹ Quay lại  CHỮ ĐỎ ——
function eyebrow(p, text, o) {
  o = o || {};
  const r = AL('H', 'Đầu trang', { gap: 12, align: 'CENTER' }); add(p, r, 'FILL');
  if (o.back !== false) { const b = AL('H', 'Quay lại', { gap: 4, align: 'CENTER' }); const ch = ic('mui-ten-phai', 13, 'chữ/mờ'); ch.rotation = 180; add(b, ch); add(b, T('Quay lại', 'r', 13, 'chữ/phụ')); add(r, b); }
  add(r, T(text, 'b', 13.5, 'nhấn/đỏ son', { ls: 8, upper: true }));
  if (o.line !== false) { const l = line(40, 'nhấn/đỏ son'); add(r, l); }
  if (o.extra) add(r, T(o.extra, 'r', 13, 'chữ/mờ'));
  if (o.right) { grow(r); add(r, o.right); }
  return r;
}
// Thanh tab gạch chân
function tabsU(p, items, active, o) {
  o = o || {};
  const w = AL('V', 'Thanh tab', { gap: 0 }); add(p, w, 'FILL');
  const r = AL('H', 'Tab', { gap: 28 }); add(w, r, 'FILL');
  items.forEach((t, i) => {
    const c = AL('V', 'Tab · ' + t, { gap: 9, pad: [0, 2, 0, 2] }); add(r, c);
    const row = AL('H', 'nhãn', { gap: 6, align: 'CENTER' }); add(c, row);
    add(row, T(t, i === active ? 'b' : 'sb', 15, i === active ? 'nhấn/đỏ son' : 'chữ/phụ'));
    if (o.locks && o.locks.indexOf(i) >= 0) add(row, ic('khoa', 12, 'chữ/mờ'));
    const u = line(10, i === active ? 'nhấn/đỏ son' : '#ffffff'); u.resize(10, 2); if (i !== active) u.opacity = 0; add(c, u, 'FILL');
  });
  hr(w);
  return w;
}
// Tab dạng nút trong hộp trắng
function tabsSeg(p, items, active, o) {
  o = o || {};
  const r = AL('H', 'Tab nút', { gap: 4, pad: [5, 5], r: 12, fill: 'nền/thẻ', stroke: 'viền/mảnh', align: 'CENTER' });
  add(p, r, o.fill ? 'FILL' : null);
  items.forEach((t, i) => {
    const on = i === active;
    const c = AL('H', 'Tab · ' + t, { pad: [8, 15], r: 9, fill: on ? 'nhấn/đỏ nhạt' : null, stroke: on ? '#f2c4bd' : null, align: 'CENTER', gap: 6 });
    add(c, T(t, on ? 'b' : 'sb', 14.5, on ? 'nhấn/đỏ son' : 'chữ/phụ')); add(r, c);
  });
  return r;
}

// ---------- Khung trang quản trị ----------
const ADMIN_NAV = [
  ['VẬN HÀNH', [['luoi', 'Tổng quan'], ['luoi', 'Phòng chơi', '0'], ['ban-be', 'Kỳ thủ', '26'], ['giai-dau', 'Giải đấu', '0'], ['xep-hang', 'Bảng xếp hạng']]],
  ['NỘI DUNG', [['quan-co', 'Cờ thế', '5'], ['tro-chuyen', 'Cộng đồng'], ['tro-chuyen', 'Góp ý', '0']]],
  ['CÀI ĐẶT', [['luoi', 'Chức năng web'], ['xep-hang', 'Cài đặt hệ thống'], ['muc-tieu', 'Chế độ chơi & xu'], ['muc-tieu', 'Bàn cờ & quân cờ'], ['muc-tieu', 'Cửa hàng vật phẩm']]],
];
function adminShell(name, activeLabel, crumb) {
  const screen = screenFrame(name);
  const s = AL('V', 'Menu quản trị', { gap: 4, pad: [20, 14, 18, 14] });
  s.fills = [lin([['#1d1612'], ['#140f0c']])];
  add(screen, s, null, 'FILL'); fixW(s, 232);
  const brand = AL('H', 'Logo', { gap: 10, align: 'CENTER', pad: [0, 0, 16, 6] }); add(s, brand);
  const lg = figma.createRectangle(); lg.name = 'Logo 象'; lg.resize(42, 40); lg.fills = [{ type: 'IMAGE', imageHash: HASH.logo, scaleMode: 'FIT' }]; add(brand, lg);
  const bt = AL('V', 'Tên'); add(brand, bt); add(bt, T('Tượng Kỳ', 'serif', 21, '#f6eee4')); add(bt, T('QUẢN TRỊ', 'b', 10.5, '#f6e1b0', { ls: 10 }));
  for (const grp of ADMIN_NAV) {
    const lab = AL('H', 'nhóm', { pad: [10, 0, 4, 10] }); add(lab, T(grp[0], 'b', 11, 'menu/nhãn', { ls: 10 })); add(s, lab);
    for (const it of grp[1]) {
      const on = it[1] === activeLabel;
      const r = AL('H', 'Mục · ' + it[1], { gap: 12, align: 'CENTER', pad: [10, 12], r: 10 });
      if (on) { r.fills = [lin([['#d23a2c'], ['#a3150f']], 'h')]; r.effects = [shadow(4, 12, 0.35, '#7a0d08')]; }
      add(r, ic(it[0], 18, on ? '#ffffff' : '#a89887')); add(r, T(it[1], on ? 'b' : 'm', 14.5, on ? '#ffffff' : '#d9cbbb'));
      if (it[2] != null) { grow(r); const b = AL('H', 'đếm', { pad: [1, 7], r: 999, fill: '#f6eee4', align: 'CENTER' }); add(b, T(it[2], 'b', 11.5, '#1d1612')); add(r, b); }
      add(s, r, 'FILL');
    }
  }
  grow(s);
  hr(s, '#4a3a30');
  const op = AL('H', 'Mở trang chơi', { gap: 12, align: 'CENTER', pad: [12, 12] }); add(op, ic('chia-se', 18, '#a89887')); add(op, T('Mở trang chơi', 'm', 14.5, '#d9cbbb')); add(s, op, 'FILL');
  const main = sceneMain(screen, true);
  const top = AL('H', 'Thanh trên quản trị', { gap: 8, align: 'CENTER', pad: [0, 32], fill: '#ffffff', stroke: 'viền/mảnh' });
  top.strokeTopWeight = 0; top.strokeLeftWeight = 0; top.strokeRightWeight = 0; top.strokeBottomWeight = 1;
  add(main, top, 'FILL'); fixH(top, 64);
  add(top, T('Quản trị', 'r', 13.5, 'chữ/mờ')); add(top, T('/', 'r', 13.5, 'chữ/mờ')); add(top, T(crumb || activeLabel, 'sb', 13.5, 'chữ/chính'));
  grow(top); add(top, dot('trạng thái/xanh', 8)); add(top, T('File JSON · cập nhật 15:32:14', 'r', 13, 'chữ/phụ'));
  const content = AL('V', 'Nội dung', { gap: 20, pad: [26, 32, 24, 32] }); add(main, content, 'FILL', 'FILL');
  return { screen: screen, content: content };
}
function adminHead(p, eyebrowText, title, desc, actions) {
  const r = AL('H', 'Đầu trang', { gap: 24, align: 'MIN' }); add(p, r, 'FILL');
  const l = AL('V', 'Tiêu đề', { gap: 6 }); add(r, l, 'FILL');
  add(l, T(eyebrowText, 'b', 13, 'nhấn/đỏ son', { ls: 8, upper: true }));
  add(l, T(title, 'serif', 26, 'chữ/chính'));
  if (desc) TW(l, T(desc, 'r', 14, 'chữ/phụ', { lh: 20 }));
  if (actions) add(r, actions);
  return r;
}
function adminActions(withRestore) {
  const a = AL('V', 'Thao tác', { gap: 8, align: 'MAX' });
  const r1 = AL('H', 'hàng', { gap: 8 }); add(a, r1);
  if (withRestore) add(r1, pbtn('Khôi phục mặc định', { fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14.5 }));
  add(r1, pbtn('Bỏ thay đổi', { fill: 'nền/thẻ phụ', stroke: 'viền/mảnh', color: 'chữ/mờ', size: 14.5 }));
  add(a, pbtn('Lưu thay đổi', { fill: '#e08a85', size: 14.5 }));
  return a;
}

// ---------- Trang chủ ----------
function buildHome(name, guest) {
  const S = playerShell(name, { nav: 0, crumb: 'Trang chủ', guest: guest, gap: 14 });
  const c = S.content;
  add(c, T('CHÀO BUỔI CHIỀU, KỲ THỦ', 'b', 13, 'nhấn/đỏ son', { ls: 8 }));
  const grid = AL('H', 'Lưới trang chủ', { gap: 16 }); add(c, grid, 'FILL', 'FILL');
  const left = AL('V', 'Cột trái', { gap: 16 }); add(grid, left, 'FILL', 'FILL');

  // Banner
  const hero = AL('H', 'Banner', { align: 'CENTER', r: 16, clip: true, fx: [shadow(10, 24, 0.18)] });
  hero.fills = [rad([['#3a2a22'], ['#1d1612']])];
  add(left, hero, 'FILL'); fixH(hero, 314);
  const hb = AL('V', 'Chữ banner', { gap: 14, pad: [0, 16, 0, 32] }); add(hero, hb, 'FILL');
  add(hb, redTag('Cờ tướng Việt'));
  add(hb, T('Đấu trí trên bàn cờ.\nKết kỳ hữu bốn phương.', 'xb', 29, '#ffffff', { lh: 36 }));
  const meta = AL('H', 'Số liệu', { gap: 18, align: 'CENTER' }); add(hb, meta);
  const m1 = AL('H', 'online', { gap: 6, align: 'CENTER' }); add(m1, dot('trạng thái/xanh', 8)); const t1 = T('2 người đang online', 'r', 13.5, '#cbbfb2'); bold(t1, '2', 'b', '#ffffff'); add(m1, t1); add(meta, m1);
  const t2 = T('0 ván đang diễn ra', 'r', 13.5, '#cbbfb2'); bold(t2, '0', 'b', '#ffffff'); add(meta, t2);
  const acts = AL('H', 'Nút', { gap: 10 }); add(hb, acts);
  add(acts, btn('Chính', 'Chơi', 'choi')); add(acts, btn('Sáng', 'Phân tích', 'bieu-do'));
  const art = figma.createRectangle(); art.name = 'Quân 象'; art.resize(290, 278); art.fills = [{ type: 'IMAGE', imageHash: HASH.piece, scaleMode: 'FIT' }];
  add(hero, art);

  // Hàng dưới
  const row = AL('H', 'Hàng dưới', { gap: 16 }); add(left, row, 'FILL', 'FILL');
  const rank = card(row, 'Thông tin xếp hạng', { v: 'FILL' });
  if (guest) {
    cardHead(rank, 'Thông tin xếp hạng', 'Khách vẫn chơi được ngay.');
    const rb = AL('H', 'Bậc rank', { gap: 14, align: 'CENTER', pad: [12, 14], r: 12, fill: lin([['#2a1c15'], ['#47281b']], 'h') }); add(rank, rb, 'FILL');
    add(rb, avatar('?', 58, { r: 29, fill: rad([['#fff8e8'], ['#cdb48a']]), stroke: '#e8d2a6', sw: 3, color: '#8a5a12', st: 'serif', size: 24 }));
    const ri = AL('V', 'Thông tin', { gap: 4 }); add(rb, ri);
    add(ri, T('Chưa xếp hạng', 'serif', 21, '#f6e1b0'));
    const e = AL('H', 'Elo', { gap: 6, align: 'BASELINE' }); add(e, T('Elo khởi đầu', 'r', 12.5, '#c9a87a')); add(e, T('1.200', 'xb', 24, '#fff3dc')); add(ri, e);
    TW(rank, T('Tạo tài khoản miễn phí để có Elo xếp hạng, nhận xu mỗi ngày, lưu lịch sử và phân tích lại mọi ván cờ.', 'r', 14, 'chữ/phụ', { lh: 21 }));
    const bb = AL('H', 'Nút', { gap: 10 }); add(rank, bb); add(bb, btn('Chính', 'Tạo tài khoản')); add(bb, btn('Sáng', 'Đăng nhập'));
  } else {
    cardHead(rank, 'Thông tin xếp hạng', 'Elo chỉ đổi ở ván online giữa hai tài khoản', 'Hồ sơ ›');
    const rb = AL('H', 'Bậc rank', { gap: 14, align: 'CENTER', pad: [12, 14], r: 12, fill: lin([['#2a1c15'], ['#47281b']], 'h') }); add(rank, rb, 'FILL');
    rb.appendChild(rankBadge(60));
    const ri = AL('V', 'Thông tin', { gap: 2 }); add(rb, ri);
    add(ri, T('Bạc', 'serif', 21, '#dfe6ee')); add(ri, T('★★★☆☆', 'r', 13, '#ffd27a'));
    const e = AL('H', 'Elo', { gap: 6, align: 'BASELINE' }); add(e, T('Elo', 'r', 12.5, '#c9a87a')); add(e, T('1.200', 'xb', 24, '#fff3dc')); add(ri, e);
    progress(rank, 0.5);
    add(rank, T('Còn 100 Elo để lên Vàng', 'r', 12.5, 'chữ/mờ'));
    const st = AL('H', 'Chỉ số', { gap: 8 }); add(rank, st, 'FILL');
    [['Tỉ lệ thắng', '—', '0T · 0H · 0B'], ['Chuỗi thắng', '0', 'Kỷ lục 0'], ['Xu', '1.020', 'Dùng ở Cửa hàng']].forEach((x) => {
      const b = AL('V', x[0], { gap: 3, pad: [9, 11], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(st, b, 'FILL', 'FILL');
      add(b, T(x[0], 'r', 12, 'chữ/mờ')); add(b, T(x[1], 'xb', 20, 'chữ/chính')); TW(b, T(x[2], 'r', 11.5, 'chữ/mờ', { lh: 16 }));
    });
    grow(rank);
    const rbt = pbtn('Đấu xếp hạng', { icon: 'xep-hang' }); add(rank, rbt, 'FILL');
  }
  const hot = card(row, 'Trận đấu hot', { v: 'FILL' });
  cardHead(hot, 'Trận đấu hot', 'Đang diễn ra tại Tượng Kỳ', 'Xem tất cả ›');
  const em = AL('V', 'Trống', { align: 'CENTER', pad: [22, 16], r: 10, stroke: 'viền/mảnh', dash: [5, 4] }); add(hot, em, 'FILL');
  const et = T('Chưa có ván nào đang diễn ra — mở màn ngay', 'r', 13.5, 'chữ/mờ', { align: 'CENTER', lh: 20 }); TW(em, et); bold(et, 'mở màn ngay', 'b', 'nhấn/đỏ son');

  community(grid, guest);
  return S;
}
function rankBadge(s) {
  const b = AL('H', 'Huy hiệu Bạc', { align: 'CENTER', justify: 'CENTER', r: s / 2, fill: rad([['#ffffff'], ['#8f9aa8']]), stroke: '#c9d3df', sw: 3, fx: [shadow(3, 8, 0.35, '#000000')] });
  size(b, s, s);
  const i = AL('H', 'Mặt', { align: 'CENTER', justify: 'CENTER', r: s * 0.35, fill: rad([['#fbefd6'], ['#e8cf9e']]), stroke: '#8f5a12', sw: 2 });
  size(i, s * 0.7, s * 0.7); add(i, T('炮', 'han', s * 0.34, '#8a1712')); add(b, i);
  return b;
}
function community(grid, guest) {
  const cm = card(grid, 'Cộng đồng Tượng Kỳ', { h: 'FIXED', v: 'FILL', gap: 12 });
  fixW(cm, 394);
  const hd = AL('H', 'Đầu thẻ', { gap: 10 }); add(cm, hd, 'FILL');
  const hl = AL('V', 'Tiêu đề', { gap: 4 }); add(hd, hl, 'FILL');
  add(hl, T('Cộng đồng Tượng Kỳ', 'b', 17, 'chữ/chính'));
  TW(hl, T('Trò chuyện và chia sẻ thế cờ với mọi kỳ thủ — bấm "Mở phân tích" để xem thế cờ người khác gửi.', 'r', 12.5, 'chữ/mờ', { lh: 19 }));
  add(hd, pill('2 người đang online'));
  const feed = AL('V', 'Tin nhắn', { gap: 10, pad: [10, 10], r: 12, stroke: 'viền/mảnh', clip: true }); add(cm, feed, 'FILL', 'FILL');
  const msg = (who, ini, text, share) => {
    const m = AL('H', 'Tin · ' + who, { gap: 10 }); add(feed, m, 'FILL');
    add(m, avatar(ini, 34, { r: 8, size: 12 }));
    const bub = AL('V', 'Bong bóng', { gap: 6, pad: [8, 12], r: 12, fill: 'nền/thẻ', stroke: 'viền/mảnh' }); bub.topLeftRadius = 4; add(m, bub, 'FILL');
    const nm = AL('H', 'Tên', { gap: 6, align: 'CENTER' }); add(nm, T(who, 'b', 13.5, 'chữ/chính')); add(nm, T('Bạc · 1.200   00:47 12/10/2026', 'r', 11.5, 'chữ/mờ')); add(bub, nm);
    if (text) TW(bub, T(text, 'r', 14, 'chữ/chính', { lh: 20 }));
    if (share) {
      const s = AL('H', 'Thế cờ chia sẻ', { gap: 12, align: 'CENTER', pad: [8, 8], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(bub, s, 'FILL');
      add(s, boardInst(118));
      const r = AL('V', 'Thông tin', { gap: 6 }); add(s, r, 'FILL');
      TW(r, T(share[0], 'b', 15, 'chữ/chính', { lh: 21 })); add(r, T(share[1], 'r', 12.5, 'chữ/mờ')); add(r, pbtn('Mở phân tích', { pad: [8, 12], size: 13.5 }));
    }
  };
  msg('Thu Hà', 'TH', 'Thế này Đen nên đi gì?', ['P2-5 M8.7 M2.3', '3 nước']);
  msg('Minh Quân', 'MQ', 'Chào cả nhà! Tối nay ai làm vài ván cờ chớp không?');
  msg('Minh Quân', 'MQ', 'Thế Pháo đầu này Đen nên đáp thế nào cho chắc?', ['Pháo đầu đối Bình phong mã', '4 nước']);
  const comp = AL('H', 'Soạn tin', { gap: 8 }); add(cm, comp, 'FILL');
  const ta = AL('V', 'Ô soạn', { pad: [10, 12], r: 10, fill: 'nền/thẻ', stroke: 'viền/mảnh' }); add(comp, ta, 'FILL', 'FILL');
  TW(ta, T('Nhắn với cộng đồng… (Enter để gửi, Shift+Enter xuống dòng)', 'r', 14, 'chữ/mờ', { lh: 20 }));
  const col = AL('V', 'Nút', { gap: 6 }); add(comp, col);
  add(col, pbtn('Thế cờ', { icon: 'luoi', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', pad: [8, 12], size: 13.5 }), 'FILL');
  add(col, pbtn('Gửi', { pad: [8, 12], size: 14, opacity: guest ? 0.5 : null }), 'FILL');
  if (guest) { const n = T('Ai cũng đọc được — đăng nhập để gửi tin và chia sẻ thế cờ.', 'r', 12.5, 'chữ/mờ', { lh: 18 }); TW(cm, n); bold(n, 'đăng nhập', 'm', 'nhấn/đỏ son'); }
}
function buildMissions(name) {
  const S = buildHome(name, false);
  const p = AL('V', 'Bảng nhiệm vụ', { gap: 10, pad: [16, 14], r: 12, fill: 'nền/thẻ', stroke: 'viền/mảnh', fx: [shadow(16, 40, 0.22)] });
  S.screen.appendChild(p); p.layoutPositioning = 'ABSOLUTE'; fixW(p, 378); p.x = 1037; p.y = 62;
  const h = AL('H', 'Đầu', { gap: 8 }); add(p, h, 'FILL');
  const l = AL('V', 'Tiêu đề', { gap: 2 }); add(h, l, 'FILL'); add(l, T('Nhiệm vụ hôm nay', 'b', 17, 'chữ/chính')); add(l, T('Hoàn thành để nhận xu — làm mới mỗi ngày', 'r', 13, 'chữ/mờ'));
  add(h, ic('qua', 20, 'nhấn/đỏ son'));
  [['Giải 1 thế cờ', '+15'], ['Thắng máy từ cấp 3 trở lên', '+15'], ['Thắng 1 ván xếp hạng', '+30']].forEach((m, i) => {
    hr(p);
    const r = AL('H', m[0], { gap: 8, align: 'CENTER', pad: [4, 0, 0, 0] }); add(p, r, 'FILL'); add(r, T(m[0], 'sb', 14.5, 'chữ/chính')); grow(r);
    add(r, ic('xu', 14, '#c99a2e')); add(r, T(m[1], 'b', 13.5, '#c99a2e'));
    progress(p, 0.02, { h: 6 });
    add(p, T('0/1', 'r', 12.5, 'chữ/mờ'));
  });
  return S;
}

// ---------- Chơi: 4 cờ phướn ----------
function banner(parent, color, name, W, H) {
  const wrap = FR('Cờ phướn · ' + name, W, H); add(parent, wrap);
  const v = C.banners.children.find((c) => c.name === 'Màu=' + color) || C.banners.children[0];
  const b = v.createInstance(); b.resize(W, H); b.x = 0; b.y = 0; wrap.appendChild(b);
  b.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
  const px = Math.round(W * 0.085), pt = Math.round(W * 0.075), pb = Math.round(W * 0.5);
  const body = AL('V', 'Nội dung cờ phướn', { gap: 10 }); wrap.appendChild(body);
  body.x = px; body.y = pt; size(body, W - 2 * px, H - pt - pb);
  body.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
  return body;
}
function bannerHead(p, illName, title, desc, light) {
  const h = AL('H', 'Đầu', { gap: 10, align: 'CENTER' }); add(p, h, 'FILL');
  add(h, ill(illName, 38)); add(h, T(title, 'serif', 21, light ? '#fff5e6' : '#3a2416'));
  TW(p, T(desc, 'r', 12.5, light ? '#f3dccb' : '#6b5545', { lh: 17 }));
}
function bannerFoot(p, text, light, dotCol) {
  const f = AL('H', 'Chân', { gap: 6, align: 'CENTER', justify: 'CENTER' }); add(p, f, 'FILL');
  if (dotCol) add(f, dot(dotCol, 7)); else add(f, ic('ban-be', 13, light ? '#cbbfb2' : '#8a7563'));
  add(f, T(text, 'r', 12, light ? '#f3dccb' : '#7a6656'));
}
function buildPlay(name) {
  const S = playerShell(name, { nav: 1, crumb: 'Chơi', gap: 18 });
  eyebrow(S.content, 'Chơi');
  const row = AL('H', 'Dãy cờ phướn', { gap: 26, pad: [8, 0, 0, 0] }); add(S.content, row, 'FILL');
  row.primaryAxisAlignItems = 'CENTER';
  const W = 265, H = 670;
  // 1. Xếp hạng
  let b = banner(row, 'Đỏ', 'Xếp hạng', W, H);
  bannerHead(b, 'cupNho', 'Xếp hạng', 'Đấu xếp hạng ELO · ghép trận tự động', true);
  const tw = AL('H', 'Cúp', { justify: 'CENTER' }); add(b, tw, 'FILL'); add(tw, ill('cup', 104));
  const tb = AL('V', 'Thời gian mỗi ván', { gap: 2, align: 'CENTER', pad: [8, 10], r: 10, fill: lin([['#2a1410'], ['#160a08']]), stroke: '#e9b44c', sw: 1.5 }); add(b, tb, 'FILL');
  add(tb, T('THỜI GIAN MỖI VÁN', 'b', 10.5, '#f2cf72', { ls: 8 })); add(tb, T('15p + 5s', 'serif', 25, '#ffffff'));
  bullets(b, [['Bậc của bạn: ', 'Bạc 3★ · Elo 1.200'], 'Ghép đối thủ cùng trình độ (±100 Elo)', 'Thắng +20 xu, chơi trọn ván +10 xu'], { color: '#fbe3cf', boldColor: '#ffffff', size: 11.5, lh: 17, dot: '#f2cf72', gap: 3 });
  grow(b); add(b, pbtn('Vào xếp hạng', Object.assign({ chev: true, size: 15 }, GOLD_BTN)), 'FILL');
  const f1 = AL('H', 'Chân', { gap: 6, align: 'CENTER', justify: 'CENTER' }); add(b, f1, 'FILL'); add(f1, dot('trạng thái/xanh', 7)); const ft = T('3 người đang online', 'r', 12, '#f3dccb'); bold(ft, '3', 'b', '#ffffff'); add(f1, ft);
  // 2. Chơi nhanh
  b = banner(row, 'Ngà', 'Chơi nhanh', W, H);
  bannerHead(b, 'dongXu', 'Chơi nhanh', 'Tuỳ chọn nhịp chơi và mức đặt theo sở thích của bạn.', false);
  add(b, coinPill('Số dư: 1.020 xu', { size: 12, is: 12, pad: [4, 10] }));
  [['choi', 'Cờ chớp', '1+0 · 3+0 · 3+2'], ['dong-ho', 'Cờ nhanh', '5+0 · 10+0 · 10+5'], [null, 'Mức đặt', '50 – 500 xu']].forEach((o) => {
    const r = AL('H', o[1], { gap: 12, align: 'CENTER', pad: [9, 12], r: 9, fill: '#ffffff', stroke: '#eadfce' }); add(b, r, 'FILL');
    if (o[0]) add(r, ic(o[0], 19, 'nhấn/đỏ son')); else add(r, ill('dongXu', 22));
    const t = AL('V', 'chữ', { gap: 2 }); add(r, t); add(t, T(o[1], 'b', 14, '#3a2416')); add(t, T(o[2], 'r', 11.5, '#7a6656'));
  });
  grow(b); add(b, pbtn('Vào bàn chơi nhanh', Object.assign({ chev: true, size: 15 }, RED_BTN)), 'FILL');
  bannerFoot(b, '0 bàn chơi nhanh đang chờ', false);
  // 3. Bàn đấu
  b = banner(row, 'Đen', 'Bàn đấu', W, H);
  bannerHead(b, 'banCoNho', 'Bàn đấu', 'Xem các ván đang diễn ra trong cộng đồng.', true);
  const em = AL('V', 'Trống', { gap: 8, align: 'CENTER', justify: 'CENTER', pad: [12, 14], r: 8, stroke: '#5a4a3a', dash: [4, 4] }); add(b, em, 'FILL', 'FILL');
  add(em, ill('banCoNho', 30)); add(em, T('Chưa có bàn nào', 'b', 13.5, '#f1e7da'));
  TW(em, T('Vào hàng chờ xếp hạng hoặc tạo phòng để mở màn.', 'r', 12.5, '#cbbfb2', { align: 'CENTER', lh: 18 }));
  add(b, pbtn('Xem tất cả bàn đấu', Object.assign({ chev: true, size: 15 }, DARK_BTN)), 'FILL');
  bannerFoot(b, '0 bàn đang đấu · 0 bàn đang chờ', true);
  // 4. Đánh với bạn
  b = banner(row, 'Be', 'Đánh với bạn', W, H);
  bannerHead(b, 'haiNguoi', 'Đánh với bạn', 'Tạo phòng và mời bạn bè cùng so tài.', false);
  add(b, ill('canhBan', 190));
  bullets(b, ['Phòng riêng, gửi link là vào chơi', 'Tự chọn nhịp, màu quân, cho đi lại', 'Không tính Elo, không mất xu'], { color: '#5a4334', size: 11.5, lh: 17, gap: 3 });
  grow(b); add(b, pbtn('Tạo phòng', Object.assign({ icon: 'cong', chev: true, size: 15 }, RED_BTN)), 'FILL');
  return S;
}

// ---------- Xếp hạng ----------
function buildRanked(name) {
  const S = playerShell(name, { nav: 1, crumb: 'Chơi  /  Xếp hạng', gap: 18 });
  eyebrow(S.content, 'Chơi · Xếp hạng');
  const row = AL('H', 'Hai cột', { gap: 24, align: 'MIN' }); add(S.content, row, 'FILL');
  const big = AL('H', 'Thẻ xếp hạng', { gap: 20, align: 'CENTER', pad: [26, 26], r: 16, fill: lin([['#a51c14'], ['#6e0f0b']]), stroke: '#d9a94e', sw: 1.5, fx: [shadow(14, 30, 0.3)] });
  add(row, big); fixW(big, 760);
  const tl = AL('H', 'Cúp', { justify: 'CENTER', align: 'CENTER' }); add(big, tl); fixW(tl, 240); add(tl, ill('cup', 210));
  const r = AL('V', 'Thông tin', { gap: 14 }); add(big, r, 'FILL');
  const rk = AL('V', 'Bậc hiện tại', { gap: 10, pad: [14, 18], r: 12, fill: lin([['#5a120d'], ['#3a0b08']]), stroke: '#9a4a2a' }); add(r, rk, 'FILL');
  const rr = AL('H', 'hàng', { gap: 14, align: 'CENTER' }); add(rk, rr, 'FILL');
  rr.appendChild(rankBadge(66));
  const rn = AL('V', 'Tên bậc', { gap: 2 }); add(rr, rn); add(rn, T('BẬC HIỆN TẠI', 'b', 11, '#f2cf72', { ls: 8 })); add(rn, T('Bạc', 'serif', 26, '#ffffff')); add(rn, T('★★★☆☆', 'r', 13, '#ffd27a'));
  grow(rr);
  const el = AL('V', 'Elo', { align: 'MAX' }); add(rr, el); add(el, T('ELO', 'b', 11, '#f2cf72', { ls: 8 })); add(el, T('1.200', 'serif', 38, '#ffffff'));
  progress(rk, 0.5, { bg: '#2a0806', fill: lin([['#d8dde4'], ['#ffffff']], 'h') });
  add(rk, T('Còn 100 Elo để lên Vàng', 'r', 13, '#f3dccb'));
  const tb = AL('V', 'Thời gian mỗi ván', { gap: 2, align: 'CENTER', pad: [12, 14], r: 12, fill: lin([['#2a1410'], ['#160a08']]), stroke: '#e9b44c', sw: 2 }); add(r, tb, 'FILL');
  add(tb, T('THỜI GIAN MỖI VÁN · CỐ ĐỊNH', 'b', 11, '#f2cf72', { ls: 8 })); add(tb, T('15p + 5s', 'serif', 36, '#ffffff'));
  add(tb, T('15 phút mỗi bên, cộng 5 giây sau mỗi nước, tối đa 1 phút mỗi nước', 'r', 12.5, '#e8d6c4'));
  TW(r, T('Thắng +20 xu, chơi trọn ván +10 xu · Elo thay đổi sau mỗi ván với tài khoản khác', 'r', 14, '#fbe3cf', { lh: 20 }));
  add(r, pbtn('Vào hàng chờ', Object.assign({ chev: true, size: 17, pad: [14, 18] }, GOLD_BTN)), 'FILL');
  const ft = AL('H', 'Chân', { gap: 16, align: 'CENTER', justify: 'CENTER' }); add(r, ft, 'FILL');
  const a = AL('H', 'online', { gap: 6, align: 'CENTER' }); add(a, dot('trạng thái/xanh', 8)); const at = T('3 người đang online', 'r', 13, '#f3dccb'); bold(at, '3', 'b', '#ffffff'); add(a, at); add(ft, a);
  const w = AL('H', 'ước tính', { gap: 6, align: 'CENTER' }); add(w, ic('dong-ho', 13, '#f3dccb')); add(w, T('Ước tính: < 1 phút', 'r', 13, '#f3dccb')); add(ft, w);
  add(ft, pill('Phí 10 xu', { fill: '#f9dc8a', color: '#5a3410', st: 'b', stroke: '#c98a22' }));
  const rules = card(row, 'Luật xếp hạng', { h: 'FILL', pad: [22, 20] });
  add(rules, T('Luật xếp hạng', 'serif', 21, 'chữ/chính'));
  const bx = AL('V', 'Hộp luật', { pad: [12, 16], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(rules, bx, 'FILL');
  bullets(bx, [['Phí', ' 10 xu mỗi ván, trừ khi ván bắt đầu'], ['Thưởng', ' +10 xu khi chơi trọn ván, thắng thêm +10 xu'], ['Elo', ' chỉ tính khi cả hai bên đều đăng nhập'], ['Ghép trận', ' ±100 Elo, nới dần mỗi 5 giây chờ'], ['Rời bàn', ' giữa ván hoặc mất kết nối quá 90 giây bị xử thua']], { dot: 'chữ/chính' });
  return S;
}

// ---------- Chơi nhanh ----------
function buildCoin(name) {
  const S = playerShell(name, { nav: 1, crumb: 'Chơi  /  Chơi nhanh', gap: 18 });
  eyebrow(S.content, 'Chơi · Chơi nhanh');
  const row = AL('H', 'Hai cột', { gap: 24, align: 'MIN' }); add(S.content, row, 'FILL');
  const big = AL('V', 'Thẻ chơi nhanh', { gap: 14, pad: [24, 26], r: 16, fill: lin([['#fffaf0'], ['#f6ecdb']]), stroke: '#e3cfa8', sw: 1.5, fx: [shadow(12, 26, 0.12)] });
  add(row, big); fixW(big, 760);
  const h = AL('H', 'Đầu', { align: 'CENTER' }); add(big, h, 'FILL'); add(h, T('Nhịp chơi', 'serif', 23, '#3a2416')); grow(h); add(h, coinPill('Số dư: 1.020 xu', { size: 13, is: 13 }));
  const opt = (icn, title, chips, sel, chipSel) => {
    const r = AL('H', title, { gap: 16, align: 'CENTER', pad: [14, 18], r: 12, fill: '#ffffff', stroke: sel ? 'nhấn/đỏ son' : '#eadfce', sw: sel ? 2 : 1 }); add(big, r, 'FILL');
    add(r, ic(icn, 20, 'nhấn/đỏ son'));
    const t = AL('V', 'chữ', { gap: 8 }); add(r, t, 'FILL'); add(t, T(title, 'b', 16, '#2a1a10'));
    const cs = AL('H', 'nhịp', { gap: 6 }); add(t, cs);
    chips.forEach((c, i) => add(cs, pill(c, i === chipSel ? { fill: 'nhấn/đỏ son', color: '#ffffff', st: 'b', size: 13, pad: [5, 12] } : { fill: '#ffffff', stroke: '#d8cfc4', color: 'chữ/phụ', size: 13, pad: [5, 12] })));
    add(r, radio(sel));
  };
  opt('choi', 'Cờ chớp', ['1+0', '3+0', '3+2'], false, -1);
  opt('dong-ho', 'Cờ nhanh', ['5+0', '10+0', '10+5'], true, 0);
  add(big, T('Mức đặt', 'serif', 23, '#3a2416'));
  const st = AL('H', 'Mức đặt', { gap: 10 }); add(big, st, 'FILL');
  ['50 xu', '100 xu', '200 xu', '500 xu'].forEach((v, i) => {
    const b = AL('H', v, { align: 'CENTER', justify: 'CENTER', pad: [14, 10], r: 8, fill: i === 0 ? lin([['#f9dc8a'], ['#e9b44c']]) : '#fffaf0', stroke: i === 0 ? '#c98a22' : '#eadfce' }); add(st, b, 'FILL');
    add(b, T(v, 'b', 16, i === 0 ? '#5a3410' : '#3a2416'));
  });
  add(big, pbtn('Vào bàn · đặt 50 xu · 5+0', Object.assign({ chev: true, size: 18, pad: [14, 18] }, RED_BTN)), 'FILL');
  const cap = AL('H', 'ghi chú', { justify: 'CENTER' }); add(big, cap, 'FILL'); add(cap, T('Có bàn đang chờ cùng nhịp & mức đặt thì vào ngồi ngay; chưa có thì tự tạo bàn mới và chờ đối thủ.', 'r', 13, '#7a6656'));
  const f = AL('H', 'Chân', { gap: 8, align: 'CENTER' }); add(big, f); add(f, ic('ban-be', 14, '#8a7563')); add(f, T('0 bàn chơi nhanh đang chờ', 'r', 13.5, '#6b5545'));
  const art = AL('H', 'Minh hoạ', { justify: 'CENTER' }); add(big, art, 'FILL'); add(art, ill('canhXu', 190));
  const rc = AL('V', 'Cột phải', { gap: 16 }); add(row, rc, 'FILL');
  const w = card(rc, 'Bàn đang chờ', { pad: [22, 20] }); add(w, T('Bàn đang chờ', 'serif', 21, 'chữ/chính'));
  TW(w, T('Chưa có bàn nào đang chờ — bấm "Vào bàn" để mở bàn đầu tiên.', 'r', 13.5, 'chữ/mờ', { lh: 20 }));
  const ru = card(rc, 'Luật chơi nhanh', { pad: [22, 20] }); add(ru, T('Luật chơi nhanh', 'serif', 21, 'chữ/chính'));
  const bx = AL('V', 'Hộp luật', { pad: [12, 16], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(ru, bx, 'FILL');
  bullets(bx, [['Thắng', ' +mức đặt · Thua −mức đặt · Hoà hoàn nguyên'], 'Chỉ chọn được mức đặt không vượt quá số dư', ['Bỏ trận', ' hoặc mất kết nối quá 90 giây bị xử thua'], 'Xu chỉ dùng trong Tượng Kỳ (vật phẩm, chơi nhanh), không quy đổi tiền thật'], { dot: 'chữ/chính' });
  return S;
}

// ---------- Bàn đấu ----------
function buildTables(name) {
  const S = playerShell(name, { nav: 1, crumb: 'Chơi  /  Bàn đấu', gap: 18 });
  eyebrow(S.content, 'Chơi · Bàn đấu');
  const box = AL('V', 'Danh sách bàn', { pad: [20, 20], r: 16, fill: lin([['#231a15'], ['#15100d']]), fx: [shadow(14, 30, 0.3)] }); add(S.content, box, 'FILL');
  const em = AL('V', 'Trống', { gap: 10, align: 'CENTER', pad: [52, 20], r: 10, stroke: '#4a3a30', dash: [4, 4] }); add(box, em, 'FILL');
  add(em, ill('banCoNho', 38)); add(em, T('Chưa có bàn nào', 'b', 15, '#ffffff')); add(em, T('Vào hàng chờ xếp hạng hoặc tạo phòng để mở màn.', 'r', 14, '#cbbfb2'));
  // Bản mẫu khi có bàn
  add(S.content, T('Mẫu khi có bàn', 'b', 13, 'chữ/phụ', { ls: 6, upper: true }));
  const list = AL('H', 'Các bàn (mẫu)', { gap: 16, wrap: true }); add(S.content, list, 'FILL');
  [['Đang chơi', 'Minh Quân', 'Thu Hà', 'Xếp hạng · 15+5', 'trạng thái/xanh', 'Xem'], ['Đang chờ', 'Văn Long', null, 'Chơi nhanh · 5+0 · 100 xu', '#e9b44c', 'Vào bàn'], ['Sẵn sàng', 'Hải Đăng', 'Bảo Ngọc', 'Phòng riêng · 10+0', '#5b8def', 'Xem']].forEach((t) => {
    const c = AL('H', 'Bàn · ' + t[1], { gap: 14, align: 'CENTER', pad: [14, 16], r: 14, fill: lin([['#2a1f19'], ['#1a130f']]), stroke: '#4a3a30' }); add(list, c); fixW(c, 362);
    add(c, boardInst(84));
    const r = AL('V', 'Thông tin', { gap: 6 }); add(c, r, 'FILL');
    const s = AL('H', 'Trạng thái', { gap: 6, align: 'CENTER' }); add(s, dot(t[4], 7)); add(s, T(t[0], 'b', 12, '#f1e7da')); add(r, s);
    add(r, T(t[1] + (t[2] ? '  vs  ' + t[2] : '  ·  chờ đối thủ'), 'b', 14.5, '#ffffff'));
    add(r, T(t[3], 'r', 12.5, '#cbbfb2'));
    add(r, pbtn(t[5], Object.assign({ size: 13, pad: [6, 12], chev: true }, t[5] === 'Xem' ? DARK_BTN : RED_BTN)));
  });
  return S;
}

// ---------- Chơi với bạn ----------
function buildRoom(name) {
  const S = playerShell(name, { nav: 1, crumb: 'Chơi  /  Chơi với bạn', gap: 18 });
  eyebrow(S.content, 'Chơi · Chơi với bạn', { line: false });
  const row = AL('H', 'Hai cột', { gap: 24, align: 'MIN' }); add(S.content, row, 'FILL');
  const L = card(row, 'Tạo phòng', { h: 'FIXED', pad: [22, 20], gap: 14 }); fixW(L, 710);
  cardHead(L, 'Tạo phòng', 'Phòng riêng không tính Elo.', pill('Phòng riêng'));
  const lab = (t) => add(L, T(t, 'sb', 14, 'chữ/chính'));
  lab('Nhịp chơi');
  const tc = AL('H', 'Nhịp', { gap: 8 }); add(L, tc);
  ['5+0', '10+0', '15+10', '30+0', 'Không giới hạn'].forEach((t, i) => add(tc, pill(t, i === 1 ? { fill: 'nhấn/đỏ nhạt', stroke: 'nhấn/đỏ son', color: 'nhấn/đỏ son', size: 15, pad: [9, 14] } : { fill: '#ffffff', stroke: '#d8cfc4', color: 'chữ/chính', size: 15, pad: [9, 14] })));
  lab('Thời gian mỗi nước');
  add(L, input('1 phút', { select: true }), 'FILL');
  lab('Màu quân của bạn');
  const col = AL('H', 'Màu', { gap: 8 }); add(L, col, 'FILL');
  [['Đỏ', ' (đi trước)', 'nhấn/đỏ son'], ['Đen', '', '#1d1612'], ['Ngẫu nhiên', '', null]].forEach((x, i) => {
    const b = AL('H', x[0], { gap: 8, align: 'CENTER', justify: 'CENTER', pad: [11, 10], r: 8, fill: i === 0 ? 'nhấn/đỏ nhạt' : '#ffffff', stroke: i === 0 ? 'nhấn/đỏ son' : '#d8cfc4' }); add(col, b, 'FILL');
    if (x[2]) add(b, dot(x[2], 10)); const t = T(x[0] + x[1], 'b', 15, i === 0 ? 'nhấn/đỏ son' : 'chữ/chính'); if (x[1]) bold(t, x[1], 'r', 'chữ/phụ'); add(b, t);
  });
  lab('Luật phòng');
  [['Cho người xem', 'Người có link xem trực tiếp, hiện ở Trận đấu hot', true], ['Cho phép đi lại', 'Xin đi lại, đối thủ đồng ý thì lùi nước', false]].forEach((x) => {
    const r = AL('H', x[0], { gap: 12, align: 'CENTER', pad: [13, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, r, 'FILL');
    const t = AL('V', 'chữ', { gap: 3 }); add(r, t, 'FILL'); add(t, T(x[0], 'b', 14.5, 'chữ/chính')); add(t, T(x[1], 'r', 12.5, 'chữ/mờ'));
    add(r, toggle(x[2]));
  });
  add(L, pbtn('Tạo phòng & lấy link mời', { icon: 'lien-ket', size: 16, pad: [14, 18] }), 'FILL');
  const R = AL('V', 'Cột phải', { gap: 22 }); add(row, R, 'FILL');
  const j = card(R, 'Nhập mã phòng'); cardHead(j, 'Nhập mã phòng', 'Mã 5 ký tự bạn bè gửi, hoặc mở thẳng link mời.');
  const jr = AL('H', 'Nhập', { gap: 8 }); add(j, jr, 'FILL'); add(jr, input('VD: K7QX2', { ph: true }), 'FILL'); add(jr, pbtn('Vào phòng', { size: 15 }));
  const inv = card(R, 'Mời kỳ hữu'); cardHead(inv, 'Mời kỳ hữu', 'Tạo phòng và gửi lời mời trực tiếp cho bạn bè.');
  const it = T('Chưa có kỳ hữu — tìm bạn bè', 'r', 14.5, 'chữ/chính'); add(inv, it); bold(it, 'tìm bạn bè', 'm', 'chữ/chính'); it.setRangeTextDecoration(it.characters.indexOf('tìm'), it.characters.length, 'UNDERLINE');
  const how = card(R, 'Chơi với bạn thế nào?'); add(how, T('Chơi với bạn thế nào?', 'b', 17, 'chữ/chính'));
  [['Tạo phòng', ' và chọn nhịp chơi, màu quân.'], ['Gửi link mời', ' — bạn bè mở link là vào bàn.'], ['Chơi lại', ' bao nhiêu ván tuỳ thích, tự đổi màu quân.']].forEach((x, i) => {
    const r = AL('H', 'Bước ' + (i + 1), { gap: 8 }); add(how, r, 'FILL'); add(r, T((i + 1) + '.', 'b', 14.5, 'nhấn/đỏ son'));
    const t = T(x[0] + x[1], 'r', 14.5, 'chữ/chính'); bold(t, x[0]); TW(r, t);
  });
  return S;
}

// ---------- AI ----------
const AI_TABS = ['Phân tích', 'Đấu với AI', 'Cờ thế', 'Lịch sử luyện tập'];
function arrowsSvg(list) {
  // list: [[c1,r1,c2,r2,độ đậm]] theo toạ độ ô của bàn 480px
  const k = 480 / 1280; let s = '';
  for (const a of list) {
    const x1 = BXS[a[0]] * k, y1 = BYS[a[1]] * k, x2 = BXS[a[2]] * k, y2 = BYS[a[3]] * k;
    const ang = Math.atan2(y2 - y1, x2 - x1), L = 16, W = 10;
    const bx = x2 - Math.cos(ang) * L, by = y2 - Math.sin(ang) * L;
    const px = -Math.sin(ang) * W, py = Math.cos(ang) * W;
    const op = a[4] || 0.85;
    s += `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="#2e9e5b" stroke-opacity="${op}" stroke-width="7" stroke-linecap="round"/>`;
    s += `<polygon points="${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}" fill="#2e9e5b" fill-opacity="${op}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">${s}</svg>`;
}
function framedBoard(s, o) {
  o = o || {};
  const f = AL('V', o.name || 'Khung bàn cờ', { pad: [7, 7], r: 10, fill: lin([['#d9a46a'], ['#b97e45']]), stroke: '#8a5a2a', fx: [shadow(12, 26, 0.3)] });
  const w = FR('Bàn', s, s); add(f, w);
  const b = o.pos ? woodBoard(s, o.pos) : boardInst(s); w.appendChild(b); b.x = 0; b.y = 0;
  if (o.arrows) { const a = svg(arrowsSvg(o.arrows), 'Mũi tên gợi ý'); a.rescale(s / 480); w.appendChild(a); a.x = 0; a.y = 0; }
  return f;
}
function evalGraph(w, h) {
  const g = FR('Biểu đồ thế trận', w, h, { fill: '#fbf8f3', stroke: 'viền/mảnh', r: 6 });
  const ys = [0.12, 0.32, 0.5, 0.68, 0.88];
  let s = '';
  ys.forEach((y, i) => { s += `<line x1="0" y1="${y * h}" x2="${w}" y2="${y * h}" stroke="${i === 2 ? '#c9bcae' : '#ece4d9'}"${i === 2 ? ' stroke-dasharray="3 3"' : ''}/>`; });
  s += `<line x1="${w * 0.6}" y1="0" x2="${w * 0.6}" y2="${h}" stroke="#3d6fd1" stroke-width="1.5"/><circle cx="${w * 0.6}" cy="${h * 0.48}" r="4" fill="#ffffff" stroke="#3d6fd1" stroke-width="2"/>`;
  const n = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>`, 'Lưới'); g.appendChild(n);
  ['+3', '+1', '0', '−1', '−3'].forEach((t, i) => { const x = T(t, 'm', 9.5, i < 2 ? 'nhấn/đỏ son' : 'chữ/phụ'); g.appendChild(x); x.x = 5; x.y = ys[i] * h - 7; });
  return g;
}
function engineLine(p, mv, tag, good, ev, pct, line, depth) {
  const b = AL('V', 'Phương án ' + mv, { gap: 6, pad: [10, 12, 10, 14], r: 10, fill: '#ffffff', stroke: 'viền/mảnh' }); add(p, b, 'FILL');
  b.strokes = [fp('#2e9e5b')]; b.strokeTopWeight = 0; b.strokeRightWeight = 0; b.strokeBottomWeight = 0; b.strokeLeftWeight = 4;
  const h = AL('H', 'đầu', { gap: 10, align: 'CENTER' }); add(b, h, 'FILL');
  add(h, T(mv, 'b', 15, 'chữ/chính')); add(h, T((good ? '★ ' : '✓ ') + tag, 'b', 12.5, '#2e9e5b')); grow(h); add(h, T(ev, 'b', 14, 'chữ/chính'));
  const bar = AL('H', 'thanh', { align: 'CENTER' }); add(b, bar, 'FILL'); progress(bar, pct, { h: 10, bg: '#eef3ee', fill: solid('#4cb07a') });
  const pc = T(Math.round(pct * 100) + '%', 'b', 10, 'chữ/chính'); bar.appendChild(pc); pc.layoutPositioning = 'ABSOLUTE'; pc.x = 228; pc.y = -1;
  TW(b, T('Diễn biến mẫu: ' + line, 'r', 12.5, 'chữ/mờ', { lh: 18 }));
  if (depth) add(b, T('độ sâu ' + depth, 'r', 11, 'chữ/mờ'));
}
function buildAnalysis(name) {
  const S = playerShell(name, { nav: 2, crumb: 'AI', gap: 16 });
  eyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, AI_TABS, 0);
  const row = AL('H', 'Bàn phân tích', { gap: 22, align: 'MIN' }); add(S.content, row, 'FILL', 'FILL');
  const L = AL('V', 'Cột trái', { gap: 16 }); add(row, L); fixW(L, 218);
  const bb = card(L, 'Biên bản', { gap: 6 }); fixH(bb, 228); add(bb, T('Biên bản', 'b', 17, 'chữ/chính')); add(bb, T('Bấm nước để quay lại', 'r', 12.5, 'chữ/mờ')); spacer(bb, 12);
  TW(bb, T('Chưa có nước nào — đi quân trên bàn để bắt đầu.', 'r', 13.5, 'chữ/mờ', { lh: 20 }));
  const tt = card(L, 'Thế trận', { gap: 10 });
  const th = AL('H', 'đầu', {}); add(tt, th, 'FILL'); add(th, T('Thế trận', 'b', 17, 'chữ/chính')); grow(th); add(th, T('+0.26', 'b', 15, 'chữ/chính'));
  add(tt, evalGraph(178, 138));
  TW(tt, T('Trên vạch giữa: Đỏ ưu thế · dưới: Đen ưu thế. Bấm để nhảy tới nước.', 'r', 11.5, 'chữ/mờ', { lh: 17 }));
  const M = AL('V', 'Giữa', { gap: 12, align: 'CENTER' }); add(row, M);
  add(M, framedBoard(520, { arrows: [[1, 7, 4, 7, 0.9], [7, 7, 5, 7, 0.45], [2, 6, 2, 5, 0.6]] }));
  const tb = AL('H', 'Thanh công cụ', { gap: 8, align: 'CENTER' }); add(M, tb);
  const sq = (icn) => { const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 7, fill: '#ffffff', stroke: 'viền/mảnh' }); size(b, 34, 34); add(b, ic(icn, 15, 'chữ/chính')); return b; };
  ['ve-dau', 'lui', 'tiep', 've-cuoi'].forEach((k) => add(tb, sq(k)));
  spacer(tb, 4);
  ['Lật bàn', 'Đi lại', 'Bàn mới', 'Bày thế cờ', 'Lưu', 'Chia sẻ'].forEach((t) => add(tb, pbtn(t, t === 'Lưu' ? { size: 14, pad: [7, 10], r: 7 } : { size: 14, pad: [7, 10], r: 7, fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính' })));
  const R = card(row, 'Engine phân tích', { h: 'FILL', v: 'FILL', gap: 12, pad: [22, 20] });
  const eh = AL('H', 'đầu', { gap: 10 }); add(R, eh, 'FILL');
  const el = AL('V', 'tiêu đề', { gap: 3 }); add(eh, el, 'FILL'); add(el, T('Engine phân tích', 'b', 17, 'chữ/chính'));
  TW(el, T('Điểm theo phía Đỏ (đơn vị: tốt) · thanh = tỉ lệ thắng của bên đang đi', 'r', 12.5, 'chữ/mờ', { lh: 18 }));
  add(eh, toggle(true));
  add(R, input('Pikafish (server)', { select: true }), 'FILL');
  const op = AL('H', 'tuỳ chọn', { gap: 14, align: 'CENTER' }); add(R, op); add(op, input('3 phương án', { select: true }));
  const cb = AL('H', 'mũi tên', { gap: 6, align: 'CENTER' }); add(cb, check(true, '#2f6fde')); add(cb, T('Mũi tên', 'r', 14, 'chữ/phụ')); add(op, cb);
  const ev = AL('H', 'điểm', { gap: 12, align: 'BASELINE' }); add(R, ev); add(ev, T('+0.26', 'xb', 30, 'chữ/chính')); add(ev, T('Cân bằng', 'sb', 15, 'chữ/phụ'));
  add(R, T('Độ sâu 17/31   803k nút   339k/giây   2.4 giây', 'r', 13, 'chữ/mờ'));
  const dt = AL('H', 'đang tính', { justify: 'MAX' }); add(R, dt, 'FILL'); add(dt, T('Đang tính…', 'sb', 12.5, 'chữ/phụ'));
  add(R, T('3 nước · bấm một nước để đi', 'r', 12.5, 'chữ/mờ'));
  engineLine(R, 'P8-5', 'Tốt nhất', true, '+0.26', 0.53, 'M2.3 B7.1 X1-2 M8.7 P2-1 B3.1 B7.1 B3.1 X2.4 B3.1 T7.5 P2-4 B3.1 B7.1 X2-3', 17);
  engineLine(R, 'B7.1', 'Tốt nhất', true, '+0.25', 0.52, 'B7.1 M8.7 M8.7 P2-6 M7.6', 16);
  engineLine(R, 'P2-4', 'Tốt', false, '+0.20', 0.52, 'M8.7 B3.1 P2-5 M8.7 M2.3', null);
  R.clipsContent = true;
  return S;
}
function buildAiPlay(name) {
  const S = playerShell(name, { nav: 2, crumb: 'AI  /  Đấu với AI', gap: 16 });
  eyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, AI_TABS, 1);
  const row = AL('H', 'Hai cột', { gap: 22, align: 'MIN' }); add(S.content, row, 'FILL');
  const L = card(row, 'Chọn cấp độ AI', { h: 'FIXED', gap: 12 }); fixW(L, 690);
  add(L, T('Chọn cấp độ AI', 'b', 17, 'chữ/chính'));
  const g = AL('H', 'Cấp độ', { gap: 10, wrap: true }); add(L, g, 'FILL');
  const LV = [['Tập sự', '~800 Elo'], ['Nhập môn', '~1.000 Elo'], ['Kỳ hữu', '~1.200 Elo'], ['Trung cấp', '~1.400 Elo'], ['Cao cấp', '~1.600 Elo'], ['Kiện tướng', '~1.800 Elo'], ['Đại kiện tướng', '~2.000 Elo'], ['Kỳ vương', '~2.200 Elo'], ['Vô đối', '3.000+ Elo · Pikafish']];
  LV.forEach((l, i) => {
    const on = i === 3;
    const c = AL('V', 'Cấp ' + (i + 1), { gap: 3, pad: [11, 12], r: 10, fill: on ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ', stroke: on ? 'nhấn/đỏ son' : 'viền/mảnh' });
    add(g, c); fixW(c, i === 8 ? 650 : 155);
    const hr2 = AL('H', 'đầu', {}); add(c, hr2, 'FILL'); add(hr2, T('Cấp ' + (i + 1), 'r', 13, on ? 'nhấn/đỏ son' : 'chữ/mờ'));
    if (on) { grow(hr2); const k = AL('H', 'đã chọn', { align: 'CENTER', justify: 'CENTER', r: 9, fill: 'nhấn/đỏ son' }); size(k, 18, 18); add(k, ic('dung', 12, '#ffffff')); add(hr2, k); }
    add(c, T(l[0], 'b', 15, on || i === 8 ? 'nhấn/đỏ son' : 'chữ/chính')); add(c, T(l[1], 'r', 13, 'chữ/mờ'));
  });
  const info = AL('H', 'Gợi ý cấp', { gap: 10, align: 'CENTER', pad: [11, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, info, 'FILL');
  add(info, ic('thong-tin', 16, 'nhấn/đỏ son')); add(info, T('Cấp 4 – 5: máy tính trước nhiều nước, hợp với người đã quen khai cuộc.', 'r', 13.5, 'chữ/phụ'));
  add(L, T('Chọn màu quân', 'b', 17, 'chữ/chính'));
  const cs = AL('H', 'Màu quân', { gap: 10 }); add(L, cs, 'FILL');
  [['Quân Đỏ', 'Đi trước', 'nhấn/đỏ son'], ['Quân Đen', 'Đi sau', '#1d1612'], ['Ngẫu nhiên', 'Để máy chọn', null]].forEach((x, i) => {
    const on = i === 0;
    const b = AL('V', x[0], { gap: 6, align: 'CENTER', pad: [16, 10], r: 10, fill: on ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ', stroke: on ? 'nhấn/đỏ son' : 'viền/mảnh' }); add(cs, b, 'FILL');
    const d = FR('quân', 26, 26, { r: 13, stroke: '#ffffff', sw: 2, fill: x[2] ? x[2] : lin([['#c61d1d', 0.5], ['#1d1612', 0.5]], 'h') }); d.effects = [shadow(1, 3, 0.3, '#000000')]; add(b, d);
    if (!x[2]) d.fills = [lin([['#c61d1d', 0], ['#c61d1d', 0.5], ['#1d1612', 0.5], ['#1d1612', 1]], 'h')];
    add(b, T(x[0], 'b', 15, on ? 'nhấn/đỏ son' : 'chữ/chính')); add(b, T(x[1], 'r', 13, 'chữ/mờ'));
  });
  const tg = AL('H', 'Gợi ý & đi lại', { gap: 12, align: 'CENTER', pad: [13, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, tg, 'FILL');
  const tt = AL('V', 'chữ', { gap: 3 }); add(tg, tt, 'FILL'); add(tt, T('Gợi ý & đi lại', 'b', 14.5, 'chữ/chính')); add(tt, T('Cho phép xin gợi ý nước đi và đi lại khi chơi với máy', 'r', 12.5, 'chữ/mờ')); add(tg, toggle(true));
  add(L, pbtn('Bắt đầu đấu máy', { icon: 'ai', size: 16, pad: [14, 18] }), 'FILL');
  const R = AL('V', 'Cột phải', { gap: 22 }); add(row, R, 'FILL');
  const pb = card(R, 'Bàn cờ luyện tập'); cardHead(pb, 'Bàn cờ luyện tập', 'Cấp 4 · Trung cấp — ước tính ~1.400 Elo');
  const bw = AL('H', 'bàn', { justify: 'CENTER' }); add(pb, bw, 'FILL'); add(bw, boardInst(366));
  const ch = AL('H', 'nhãn', { gap: 8 }); add(pb, ch); add(ch, pill('Cấp 4 · Trung cấp', { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 13 })); add(ch, pill('Quân Đỏ', { size: 13 })); add(ch, pill('Có gợi ý & đi lại', { size: 13 }));
  const tip = card(R, 'Mẹo từ kỳ thủ'); add(tip, T('Mẹo từ kỳ thủ', 'b', 17, 'chữ/chính'));
  TW(tip, T('Đừng vội đổi quân khi chưa ra đủ Xe, Mã, Pháo. Khai cuộc chắc chắn giúp trung cuộc nhẹ nhàng hơn — bật "Gợi ý" để xem máy nghĩ gì.', 'r', 14, 'chữ/phụ', { lh: 21 }));
  return S;
}
const PUZ = [
  ['Chiếu bí trong 1 nước #1', 'Dễ', '1 nước', [['b', 'K', 4, 1], ['b', 'A', 5, 1], ['b', 'P', 4, 3], ['r', 'H', 5, 6], ['r', 'P', 8, 6], ['r', 'K', 3, 8], ['r', 'R', 4, 8]]],
  ['Chiếu bí trong 1 nước #2', 'Dễ', '1 nước', [['b', 'A', 3, 0], ['b', 'A', 5, 0], ['b', 'K', 5, 1], ['b', 'C', 0, 3], ['r', 'K', 4, 7], ['r', 'R', 1, 8]]],
  ['Chiếu bí trong 1 nước #3', 'Dễ', '1 nước', [['b', 'K', 4, 1], ['b', 'A', 5, 1], ['r', 'K', 3, 8], ['r', 'R', 7, 8]]],
  ['Chiếu bí trong 2 nước #1', 'Vừa', '2 nước', [['b', 'A', 4, 0], ['b', 'K', 5, 1], ['r', 'R', 4, 6], ['r', 'K', 4, 7], ['r', 'H', 4, 8]]],
  ['Chiếu bí trong 2 nước #2', 'Vừa', '2 nước', [['b', 'R', 1, 0], ['b', 'K', 5, 1], ['b', 'A', 3, 2], ['b', 'R', 6, 4], ['r', 'K', 3, 9]]],
];
function buildPuzzles(name) {
  const S = playerShell(name, { nav: 2, crumb: 'AI  /  Cờ thế', gap: 16 });
  eyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, AI_TABS, 2);
  const f = AL('H', 'Bộ lọc', { gap: 16, align: 'CENTER' }); add(S.content, f, 'FILL');
  tabsSeg(f, ['Tất cả', 'Dễ', 'Vừa', 'Khó'], 0);
  const c1 = AL('H', 'chưa giải', { gap: 8, align: 'CENTER' }); add(c1, check(false)); add(c1, T('Chỉ bài chưa giải', 'r', 14.5, 'chữ/phụ')); add(f, c1);
  add(f, input('Mọi chủ đề', { select: true, pad: [8, 10], size: 13.5 }));
  add(f, T('Đã giải 0/5 bài', 'r', 14.5, 'chữ/mờ'));
  add(f, pbtn('Tiếp tục bài gần nhất', { icon: 'mui-ten-phai', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14, pad: [8, 14] }));
  const g = AL('H', 'Danh sách thế cờ', { gap: 18 }); add(S.content, g, 'FILL');
  PUZ.forEach((p) => {
    const c = card(g, p[0], { h: 'FIXED', gap: 8, pad: [0, 0, 14, 0], clip: true }); fixW(c, 214); c.clipsContent = true;
    add(c, woodBoard(214, p[3], { r: 0 }));
    const t = AL('V', 'chữ', { gap: 8, pad: [6, 14, 0, 14] }); add(c, t, 'FILL');
    add(t, T(p[0], 'b', 15, 'chữ/chính'));
    const m = AL('H', 'nhãn', { gap: 6, align: 'CENTER', wrap: true }); add(t, m, 'FILL');
    add(m, pill(p[1], p[1] === 'Dễ' ? { fill: '#e3f4e8', color: '#2e9e5b', st: 'b' } : { fill: '#fdf1d6', color: '#b07c12', st: 'b' }));
    add(m, pill('Chiếu bí', { st: 'b' })); add(m, T('Đỏ đi · ' + p[2], 'r', 12.5, 'chữ/mờ'));
  });
  return S;
}

// ---------- Bảng xếp hạng ----------
function buildRanking(name) {
  const S = playerShell(name, { nav: 3, crumb: 'Xếp hạng', gap: 18 });
  eyebrow(S.content, 'Bảng xếp hạng', { line: false });
  const tr = AL('H', 'Tab', { align: 'CENTER' }); add(S.content, tr, 'FILL');
  tabsSeg(tr, ['Elo', 'Bạn bè', 'Danh vọng mùa', 'Chuỗi thắng', 'Chơi nhanh', 'Cờ thế'], 0);
  grow(tr); add(tr, T('128 kỳ thủ trên bảng', 'r', 14.5, 'chữ/phụ'));
  const row = AL('H', 'Hai cột', { gap: 24, align: 'MIN' }); add(S.content, row, 'FILL');
  const L = AL('V', 'Cột trái', { gap: 20 }); add(row, L); fixW(L, 712);
  const pod = AL('H', 'Top 3', { gap: 14 }); add(L, pod, 'FILL');
  [['#1', 'Văn Long', 'VL', '@vanlong', '2.184', true], ['#2', 'Minh Quân', 'MQ', '@minhquan', '2.031'], ['#3', 'Thu Hà', 'TH', '@thuha', '1.968']].forEach((p) => {
    const dark = !!p[5];
    const c = AL('V', 'Hạng ' + p[0], { gap: 12, pad: [16, 18], r: 14, fill: dark ? lin([['#2a1f19'], ['#15100d']]) : 'nền/thẻ', stroke: dark ? null : 'viền/mảnh', fx: [shadow(8, 20, dark ? 0.25 : 0.06)] }); add(pod, c, 'FILL');
    const h = AL('H', 'đầu', {}); add(c, h, 'FILL'); add(h, T(p[0], 'b', 13, dark ? '#f2cf72' : 'chữ/chính')); grow(h); add(h, ic(dark ? 'giai-dau' : 'sao', 14, dark ? '#f2cf72' : 'chữ/mờ'));
    const u = AL('H', 'kỳ thủ', { gap: 10, align: 'CENTER' }); add(c, u);
    add(u, avatar(p[2], 40, { fill: dark ? 'nhấn/đỏ son' : 'nhấn/đỏ nhạt', color: dark ? '#ffffff' : 'nhấn/đỏ son', size: 15 }));
    const n = AL('V', 'tên', { gap: 2 }); add(u, n); add(n, T(p[1], 'b', 15, dark ? '#ffffff' : 'chữ/chính')); add(n, T(p[3], 'r', 12.5, dark ? '#a8998a' : 'chữ/mờ'));
    const e = AL('H', 'Elo', { gap: 4, align: 'BASELINE' }); add(c, e); add(e, T(p[4], 'xb', 30, dark ? '#ffffff' : 'chữ/chính')); add(e, T('Elo', 'r', 12.5, dark ? '#a8998a' : 'chữ/mờ'));
  });
  const tb = card(L, 'Bảng', { gap: 0, pad: [0, 0] }); tb.clipsContent = true;
  const cols = [['Hạng', 64], ['Kỳ thủ', 250], ['Elo', 120], ['Ván', 110], ['Tỉ lệ thắng', 0]];
  const rowOf = (vals, head, me) => {
    const r = AL('H', head ? 'Tiêu đề bảng' : 'Dòng · ' + vals[1], { align: 'CENTER', pad: [head ? 12 : 11, 16], fill: head ? 'nền/thẻ phụ' : (me ? 'nhấn/đỏ nhạt' : null) }); add(tb, r, 'FILL');
    if (!head) { r.strokes = [fp('viền/mảnh')]; r.strokeTopWeight = 1; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 0; }
    cols.forEach((c, i) => {
      const cell = AL('H', c[0], { gap: 8, align: 'CENTER', justify: i === 4 ? 'MAX' : 'MIN' }); add(r, cell, c[1] ? null : 'FILL'); if (c[1]) fixW(cell, c[1]);
      if (!head && i === 1) add(cell, avatar(vals[1].split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), 28, { r: 7, size: 11 }));
      add(cell, T(vals[i], head ? 'sb' : (i === 1 || i === 2 ? 'b' : 'r'), head ? 13 : 14, head ? 'chữ/phụ' : (me ? 'nhấn/đỏ son' : 'chữ/chính')));
    });
  };
  rowOf(cols.map((c) => c[0]), true);
  [['4', 'Hải Đăng', '1.942', '212', '58%'], ['5', 'Bảo Ngọc', '1.903', '187', '56%'], ['6', 'Quốc Bảo', '1.880', '240', '54%'], ['7', 'Lan Anh', '1.845', '96', '57%'], ['8', 'Đức Trí', '1.812', '133', '52%'], ['12', 'Kỳ thủ Tượng (bạn)', '1.200', '0', '—']].forEach((v, i) => rowOf(v, false, i === 5));
  const R = AL('V', 'Cột phải', { gap: 20 }); add(row, R, 'FILL');
  const me = card(R, 'Vị trí của bạn', { pad: [22, 20] }); add(me, T('Vị trí của bạn', 'b', 17, 'chữ/chính'));
  const mr = AL('H', 'hạng', { gap: 12, align: 'CENTER' }); add(me, mr);
  add(mr, avatar('KT', 44)); const mt = AL('V', 'chữ', { gap: 2 }); add(mr, mt); add(mt, T('Hạng #12 · Elo 1.200', 'b', 16, 'chữ/chính')); add(mt, T('Còn 612 Elo để vào Top 8', 'r', 13, 'chữ/mờ'));
  add(me, pbtn('Đấu xếp hạng để leo hạng', { icon: 'xep-hang' }), 'FILL');
  const how = card(R, 'Cách tính Elo', { pad: [22, 20] }); add(how, ic('thong-tin', 20, 'nhấn/đỏ son')); add(how, T('Cách tính Elo', 'b', 17, 'chữ/chính'));
  TW(how, T('Mọi tài khoản bắt đầu với 1.200 Elo. Thắng người Elo cao hơn được cộng nhiều hơn; hệ số K = 32. Ván có khách tham gia không tính Elo.', 'r', 14.5, 'chữ/phụ', { lh: 21 }));
  return S;
}

// ---------- Túi đồ & Cửa hàng ----------
const SHOP_BOARDS = [
  ['Theo Tượng Kỳ', 'Bàn cờ chính thức', 'wood', 'Đang dùng', true], ['Gỗ sáng', 'Vân gỗ thật', 'wood', 'Miễn phí'], ['Cổ điển', 'Nét vẽ truyền thống', 'classic', 'Miễn phí'],
  ['Thi Đấu', 'Nền sáng, nét rõ như bàn giải', 'thidau', '100'], ['Gỗ Trầm', 'Gỗ sẫm màu, ấm', 'tram', '150'], ['Trúc Thanh', 'Sắc trúc xanh nhẹ', 'truc', '150'],
  ['Ngọc Sáng', 'Ngọc bích trong trẻo', 'ngoc', '250'], ['Đế Vương', 'Đỏ son, nét vàng', 'devuong', '400'],
];
function thumb(kind, w) {
  const h = Math.round(w * 0.75);
  const f = FR('Ảnh bàn', w, h, { r: 6, clip: true });
  const b = kind === 'wood' ? woodBoard(w, startPos()) : drawnBoard(w, kind);
  f.appendChild(b); b.x = 0; b.y = -(b.height - h) / 2;
  return f;
}
function itemCard(p, it) {
  const sel = !!it[4];
  const c = card(p, it[0], { h: 'FIXED', gap: 10, pad: [12, 12], stroke: sel ? 'nhấn/đỏ son' : 'viền/mảnh' }); fixW(c, 224);
  if (sel) c.strokeWeight = 1.5;
  add(c, thumb(it[2], 200));
  const r = AL('H', 'chữ', { gap: 8, align: 'CENTER' }); add(c, r, 'FILL');
  const t = AL('V', 'tên', { gap: 2 }); add(r, t, 'FILL'); add(t, T(it[0], 'b', 15, 'chữ/chính')); TW(t, T(it[1], 'r', 12.5, 'chữ/mờ', { lh: 17 }));
  const pr = it[3];
  if (pr === 'Đang dùng') add(r, pill(pr, { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 13 }));
  else if (pr === 'Miễn phí') add(r, pill(pr, { st: 'b', size: 13 }));
  else { const x = AL('H', 'giá', { gap: 5, align: 'CENTER' }); add(x, ic('xu', 14, '#c99a2e')); add(x, T(pr, 'b', 14, '#a0761a')); add(r, x); }
  return c;
}
function clockBox(t, red) {
  const b = AL('H', 'Đồng hồ', { pad: [6, 14], r: 8, fill: red ? lin([['#d93a2b'], ['#a3150f']]) : '#efe9e1', stroke: red ? null : '#d8cfc4' });
  add(b, T(t, 'xb', 22, red ? '#ffffff' : 'chữ/chính')); return b;
}
function buildBag(name, shop) {
  const S = playerShell(name, { nav: 6, crumb: shop ? 'Túi đồ  /  Cửa hàng' : 'Túi đồ', gap: 16 });
  eyebrow(S.content, shop ? 'Cửa hàng' : 'Túi đồ', { line: false, right: coinPill('1.020 xu', { size: 15, pad: [8, 16] }) });
  tabsU(S.content, ['Túi đồ', 'Cửa hàng'], shop ? 1 : 0);
  tabsSeg(S.content, ['Bàn cờ', 'Quân cờ', 'Đồng hồ'], 0, { fill: true });
  const row = AL('H', 'Hai cột', { gap: 24, align: 'MIN' }); add(S.content, row, 'FILL', 'FILL');
  const L = AL('V', 'Danh sách', { gap: 16, clip: true }); add(row, L, null, 'FILL'); fixW(L, 712);
  const h = AL('H', 'đầu', {}); add(L, h, 'FILL'); add(h, T('Bàn cờ', 'b', 17, 'chữ/chính')); grow(h); add(h, T(shop ? '5 vật phẩm chưa sở hữu' : '3 vật phẩm đã sở hữu', 'r', 14, 'chữ/mờ'));
  const g = AL('H', 'Vật phẩm', { gap: 16, wrap: true }); add(L, g, 'FILL');
  (shop ? SHOP_BOARDS : SHOP_BOARDS.slice(0, 3)).forEach((it) => itemCard(g, it));
  const R = card(row, 'Xem trước', { v: 'FILL', gap: 12, pad: [18, 16] });
  const rh = AL('H', 'đầu', {}); add(R, rh, 'FILL'); add(rh, T('Xem trước', 'b', 16.5, 'chữ/chính')); grow(rh); add(rh, pill('Đang dùng', { st: 'b' }));
  const pv = AL('V', 'Bàn xem trước', { gap: 10, align: 'CENTER' }); add(R, pv, 'FILL');
  add(pv, clockBox('09:58')); add(pv, boardInst(256)); add(pv, clockBox('09:54', true));
  [['Bàn cờ', 'Theo Tượng Kỳ'], ['Quân cờ', 'Theo Tượng Kỳ'], ['Đồng hồ', 'Cổ điển']].forEach((kv) => { const r = AL('H', kv[0], {}); add(R, r, 'FILL'); add(r, T(kv[0], 'r', 13.5, 'chữ/mờ')); grow(r); add(r, T(kv[1], 'b', 13.5, 'chữ/chính')); });
  TW(R, T('Bộ trang bị lưu theo tài khoản, dùng được trên mọi thiết bị.', 'r', 12.5, 'chữ/mờ', { lh: 18 }));
  grow(R); add(R, pbtn('Đang trang bị', { fill: '#e08a85' }), 'FILL');
  return S;
}

// ---------- Hồ sơ ----------
function buildProfile(name) {
  const S = playerShell(name, { nav: 7, crumb: 'Hồ sơ kỳ thủ', gap: 16, pad: [20, 32, 24, 32] });
  const row = AL('H', 'Hai cột', { gap: 18, align: 'MIN' }); add(S.content, row, 'FILL');
  const L = AL('V', 'Cột trái', { gap: 16 }); add(row, L); fixW(L, 506);
  const pc = card(L, 'Thẻ kỳ thủ', { gap: 16 });
  const top = AL('H', 'đầu', { gap: 16, align: 'CENTER' }); add(pc, top, 'FILL');
  add(top, avatar('KT', 96, { r: 22, size: 34 }));
  const info = AL('V', 'chữ', { gap: 6 }); add(top, info, 'FILL');
  add(info, T('Kỳ thủ Tượng', 'b', 25, 'chữ/chính')); TW(info, T('@kythutuong · Chưa đặt khu vực · Tham gia 14/10/2026', 'r', 13.5, 'chữ/mờ'));
  add(info, pill('Bạc 3★', { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 12.5 }));
  hr(pc);
  const st = AL('H', 'Chỉ số', { gap: 10 }); add(pc, st, 'FILL');
  [['Elo', '1.200', 'nhấn/đỏ son'], ['Xu', '1.020', '#c99a2e'], ['Uy tín', '1.000', '#d8cfc4'], ['Chuỗi thắng', '0', '#d8cfc4']].forEach((x) => {
    const b = AL('V', x[0], { gap: 4, pad: [0, 0, 8, 0] }); add(st, b, 'FILL');
    b.strokes = [fp(x[2])]; b.strokeTopWeight = 0; b.strokeLeftWeight = 0; b.strokeRightWeight = 0; b.strokeBottomWeight = 2;
    add(b, T(x[0], 'r', 13, 'chữ/phụ')); add(b, T(x[1], 'xb', 19, 'chữ/chính'));
  });
  const two = AL('H', 'Thống kê', { gap: 16 }); add(L, two, 'FILL');
  [[['Số trận', '0'], ['Tỉ lệ thắng', '—'], '0 thắng · 0 hoà · 0 thua'], [['Elo cao nhất', '1.200'], ['Hạng', '—'], '0 online · 0 đấu máy']].forEach((x) => {
    const c = card(two, x[0][0], { gap: 8, pad: [16, 16] });
    const r = AL('H', 'số', { gap: 10 }); add(c, r, 'FILL');
    [x[0], x[1]].forEach((kv) => { const b = AL('V', kv[0], { gap: 4 }); add(r, b, 'FILL'); add(b, T(kv[0], 'r', 13, 'chữ/phụ')); add(b, T(kv[1], 'xb', 25, 'chữ/chính')); });
    add(c, T(x[2], 'r', 13, 'chữ/mờ'));
  });
  const menu = card(L, 'Menu hồ sơ', { gap: 8, pad: [12, 12] });
  const grid = (items) => {
    const g = AL('H', 'nhóm', { gap: 8, wrap: true }); add(menu, g, 'FILL');
    items.forEach((it) => {
      const on = !!it[2];
      const b = AL('H', it[1], { gap: 10, align: 'CENTER', pad: [11, 14], r: 8, fill: on ? 'nhấn/đỏ son' : 'nền/thẻ phụ', stroke: on ? null : 'viền/mảnh' }); add(g, b); fixW(b, 237);
      add(b, ic(it[0], 16, on ? '#ffffff' : (it[3] || 'chữ/chính'))); add(b, T(it[1], 'sb', 14.5, on ? '#ffffff' : (it[3] || 'chữ/chính')));
    });
  };
  grid([['kiem', 'Lịch sử đấu', true], ['bieu-do', 'Biến thiên Elo'], ['luoi', 'Theo chế độ'], ['giai-dau', 'Thành tích & huy hiệu'], ['tui-do', 'Bộ trang bị'], ['sao', 'Mục tiêu']]);
  hr(menu);
  grid([['sua', 'Chỉnh sửa hồ sơ'], ['chia-se', 'Mời bạn bè'], ['tro-chuyen', 'Trợ giúp & góp ý'], ['dang-xuat', 'Đăng xuất', false, 'nhấn/đỏ son']]);
  const R = card(row, 'Lịch sử đấu', { gap: 0, pad: [20, 18] });
  add(R, T('Lịch sử đấu', 'b', 17, 'chữ/chính')); spacer(R, 12);
  const th = AL('H', 'Tiêu đề bảng', { pad: [11, 14], fill: 'nền/thẻ phụ' }); add(R, th, 'FILL');
  [['Đối thủ', 118], ['Chế độ', 118], ['Kết quả', 154], ['Elo', 86], ['Nước', 0]].forEach((c) => { const t = T(c[0], 'sb', 13, 'chữ/phụ'); const w = AL('H', c[0]); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, t); });
  const rows = [['Minh Quân', 'Xếp hạng', 'Thắng · chiếu bí', '+16', '42'], ['Máy (Cấp 4)', 'Đấu máy', 'Thua · đầu hàng', '—', '18'], ['Thu Hà', 'Chơi nhanh', 'Hoà', '0', '61']];
  rows.forEach((v) => {
    const r = AL('H', 'Dòng', { pad: [12, 14], align: 'CENTER' }); add(R, r, 'FILL');
    r.strokes = [fp('viền/mảnh')]; r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1;
    [118, 118, 154, 86, 0].forEach((w, i) => {
      const cell = AL('H', 'ô'); add(r, cell, w ? null : 'FILL'); if (w) fixW(cell, w);
      const col = i === 2 ? (v[2].indexOf('Thắng') === 0 ? 'trạng thái/xanh' : v[2].indexOf('Thua') === 0 ? 'nhấn/đỏ son' : 'chữ/phụ') : (i === 3 && v[3][0] === '+' ? 'trạng thái/xanh' : 'chữ/chính');
      add(cell, T(v[i], i === 0 || i === 2 ? 'sb' : 'r', 14, col));
    });
  });
  spacer(R, 14);
  const n = AL('H', 'ghi chú', { justify: 'CENTER' }); add(R, n, 'FILL'); add(n, T('Dữ liệu mẫu — các ván bạn chơi khi đã đăng nhập sẽ được lưu ở đây.', 'r', 13, 'chữ/mờ'));
  return S;
}

// ---------- Trong trận ----------
function clockPair(total, move, active) {
  const r = AL('H', 'Đồng hồ', { gap: 6 });
  const box = (icn, v, col, bg, name) => { const b = AL('H', name, { gap: 6, align: 'CENTER', pad: [5, 10], r: 8, fill: bg, stroke: col }); add(b, T(icn, 'r', 13, col)); add(b, T(v, 'xb', 17, col)); return b; };
  add(r, box('⏳', total, '#1f8a4c', '#e6f6ec', 'Tổng thời gian'));
  add(r, box('🕒', move, '#d9730d', active ? '#fff1e2' : '#fbf6f0', 'Thời gian nước'));
  return r;
}
// Thẻ kỳ thủ (đỏ sơn mài)
function playerCard(p, o) {
  const c = AL('V', 'Thẻ kỳ thủ · ' + o.name, { gap: 10, pad: [12, 12], r: 10, fill: lin([['#6a1f15'], ['#3e110b']]), stroke: '#c9963a', sw: 1.5, fx: [shadow(8, 18, 0.3)] });
  add(p, c, 'FILL');
  const r = AL('H', 'hàng', { gap: 12, align: 'CENTER' }); add(c, r, 'FILL');
  const ringCol = o.active ? '#2bb35a' : '#c9963a';
  const ring = AL('H', 'Vòng thời gian', { align: 'CENTER', justify: 'CENTER', r: 18, stroke: ringCol, sw: o.active ? 4 : 2 }); size(ring, 86, 86); add(r, ring);
  ring.appendChild(avatar(o.ini, 76, { r: 14, fill: o.ai ? lin([['#33476e'], ['#1d2a46']]) : lin([['#8a1f17'], ['#5a120d']]), color: '#ffffff', st: 'serif', size: 28, stroke: '#e9c77a', sw: 1.5 }));
  if (o.turnDot) { const d = dot(o.turnDot, 14); d.strokes = [solid('#ffffff')]; d.strokeWeight = 2; ring.appendChild(d); d.layoutPositioning = 'ABSOLUTE'; d.x = 72; d.y = 72; }
  const t = AL('V', 'chữ', { gap: 3 }); add(r, t, 'FILL');
  TW(t, T(o.name, 'serif', 18, '#fff3dc'));
  o.lines.forEach((l, i) => add(t, T(l, i === 0 && !o.ai ? 'b' : 'r', 13, i === 0 && !o.ai ? '#f9dc8a' : '#e3cbb5')));
  if (o.clock) add(c, clockPair(o.clock[0], o.clock[1], o.active));
  add(c, T(o.captured || 'Chưa ăn quân nào', 'r', 12, '#e3cbb5'));
  return c;
}
function gameBtn(label, icn, kind) {
  const st = { cream: { fill: lin([['#fffaf0'], ['#efe2c9']]), color: '#3a2416', stroke: '#d9c49b' }, gold: { fill: lin([['#f6d98c'], ['#e2b75a']]), color: '#4a2c0c', stroke: '#c99a3a' }, red: { fill: lin([['#d93a2b'], ['#a3150f']]), color: '#ffffff', stroke: '#8a1712' } }[kind];
  return pbtn(label, { icon: icn, st: 'serif', size: 15, pad: [10, 14], r: 8, fill: st.fill, color: st.color, stroke: st.stroke, fx: [shadow(3, 6, 0.2)] });
}
function buildGame(name, online) {
  const S = gameShell(name, online ? 'Chơi  /  Xếp hạng' : 'AI  /  Bàn luyện tập', online ? 1 : 2);
  eyebrow(S.content, online ? 'Xếp hạng · 15p + 5s · tối đa 1 phút/nước' : 'Đấu máy · Cấp 4 · Trung cấp', { line: false, extra: online ? 'Ván 1 · Elo ±16' : 'Máy Cấp 4 · Trung cấp · có gợi ý & đi lại' });
  const table = AL('H', 'Bàn gỗ', { gap: 14, pad: [14, 18], r: 18, fill: lin([['#d9bd8f'], ['#c7a271']]), stroke: '#a7804f', fx: [shadow(16, 36, 0.3)] });
  add(S.content, table, 'FILL', 'FILL');
  const L = AL('V', 'Cột trái', { gap: 12 }); add(table, L, null, 'FILL'); fixW(L, 258);
  playerCard(L, online ? { name: 'Minh Quân', ini: 'MQ', lines: ['Elo 1.215', 'Bạc 4★ · Đen'], clock: ['14:21', '0:60'] } : { name: 'Máy (Cấp 4)', ini: 'AI', ai: true, lines: ['Máy', 'Cấp 4 · Trung cấp'], turnDot: '#1d1612' });
  const hc = card(L, 'Lịch sử nước đi', { v: 'FILL', gap: 10, pad: [14, 12] });
  const hh = AL('H', 'đầu', { align: 'CENTER' }); add(hc, hh, 'FILL'); add(hh, T('Lịch sử nước đi', 'b', 16, 'chữ/chính')); grow(hh); add(hh, input('Ván 1 (đang chơi)', { select: true, pad: [5, 8], size: 12.5 }));
  const th = AL('H', 'tiêu đề', { gap: 0, pad: [7, 10], r: 6, fill: 'nền/thẻ phụ' }); add(hc, th, 'FILL');
  [['#', 40], ['Đỏ', 90], ['Đen', 0]].forEach((c) => { const w = AL('H', c[0]); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], 'sb', 13, 'chữ/phụ')); });
  if (online) {
    [['1.', 'P2-5', 'M8.7'], ['2.', 'M2.3', 'X9-8'], ['3.', 'X1-2', '']].forEach((m) => { const r = AL('H', 'nước', { pad: [6, 10] }); add(hc, r, 'FILL'); [[m[0], 40], [m[1], 90], [m[2], 0]].forEach((c) => { const w = AL('H', 'ô'); add(r, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], c[1] === 40 ? 'r' : 'b', 14, 'chữ/chính')); }); });
  } else { const e = AL('H', 'trống', { justify: 'CENTER', pad: [16, 0] }); add(hc, e, 'FILL'); add(e, T('Chưa có nước đi nào.', 'r', 14, 'chữ/phụ')); }
  grow(hc);
  const nv = AL('H', 'điều hướng', { gap: 6, align: 'CENTER' }); add(hc, nv, 'FILL');
  ['ve-dau', 'lui'].forEach((k) => { const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 6, stroke: 'viền/mảnh' }); size(b, 30, 30); add(b, ic(k, 13, 'chữ/mờ')); add(nv, b); });
  const nt = T('Xem lại khi hết ván', 'r', 12.5, 'chữ/phụ', { align: 'CENTER' }); TW(nv, nt);
  ['tiep', 've-cuoi'].forEach((k) => { const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 6, stroke: 'viền/mảnh' }); size(b, 30, 30); add(b, ic(k, 13, 'chữ/mờ')); add(nv, b); });
  const st = AL('V', 'Thao tác', { gap: 8 }); add(L, st, 'FILL');
  const turn = AL('H', 'Lượt', { gap: 8, align: 'CENTER', justify: 'CENTER', pad: [10, 14], r: 8, fill: lin([['#fffaf0'], ['#efe2c9']]), stroke: '#d9c49b' }); add(st, turn, 'FILL'); add(turn, dot('nhấn/đỏ son', 10)); add(turn, T('Đến lượt bạn.', 'serif', 15, '#3a2416'));
  if (online) { add(st, gameBtn('Xin hoà', 'cau-hoa', 'gold'), 'FILL'); add(st, gameBtn('Đầu hàng', 'dau-hang', 'red'), 'FILL'); }
  else { add(st, gameBtn('Gợi ý', 'goi-y', 'gold'), 'FILL'); add(st, gameBtn('Đầu hàng', 'dau-hang', 'red'), 'FILL'); add(st, gameBtn('Rời bàn', 'dang-xuat', 'cream'), 'FILL'); }
  const M = AL('V', 'Giữa', { align: 'CENTER', justify: 'CENTER' }); add(table, M, 'FILL', 'FILL');
  const pos = startPos();
  if (online) { pos.forEach((p) => { if (p[0] === 'r' && p[1] === 'C' && p[2] === 7) p[2] = 4; if (p[0] === 'b' && p[1] === 'H' && p[2] === 7) p[3] = 2, p[2] = 6; }); }
  const fb = framedBoard(704, { pos: pos, name: 'Bàn cờ' }); add(M, fb);
  const R = AL('V', 'Cột phải', { gap: 12 }); add(table, R, null, 'FILL'); fixW(R, 280);
  if (online) {
    const ch = card(R, 'Trò chuyện', { v: 'FILL', gap: 10, pad: [14, 14] });
    add(ch, T('Trò chuyện', 'b', 16, 'chữ/chính'));
    [['Minh Quân', 'Chào bạn, chơi vui nhé!'], ['Bạn', 'Chúc ván hay 👍']].forEach((m) => { const b = AL('V', 'tin', { gap: 2, pad: [8, 10], r: 10, fill: m[0] === 'Bạn' ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ' }); add(ch, b, 'FILL'); add(b, T(m[0], 'b', 12.5, 'chữ/phụ')); TW(b, T(m[1], 'r', 14, 'chữ/chính')); });
    grow(ch); add(ch, input('Nhắn tin…', { ph: true }), 'FILL');
  } else {
    const an = card(R, 'Máy phân tích', { v: 'FILL', gap: 10, pad: [14, 14] });
    const ah = AL('H', 'đầu', { gap: 8 }); add(an, ah, 'FILL'); const al = AL('V', 'chữ', { gap: 3 }); add(ah, al, 'FILL'); add(al, T('Máy phân tích', 'b', 16, 'chữ/chính')); TW(al, T('Các nước tốt cho bạn — bấm để xem mũi tên', 'r', 12.5, 'chữ/mờ', { lh: 18 })); add(ah, toggle(true));
    const ev = AL('H', 'điểm', { gap: 12, align: 'BASELINE' }); add(an, ev); add(ev, T('+0.3', 'xb', 22, 'chữ/chính')); add(ev, T('Thế cờ cân bằng', 'r', 13, 'chữ/phụ'));
    progress(an, 0.53, { h: 5, bg: '#1d1612', fill: solid('#c61d1d') });
    [['1', 'P8-5', '+0.3', 'M2.3 M8.7 X1-2 X9-8 B3.1 X8.6'], ['2', 'B7.1', '+0.3', 'B7.1 M8.7 M8.7 P2-6 M7.6'], ['3', 'P2-5', '+0.2', 'M8.7']].forEach((l) => {
      const b = AL('H', 'phương án ' + l[0], { gap: 10, pad: [8, 12], r: 8, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(an, b, 'FILL');
      add(b, T(l[0], 'r', 13, 'chữ/mờ')); const t = AL('V', 'chữ', { gap: 2 }); add(b, t, 'FILL'); add(t, T(l[1], 'b', 14.5, 'chữ/chính')); TW(t, T(l[3], 'r', 12.5, 'chữ/mờ')); add(b, T(l[2], 'b', 13.5, 'chữ/chính'));
    });
    add(an, T('Pikafish · độ sâu 16', 'r', 12.5, 'chữ/mờ'));
  }
  playerCard(R, online ? { name: 'Kỳ thủ Tượng (Bạn)', ini: 'KT', lines: ['Elo 1.200', 'Bạc 3★ · Đỏ'], clock: ['14:52', '0:47'], active: true, turnDot: '#c61d1d' } : { name: 'Kỳ thủ Tượng (Bạn)', ini: 'KT', lines: ['Elo 1.200', 'Bạc 3★'], active: true, turnDot: '#c61d1d' });
  return S;
}

// ---------- Kết quả trận ----------
function cornerSvg(col) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><path d="M2 32V2h30" fill="none" stroke="${col}" stroke-width="2"/><path d="M8 32V8h24" fill="none" stroke="${col}" stroke-width="1"/><rect x="11" y="11" width="5" height="5" fill="none" stroke="${col}" stroke-width="1"/></svg>`;
}
function radarSvg(col, txt) {
  const cx = 150, cy = 110, R = 62; let s = '';
  for (let k = 1; k <= 4; k++) { const r = R * k / 4; let pts = ''; for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; pts += `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} `; } s += `<polygon points="${pts}" fill="none" stroke="${col}" stroke-opacity="0.45"/>`; }
  for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; s += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(a)}" y2="${cy + R * Math.sin(a)}" stroke="${col}" stroke-opacity="0.35"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220">${s}</svg>`;
}
function buildResult(name, win) {
  const S = gameShell(name, 'AI  /  Bàn luyện tập', 2);
  eyebrow(S.content, 'Đấu máy · Cấp 4 · Trung cấp', { line: false });
  const gold = '#e9c77a', silver = '#d8dde4', acc = win ? gold : silver;
  const panel = AL('H', win ? 'Kết quả · thắng' : 'Kết quả · thua', { gap: 18, pad: [16, 110, 16, 110], r: 18, fx: [shadow(18, 40, 0.4, '#000000')] });
  panel.fills = [win ? lin([['#7a1a12'], ['#4a0e0a']]) : lin([['#2b2f38'], ['#1b1e25']])];
  add(S.content, panel, 'FILL', 'FILL');
  const sub = win ? '#f3d6c4' : '#b9bfca', box = win ? '#ffffff' : '#ffffff';
  const darkCard = (p, nm, o) => { const c = AL('V', nm, Object.assign({ gap: 10, pad: [14, 14], r: 12, stroke: win ? '#9a4a2a' : '#454b57' }, o || {})); c.fills = [solid('#000000', 0.18)]; add(p, c, 'FILL'); return c; };
  // Trái: biên bản
  const L = AL('V', 'Cột trái', {}); add(panel, L, null, 'FILL'); fixW(L, 280);
  const bb = darkCard(L, 'Biên bản trận đấu'); bb.layoutSizingVertical = 'FILL';
  const bh = AL('H', 'đầu', { align: 'CENTER' }); add(bb, bh, 'FILL'); add(bh, T('Biên bản trận đấu', 'serif', 16, acc)); grow(bh);
  const sel = AL('H', 'chọn ván', { pad: [5, 9], r: 6, stroke: win ? '#9a4a2a' : '#454b57' }); add(sel, T('Ván 1 (đang chơi)', 'r', 12.5, sub)); add(bh, sel);
  const th = AL('H', 'tiêu đề', { pad: [6, 10], r: 6 }); th.fills = [solid('#ffffff', 0.06)]; add(bb, th, 'FILL');
  [['#', 44], ['Đỏ', 90], ['Đen', 0]].forEach((c) => { const w = AL('H', c[0]); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], 'sb', 13, sub)); });
  const em = AL('V', 'trống', { gap: 14, align: 'CENTER', pad: [40, 8, 0, 8] }); add(bb, em, 'FILL');
  add(em, ic('sua', 64, win ? '#9a5a40' : '#5a606c'));
  add(em, T('Chưa có nước đi nào.', 'r', 14, sub));
  TW(em, T('Kết quả: Đen (Máy (Cấp 4)) thắng – Kỳ thủ Tượng đầu hàng', 'r', 13.5, sub, { align: 'CENTER', lh: 20 }));
  grow(bb);
  const nv = AL('H', 'điều hướng', { gap: 6, align: 'CENTER' }); add(bb, nv, 'FILL');
  const nb = (k) => { const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 6, stroke: win ? '#9a4a2a' : '#454b57' }); size(b, 32, 32); add(b, ic(k, 13, sub)); return b; };
  add(nv, nb('ve-dau')); add(nv, nb('lui')); TW(nv, T('Bấm "Phân tích" để xem lại', 'r', 12.5, sub, { align: 'CENTER' })); add(nv, nb('tiep')); add(nv, nb('ve-cuoi'));
  // Giữa: thẻ kết quả
  const mid = AL('V', 'Thẻ kết quả', { gap: 12, align: 'CENTER', pad: [20, 22], r: 12, stroke: acc, sw: 1.5 });
  mid.fills = [win ? lin([['#6a1610'], ['#3e0b08']]) : lin([['#2e333d'], ['#1f232b']])];
  add(panel, mid, null, 'FILL'); fixW(mid, 458);
  add(mid, T(win ? 'CHIẾN THẮNG' : 'THẤT BẠI', 'serif', 34, acc, { ls: 14 }));
  const dv = AL('H', 'gạch', { gap: 6, align: 'CENTER' }); add(mid, dv); add(dv, line(90, acc)); const dm = figma.createRectangle(); dm.resize(7, 7); dm.rotation = 45; dm.fills = [fp(acc)]; add(dv, dm); add(dv, line(90, acc));
  const vs = AL('H', 'Đối đầu', { gap: 34, align: 'CENTER' }); add(mid, vs);
  const side = (ini, nm, s2, w, ai, chg) => {
    const c = AL('V', nm, { gap: 4, align: 'CENTER' }); add(vs, c);
    const cr = AL('H', 'vương miện', { justify: 'CENTER' }); add(c, cr); const crown = ic('vuong-mien', 24, gold); add(cr, crown); if (!w) crown.opacity = 0;
    add(c, avatar(ini, 66, { r: 12, fill: ai ? lin([['#33476e'], ['#1d2a46']]) : lin([['#fffaf0'], ['#f1e2c8']]), color: ai ? '#ffffff' : 'nhấn/đỏ son', size: 22, stroke: w ? gold : '#ffffff', sw: 2, fx: [shadow(4, 10, 0.35, '#000000')] }));
    add(c, T(nm, 'serif', 16, '#ffffff')); add(c, T(s2, 'r', 13, sub));
    if (chg) add(c, pill(chg, { fill: chg[0] === '+' ? '#123d24' : '#4a0f0b', stroke: chg[0] === '+' ? '#2bb35a' : '#e2574c', color: chg[0] === '+' ? '#7fe0a2' : '#ff9a90', st: 'b', size: 12.5 }));
  };
  side('KT', 'Kỳ thủ Tượng', 'Đỏ · Elo 1.200', win, false, win ? '+16 Elo' : null);
  const sc = AL('V', 'Tỉ số', { gap: 4, align: 'CENTER' }); vs.insertChild(1, sc); add(sc, T(win ? '1–0' : '0–1', 'serif', 40, '#ffffff'));
  side('AI', 'Máy (Cấp 4)', 'Đen · Máy', !win, true, win ? '−16 Elo' : null);
  add(mid, T(win ? 'Bạn đã thắng ván đấu này!' : 'Bạn đã thua ván đấu này!', 'serif', 15, acc));
  const bw = AL('V', 'Bàn', { pad: [5, 5], r: 8, fill: lin([['#e9c99a'], ['#c99a62']]) }); add(mid, bw); add(bw, boardInst(win ? 286 : 312));
  grow(mid);
  add(mid, pbtn('Ván mới', { icon: 'choi', st: 'serif', size: 19, pad: [12, 18], color: win ? '#4a2c0c' : '#2a2f3a', fill: win ? lin([['#f9dc8a'], ['#e2b75a']]) : lin([['#f4f6f9'], ['#cfd5dd']]), fx: [shadow(4, 10, 0.3, '#000000')] }), 'FILL');
  hr(mid, win ? '#9a4a2a' : '#454b57');
  const lk = AL('H', 'Liên kết', { gap: 26, justify: 'CENTER' }); add(mid, lk, 'FILL');
  [['bieu-do', 'Phân tích'], ['chia-se', 'Chia sẻ'], ['dang-xuat', 'Rời bàn']].forEach((x) => { const a = AL('H', x[1], { gap: 6, align: 'CENTER' }); add(a, ic(x[0], 15, '#ffffff')); add(a, T(x[1], 'b', 16, '#ffffff')); add(lk, a); });
  const MH = mid.height;
  ['TL', 'TR', 'BL', 'BR'].forEach((k, i) => { const c = svg(cornerSvg(acc), 'Góc ' + k); mid.appendChild(c); c.layoutPositioning = 'ABSOLUTE'; c.rotation = [0, -90, 90, 180][i]; c.x = [8, 458 - 8, 8, 458 - 8][i]; c.y = [8, 8, MH - 8, MH - 8][i]; });
  // Phải: thống kê
  const R = AL('V', 'Cột phải', { gap: 14 }); add(panel, R, 'FILL', 'FILL');
  const c1 = darkCard(R, 'Biểu đồ trận đấu');
  add(c1, pill('đầu hàng', { fill: '#ffffff', color: sub, st: 'b', size: 12 })).fills = [solid('#ffffff', 0.12)];
  const h1 = AL('H', 'đầu', {}); add(c1, h1, 'FILL'); add(h1, T('Biểu đồ trận đấu', 'serif', 15.5, acc)); grow(h1); add(h1, T('Chênh lệch quân', 'r', 12, sub));
  const ch = FR('Biểu đồ', 300, 108, { r: 8, stroke: win ? '#9a4a2a' : '#454b57' }); ch.fills = [solid('#000000', 0.15)]; add(c1, ch, 'FILL');
  const ml = line(300, sub); ml.opacity = 0.5; ml.y = 54; ch.appendChild(ml); ml.constraints = { horizontal: 'STRETCH', vertical: 'CENTER' };
  add(c1, T('Ván kết thúc', 'serif', 15, acc));
  TW(c1, T('Đen (Máy (Cấp 4)) đã thắng ván đấu. Kỳ thủ Tượng đầu hàng ở nước 0.', 'r', 13, sub, { lh: 19 }));
  add(c1, pbtn('Phân tích ván', { icon: 'bieu-do', fill: solid('#000000', 0), stroke: acc, color: acc, size: 15, pad: [9, 14] }), 'FILL');
  const c2 = darkCard(R, 'Thống kê ván'); add(c2, T('Thống kê ván', 'serif', 15.5, acc));
  const sr = AL('H', 'số', { gap: 10 }); add(c2, sr, 'FILL');
  [['Số nước', '0'], ['Thời lượng', '00:03'], ['Quân bắt được', '0'], ['Lần chiếu tướng', '0']].forEach((x) => { const b = AL('V', x[0], { gap: 4 }); add(sr, b, 'FILL'); TW(b, T(x[0], 'r', 12.5, sub)); add(b, T(x[1], 'xb', 19, '#ffffff')); });
  const c3 = darkCard(R, 'Chỉ số ván đấu', { gap: 6 }); c3.layoutSizingVertical = 'FILL';
  add(c3, T('Chỉ số ván đấu', 'serif', 15.5, acc)); TW(c3, T('Ván quá ngắn để chấm điểm (cần ít nhất 8 nước).', 'r', 13, sub));
  const rw = FR('Biểu đồ radar', 300, 200); add(c3, rw, 'FILL');
  const rs = svg(radarSvg(sub), 'Lưới radar'); rw.appendChild(rs); rs.x = 0; rs.y = -10;
  [['Khai cuộc', 130, 20], ['Trung cuộc', 222, 54], ['Tàn cuộc', 222, 140], ['Chính xác', 128, 176], ['Chiến thuật', 30, 140], ['Quản lý thời gian', 10, 54]].forEach((x) => { const t = T(x[0], 'sb', 9.5, sub); rw.appendChild(t); t.x = x[1]; t.y = x[2]; });
  const mt = AL('H', 'chỉ số', { gap: 16 }); add(c3, mt, 'FILL');
  [['Khai cuộc', 'Tàn cuộc', 'Chiến thuật'], ['Trung cuộc', 'Chính xác', 'Quản lý thời gian']].forEach((col) => { const v = AL('V', 'cột', { gap: 6 }); add(mt, v, 'FILL'); col.forEach((k) => { const r = AL('H', k, {}); add(v, r, 'FILL'); add(r, T(k, 'r', 13, sub)); grow(r); add(r, T('—', 'b', 13, '#ffffff')); }); });
  return S;
}

// ---------- Quản trị ----------
const FEATURES = [
  ['Chơi cờ', [['Đấu xếp hạng', 'Ghép trận tự động, tính Elo.'], ['Chơi nhanh', 'Đặt xu, thắng ăn xu của đối thủ.'], ['Bàn chơi', 'Danh sách bàn đang chờ để vào ngồi.'], ['Chơi với bạn', 'Tạo phòng riêng, gửi link hoặc mời bạn bè.'], ['Xem trận', 'Mục "Trận đấu hot" và vào xem ván người khác.'], ['Trò chuyện trong trận', 'Khung chat giữa hai người chơi.']]],
  ['Luyện tập', [['Đấu máy', 'Chơi với AI 9 cấp độ.'], ['Phân tích', 'Bàn phân tích có engine, lưu thế cờ.'], ['Cờ thế', 'Giải thế cờ, nhận xu thưởng.']]],
  ['Cộng đồng', [['Tường cộng đồng', 'Trò chuyện & chia sẻ thế cờ ở trang chủ.'], ['Bạn bè', 'Kết bạn, tìm kỳ thủ, mời vào bàn.'], ['Giải đấu', 'Xem và đăng ký giải đấu.'], ['Bảng xếp hạng', 'Bảng Elo, chuỗi thắng, cờ thế.']]],
  ['Tài khoản & xu', [['Đăng ký tài khoản mới', 'Tắt: chỉ tài khoản đã có mới đăng nhập được.'], ['Cửa hàng', 'Mua vật phẩm bằng xu (Túi đồ vẫn dùng được).'], ['Nhiệm vụ hằng ngày', 'Nhiệm vụ và nhận thưởng xu.'], ['Góp ý', 'Người chơi gửi góp ý cho quản trị viên.']]],
];
function buildAdminFeatures(name) {
  const A = adminShell(name, 'Chức năng web');
  adminHead(A.content, 'Chức năng web', 'Bật / tắt chức năng.', 'Gạt công tắc là áp dụng ngay: chức năng tắt sẽ biến khỏi trang chơi của mọi người và server từ chối mọi thao tác của nó. Ván đang diễn ra không bị ảnh hưởng.',
    pbtn('Bật tất cả', { fill: 'nền/thẻ phụ', stroke: 'viền/mảnh', color: 'chữ/mờ', size: 14.5 }));
  const cols = AL('H', 'Ba cột', { gap: 16, align: 'MIN' }); add(A.content, cols, 'FILL');
  const C3 = [AL('V', 'Cột 1', { gap: 16 }), AL('V', 'Cột 2', { gap: 16 }), AL('V', 'Cột 3', { gap: 16 })];
  C3.forEach((c) => add(cols, c, 'FILL'));
  const place = [0, 1, 2, 0];
  FEATURES.forEach((g, gi) => {
    const c = card(C3[place[gi]], g[0], { gap: 0, pad: [20, 20, 8, 20] });
    add(c, T(g[0], 'b', 17, 'chữ/chính')); spacer(c, 12);
    g[1].forEach((f, i) => {
      if (i === 0 || true) hr(c);
      const r = AL('H', f[0], { gap: 12, align: 'CENTER', pad: [12, 0] }); add(c, r, 'FILL');
      const t = AL('V', 'chữ', { gap: 3 }); add(r, t, 'FILL'); add(t, T(f[0], 'b', 14.5, 'chữ/chính')); TW(t, T(f[1], 'r', 13, 'chữ/mờ', { lh: 19 }));
      add(r, T('Đang bật', 'b', 13, '#1f8a4c')); add(r, toggle(true, { on: '#1f8a4c', w: 42, h: 24 }));
    });
  });
  return A;
}
function buildAdminConfig(name) {
  const A = adminShell(name, 'Cài đặt hệ thống');
  adminHead(A.content, 'Cài đặt hệ thống', 'Thiết lập toàn bộ web.', 'Elo, bậc rank, ghép trận, phòng riêng, nhiệm vụ, giới hạn chat, engine, tài khoản và nội dung trang chủ. Lưu là áp dụng ngay — trang chơi của mọi người cập nhật không cần tải lại.', adminActions(true));
  const row = AL('H', 'Hai cột', { gap: 18, align: 'MIN' }); add(A.content, row, 'FILL');
  const nav = card(row, 'Mục lục', { h: 'FIXED', gap: 2, pad: [12, 8] }); fixW(nav, 208);
  ['Nội dung trang chủ', 'Elo & uy tín', 'Bậc rank', 'Ghép trận & kết nối', 'Phòng riêng (Chơi với bạn)', 'Cộng đồng & trò chuyện', 'Nhiệm vụ hằng ngày', 'Giải đấu', 'Engine phân tích (Pikafish)', 'Tài khoản'].forEach((t, i) => {
    const b = AL('H', t, { pad: [9, 12], r: 8, fill: i === 0 ? 'nhấn/đỏ nhạt' : null }); add(nav, b, 'FILL'); TW(b, T(t, 'sb', 13.5, i === 0 ? 'nhấn/đỏ son' : 'chữ/chính', { lh: 19 }));
  });
  const R = AL('V', 'Các mục', { gap: 18 }); add(row, R, 'FILL');
  const s1 = card(R, 'Nội dung trang chủ', { gap: 14, pad: [22, 20] }); cardHead(s1, 'Nội dung trang chủ', 'Chữ hiển thị trên web — đổi là mọi người thấy ngay.');
  const g1 = AL('H', 'hàng', { gap: 16, align: 'MIN' }); add(s1, g1, 'FILL');
  field(g1, 'Thông báo đầu trang', ' ', { multi: true, h: 80, hint: 'Hiện thành dải thông báo trên cùng mọi trang. Để trống = ẩn.' });
  field(g1, 'Nhãn banner', 'Cờ tướng Việt');
  field(g1, 'Tiêu đề banner', 'Đấu trí trên bàn cờ.\nKết kỳ hữu bốn phương.', { multi: true, h: 80, hint: 'Xuống dòng để ngắt dòng trên banner.' });
  const g2 = AL('H', 'hàng', { gap: 16, align: 'MIN' }); add(s1, g2, 'FILL');
  field(g2, 'Hộp gợi ý menu trái — tiêu đề', 'Mời kỳ hữu vào bàn');
  field(g2, 'Hộp gợi ý menu trái — nội dung', 'Tạo phòng riêng và gửi link — bạn bè vào chơi ngay, không cần tài khoản.', { multi: true, h: 80 });
  const ph = AL('V', 'trống', {}); add(g2, ph, 'FILL');
  const s2 = card(R, 'Elo & uy tín', { gap: 14, pad: [22, 20] }); cardHead(s2, 'Elo & uy tín', 'Áp dụng cho tài khoản mới và các ván kết thúc từ bây giờ.');
  const g3 = AL('H', 'hàng', { gap: 16, align: 'MAX' }); add(s2, g3, 'FILL'); field(g3, 'Elo khởi đầu', '1200'); field(g3, 'Hệ số K (Elo thay đổi tối đa mỗi ván)', '32'); field(g3, 'Uy tín khởi đầu', '1000');
  const g4 = AL('H', 'hàng', { gap: 16, align: 'MAX' }); add(s2, g4, 'FILL'); field(g4, 'Uy tín tối đa', '1100'); field(g4, 'Uy tín cộng mỗi ván chơi trọn', '1'); field(g4, 'Uy tín trừ khi bỏ ván giữa chừng', '10');
  const s3 = card(R, 'Bậc rank', { gap: 14, pad: [22, 20] }); cardHead(s3, 'Bậc rank', 'Mốc Elo của từng bậc — huy hiệu và tên bậc hiện ở hồ sơ, bảng xếp hạng.');
  const g5 = AL('H', 'hàng', { gap: 12 }); add(s3, g5, 'FILL');
  [['Đồng', '0'], ['Bạc', '1100'], ['Vàng', '1300'], ['Bạch kim', '1500'], ['Kim cương', '1700'], ['Cao thủ', '1900']].forEach((x) => field(g5, x[0], x[1]));
  return A;
}
function buildAdminEconomy(name) {
  const A = adminShell(name, 'Chế độ chơi & xu');
  adminHead(A.content, 'Chế độ chơi & xu', 'Nhịp chơi, phí và thưởng.', 'Áp dụng ngay cho ván mới và cập nhật trên trang chơi của mọi người. Ván đang diễn ra giữ nguyên nhịp và mức xu cũ.');
  const act = AL('H', 'Thao tác', { gap: 8 }); add(A.content, act);
  add(act, pbtn('Khôi phục mặc định', { fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14.5 })); add(act, pbtn('Hoàn tác', { fill: 'nền/thẻ phụ', stroke: 'viền/mảnh', color: 'chữ/mờ', size: 14.5 })); add(act, pbtn('Lưu thay đổi', { fill: '#e08a85', size: 14.5 }));
  const cols = AL('H', 'Ba cột', { gap: 22, align: 'MIN' }); add(A.content, cols, 'FILL');
  const a = card(cols, 'Xếp hạng', { gap: 14, pad: [22, 20] }); cardHead(a, 'Xếp hạng', 'Ghép trận tự động, tính Elo. Mọi ván chơi một nhịp cố định.');
  const pair = (p, l1, v1, l2, v2) => { const r = AL('H', 'hàng', { gap: 12, align: 'MAX' }); add(p, r, 'FILL'); field(r, l1, v1); field(r, l2, v2); };
  pair(a, 'Thời gian mỗi bên (phút)', '15', 'Cộng sau mỗi nước (giây)', '5');
  pair(a, 'Thời gian mỗi nước (giây, 10–600)', '60', 'Phí mỗi ván (xu)', '10');
  pair(a, 'Thưởng chơi trọn ván (xu)', '10', 'Thưởng thêm khi thắng (xu)', '10');
  const n = AL('V', 'ghi chú', { pad: [10, 12], r: 8, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh', dash: [4, 3] }); add(a, n, 'FILL');
  TW(n, T('Người chơi thấy: nhịp 15p + 5s · phí 10 xu · thắng +20 xu, thua/hoà +10 xu (chơi trọn ván).', 'r', 13, 'chữ/phụ', { lh: 19 }));
  const b = card(cols, 'Chơi nhanh', { gap: 12, pad: [22, 20] }); cardHead(b, 'Chơi nhanh', 'Người chơi chọn một nhịp và một mức đặt — thắng nhận mức đặt của đối thủ.');
  field(b, 'Thời gian mỗi nước (giây, 10–600) — áp dụng mọi nhịp Chơi nhanh', '60');
  add(b, T('Nhịp chơi', 'b', 15, 'chữ/chính'));
  TW(b, T('Nhóm cùng tên hiện chung một hàng (vd Cờ chớp, Cờ nhanh). Tối đa 12 nhịp.', 'r', 12.5, 'chữ/mờ', { lh: 18 }));
  const th = AL('H', 'tiêu đề', { gap: 8 }); add(b, th, 'FILL');
  [['NHÓM', 0], ['PHÚT MỖI BÊN', 78], ['GIÂY CỘNG', 78], ['', 36]].forEach((c) => { const w = AL('H', c[0] || 'xoá'); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); TW(w, T(c[0], 'b', 12, 'chữ/phụ', { ls: 4 })); });
  [['Cờ chớp', '1', '0'], ['Cờ chớp', '3', '0'], ['Cờ chớp', '3', '2'], ['Cờ nhanh', '5', '0'], ['Cờ nhanh', '10', '0'], ['Cờ nhanh', '10', '5']].forEach((x) => {
    const r = AL('H', 'nhịp', { gap: 8, align: 'CENTER' }); add(b, r, 'FILL');
    add(r, input(x[0]), 'FILL'); const i1 = input(x[1]); add(r, i1); fixW(i1, 78); const i2 = input(x[2]); add(r, i2); fixW(i2, 78);
    const d = AL('H', 'xoá', { align: 'CENTER', justify: 'CENTER', r: 8, stroke: '#d8cfc4' }); size(d, 36, 36); add(d, ic('dong', 14, 'chữ/mờ')); add(r, d);
  });
  add(b, pbtn('Thêm nhịp', { icon: 'cong', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14, pad: [8, 14] }));
  const c = card(cols, 'Thưởng & xu khác', { gap: 14, pad: [22, 20] }); cardHead(c, 'Thưởng & xu khác', 'Xu chỉ dùng trong game, không quy đổi tiền thật.');
  pair(c, 'Xu tặng khi tạo tài khoản', '1000', 'Thưởng đăng nhập mỗi ngày', '20');
  pair(c, 'Thưởng giải cờ thế (lần đầu)', '5', 'Đấu máy: thưởng mỗi ván', '2');
  const r3 = AL('H', 'hàng', { gap: 12 }); add(c, r3, 'FILL'); field(r3, 'Đấu máy: thưởng thêm khi thắng', '3'); add(r3, AL('V', 'trống'), 'FILL');
  TW(c, T('Xu tặng khi tạo tài khoản chỉ áp dụng cho tài khoản mới; tài khoản cũ giữ nguyên số xu.', 'r', 12.5, 'chữ/mờ', { lh: 18 }));
  return A;
}
function buildAdminTheme(name) {
  const A = adminShell(name, 'Bàn cờ & quân cờ');
  adminHead(A.content, 'Bàn cờ & quân cờ', 'Giao diện mặc định.', 'Là món "Theo Tượng Kỳ" trong Túi đồ — áp dụng ngay cho mọi người chơi chưa tự trang bị kiểu khác.');
  const row = AL('H', 'Hai cột', { gap: 26, align: 'MIN' }); add(A.content, row, 'FILL');
  const L = card(row, 'Xem trước', { h: 'FIXED', gap: 14, pad: [20, 48] }); fixW(L, 718);
  add(L, boardInst(622));
  const cb = AL('H', 'điểm giao', { gap: 8, align: 'CENTER', justify: 'CENTER' }); add(L, cb, 'FILL'); add(cb, check(false)); add(cb, T('Hiện điểm giao (kiểm tra căn chỉnh)', 'r', 14, 'chữ/phụ'));
  const R = card(row, 'Bàn cờ', { gap: 12, pad: [20, 20] });
  add(R, T('Bàn cờ', 'b', 16, 'chữ/chính'));
  const g = AL('H', 'Mẫu bàn', { gap: 12, wrap: true }); add(R, g, 'FILL');
  [['Gỗ sáng', 'wood', 'Miễn phí', true], ['Cổ điển', 'classic', 'Miễn phí'], ['Thi Đấu', 'thidau', '100 xu'], ['Gỗ Trầm', 'tram', '150 xu'], ['Trúc Thanh', 'truc', '150 xu'], ['Ngọc Sáng', 'ngoc', '250 xu'], ['Đế Vương', 'devuong', '400 xu']].forEach((x) => {
    const c = AL('V', x[0], { gap: 6, align: 'CENTER', pad: [6, 6], r: 10, fill: x[3] ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ', stroke: x[3] ? 'nhấn/đỏ son' : 'viền/mảnh', sw: x[3] ? 2 : 1 }); add(g, c); fixW(c, 108);
    const th = FR('ảnh', 96, 96, { r: 4, clip: true }); add(c, th);
    const bd = x[1] === 'wood' ? woodBoard(96, startPos()) : drawnBoard(96, x[1]); th.appendChild(bd);
    const tg = pill(x[2], { fill: x[2] === 'Miễn phí' ? '#1f8a4c' : '#f9dc8a', color: x[2] === 'Miễn phí' ? '#ffffff' : '#5a3410', st: 'b', size: 10, pad: [2, 6] }); th.appendChild(tg); tg.x = 4; tg.y = 4;
    add(c, T(x[0], 'sb', 13, x[3] ? 'nhấn/đỏ son' : 'chữ/phụ'));
  });
  add(R, pbtn('Tải ảnh bàn cờ lên…', { icon: 'tai-xuong', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14.5 }), 'FILL');
  hr(R);
  const pub = AL('V', 'Phát hành', { gap: 10, pad: [14, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(R, pub, 'FILL');
  add(pub, T('Phát hành bàn cờ cho kỳ thủ', 'b', 14.5, 'chữ/chính'));
  add(pub, pill('Đang tặng miễn phí — mọi kỳ thủ đều có trong Túi đồ.', { fill: '#e3f4e8', color: '#1f8a4c', size: 12 }));
  [['Không phát hành', 'Không có trong Túi đồ / Cửa hàng', false], ['Miễn phí', 'Tặng cho mọi kỳ thủ', true], ['Bán bằng xu', 'Đưa vào Cửa hàng', false]].forEach((o) => {
    const r = AL('H', o[0], { gap: 10, align: 'CENTER', pad: [9, 12], r: 8, fill: o[2] ? 'nhấn/đỏ nhạt' : '#ffffff', stroke: o[2] ? 'nhấn/đỏ son' : 'viền/mảnh' }); add(pub, r, 'FILL');
    add(r, radio(o[2])); const t = AL('V', 'chữ', { gap: 1 }); add(r, t); add(t, T(o[0], 'b', 13.5, 'chữ/chính')); add(t, T(o[1], 'r', 12, 'chữ/mờ'));
  });
  add(R, T('Căn chỉnh lưới', 'b', 15, 'chữ/chính'));
  field(R, 'Tên bàn cờ', 'Gỗ sáng', { hint: 'Toạ độ (pixel trên ảnh) của đường kẻ ngoài cùng — lưới ở giữa được chia đều.' });
  return A;
}
function buildAdminShop(name) {
  const A = adminShell(name, 'Cửa hàng vật phẩm');
  adminHead(A.content, 'Cửa hàng vật phẩm', 'Bàn cờ, quân cờ, đồng hồ.', 'Toàn bộ vật phẩm người chơi thấy trong Túi đồ & Cửa hàng: đổi tên, giá, thứ tự, ẩn khỏi Cửa hàng, thêm hoặc xoá.', adminActions(true));
  const tabs = AL('H', 'Loại', { gap: 8 }); add(A.content, tabs);
  [['Bàn cờ', '8', true], ['Quân cờ', '9'], ['Đồng hồ', '6']].forEach((t) => {
    const b = AL('H', t[0], { gap: 8, align: 'CENTER', pad: [10, 14], r: 999, fill: t[2] ? '#1d1612' : '#ffffff', stroke: t[2] ? null : 'viền/mảnh' }); add(tabs, b);
    add(b, T(t[0], 'b', 15, t[2] ? '#ffffff' : 'chữ/chính')); const n = AL('H', 'đếm', { pad: [1, 7], r: 999, fill: t[2] ? '#3a2c24' : 'nền/thẻ phụ' }); add(n, T(t[1], 'b', 12, t[2] ? '#ffffff' : 'chữ/phụ')); add(b, n);
  });
  const g = AL('H', 'Vật phẩm', { gap: 16, wrap: true }); add(A.content, g, 'FILL');
  [['Theo Tượng Kỳ', 'Bàn cờ chính thức', '0', 'wood', 'Mặc định'], ['Gỗ sáng', 'Vân gỗ thật', '0', 'wood', 'Ảnh có sẵn'], ['Cổ điển', 'Nét vẽ truyền thống', '0', 'classic', 'Vẽ · bảng màu Cổ điển'], ['Thi Đấu', 'Nền sáng, nét rõ như bàn giải', '100', 'thidau', 'Vẽ · bảng màu Thi Đấu'],
    ['Gỗ Trầm', 'Gỗ sẫm màu, ấm', '150', 'tram', 'Vẽ · bảng màu Gỗ Trầm'], ['Trúc Thanh', 'Sắc trúc xanh nhẹ', '150', 'truc', 'Vẽ · bảng màu Trúc Thanh'], ['Ngọc Sáng', 'Ngọc bích trong trẻo', '250', 'ngoc', 'Vẽ · bảng màu Ngọc Sáng'], ['Đế Vương', 'Đỏ son, nét vàng', '400', 'devuong', 'Vẽ · bảng màu Đế Vương']].forEach((x, i) => {
    const c = card(g, x[0], { h: 'FIXED', gap: 8, pad: [14, 14] }); fixW(c, 274);
    const top = AL('H', 'đầu', { gap: 8 }); add(c, top, 'FILL');
    const th = FR('ảnh', 120, 120, { r: 4, clip: true }); add(top, th); th.appendChild(x[3] === 'wood' ? woodBoard(120, startPos()) : drawnBoard(120, x[3]));
    grow(top);
    const ar = AL('V', 'sắp xếp', { gap: 6 }); add(top, ar);
    ['↑', '↓', '×'].forEach((s, j) => { if (i === 0 && j === 2) return; const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 6, stroke: 'viền/mảnh', fill: '#ffffff' }); size(b, 30, 30); add(b, T(s, 'b', 13, j === 2 ? 'nhấn/đỏ son' : 'chữ/phụ')); add(ar, b); });
    const tg = AL('H', 'nguồn', { gap: 8, align: 'CENTER' }); add(c, tg); if (i === 0) add(tg, pill('Mặc định', { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b' })); add(tg, T(i === 0 ? 'Theo giao diện mặc định' : x[4], 'r', 12.5, 'chữ/mờ'));
    field(c, 'Tên', x[0]); field(c, 'Mô tả', x[1]);
    const pr = AL('H', 'giá', { gap: 10, align: 'MAX' }); add(c, pr, 'FILL'); field(pr, i === 0 ? 'Giá (luôn miễn phí)' : 'Giá (xu, 0 = miễn phí)', x[2]);
    const on = AL('H', 'đang bán', { gap: 6, align: 'CENTER', pad: [0, 0, 12, 0] }); add(pr, on); add(on, check(true, i === 0 ? '#b9ab9b' : '#2f6fde')); add(on, T('Đang bán', 'sb', 13.5, '#1f8a4c'));
  });
  return A;
}

// =====================================================================
// GIAO DIỆN MOBILE (390px) — theo web ở khổ điện thoại + các chỉnh sửa Figma 14/10
// =====================================================================
const MW = 390;
let M_TOP = null; // component thanh trên mobile (tạo mỗi lần dựng)
function iconBox(name, s, o) {
  o = o || {};
  const b = AL('H', o.label || 'Nút ' + name, { align: 'CENTER', justify: 'CENTER', r: 10, fill: o.fill || 'nền/thẻ', stroke: o.stroke === false ? null : 'viền/mảnh' });
  size(b, s || 36, s || 36); add(b, ic(name, o.is || 17, o.color || 'chữ/chính')); return b;
}
function makeMobileTop(parent) {
  const t = AL('H', 'Khung · Thanh trên mobile', { gap: 10, align: 'CENTER', pad: [0, 16], fill: '#ffffff', stroke: 'viền/mảnh' });
  t.fills = [solid('#ffffff', 0.94)];
  t.strokeTopWeight = 0; t.strokeLeftWeight = 0; t.strokeRightWeight = 0; t.strokeBottomWeight = 1;
  size(t, MW, 64); t.primaryAxisSizingMode = 'FIXED'; t.counterAxisSizingMode = 'FIXED';
  add(t, iconBox('menu', 36, { label: 'Nút menu' }));
  const lg = figma.createRectangle(); lg.name = 'Logo'; lg.resize(34, 32); lg.fills = [{ type: 'IMAGE', imageHash: HASH.logo, scaleMode: 'FIT' }]; add(t, lg);
  add(t, T('Tượng Kỳ', 'b', 16, 'chữ/chính'));
  grow(t);
  add(t, iconBox('qua', 36, { label: 'Nút nhiệm vụ' })); add(t, iconBox('chuong', 36, { label: 'Nút thông báo' }));
  add(t, avatar('KT', 36, { r: 9, size: 14 }));
  const comp = figma.createComponentFromNode(t);
  comp.description = 'Thanh trên ở khổ điện thoại: nút menu (mở menu trái), logo, nhiệm vụ, thông báo, ảnh đại diện.';
  parent.appendChild(comp);
  return comp;
}
function mShell(name, o) {
  o = o || {};
  const s = AL('V', name);
  s.resize(MW, o.h || 844); s.counterAxisSizingMode = 'FIXED'; s.primaryAxisSizingMode = o.h ? 'FIXED' : 'AUTO';
  s.fills = [{ type: 'IMAGE', imageHash: HASH.bg, scaleMode: 'FILL' }, solid('#faf4e9', 0.35)];
  s.clipsContent = true; s.setPluginData(MARK, '1');
  let top = M_TOP.createInstance(); add(s, top, 'FILL');
  if (o.guest) {
    top = top.detachInstance(); top.name = 'Thanh trên mobile · khách';
    const g = top.children.find((c) => c.name === 'đẩy'); const idx = top.children.indexOf(g);
    top.children.slice(idx + 1).forEach((c) => c.remove());
    add(top, T('Đăng nhập', 'sb', 14.5, 'chữ/chính')); add(top, pbtn('Đăng ký', { pad: [9, 14], size: 14.5 }));
  }
  const c = AL('V', 'Nội dung', { gap: o.gap != null ? o.gap : 16, pad: o.pad || [16, 16, 28, 16] }); add(s, c, 'FILL');
  return { screen: s, content: c };
}
function mEyebrow(p, text, o) { return eyebrow(p, text, Object.assign({ line: true }, o || {})); }

// ---------- Trang chủ ----------
function buildMHome(name, guest) {
  const S = mShell(name, { guest: guest });
  const c = S.content;
  add(c, T('CHÀO BUỔI CHIỀU, KỲ THỦ', 'b', 12.5, 'nhấn/đỏ son', { ls: 8 }));
  const hero = AL('V', 'Banner', { gap: 14, pad: [28, 22], r: 16, fill: rad([['#3a2a22'], ['#1d1612']]), fx: [shadow(10, 24, 0.18)] }); add(c, hero, 'FILL');
  add(hero, redTag('Cờ tướng Việt'));
  add(hero, T('Đấu trí trên bàn cờ.\nKết kỳ hữu bốn phương.', 'xb', 24, '#ffffff', { lh: 30 }));
  const meta = AL('H', 'Số liệu', { gap: 14, align: 'CENTER' }); add(hero, meta);
  const m1 = AL('H', 'online', { gap: 6, align: 'CENTER' }); add(m1, dot('trạng thái/xanh', 8)); const t1 = T('2 người đang online', 'r', 13, '#cbbfb2'); bold(t1, '2', 'b', '#ffffff'); add(m1, t1); add(meta, m1);
  const t2 = T('0 ván đang diễn ra', 'r', 13, '#cbbfb2'); bold(t2, '0', 'b', '#ffffff'); add(meta, t2);
  const acts = AL('H', 'Nút', { gap: 10 }); add(hero, acts); add(acts, btn('Chính', 'Chơi', 'choi')); add(acts, btn('Sáng', 'Phân tích', 'bieu-do'));
  const tiles = AL('H', 'Lối tắt', { gap: 12, wrap: true }); add(c, tiles, 'FILL');
  [['choi', 'Chơi', 'Xếp hạng Elo, chơi với bạn, xem trận hot.', 'Vào chơi'], ['ai', 'Đấu máy', '9 cấp độ AI, có gợi ý và đi lại.', 'Luyện ngay'], ['co-the', 'Cờ thế', '5 thế cờ theo độ khó, giải lần đầu +5 xu.', 'Giải thế cờ'], ['xep-hang', 'Xếp hạng', 'Bảng Elo, chuỗi thắng và cờ thế.', 'Xem bảng']].forEach((x) => {
    const t = card(tiles, x[1], { h: 'FIXED', gap: 8, pad: [16, 16] }); fixW(t, 173);
    add(t, iconBox(x[0], 36, { fill: 'nhấn/đỏ nhạt', stroke: false, color: 'nhấn/đỏ son' }));
    add(t, T(x[1], 'b', 16, 'chữ/chính')); TW(t, T(x[2], 'r', 13, 'chữ/phụ', { lh: 19 }));
    const l = AL('H', 'liên kết', { gap: 4, align: 'CENTER' }); add(l, T(x[3], 'b', 13.5, 'nhấn/đỏ son')); add(l, ic('mui-ten-phai', 13, 'nhấn/đỏ son')); add(t, l);
  });
  // Cộng đồng (rút gọn)
  const cm = card(c, 'Cộng đồng Tượng Kỳ', { gap: 12 });
  const hd = AL('H', 'đầu', { gap: 10 }); add(cm, hd, 'FILL'); const hl = AL('V', 'tiêu đề', { gap: 3 }); add(hd, hl, 'FILL');
  add(hl, T('Cộng đồng Tượng Kỳ', 'b', 16, 'chữ/chính')); TW(hl, T('Trò chuyện và chia sẻ thế cờ với mọi kỳ thủ.', 'r', 12.5, 'chữ/mờ', { lh: 18 })); add(hd, pill('2 online'));
  [['Minh Quân', 'MQ', 'Chào cả nhà! Tối nay ai làm vài ván cờ chớp không?', null], ['Minh Quân', 'MQ', 'Thế Pháo đầu này Đen nên đáp thế nào cho chắc?', ['Pháo đầu đối Bình phong mã', '4 nước']]].forEach((m) => {
    const r = AL('H', 'Tin', { gap: 10 }); add(cm, r, 'FILL'); add(r, avatar(m[1], 32, { r: 8, size: 11.5 }));
    const b = AL('V', 'Bong bóng', { gap: 5, pad: [8, 10], r: 12, fill: 'nền/thẻ', stroke: 'viền/mảnh' }); b.topLeftRadius = 4; add(r, b, 'FILL');
    const nm = AL('H', 'tên', { gap: 6 }); add(nm, T(m[0], 'b', 13, 'chữ/chính')); add(nm, T('Bạc · 1.200', 'r', 11.5, 'chữ/mờ')); add(b, nm);
    TW(b, T(m[2], 'r', 13.5, 'chữ/chính', { lh: 19 }));
    if (m[3]) { const s = AL('H', 'Thế cờ', { gap: 10, align: 'CENTER', pad: [6, 6], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(b, s, 'FILL'); add(s, boardInst(84)); const i = AL('V', 'chữ', { gap: 4 }); add(s, i, 'FILL'); TW(i, T(m[3][0], 'b', 13.5, 'chữ/chính')); add(i, T(m[3][1], 'r', 12, 'chữ/mờ')); add(i, pbtn('Mở phân tích', { size: 12.5, pad: [6, 10] })); }
  });
  const comp = AL('V', 'Soạn tin', { gap: 8 }); add(cm, comp, 'FILL');
  add(comp, input('Nhắn với cộng đồng… (Enter để gửi, Shift+Enter xuống dòng)', { ph: true, multi: true, size: 13.5 }), 'FILL');
  const cb = AL('H', 'nút', { gap: 8, justify: 'MAX' }); add(comp, cb, 'FILL');
  add(cb, pbtn('Thế cờ', { icon: 'luoi', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 13, pad: [7, 12] })); add(cb, pbtn('Gửi', { size: 13.5, pad: [7, 14], opacity: guest ? 0.5 : null }));
  if (guest) { const n = T('Ai cũng đọc được — đăng nhập để gửi tin và chia sẻ thế cờ.', 'r', 12.5, 'chữ/mờ', { lh: 18 }); TW(cm, n); bold(n, 'đăng nhập', 'm', 'nhấn/đỏ son'); }
  const hot = card(c, 'Trận đấu hot'); cardHead(hot, 'Trận đấu hot', 'Đang diễn ra tại Tượng Kỳ', 'Xem tất cả ›', { size: 16 });
  const em = AL('V', 'Trống', { align: 'CENTER', pad: [20, 14], r: 10, stroke: 'viền/mảnh', dash: [5, 4] }); add(hot, em, 'FILL');
  const et = T('Chưa có ván nào đang diễn ra — mở màn ngay', 'r', 13, 'chữ/mờ', { align: 'CENTER', lh: 19 }); TW(em, et); bold(et, 'mở màn ngay', 'b', 'nhấn/đỏ son');
  const rank = card(c, 'Thông tin xếp hạng');
  if (guest) {
    cardHead(rank, 'Thông tin xếp hạng', 'Khách vẫn chơi được ngay.', null, { size: 16 });
    const rb = AL('H', 'Bậc rank', { gap: 14, align: 'CENTER', pad: [12, 14], r: 12, fill: lin([['#2a1c15'], ['#47281b']], 'h') }); add(rank, rb, 'FILL');
    add(rb, avatar('?', 54, { r: 27, fill: rad([['#fff8e8'], ['#cdb48a']]), stroke: '#e8d2a6', sw: 3, color: '#8a5a12', st: 'serif', size: 22 }));
    const ri = AL('V', 'chữ', { gap: 2 }); add(rb, ri); add(ri, T('Chưa xếp hạng', 'serif', 19, '#f6e1b0')); const e = AL('H', 'Elo', { gap: 6, align: 'BASELINE' }); add(e, T('Elo khởi đầu', 'r', 12, '#c9a87a')); add(e, T('1.200', 'xb', 22, '#fff3dc')); add(ri, e);
    TW(rank, T('Tạo tài khoản miễn phí để có Elo xếp hạng, nhận xu mỗi ngày, lưu lịch sử và phân tích lại mọi ván cờ.', 'r', 13.5, 'chữ/phụ', { lh: 20 }));
    const bb = AL('H', 'Nút', { gap: 10 }); add(rank, bb, 'FILL'); add(bb, btn('Chính', 'Tạo tài khoản'), 'FILL'); add(bb, btn('Sáng', 'Đăng nhập'), 'FILL');
  } else {
    cardHead(rank, 'Thông tin xếp hạng', 'Elo chỉ đổi ở ván online giữa hai tài khoản', 'Hồ sơ ›', { size: 16 });
    const rb = AL('H', 'Bậc rank', { gap: 14, align: 'CENTER', pad: [12, 14], r: 12, fill: lin([['#2a1c15'], ['#47281b']], 'h') }); add(rank, rb, 'FILL');
    rb.appendChild(rankBadge(56)); const ri = AL('V', 'chữ', { gap: 2 }); add(rb, ri); add(ri, T('Bạc', 'serif', 20, '#dfe6ee')); add(ri, T('★★★☆☆', 'r', 12.5, '#ffd27a'));
    const e = AL('H', 'Elo', { gap: 6, align: 'BASELINE' }); add(e, T('Elo', 'r', 12, '#c9a87a')); add(e, T('1.200', 'xb', 22, '#fff3dc')); add(ri, e);
    progress(rank, 0.5); add(rank, T('Còn 100 Elo để lên Vàng', 'r', 12.5, 'chữ/mờ'));
    const st = AL('H', 'Chỉ số', { gap: 8 }); add(rank, st, 'FILL');
    [['Tỉ lệ thắng', '—', '0T · 0H · 0B'], ['Chuỗi thắng', '0', 'Kỷ lục 0'], ['Xu', '1.020', 'Cửa hàng']].forEach((x) => { const b = AL('V', x[0], { gap: 3, pad: [9, 10], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(st, b, 'FILL', 'FILL'); add(b, T(x[0], 'r', 11.5, 'chữ/mờ')); add(b, T(x[1], 'xb', 18, 'chữ/chính')); add(b, T(x[2], 'r', 11, 'chữ/mờ')); });
    add(rank, pbtn('Đấu xếp hạng', { icon: 'xep-hang' }), 'FILL');
  }
  return S;
}
function buildMMenu(name) {
  const S = buildMHome(name, false);
  S.screen.primaryAxisSizingMode = 'FIXED'; S.screen.resize(MW, 844);
  const ov = FR('Lớp mờ', MW, 844, { fill: solid('#000000', 0.45) }); S.screen.appendChild(ov); ov.layoutPositioning = 'ABSOLUTE'; ov.x = 0; ov.y = 0;
  const side = C.side.createInstance(); S.screen.appendChild(side); side.layoutPositioning = 'ABSOLUTE'; side.resize(side.width, 844); side.x = 0; side.y = 0;
  const it = navItems(side)[0]; if (it) it.setProperties({ 'Trạng thái': 'Đang chọn' });
  side.effects = [shadow(0, 30, 0.4, '#000000')];
  return S;
}

// ---------- Chơi ----------
function buildMPlay(name) {
  const S = mShell(name, { h: 844 });
  mEyebrow(S.content, 'Chơi');
  const vp = FR('Dãy cờ phướn (cuộn ngang)', 374, 500, { clip: true }); add(S.content, vp);
  const row = AL('H', 'Dãy cờ phướn', { gap: 26, pad: [8, 0, 0, 0] }); vp.appendChild(row); row.x = 0; row.y = 0;
  // dựng ở cỡ desktop rồi thu nhỏ để giữ đúng tỉ lệ chữ
  const W = 265, H = 640;
  let b = banner(row, 'Đỏ', 'Xếp hạng', W, H);
  bannerHead(b, 'cupNho', 'Xếp hạng', 'Đấu xếp hạng ELO · ghép trận tự động', true);
  const tw = AL('H', 'Cúp', { justify: 'CENTER' }); add(b, tw, 'FILL'); add(tw, ill('cup', 104));
  const tb = AL('V', 'Thời gian mỗi ván', { gap: 2, align: 'CENTER', pad: [8, 10], r: 10, fill: lin([['#2a1410'], ['#160a08']]), stroke: '#e9b44c', sw: 1.5 }); add(b, tb, 'FILL');
  add(tb, T('THỜI GIAN MỖI VÁN', 'b', 10.5, '#f2cf72', { ls: 8 })); add(tb, T('15p + 5s', 'serif', 25, '#ffffff'));
  bullets(b, [['Bậc của bạn: ', 'Bạc 3★ · Elo 1.200'], 'Ghép đối thủ cùng trình độ (±100 Elo)', 'Thắng +20 xu, chơi trọn ván +10 xu'], { color: '#fbe3cf', boldColor: '#ffffff', size: 11.5, lh: 17, dot: '#f2cf72', gap: 3 });
  grow(b); add(b, pbtn('Vào xếp hạng', Object.assign({ chev: true, size: 15 }, GOLD_BTN)), 'FILL');
  b = banner(row, 'Ngà', 'Chơi nhanh', W, H);
  bannerHead(b, 'dongXu', 'Chơi nhanh', 'Tuỳ chọn nhịp chơi và mức đặt theo sở thích của bạn.', false);
  add(b, coinPill('Số dư: 1.020 xu', { size: 12, is: 12, pad: [4, 10] }));
  [['choi', 'Cờ chớp', '1+0 · 3+0 · 3+2'], ['dong-ho', 'Cờ nhanh', '5+0 · 10+0 · 10+5']].forEach((o) => { const r = AL('H', o[1], { gap: 12, align: 'CENTER', pad: [9, 12], r: 9, fill: '#ffffff', stroke: '#eadfce' }); add(b, r, 'FILL'); add(r, ic(o[0], 19, 'nhấn/đỏ son')); const t = AL('V', 'chữ', { gap: 2 }); add(r, t); add(t, T(o[1], 'b', 14, '#3a2416')); add(t, T(o[2], 'r', 11.5, '#7a6656')); });
  grow(b); add(b, pbtn('Vào bàn chơi nhanh', Object.assign({ chev: true, size: 15 }, RED_BTN)), 'FILL');
  row.rescale(0.72);
  const nx = AL('H', 'Nút cuộn phải', { align: 'CENTER', justify: 'CENTER', r: 22, fill: lin([['#fff6dc'], ['#f1d9a4']]), stroke: '#e8b75a', sw: 2, fx: [shadow(6, 16, 0.3)] }); size(nx, 44, 44); add(nx, ic('mui-ten-phai', 18, '#7a3d0e'));
  vp.appendChild(nx); nx.x = 374 - 52; nx.y = 230;
  const dots = AL('H', 'Chấm trang', { gap: 6, justify: 'CENTER' }); add(S.content, dots, 'FILL'); [1, 0, 0, 0].forEach((on) => add(dots, dot(on ? 'nhấn/đỏ son' : '#d8cfc4', 7)));
  return S;
}
function buildMRanked(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'Chơi · Xếp hạng');
  const big = AL('V', 'Thẻ xếp hạng', { gap: 14, align: 'CENTER', pad: [18, 18], r: 16, fill: lin([['#a51c14'], ['#6e0f0b']]), stroke: '#d9a94e', sw: 1.5, fx: [shadow(14, 30, 0.3)] }); add(S.content, big, 'FILL');
  add(big, ill('cup', 150));
  const rk = AL('V', 'Bậc hiện tại', { gap: 10, pad: [14, 14], r: 12, fill: lin([['#5a120d'], ['#3a0b08']]), stroke: '#9a4a2a' }); add(big, rk, 'FILL');
  const rr = AL('H', 'hàng', { gap: 12, align: 'CENTER' }); add(rk, rr, 'FILL'); rr.appendChild(rankBadge(60));
  const rn = AL('V', 'tên', { gap: 2 }); add(rr, rn); add(rn, T('BẬC HIỆN TẠI', 'b', 10.5, '#f2cf72', { ls: 8 })); add(rn, T('Bạc', 'serif', 22, '#ffffff')); add(rn, T('★★★☆☆', 'r', 12.5, '#ffd27a'));
  const el = AL('H', 'Elo', { gap: 8, align: 'BASELINE' }); add(rk, el); add(el, T('ELO', 'b', 11, '#f2cf72', { ls: 8 })); add(el, T('1.200', 'serif', 26, '#ffffff'));
  progress(rk, 0.5, { bg: '#2a0806', fill: lin([['#d8dde4'], ['#ffffff']], 'h') }); add(rk, T('Còn 100 Elo để lên Vàng', 'r', 12.5, '#f3dccb'));
  const tb = AL('V', 'Thời gian mỗi ván', { gap: 2, align: 'CENTER', pad: [10, 12], r: 12, fill: lin([['#2a1410'], ['#160a08']]), stroke: '#e9b44c', sw: 2 }); add(big, tb, 'FILL');
  add(tb, T('THỜI GIAN MỖI VÁN · CỐ ĐỊNH', 'b', 10.5, '#f2cf72', { ls: 8 })); add(tb, T('15p + 5s', 'serif', 30, '#ffffff'));
  TW(tb, T('15 phút mỗi bên, cộng 5 giây sau mỗi nước, tối đa 1 phút mỗi nước', 'r', 12, '#e8d6c4', { align: 'CENTER', lh: 17 }));
  TW(big, T('Thắng +20 xu, chơi trọn ván +10 xu · Elo thay đổi sau mỗi ván với tài khoản khác', 'r', 13.5, '#fbe3cf', { lh: 19 }));
  add(big, pbtn('Vào hàng chờ', Object.assign({ chev: true, size: 17, pad: [13, 18] }, GOLD_BTN)), 'FILL');
  const ft = AL('H', 'Chân', { gap: 12, align: 'CENTER', wrap: true, wrapGap: 8 }); add(big, ft, 'FILL');
  const a = AL('H', 'online', { gap: 6, align: 'CENTER' }); add(a, dot('trạng thái/xanh', 8)); const at = T('3 người đang online', 'r', 12.5, '#f3dccb'); bold(at, '3', 'b', '#ffffff'); add(a, at); add(ft, a);
  const w = AL('H', 'ước tính', { gap: 6, align: 'CENTER' }); add(w, ic('dong-ho', 13, '#f3dccb')); add(w, T('Ước tính: < 1 phút', 'r', 12.5, '#f3dccb')); add(ft, w);
  add(ft, pill('Phí 10 xu', { fill: '#f9dc8a', color: '#5a3410', st: 'b', stroke: '#c98a22' }));
  const rules = card(S.content, 'Luật xếp hạng', { pad: [20, 18] }); add(rules, T('Luật xếp hạng', 'serif', 19, 'chữ/chính'));
  const bx = AL('V', 'Hộp luật', { pad: [12, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(rules, bx, 'FILL');
  bullets(bx, [['Phí', ' 10 xu mỗi ván, trừ khi ván bắt đầu'], ['Thưởng', ' +10 xu khi chơi trọn ván, thắng thêm +10 xu'], ['Elo', ' chỉ tính khi cả hai bên đều đăng nhập'], ['Ghép trận', ' ±100 Elo, nới dần mỗi 5 giây chờ'], ['Rời bàn', ' giữa ván hoặc mất kết nối quá 90 giây bị xử thua']], { dot: 'chữ/chính' });
  return S;
}
function buildMCoin(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'Chơi · Chơi nhanh');
  const big = AL('V', 'Thẻ chơi nhanh', { gap: 12, pad: [18, 18], r: 16, fill: lin([['#fffaf0'], ['#f6ecdb']]), stroke: '#e3cfa8', sw: 1.5, fx: [shadow(12, 26, 0.12)] }); add(S.content, big, 'FILL');
  const h = AL('H', 'đầu', { align: 'CENTER' }); add(big, h, 'FILL'); add(h, T('Nhịp chơi', 'serif', 20, '#3a2416')); grow(h); add(h, coinPill('Số dư: 1.020 xu', { size: 12.5, is: 12 }));
  const opt = (icn, title, chips, sel, chipSel) => {
    const r = AL('H', title, { gap: 12, align: 'CENTER', pad: [12, 14], r: 12, fill: '#ffffff', stroke: sel ? 'nhấn/đỏ son' : '#eadfce', sw: sel ? 2 : 1 }); add(big, r, 'FILL');
    add(r, ic(icn, 19, 'nhấn/đỏ son')); const t = AL('V', 'chữ', { gap: 7 }); add(r, t, 'FILL'); add(t, T(title, 'b', 15, '#2a1a10'));
    const cs = AL('H', 'nhịp', { gap: 6 }); add(t, cs); chips.forEach((x, i) => add(cs, pill(x, i === chipSel ? { fill: 'nhấn/đỏ son', color: '#ffffff', st: 'b', size: 12.5, pad: [5, 11] } : { fill: '#ffffff', stroke: '#d8cfc4', color: 'chữ/phụ', size: 12.5, pad: [5, 11] })));
    add(r, radio(sel));
  };
  opt('choi', 'Cờ chớp', ['1+0', '3+0', '3+2'], false, -1); opt('dong-ho', 'Cờ nhanh', ['5+0', '10+0', '10+5'], true, 0);
  add(big, T('Mức đặt', 'serif', 20, '#3a2416'));
  const st = AL('H', 'Mức đặt', { gap: 10, wrap: true }); add(big, st, 'FILL');
  ['50 xu', '100 xu', '200 xu', '500 xu'].forEach((v, i) => { const b = AL('H', v, { align: 'CENTER', justify: 'CENTER', pad: [13, 10], r: 8, fill: i === 0 ? lin([['#f9dc8a'], ['#e9b44c']]) : '#fffaf0', stroke: i === 0 ? '#c98a22' : '#eadfce' }); add(st, b); fixW(b, 146); add(b, T(v, 'b', 15, i === 0 ? '#5a3410' : '#3a2416')); });
  add(big, pbtn('Vào bàn · đặt 50 xu · 5+0', Object.assign({ chev: true, size: 16, pad: [13, 14] }, RED_BTN)), 'FILL');
  TW(big, T('Có bàn đang chờ cùng nhịp & mức đặt thì vào ngồi ngay; chưa có thì tự tạo bàn mới và chờ đối thủ.', 'r', 12.5, '#7a6656', { align: 'CENTER', lh: 18 }));
  const f = AL('H', 'Chân', { gap: 8, align: 'CENTER' }); add(big, f); add(f, ic('ban-be', 14, '#8a7563')); add(f, T('0 bàn chơi nhanh đang chờ', 'r', 13, '#6b5545'));
  const art = AL('H', 'Minh hoạ', { justify: 'CENTER' }); add(big, art, 'FILL'); add(art, ill('canhXu', 150));
  const w = card(S.content, 'Bàn đang chờ', { pad: [20, 18] }); add(w, T('Bàn đang chờ', 'serif', 19, 'chữ/chính')); TW(w, T('Chưa có bàn nào đang chờ — bấm "Vào bàn" để mở bàn đầu tiên.', 'r', 13.5, 'chữ/mờ', { lh: 20 }));
  const ru = card(S.content, 'Luật chơi nhanh', { pad: [20, 18] }); add(ru, T('Luật chơi nhanh', 'serif', 19, 'chữ/chính'));
  const bx = AL('V', 'Hộp luật', { pad: [12, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(ru, bx, 'FILL');
  bullets(bx, [['Thắng', ' +mức đặt · Thua −mức đặt · Hoà hoàn nguyên'], 'Chỉ chọn được mức đặt không vượt quá số dư', ['Bỏ trận', ' hoặc mất kết nối quá 90 giây bị xử thua'], 'Xu chỉ dùng trong Tượng Kỳ, không quy đổi tiền thật'], { dot: 'chữ/chính' });
  return S;
}
function buildMTables(name) {
  const S = mShell(name, { h: 844 });
  mEyebrow(S.content, 'Chơi · Bàn đấu');
  const box = AL('V', 'Danh sách bàn', { gap: 12, pad: [16, 14], r: 16, fill: lin([['#231a15'], ['#15100d']]), stroke: '#4a3a30', fx: [shadow(14, 30, 0.3)] }); add(S.content, box, 'FILL');
  [['Đang chơi', 'Minh Quân', 'Thu Hà', 'Xếp hạng · 15+5', 'trạng thái/xanh', 'Xem'], ['Đang chơi', 'Minh Quân', 'Thu Hà', 'Xếp hạng · 15+5', 'trạng thái/xanh', 'Xem'], ['Đang chờ', 'Văn Long', null, 'Chơi nhanh · 5+0 · 100 xu', '#e9b44c', 'Vào bàn'], ['Sẵn sàng', 'Hải Đăng', 'Bảo Ngọc', 'Phòng riêng · 10+0', '#5b8def', 'Xem']].forEach((t) => {
    const c = AL('H', 'Bàn · ' + t[1], { gap: 12, align: 'CENTER', pad: [12, 12], r: 14, fill: lin([['#2a1f19'], ['#1a130f']]), stroke: '#4a3a30' }); add(box, c, 'FILL');
    add(c, boardInst(78));
    const r = AL('V', 'Thông tin', { gap: 5 }); add(c, r, 'FILL');
    const s = AL('H', 'Trạng thái', { gap: 6, align: 'CENTER' }); add(s, dot(t[4], 7)); add(s, T(t[0], 'b', 12, '#f1e7da')); add(r, s);
    TW(r, T(t[1] + (t[2] ? '  vs  ' + t[2] : '  ·  chờ đối thủ'), 'b', 14, '#ffffff'));
    add(r, T(t[3], 'r', 12, '#cbbfb2'));
    add(r, pbtn(t[5], Object.assign({ size: 13, pad: [6, 12], chev: true }, t[5] === 'Xem' ? DARK_BTN : RED_BTN)));
  });
  return S;
}
function buildMRoom(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'Chơi · Chơi với bạn', { line: false });
  const L = card(S.content, 'Tạo phòng', { gap: 12, pad: [18, 18] });
  cardHead(L, 'Tạo phòng', 'Phòng riêng không tính Elo.', pill('Phòng riêng'), { size: 16 });
  field(L, 'Nhịp chơi', '10 phút', { select: true }); field(L, 'Thời gian mỗi nước', '1 phút', { select: true }); field(L, 'Thời gian cộng', '5 giây', { select: true });
  add(L, T('Màu quân của bạn', 'sb', 13.5, 'chữ/chính'));
  const col = AL('H', 'Màu', { gap: 8 }); add(L, col, 'FILL');
  [['Đỏ', 'nhấn/đỏ son'], ['Đen', '#1d1612'], ['Ngẫu nhiên', null]].forEach((x, i) => { const b = AL('H', x[0], { gap: 8, align: 'CENTER', justify: 'CENTER', pad: [11, 6], r: 8, fill: i === 0 ? 'nhấn/đỏ nhạt' : '#ffffff', stroke: i === 0 ? 'nhấn/đỏ son' : '#d8cfc4' }); add(col, b, 'FILL'); if (x[1]) add(b, dot(x[1], 10)); add(b, T(x[0], 'b', 14.5, i === 0 ? 'nhấn/đỏ son' : 'chữ/chính')); });
  add(L, T('Luật phòng', 'sb', 13.5, 'chữ/chính'));
  [['Cho người xem', 'Người có link xem trực tiếp, hiện ở Trận đấu hot', true], ['Cho phép đi lại', 'Xin đi lại, đối thủ đồng ý thì lùi nước', false]].forEach((x) => { const r = AL('H', x[0], { gap: 12, align: 'CENTER', pad: [12, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, r, 'FILL'); const t = AL('V', 'chữ', { gap: 3 }); add(r, t, 'FILL'); add(t, T(x[0], 'b', 14, 'chữ/chính')); TW(t, T(x[1], 'r', 12, 'chữ/mờ', { lh: 17 })); add(r, toggle(x[2])); });
  add(L, pbtn('Tạo phòng & lấy link mời', { icon: 'lien-ket', size: 15.5, pad: [13, 16] }), 'FILL');
  const j = card(S.content, 'Nhập mã phòng'); cardHead(j, 'Nhập mã phòng', 'Mã 5 ký tự bạn bè gửi, hoặc mở thẳng link mời.', null, { size: 16 });
  const jr = AL('H', 'Nhập', { gap: 8 }); add(j, jr, 'FILL'); add(jr, input('VD: K7QX2', { ph: true }), 'FILL'); add(jr, pbtn('Vào phòng', { size: 14.5 }));
  const inv = card(S.content, 'Mời kỳ hữu'); cardHead(inv, 'Mời kỳ hữu', 'Tạo phòng và gửi lời mời trực tiếp cho bạn bè.', null, { size: 16 });
  const it = T('Chưa có kỳ hữu — tìm bạn bè', 'r', 14, 'chữ/chính'); add(inv, it); it.setRangeTextDecoration(it.characters.indexOf('tìm'), it.characters.length, 'UNDERLINE');
  return S;
}
// ---------- AI ----------
function buildMAnalysis(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, ['Phân tích', 'Đấu với AI', 'Cờ thế', 'Lịch sử'], 0);
  const bw = AL('H', 'Bàn', { justify: 'CENTER' }); add(S.content, bw, 'FILL'); add(bw, framedBoard(330, { arrows: [[1, 7, 4, 7, 0.9], [7, 7, 5, 7, 0.45]] }));
  const tb = AL('H', 'Thanh công cụ', { gap: 6, wrap: true, wrapGap: 8, justify: 'CENTER' }); add(S.content, tb, 'FILL');
  const sq = (icn) => { const b = AL('H', 'nút', { align: 'CENTER', justify: 'CENTER', r: 7, fill: '#ffffff', stroke: 'viền/mảnh' }); size(b, 34, 34); add(b, ic(icn, 15, 'chữ/chính')); return b; };
  ['ve-dau', 'lui', 'tiep', 've-cuoi'].forEach((k) => add(tb, sq(k)));
  ['Lật bàn', 'Bàn mới', 'Bày thế cờ', 'Lưu', 'Chia sẻ'].forEach((t) => add(tb, pbtn(t, t === 'Lưu' ? { size: 13.5, pad: [7, 10], r: 7 } : { size: 13.5, pad: [7, 10], r: 7, fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính' })));
  const R = card(S.content, 'Engine phân tích', { gap: 12, pad: [18, 18] });
  const eh = AL('H', 'đầu', { align: 'CENTER' }); add(R, eh, 'FILL'); add(eh, T('Engine phân tích', 'b', 16, 'chữ/chính')); grow(eh); add(eh, toggle(true));
  add(R, input('Pikafish (server)', { select: true }), 'FILL');
  const op = AL('H', 'tuỳ chọn', { gap: 14, align: 'CENTER' }); add(R, op); add(op, input('3 phương án', { select: true }));
  const cb = AL('H', 'mũi tên', { gap: 6, align: 'CENTER' }); add(cb, check(true, '#2f6fde')); add(cb, T('Mũi tên', 'r', 14, 'chữ/phụ')); add(op, cb);
  const ev = AL('H', 'điểm', { gap: 12, align: 'BASELINE' }); add(R, ev); add(ev, T('+0.28', 'xb', 28, 'chữ/chính')); add(ev, T('Cân bằng', 'sb', 15, 'chữ/phụ'));
  add(R, T('Độ sâu 20/31  1.8M nút  926k/giây  2.0 giây', 'r', 12.5, 'chữ/mờ'));
  engineLine(R, 'P8-5', 'Tốt nhất', true, '+0.28', 0.53, 'M2.3 M8.7 B3.1 X9-8 X1-2 X8.6 M8.7 M2.3 B7.1', 20);
  engineLine(R, 'P2-5', 'Tốt', false, '+0.17', 0.52, 'M8.7 M2.3 B7.1 M8.7 M2.3 B5.1', 19);
  const bb = card(S.content, 'Biên bản', { gap: 6 }); add(bb, T('Biên bản', 'b', 16, 'chữ/chính')); add(bb, T('Bấm nước để quay lại', 'r', 12.5, 'chữ/mờ'));
  TW(bb, T('Chưa có nước nào — đi quân trên bàn để bắt đầu.', 'r', 13.5, 'chữ/mờ', { lh: 20 }));
  const tt = card(S.content, 'Thế trận', { gap: 10 }); const th = AL('H', 'đầu', {}); add(tt, th, 'FILL'); add(th, T('Thế trận', 'b', 16, 'chữ/chính')); grow(th); add(th, T('+0.28', 'b', 15, 'chữ/chính'));
  const g = evalGraph(316, 130); add(tt, g, 'FILL');
  return S;
}
function buildMAiPlay(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, ['Phân tích', 'Đấu với AI', 'Cờ thế', 'Lịch sử'], 1);
  const L = card(S.content, 'Chọn cấp độ AI', { gap: 10, pad: [18, 16] });
  add(L, T('Chọn cấp độ AI', 'b', 16, 'chữ/chính'));
  const g = AL('H', 'Cấp độ', { gap: 10, wrap: true }); add(L, g, 'FILL');
  const LV = [['Tập sự', '~800 Elo'], ['Nhập môn', '~1.000 Elo'], ['Kỳ hữu', '~1.200 Elo'], ['Trung cấp', '~1.400 Elo'], ['Cao cấp', '~1.600 Elo'], ['Kiện tướng', '~1.800 Elo'], ['Đại kiện tướng', '~2.000 Elo'], ['Kỳ vương', '~2.200 Elo'], ['Vô đối', '3.000+ Elo · Pikafish']];
  LV.forEach((l, i) => {
    const on = i === 3;
    const c = AL('V', 'Cấp ' + (i + 1), { gap: 3, pad: [10, 12], r: 10, fill: on ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ', stroke: on ? 'nhấn/đỏ son' : 'viền/mảnh' }); add(g, c); fixW(c, i === 8 ? 326 : 158);
    const h2 = AL('H', 'đầu', {}); add(c, h2, 'FILL'); add(h2, T('Cấp ' + (i + 1), 'r', 12.5, on ? 'nhấn/đỏ son' : 'chữ/mờ'));
    if (on) { grow(h2); const k = AL('H', 'đã chọn', { align: 'CENTER', justify: 'CENTER', r: 9, fill: 'nhấn/đỏ son' }); size(k, 18, 18); add(k, ic('dung', 12, '#ffffff')); add(h2, k); }
    add(c, T(l[0], 'b', 14.5, on || i === 8 ? 'nhấn/đỏ son' : 'chữ/chính')); add(c, T(l[1], 'r', 12.5, 'chữ/mờ'));
  });
  const info = AL('H', 'Gợi ý cấp', { gap: 10, align: 'MIN', pad: [11, 12], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, info, 'FILL');
  add(info, ic('thong-tin', 16, 'nhấn/đỏ son')); TW(info, T('Cấp 4 – 5: máy tính trước nhiều nước, hợp với người đã quen khai cuộc.', 'r', 13, 'chữ/phụ', { lh: 19 }));
  add(L, T('Chọn màu quân', 'b', 16, 'chữ/chính'));
  const cs = AL('H', 'Màu quân', { gap: 8 }); add(L, cs, 'FILL');
  [['Quân Đỏ', 'Đi trước', '#c61d1d'], ['Quân Đen', 'Đi sau', '#1d1612'], ['Ngẫu nhiên', 'Để máy chọn', null]].forEach((x, i) => {
    const b = AL('V', x[0], { gap: 5, align: 'CENTER', pad: [14, 6], r: 10, fill: i === 0 ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ', stroke: i === 0 ? 'nhấn/đỏ son' : 'viền/mảnh' }); add(cs, b, 'FILL');
    const d = FR('quân', 24, 24, { r: 12, stroke: '#ffffff', sw: 2, fill: x[2] ? x[2] : lin([['#c61d1d', 0], ['#c61d1d', 0.5], ['#1d1612', 0.5], ['#1d1612', 1]], 'h') }); add(b, d);
    add(b, T(x[0], 'b', 14, i === 0 ? 'nhấn/đỏ son' : 'chữ/chính')); add(b, T(x[1], 'r', 12, 'chữ/mờ'));
  });
  const tg = AL('H', 'Gợi ý & đi lại', { gap: 12, align: 'CENTER', pad: [12, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(L, tg, 'FILL');
  const tt = AL('V', 'chữ', { gap: 3 }); add(tg, tt, 'FILL'); add(tt, T('Gợi ý & đi lại', 'b', 14, 'chữ/chính')); TW(tt, T('Cho phép xin gợi ý nước đi và đi lại khi chơi với máy', 'r', 12, 'chữ/mờ', { lh: 17 })); add(tg, toggle(true));
  add(L, pbtn('Bắt đầu đấu máy', { icon: 'ai', size: 15.5, pad: [13, 16] }), 'FILL');
  const pb = card(S.content, 'Bàn cờ luyện tập'); cardHead(pb, 'Bàn cờ luyện tập', 'Cấp 4 · Trung cấp — ước tính ~1.400 Elo', null, { size: 16 });
  add(pb, boardInst(318));
  const ch = AL('H', 'nhãn', { gap: 8, wrap: true, wrapGap: 6 }); add(pb, ch, 'FILL'); add(ch, pill('Cấp 4 · Trung cấp', { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 12.5 })); add(ch, pill('Quân Đỏ', { size: 12.5 })); add(ch, pill('Có gợi ý & đi lại', { size: 12.5 }));
  return S;
}
function buildMPuzzles(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'AI', { line: false });
  tabsU(S.content, ['Phân tích', 'Đấu với AI', 'Cờ thế', 'Lịch sử'], 2);
  tabsSeg(S.content, ['Tất cả', 'Dễ', 'Vừa', 'Khó'], 0);
  const f = AL('H', 'Bộ lọc', { gap: 10, align: 'CENTER', wrap: true, wrapGap: 10 }); add(S.content, f, 'FILL');
  const c1 = AL('H', 'chưa giải', { gap: 8, align: 'CENTER' }); add(c1, check(false)); add(c1, T('Chỉ bài chưa giải', 'r', 13.5, 'chữ/phụ')); add(f, c1);
  add(f, input('Mọi chủ đề', { select: true, pad: [7, 10], size: 13 }));
  add(f, T('Đã giải 0/5 bài', 'r', 13.5, 'chữ/mờ'));
  add(f, pbtn('Tiếp tục bài gần nhất', { icon: 'mui-ten-phai', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 13, pad: [7, 12] }));
  const g = AL('H', 'Danh sách thế cờ', { gap: 12, wrap: true }); add(S.content, g, 'FILL');
  PUZ.forEach((p) => {
    const c = card(g, p[0], { h: 'FIXED', gap: 6, pad: [0, 0, 12, 0] }); fixW(c, 173); c.clipsContent = true;
    add(c, woodBoard(173, p[3], { r: 0 }));
    const t = AL('V', 'chữ', { gap: 6, pad: [6, 10, 0, 10] }); add(c, t, 'FILL');
    TW(t, T(p[0], 'b', 13.5, 'chữ/chính', { lh: 18 }));
    const m = AL('H', 'nhãn', { gap: 5, wrap: true, wrapGap: 5 }); add(t, m, 'FILL');
    add(m, pill(p[1], p[1] === 'Dễ' ? { fill: '#e3f4e8', color: '#2e9e5b', st: 'b', size: 11.5 } : { fill: '#fdf1d6', color: '#b07c12', st: 'b', size: 11.5 })); add(m, pill('Chiếu bí', { st: 'b', size: 11.5 }));
    add(t, T('Đỏ đi · ' + p[2], 'r', 12, 'chữ/mờ'));
  });
  return S;
}
// ---------- Xếp hạng, Túi đồ, Hồ sơ ----------
function buildMRanking(name) {
  const S = mShell(name);
  mEyebrow(S.content, 'Bảng xếp hạng', { line: false });
  const ts = AL('H', 'Tab', { gap: 4, pad: [5, 5], r: 12, fill: 'nền/thẻ', stroke: 'viền/mảnh', wrap: true, wrapGap: 4 }); add(S.content, ts, 'FILL');
  ['Elo', 'Bạn bè', 'Danh vọng mùa', 'Chuỗi thắng', 'Chơi nhanh', 'Cờ thế'].forEach((t, i) => { const c = AL('H', t, { pad: [8, 13], r: 9, fill: i === 0 ? 'nhấn/đỏ nhạt' : null }); add(c, T(t, i === 0 ? 'b' : 'sb', 14, i === 0 ? 'nhấn/đỏ son' : 'chữ/phụ')); add(ts, c); });
  add(S.content, T('128 kỳ thủ trên bảng', 'r', 13.5, 'chữ/phụ'));
  const pod = AL('H', 'Top 3', { gap: 8 }); add(S.content, pod, 'FILL');
  [['#1', 'Văn Long', 'VL', '2.184', true], ['#2', 'Minh Quân', 'MQ', '2.031'], ['#3', 'Thu Hà', 'TH', '1.968']].forEach((p) => {
    const dark = !!p[4];
    const c = AL('V', 'Hạng ' + p[0], { gap: 8, align: 'CENTER', pad: [12, 8], r: 14, fill: dark ? lin([['#2a1f19'], ['#15100d']]) : 'nền/thẻ', stroke: dark ? null : 'viền/mảnh' }); add(pod, c, 'FILL');
    add(c, T(p[0], 'b', 12.5, dark ? '#f2cf72' : 'chữ/chính'));
    add(c, avatar(p[2], 40, { fill: dark ? 'nhấn/đỏ son' : 'nhấn/đỏ nhạt', color: dark ? '#ffffff' : 'nhấn/đỏ son', size: 14 }));
    add(c, T(p[1], 'b', 13, dark ? '#ffffff' : 'chữ/chính')); add(c, T(p[3], 'xb', 20, dark ? '#ffffff' : 'chữ/chính'));
  });
  const tb = card(S.content, 'Bảng', { gap: 0, pad: [0, 0] }); tb.clipsContent = true;
  const cols = [['Hạng', 52], ['Kỳ thủ', 0], ['Elo', 70]];
  const rowOf = (v, head, me) => {
    const r = AL('H', head ? 'Tiêu đề' : 'Dòng', { align: 'CENTER', pad: [head ? 11 : 10, 14], fill: head ? 'nền/thẻ phụ' : (me ? 'nhấn/đỏ nhạt' : null) }); add(tb, r, 'FILL');
    cols.forEach((c, i) => { const cell = AL('H', c[0], { gap: 8, align: 'CENTER', justify: i === 2 ? 'MAX' : 'MIN' }); add(r, cell, c[1] ? null : 'FILL'); if (c[1]) fixW(cell, c[1]); if (!head && i === 1) add(cell, avatar(v[3], 26, { r: 7, size: 10.5 })); add(cell, T(v[i], head ? 'sb' : (i ? 'b' : 'r'), head ? 12.5 : 14, head ? 'chữ/phụ' : (me ? 'nhấn/đỏ son' : 'chữ/chính'))); });
  };
  rowOf(['Hạng', 'Kỳ thủ', 'Elo'], true);
  [['4', 'Hải Đăng', '1.942', 'HĐ'], ['5', 'Bảo Ngọc', '1.903', 'BN'], ['6', 'Quốc Bảo', '1.880', 'QB'], ['12', 'Kỳ thủ Tượng (bạn)', '1.200', 'KT']].forEach((v, i) => rowOf(v, false, i === 3));
  const how = card(S.content, 'Cách tính Elo'); add(how, ic('thong-tin', 20, 'nhấn/đỏ son')); add(how, T('Cách tính Elo', 'b', 16, 'chữ/chính'));
  TW(how, T('Mọi tài khoản bắt đầu với 1.200 Elo. Thắng người Elo cao hơn được cộng nhiều hơn; hệ số K = 32. Ván có khách tham gia không tính Elo.', 'r', 13.5, 'chữ/phụ', { lh: 20 }));
  return S;
}
function buildMBag(name, shop) {
  const S = mShell(name);
  mEyebrow(S.content, shop ? 'Cửa hàng' : 'Túi đồ', { line: false, right: coinPill('1.020 xu', { size: 13.5 }) });
  tabsU(S.content, ['Túi đồ', 'Cửa hàng'], shop ? 1 : 0);
  tabsSeg(S.content, ['Bàn cờ', 'Quân cờ', 'Đồng hồ'], 0, { fill: true });
  const h = AL('H', 'đầu', {}); add(S.content, h, 'FILL'); add(h, T('Bàn cờ', 'b', 16, 'chữ/chính')); grow(h); add(h, T(shop ? '5 vật phẩm chưa sở hữu' : '3 vật phẩm đã sở hữu', 'r', 13, 'chữ/mờ'));
  const g = AL('H', 'Vật phẩm', { gap: 12, wrap: true }); add(S.content, g, 'FILL');
  (shop ? SHOP_BOARDS.slice(0, 6) : SHOP_BOARDS.slice(0, 3)).forEach((it) => {
    const sel = !!it[4];
    const c = card(g, it[0], { h: 'FIXED', gap: 8, pad: [10, 10], stroke: sel ? 'nhấn/đỏ son' : 'viền/mảnh' }); fixW(c, 173);
    add(c, thumb(it[2], 153));
    add(c, T(it[0], 'b', 14, 'chữ/chính')); TW(c, T(it[1], 'r', 12, 'chữ/mờ', { lh: 16 }));
    const pr = it[3];
    if (pr === 'Đang dùng') add(c, pill(pr, { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 12 }));
    else if (pr === 'Miễn phí') add(c, pill(pr, { st: 'b', size: 12 }));
    else { const x = AL('H', 'giá', { gap: 5, align: 'CENTER' }); add(x, ic('xu', 13, '#c99a2e')); add(x, T(pr + ' xu', 'b', 13.5, '#a0761a')); add(c, x); }
  });
  const R = card(S.content, 'Xem trước', { gap: 10, pad: [16, 16] });
  const rh = AL('H', 'đầu', {}); add(R, rh, 'FILL'); add(rh, T('Xem trước', 'b', 16, 'chữ/chính')); grow(rh); add(rh, pill('Đang dùng', { st: 'b' }));
  const pv = AL('V', 'Bàn xem trước', { gap: 10, align: 'CENTER' }); add(R, pv, 'FILL'); add(pv, clockBox('09:58')); add(pv, boardInst(310)); add(pv, clockBox('09:54', true));
  [['Bàn cờ', 'Theo Tượng Kỳ'], ['Quân cờ', 'Theo Tượng Kỳ'], ['Đồng hồ', 'Cổ điển']].forEach((kv) => { const r = AL('H', kv[0], {}); add(R, r, 'FILL'); add(r, T(kv[0], 'r', 13, 'chữ/mờ')); grow(r); add(r, T(kv[1], 'b', 13, 'chữ/chính')); });
  add(R, pbtn('Đang trang bị', { fill: '#e08a85' }), 'FILL');
  return S;
}
function buildMProfile(name) {
  const S = mShell(name);
  const pc = card(S.content, 'Thẻ kỳ thủ', { gap: 14, pad: [18, 16] });
  const top = AL('H', 'đầu', { gap: 14, align: 'CENTER' }); add(pc, top, 'FILL'); add(top, avatar('KT', 84, { r: 20, size: 30 }));
  const info = AL('V', 'chữ', { gap: 5 }); add(top, info, 'FILL'); add(info, T('Kỳ thủ Tượng', 'b', 22, 'chữ/chính')); TW(info, T('@kythutuong · Chưa đặt khu vực · Tham gia 14/10/2026', 'r', 12.5, 'chữ/mờ', { lh: 17 })); add(info, pill('Bạc 3★', { fill: 'nhấn/đỏ nhạt', color: 'nhấn/đỏ son', st: 'b', size: 12 }));
  hr(pc);
  const st = AL('H', 'Chỉ số', { gap: 8 }); add(pc, st, 'FILL');
  [['Elo', '1.200', 'nhấn/đỏ son'], ['Xu', '1.020', '#c99a2e'], ['Uy tín', '1.000', '#d8cfc4'], ['Chuỗi thắng', '0', '#d8cfc4']].forEach((x) => { const b = AL('V', x[0], { gap: 3, pad: [0, 0, 7, 0] }); add(st, b, 'FILL'); b.strokes = [fp(x[2])]; b.strokeTopWeight = 0; b.strokeLeftWeight = 0; b.strokeRightWeight = 0; b.strokeBottomWeight = 2; add(b, T(x[0], 'r', 12, 'chữ/phụ')); add(b, T(x[1], 'xb', 16, 'chữ/chính')); });
  const two = AL('H', 'Thống kê', { gap: 12 }); add(S.content, two, 'FILL');
  [[['Số trận', '0'], ['Tỉ lệ thắng', '—'], '0 thắng · 0 hoà · 0 thua'], [['Elo cao nhất', '1.200'], ['Hạng', '—'], '0 online · 0 đấu máy']].forEach((x) => { const c = card(two, x[0][0], { gap: 6, pad: [14, 14] }); const r = AL('H', 'số', { gap: 8 }); add(c, r, 'FILL'); [x[0], x[1]].forEach((kv) => { const b = AL('V', kv[0], { gap: 3 }); add(r, b, 'FILL'); TW(b, T(kv[0], 'r', 12, 'chữ/phụ')); add(b, T(kv[1], 'xb', 21, 'chữ/chính')); }); TW(c, T(x[2], 'r', 12, 'chữ/mờ')); });
  const menu = card(S.content, 'Menu hồ sơ', { gap: 0, pad: [10, 10] });
  const cols = AL('H', 'Hai cột', { gap: 8 }); add(menu, cols, 'FILL');
  const mk = (items) => { const v = AL('V', 'cột', { gap: 8 }); add(cols, v, 'FILL'); items.forEach((it) => { const on = !!it[2]; const b = AL('H', it[1], { gap: 8, align: 'CENTER', pad: [11, 10], r: 8, fill: on ? 'nhấn/đỏ son' : 'nền/thẻ phụ', stroke: on ? null : 'viền/mảnh' }); add(v, b, 'FILL'); add(b, ic(it[0], 15, on ? '#ffffff' : (it[3] || 'chữ/chính'))); TW(b, T(it[1], 'sb', 13.5, on ? '#ffffff' : (it[3] || 'chữ/chính'))); }); };
  mk([['kiem', 'Lịch sử đấu', true], ['bieu-do', 'Biến thiên Elo'], ['luoi', 'Theo chế độ'], ['giai-dau', 'Thành tích'], ['tui-do', 'Bộ trang bị']]);
  mk([['sao', 'Mục tiêu'], ['sua', 'Chỉnh sửa hồ sơ'], ['chia-se', 'Mời bạn bè'], ['tro-chuyen', 'Trợ giúp & góp ý'], ['dang-xuat', 'Đăng xuất', false, 'nhấn/đỏ son']]);
  const R = card(S.content, 'Lịch sử đấu', { gap: 0, pad: [16, 14] }); add(R, T('Lịch sử đấu', 'b', 16, 'chữ/chính')); spacer(R, 10);
  const th = AL('H', 'Tiêu đề', { pad: [10, 12], fill: 'nền/thẻ phụ' }); add(R, th, 'FILL');
  [['Đối thủ', 0], ['Kết quả', 120], ['Elo', 44]].forEach((c) => { const w = AL('H', c[0]); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], 'sb', 12.5, 'chữ/phụ')); });
  [['Minh Quân', 'Thắng · chiếu bí', '+16'], ['Máy (Cấp 4)', 'Thua · đầu hàng', '—'], ['Thu Hà', 'Hoà', '0']].forEach((v) => {
    const r = AL('H', 'Dòng', { pad: [11, 12], align: 'CENTER' }); add(R, r, 'FILL'); r.strokes = [fp('viền/mảnh')]; r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1;
    [0, 120, 44].forEach((w, i) => { const cell = AL('H', 'ô'); add(r, cell, w ? null : 'FILL'); if (w) fixW(cell, w); const col = i === 1 ? (v[1][0] === 'T' && v[1][1] === 'h' && v[1][2] === 'ắ' ? 'trạng thái/xanh' : v[1].indexOf('Thua') === 0 ? 'nhấn/đỏ son' : 'chữ/phụ') : (i === 2 && v[2][0] === '+' ? 'trạng thái/xanh' : 'chữ/chính'); add(cell, T(v[i], 'sb', 13.5, col)); });
  });
  return S;
}
// ---------- Trong trận & kết quả ----------
function mStrip(p, o) {
  const s = AL('V', 'Kỳ thủ · ' + o.name, { gap: 8, pad: [10, 12], r: 12, fill: o.me ? 'nhấn/đỏ nhạt' : 'nền/thẻ', stroke: o.me ? 'nhấn/đỏ son' : 'viền/mảnh' }); add(p, s, 'FILL');
  const r = AL('H', 'hàng', { gap: 10, align: 'CENTER' }); add(s, r, 'FILL');
  const ring = AL('H', 'Vòng thời gian', { align: 'CENTER', justify: 'CENTER', r: 11, stroke: o.me ? '#2bb35a' : 'viền/mảnh', sw: o.me ? 3 : 1 }); size(ring, 48, 48); add(r, ring);
  ring.appendChild(avatar(o.ini, 40, { r: 9, fill: o.ai ? lin([['#33476e'], ['#1d2a46']]) : 'nhấn/đỏ son', color: '#ffffff', size: 14 }));
  const d = dot(o.me ? '#c61d1d' : '#1d1612', 12); d.strokes = [solid('#ffffff')]; d.strokeWeight = 2; ring.appendChild(d); d.layoutPositioning = 'ABSOLUTE'; d.x = 38; d.y = 38;
  const t = AL('V', 'chữ', { gap: 2 }); add(r, t, 'FILL'); add(t, T(o.name, 'b', 15, 'chữ/chính')); add(t, T(o.sub, 'r', 12, 'chữ/mờ'));
  if (o.clock) add(r, clockPair(o.clock[0], o.clock[1], o.me)); else add(r, T('Chưa ăn quân nào', 'r', 11.5, 'chữ/mờ'));
  return s;
}
function buildMGame(name, online) {
  const S = mShell(name, { gap: 12 });
  mEyebrow(S.content, online ? 'Xếp hạng · 15p + 5s' : 'Đấu máy · Cấp 4 · Trung cấp', { line: false });
  add(S.content, T(online ? 'Ván cờ đang diễn ra.' : 'Rèn kỹ nghệ cùng máy.', 'serif', 23, 'chữ/chính'));
  add(S.content, T(online ? 'Tối đa 1 phút mỗi nước · Elo ±16' : 'Máy Cấp 4 · Trung cấp · có gợi ý & đi lại', 'r', 13, 'chữ/mờ'));
  mStrip(S.content, online ? { name: 'Minh Quân', ini: 'MQ', sub: 'Elo 1.215 · Đen', clock: ['14:21', '0:60'] } : { name: 'Máy (Cấp 4)', ini: 'AI', ai: true, sub: 'Máy · Cấp 4 · Trung cấp' });
  const bw = AL('H', 'Bàn', { justify: 'CENTER' }); add(S.content, bw, 'FILL'); add(bw, framedBoard(344, { name: 'Bàn cờ' }));
  mStrip(S.content, online ? { name: 'Kỳ thủ Tượng (bạn)', ini: 'KT', sub: 'Elo 1.200 · Đỏ', me: true, clock: ['14:52', '0:47'] } : { name: 'Kỳ thủ Tượng (bạn)', ini: 'KT', sub: 'Elo 1.200 · Bạc 3★', me: true });
  const ac = card(S.content, 'Thao tác', { gap: 10, pad: [14, 14] });
  const turn = AL('H', 'Lượt', { gap: 8, align: 'CENTER', pad: [11, 14], r: 10, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(ac, turn, 'FILL'); add(turn, dot('nhấn/đỏ son', 10)); add(turn, T('Đến lượt bạn.', 'b', 14.5, 'chữ/chính'));
  const r = AL('H', 'nút', { gap: 10 }); add(ac, r, 'FILL');
  add(r, pbtn(online ? 'Xin hoà' : 'Gợi ý', { icon: online ? 'cau-hoa' : 'goi-y', fill: '#ffffff', stroke: 'viền/mảnh', color: 'chữ/chính', size: 14.5 }), 'FILL');
  add(r, pbtn('Đầu hàng', { icon: 'dau-hang', fill: '#ffffff', stroke: 'viền/mảnh', color: 'nhấn/đỏ son', size: 14.5 }), 'FILL');
  if (!online) { const l = AL('H', 'rời', { justify: 'CENTER' }); add(ac, l, 'FILL'); add(l, pbtn('Rời bàn', { icon: 'dang-xuat', fill: solid('#ffffff', 0), color: 'chữ/chính', size: 14.5 })); }
  const hc = card(S.content, 'Lịch sử nước đi', { gap: 10, pad: [14, 14] });
  const hh = AL('H', 'đầu', { align: 'CENTER', gap: 8 }); add(hc, hh, 'FILL'); add(hh, T('Lịch sử nước đi', 'b', 15.5, 'chữ/chính')); grow(hh); add(hh, input('Ván 1 (đang chơi)', { select: true, pad: [5, 8], size: 12.5 }));
  const th = AL('H', 'tiêu đề', { pad: [7, 10], r: 6, fill: 'nền/thẻ phụ' }); add(hc, th, 'FILL'); [['#', 40], ['Đỏ', 120], ['Đen', 0]].forEach((c) => { const w = AL('H', c[0]); add(th, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], 'sb', 12.5, 'chữ/phụ')); });
  if (online) [['1.', 'P2-5', 'M8.7'], ['2.', 'M2.3', 'X9-8']].forEach((m) => { const rr = AL('H', 'nước', { pad: [5, 10] }); add(hc, rr, 'FILL'); [[m[0], 40], [m[1], 120], [m[2], 0]].forEach((c) => { const w = AL('H', 'ô'); add(rr, w, c[1] ? null : 'FILL'); if (c[1]) fixW(w, c[1]); add(w, T(c[0], c[1] === 40 ? 'r' : 'b', 13.5, 'chữ/chính')); }); });
  else { const e = AL('H', 'trống', { justify: 'CENTER', pad: [14, 0] }); add(hc, e, 'FILL'); add(e, T('Chưa có nước đi nào.', 'r', 13.5, 'chữ/phụ')); }
  if (!online) {
    const an = card(S.content, 'Máy phân tích', { gap: 10, pad: [14, 14] });
    const ah = AL('H', 'đầu', { align: 'CENTER' }); add(an, ah, 'FILL'); const al = AL('V', 'chữ', { gap: 2 }); add(ah, al, 'FILL'); add(al, T('Máy phân tích', 'b', 15.5, 'chữ/chính')); TW(al, T('Các nước tốt cho bạn — bấm để xem mũi tên', 'r', 12, 'chữ/mờ')); add(ah, toggle(true));
    const ev = AL('H', 'điểm', { gap: 12, align: 'BASELINE' }); add(an, ev); add(ev, T('+0.3', 'xb', 22, 'chữ/chính')); add(ev, T('Thế cờ cân bằng', 'r', 13, 'chữ/phụ'));
    progress(an, 0.53, { h: 5, bg: '#1d1612', fill: solid('#c61d1d') });
    [['1', 'B7.1', '+0.3', 'P2-3 P2-5 T3.5 M8.9 B7.1 X9-8'], ['2', 'P8-5', '+0.2', 'M2.3']].forEach((l) => { const b = AL('H', 'phương án', { gap: 10, pad: [8, 12], r: 8, fill: 'nền/thẻ phụ', stroke: 'viền/mảnh' }); add(an, b, 'FILL'); add(b, T(l[0], 'r', 13, 'chữ/mờ')); const t = AL('V', 'chữ', { gap: 2 }); add(b, t, 'FILL'); add(t, T(l[1], 'b', 14, 'chữ/chính')); TW(t, T(l[3], 'r', 12, 'chữ/mờ')); add(b, T(l[2], 'b', 13.5, 'chữ/chính')); });
  } else {
    const ch = card(S.content, 'Trò chuyện', { gap: 8, pad: [14, 14] }); add(ch, T('Trò chuyện', 'b', 15.5, 'chữ/chính'));
    [['Minh Quân', 'Chào bạn, chơi vui nhé!'], ['Bạn', 'Chúc ván hay!']].forEach((m) => { const b = AL('V', 'tin', { gap: 2, pad: [8, 10], r: 10, fill: m[0] === 'Bạn' ? 'nhấn/đỏ nhạt' : 'nền/thẻ phụ' }); add(ch, b, 'FILL'); add(b, T(m[0], 'b', 12, 'chữ/phụ')); TW(b, T(m[1], 'r', 13.5, 'chữ/chính')); });
    add(ch, input('Nhắn tin…', { ph: true }), 'FILL');
  }
  return S;
}
function buildMResult(name, win) {
  const S = mShell(name, { gap: 12 });
  mEyebrow(S.content, 'Đấu máy · Cấp 4 · Trung cấp', { line: false });
  TW(S.content, T(win ? 'Thắng đẹp, giữ vững phong độ.' : 'Thua keo này, ta bày keo khác.', 'serif', 23, 'chữ/chính', { lh: 30 }));
  const gold = '#e9c77a', silver = '#d8dde4', acc = win ? gold : silver, sub = win ? '#f3d6c4' : '#b9bfca';
  const mid = AL('V', 'Thẻ kết quả', { gap: 12, align: 'CENTER', pad: [22, 18], r: 14, stroke: acc, sw: 1.5, fx: [shadow(14, 30, 0.35, '#000000')] });
  mid.fills = [win ? lin([['#7a1a12'], ['#3e0b08']]) : lin([['#2e333d'], ['#15181e']])];
  add(S.content, mid, 'FILL');
  add(mid, T(win ? 'CHIẾN THẮNG' : 'THẤT BẠI', 'serif', 28, acc, { ls: 12 }));
  const dv = AL('H', 'gạch', { gap: 6, align: 'CENTER' }); add(mid, dv); add(dv, line(70, acc)); const dm = figma.createRectangle(); dm.resize(7, 7); dm.rotation = 45; dm.fills = [fp(acc)]; add(dv, dm); add(dv, line(70, acc));
  const vs = AL('H', 'Đối đầu', { gap: 22, align: 'CENTER' }); add(mid, vs);
  const side = (ini, nm, s2, w, ai, chg) => { const c = AL('V', nm, { gap: 4, align: 'CENTER' }); add(vs, c); const crown = ic('vuong-mien', 22, gold); add(c, crown); if (!w) crown.opacity = 0; add(c, avatar(ini, 58, { r: 12, fill: ai ? lin([['#33476e'], ['#1d2a46']]) : lin([['#fffaf0'], ['#f1e2c8']]), color: ai ? '#ffffff' : 'nhấn/đỏ son', size: 20, stroke: w ? gold : '#ffffff', sw: 2 })); add(c, T(nm, 'serif', 14.5, '#ffffff')); add(c, T(s2, 'r', 12, sub)); if (chg) add(c, pill(chg, { fill: chg[0] === '+' ? '#123d24' : '#4a0f0b', stroke: chg[0] === '+' ? '#2bb35a' : '#e2574c', color: chg[0] === '+' ? '#7fe0a2' : '#ff9a90', st: 'b', size: 12 })); };
  side('KT', 'Kỳ thủ Tượng', 'Đỏ · Elo 1.200', win, false, win ? '+16 Elo' : null);
  const sc = AL('V', 'Tỉ số', { align: 'CENTER' }); add(vs, sc); add(sc, T(win ? '1–0' : '0–1', 'serif', 34, '#ffffff'));
  side('AI', 'Máy (Cấp 4)', 'Đen · Máy', !win, true, win ? '−16 Elo' : null);
  add(mid, T(win ? 'Bạn đã thắng ván đấu này!' : 'Bạn đã thua ván đấu này!', 'serif', 14.5, acc));
  const bw = AL('V', 'Bàn', { pad: [4, 4], r: 8, fill: lin([['#e9c99a'], ['#c99a62']]) }); add(mid, bw); add(bw, boardInst(150));
  add(mid, pbtn('Ván mới', { icon: 'choi', st: 'serif', size: 18, pad: [12, 16], color: win ? '#4a2c0c' : '#2a2f3a', fill: win ? lin([['#f9dc8a'], ['#e2b75a']]) : lin([['#f4f6f9'], ['#cfd5dd']]) }), 'FILL');
  hr(mid, win ? '#9a4a2a' : '#454b57');
  const lk = AL('H', 'Liên kết', { gap: 22, justify: 'CENTER', wrap: true, wrapGap: 12 }); add(mid, lk, 'FILL');
  [['bieu-do', 'Phân tích'], ['chia-se', 'Chia sẻ'], ['dang-xuat', 'Rời bàn']].forEach((x) => { const a = AL('H', x[1], { gap: 6, align: 'CENTER' }); add(a, ic(x[0], 15, '#ffffff')); add(a, T(x[1], 'b', 15, '#ffffff')); add(lk, a); });
  const c2 = card(S.content, 'Thống kê ván'); add(c2, T('Thống kê ván', 'b', 16, 'chữ/chính'));
  const sr = AL('H', 'số', { gap: 8 }); add(c2, sr, 'FILL');
  [['Số nước', '0'], ['Thời lượng', '00:03'], ['Quân bắt được', '0'], ['Lần chiếu tướng', '0']].forEach((x) => { const b = AL('V', x[0], { gap: 4 }); add(sr, b, 'FILL'); TW(b, T(x[0], 'r', 12, 'chữ/mờ')); add(b, T(x[1], 'xb', 18, 'chữ/chính')); });
  const c3 = card(S.content, 'Chỉ số ván đấu', { gap: 6 }); add(c3, T('Chỉ số ván đấu', 'b', 16, 'chữ/chính')); TW(c3, T('Ván quá ngắn để chấm điểm (cần ít nhất 8 nước).', 'r', 12.5, 'chữ/mờ'));
  const rw = FR('Biểu đồ radar', 300, 200); add(c3, rw); const rs = svg(radarSvg('#b9ab9b'), 'Lưới radar'); rw.appendChild(rs); rs.x = 0; rs.y = -10;
  [['Khai cuộc', 128, 20], ['Trung cuộc', 222, 54], ['Tàn cuộc', 222, 140], ['Chính xác', 126, 176], ['Chiến thuật', 30, 140], ['Quản lý thời gian', 8, 54]].forEach((x) => { const t = T(x[0], 'sb', 9.5, 'chữ/phụ'); rw.appendChild(t); t.x = x[1]; t.y = x[2]; });
  ['Khai cuộc', 'Trung cuộc', 'Tàn cuộc', 'Chính xác', 'Chiến thuật', 'Quản lý thời gian'].forEach((k) => { const r = AL('H', k, { pad: [6, 0] }); add(c3, r, 'FILL'); r.strokes = [fp('viền/mảnh')]; r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1; add(r, T(k, 'r', 13.5, 'chữ/chính')); grow(r); add(r, T('—', 'b', 13.5, 'chữ/chính')); });
  const c4 = card(S.content, 'Bàn cờ cuối ván', { gap: 10, fill: lin([['#fffaf0'], ['#f6ecdb']]) }); add(c4, T('Bàn cờ cuối ván', 'b', 16, 'chữ/chính'));
  add(c4, framedBoard(306)); add(c4, pill('đầu hàng', { st: 'b', size: 12 }));
  const h1 = AL('H', 'đầu', {}); add(c4, h1, 'FILL'); add(h1, T('Biểu đồ trận đấu', 'b', 15, 'chữ/chính')); grow(h1); add(h1, T('Chênh lệch quân', 'r', 12, 'chữ/mờ'));
  const chf = FR('Biểu đồ', 300, 90, { r: 8, stroke: 'viền/mảnh', fill: '#ffffff' }); add(c4, chf, 'FILL');
  add(c4, T('Ván kết thúc', 'b', 15, 'chữ/chính')); TW(c4, T('Đen (Máy (Cấp 4)) đã thắng ván đấu. Kỳ thủ Tượng đầu hàng ở nước 0.', 'r', 13, 'chữ/phụ', { lh: 19 }));
  add(c4, pbtn('Phân tích ván', { icon: 'bieu-do', size: 14.5 }), 'FILL');
  return S;
}
const M_SCREENS = [
  ['M01 · Trang chủ', (n) => buildMHome(n, false)],
  ['M02 · Trang chủ — khách', (n) => buildMHome(n, true)],
  ['M03 · Menu mở', buildMMenu],
  ['M04 · Chơi', buildMPlay],
  ['M05 · Chơi · Xếp hạng', buildMRanked],
  ['M06 · Chơi · Chơi nhanh', buildMCoin],
  ['M07 · Chơi · Bàn đấu', buildMTables],
  ['M08 · Chơi · Chơi với bạn', buildMRoom],
  ['M09 · AI · Phân tích', buildMAnalysis],
  ['M10 · AI · Đấu với AI', buildMAiPlay],
  ['M11 · AI · Cờ thế', buildMPuzzles],
  ['M12 · Bảng xếp hạng', buildMRanking],
  ['M13 · Túi đồ', (n) => buildMBag(n, false)],
  ['M14 · Cửa hàng', (n) => buildMBag(n, true)],
  ['M15 · Hồ sơ kỳ thủ', buildMProfile],
  ['M16 · Trong trận — đấu máy', (n) => buildMGame(n, false)],
  ['M17 · Trong trận — online (đồng hồ)', (n) => buildMGame(n, true)],
  ['M18 · Kết quả — Thất bại', (n) => buildMResult(n, false)],
  ['M19 · Kết quả — Chiến thắng', (n) => buildMResult(n, true)],
];

// ---------- Chạy ----------
const GROUPS = [
  ['Màn hình người chơi', [
    ['01 · Trang chủ — đã đăng nhập', (n) => buildHome(n, false)],
    ['02 · Trang chủ — khách', (n) => buildHome(n, true)],
    ['03 · Nhiệm vụ hôm nay', buildMissions],
    ['04 · Chơi', buildPlay],
    ['05 · Chơi · Xếp hạng', buildRanked],
    ['06 · Chơi · Chơi nhanh', buildCoin],
    ['07 · Chơi · Bàn đấu', buildTables],
    ['08 · Chơi · Chơi với bạn', buildRoom],
    ['09 · AI · Phân tích', buildAnalysis],
    ['10 · AI · Đấu với AI', buildAiPlay],
    ['11 · AI · Cờ thế', buildPuzzles],
    ['12 · Bảng xếp hạng', buildRanking],
    ['13 · Túi đồ', (n) => buildBag(n, false)],
    ['14 · Cửa hàng', (n) => buildBag(n, true)],
    ['15 · Hồ sơ kỳ thủ', buildProfile],
  ]],
  ['Trong trận & kết quả', [
    ['16 · Trong trận — đấu máy', (n) => buildGame(n, false)],
    ['17 · Trong trận — online (đồng hồ)', (n) => buildGame(n, true)],
    ['18 · Kết quả — Thất bại', (n) => buildResult(n, false)],
    ['19 · Kết quả — Chiến thắng', (n) => buildResult(n, true)],
  ]],
  ['Quản trị', [
    ['20 · Admin · Chức năng web', buildAdminFeatures],
    ['21 · Admin · Cài đặt hệ thống', buildAdminConfig],
    ['22 · Admin · Chế độ chơi & xu', buildAdminEconomy],
    ['23 · Admin · Bàn cờ & quân cờ', buildAdminTheme],
    ['24 · Admin · Cửa hàng vật phẩm', buildAdminShop],
  ]],
];

function errorFrame(name, e) {
  const f = AL('V', name + ' (lỗi)', { gap: 8, pad: [40, 40], fill: '#fff4f2', stroke: '#c61d1d' }); size(f, 1440, 900);
  f.setPluginData(MARK, '1');
  add(f, T('Không dựng được màn này', 'b', 28, '#c61d1d'));
  TW(f, T(String(e && e.stack || e), 'r', 14, '#3a2416', { lh: 20 }));
  return f;
}

async function setup() {
  let page = null;
  try { page = await figma.getNodeByIdAsync(PAGE_ID); } catch (e) { page = null; }
  if (!page || page.type !== 'PAGE') page = figma.root.children.find((p) => p.name.indexOf('Thiết kế sửa được') >= 0);
  if (!page) throw new Error('Không tìm thấy trang "✏️ Thiết kế sửa được".');
  await figma.setCurrentPageAsync(page);
  figma.notify('Tượng Kỳ: đang nạp phông chữ & thành phần…', { timeout: 2500 });
  await loadFonts();
  for (const v of await figma.variables.getLocalVariablesAsync('COLOR')) VAR[v.name] = v;
  await loadComponents();
  return page;
}
function bottomOf(page) { let y = 0; for (const n of page.children) y = Math.max(y, n.y + n.height); return y; }
// Dựng một nhóm màn vào section; cột cố định, mỗi hàng cao theo màn cao nhất
function buildGroup(page, title, items, mark, y, o) {
  const COLS = o.cols, GAP = o.gap, PADX = 120, PADT = 160;
  const sec = figma.createSection(); sec.name = '✏️ ' + title; sec.setPluginData(MARK, mark);
  page.appendChild(sec); sec.x = 0; sec.y = y;
  const frames = []; const errors = []; let made = 0;
  if (o.before) o.before(sec);
  items.forEach((it) => {
    let fr; const before = new Set(page.children);
    try { fr = it[1](it[0]).screen; made++; }
    catch (e) {
      errors.push(it[0] + ': ' + (e && e.message));
      for (const n of page.children.slice()) if (!before.has(n)) n.remove(); // bỏ phần dựng dở
      fr = errorFrame(it[0], e); fr.resize(o.w, 900);
    }
    sec.appendChild(fr); frames.push(fr);
  });
  let cy = PADT + (o.top || 0), maxW = 0;
  for (let i = 0; i < frames.length; i += COLS) {
    const row = frames.slice(i, i + COLS); let rh = 0;
    row.forEach((f, j) => { f.x = PADX + j * (o.w + GAP); f.y = cy; rh = Math.max(rh, f.height); });
    maxW = Math.max(maxW, PADX * 2 + row.length * o.w + (row.length - 1) * GAP);
    cy += rh + GAP;
  }
  sec.resizeWithoutConstraints(Math.max(maxW, o.minW || 0), cy - GAP + PADX);
  return { sec: sec, made: made, errors: errors };
}
async function runDesktop(page) {
  const old = page.children.filter((n) => n.type === 'SECTION' && n.getPluginData(MARK) === '1');
  if (old.length) return figma.closePlugin('Tượng Kỳ: đã có các màn desktop (có thể bạn đã sửa) — plugin không ghi đè. Muốn dựng lại thì tự xoá 3 section ✏️ desktop trước.');
  const oldHome = await node(ID.oldHome); if (oldHome && oldHome.parent) oldHome.remove();
  let y = bottomOf(page) + 400; const errors = []; let made = 0; const secs = [];
  for (const g of GROUPS) { const r = buildGroup(page, g[0], g[1], '1', y, { cols: 4, gap: 160, w: 1440 }); secs.push(r.sec); made += r.made; errors.push(...r.errors); y += r.sec.height + 300; }
  finish(secs, made, errors);
}
async function runMobile(page) {
  for (const n of page.children.slice()) if (n.type === 'SECTION' && n.getPluginData(MARK) === 'mobile') n.remove();
  const y = bottomOf(page) + 400;
  const r = buildGroup(page, 'Giao diện điện thoại (390px)', M_SCREENS, 'mobile', y, {
    cols: 7, gap: 100, w: MW, top: 160,
    before: (sec) => { M_TOP = makeMobileTop(sec); M_TOP.x = 120; M_TOP.y = 120; },
  });
  finish([r.sec], r.made, r.errors);
}
function finish(secs, made, errors) {
  figma.viewport.scrollAndZoomIntoView(secs);
  if (errors.length) console.error(errors.join('\n'));
  figma.closePlugin('Tượng Kỳ: đã dựng ' + made + ' màn hình' + (errors.length ? ' — ' + errors.length + ' màn lỗi (xem khung đỏ)' : '') + '.');
}
async function main() {
  const page = await setup();
  if (figma.command === 'desktop') await runDesktop(page);
  else await runMobile(page);
}

main().catch((e) => { console.error(e); figma.closePlugin('Tượng Kỳ — lỗi: ' + (e && e.message ? e.message : e)); });
