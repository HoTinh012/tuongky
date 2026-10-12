// Vật phẩm Túi đồ & Cửa hàng (bàn cờ, quân cờ, đồng hồ) do quản trị viên quản lý: sửa tên, mô tả, giá, ẩn/hiện, thêm, xoá.
// Lưu qua storage/ (data/shop.json hoặc khoá 'shop' trong bảng settings của Supabase).
// Danh sách được ghi thẳng vào Catalog.ITEMS / Catalog.byId nên mọi nơi đọc Catalog đều thấy ngay bản mới;
// trình duyệt nhận bản mới qua /api/shop.js (nạp ngay sau catalog.js) và sự kiện socket 'shop'.
const crypto = require('crypto');
const Catalog = require('./public/catalog.js');
const BR = require('./public/board-render.js');
const theme = require('./theme.js');
const storage = require('./storage');

const DEFAULTS = JSON.parse(JSON.stringify(Catalog.ITEMS));
const CLOCK_STYLES = ['classic', 'minimal', 'digital', 'wood', 'cinnabar', 'tournament'];
const LOCKED = new Set(Object.values(Catalog.DEFAULT_EQUIP)); // món mặc định: luôn miễn phí, không ẩn/xoá được

class ShopError extends Error {}

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// Kiểm tra một vật phẩm, trả về bản sạch
function cleanItem(x) {
  if (!x || typeof x !== 'object') throw new ShopError('Vật phẩm không hợp lệ.');
  const cat = x.cat;
  if (!Catalog.CATS[cat]) throw new ShopError('Loại vật phẩm không hợp lệ.');
  const id = typeof x.id === 'string' && /^[a-z0-9-]{3,40}$/.test(x.id) ? x.id : null;
  if (!id) throw new ShopError('Mã vật phẩm không hợp lệ.');
  const name = text(x.name, 40);
  if (!name) throw new ShopError('Vật phẩm cần có tên.');
  const price = Number(x.price);
  if (!Number.isInteger(price) || price < 0 || price > 1000000) throw new ShopError(`Giá của "${name}" phải là số nguyên từ 0 đến 1.000.000 xu.`);
  const out = { id, cat, name, desc: text(x.desc, 80), price, hidden: !!x.hidden };
  if (LOCKED.has(id)) { out.price = 0; out.hidden = false; }
  if (cat === 'board') {
    const b = x.board || {};
    if (b.type === 'default') out.board = { type: 'default' };
    else if (b.type === 'classic') {
      if (!BR.PALETTES[b.palette]) throw new ShopError(`Bảng màu của "${name}" không hợp lệ.`);
      out.board = { type: 'classic', palette: b.palette };
    } else if (b.type === 'image') {
      // Ảnh có sẵn chỉ cần src; ảnh tải lên phải kèm toạ độ lưới (lấy từ thư viện ảnh ở trang Bàn cờ & quân cờ)
      const builtin = BR.BUILTIN_BOARDS.find((y) => y.type === 'image' && y.src === b.src);
      if (builtin) out.board = { type: 'image', src: b.src };
      else {
        const lib = theme.library().find((y) => y.src === b.src);
        if (!lib) throw new ShopError(`Ảnh bàn cờ của "${name}" không còn trong thư viện.`);
        out.board = { type: 'image', src: lib.src, width: lib.width, height: lib.height, xs: lib.xs, ys: lib.ys, bg: lib.bg };
      }
    } else throw new ShopError(`Kiểu bàn cờ của "${name}" không hợp lệ.`);
  } else if (cat === 'pieces') {
    const s = x.pieces && x.pieces.style;
    if (s !== 'default' && !BR.PIECE_STYLES[s]) throw new ShopError(`Kiểu quân của "${name}" không hợp lệ.`);
    out.pieces = { style: s };
  } else {
    const s = x.clock && x.clock.style;
    if (!CLOCK_STYLES.includes(s)) throw new ShopError(`Kiểu đồng hồ của "${name}" không hợp lệ.`);
    out.clock = { style: s };
  }
  return out;
}

function cleanList(list) {
  if (!Array.isArray(list)) throw new ShopError('Danh sách vật phẩm không hợp lệ.');
  if (list.length > 300) throw new ShopError('Tối đa 300 vật phẩm.');
  const items = list.map(cleanItem);
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) throw new ShopError(`Trùng mã vật phẩm "${it.id}".`);
    ids.add(it.id);
  }
  for (const id of LOCKED) if (!ids.has(id)) throw new ShopError('Không thể xoá vật phẩm mặc định.');
  return items;
}

// Ghi vào Catalog dùng chung (giữ nguyên object để mọi module đang tham chiếu đều thấy bản mới)
function apply(items) {
  Catalog.ITEMS.splice(0, Catalog.ITEMS.length, ...items);
  for (const k of Object.keys(Catalog.byId)) delete Catalog.byId[k];
  for (const it of items) Catalog.byId[it.id] = it;
}

function save() {
  Promise.resolve(storage.saveShop(Catalog.ITEMS)).catch((err) => console.error('Không lưu được cửa hàng vật phẩm:', err.message));
}

async function init() {
  const loaded = await storage.loadShop();
  if (!loaded) return;
  try {
    apply(cleanList(loaded));
  } catch (err) {
    console.error('Cửa hàng vật phẩm đã lưu không hợp lệ, dùng mặc định:', err.message);
  }
}

function update(list) {
  // Món mới từ trang admin chưa có mã → tạo mã
  const withIds = (Array.isArray(list) ? list : []).map((x) => (x && !x.id ? { ...x, id: `${x.cat}-${crypto.randomBytes(4).toString('hex')}` } : x));
  apply(cleanList(withIds));
  save();
  return Catalog.ITEMS;
}

function reset() {
  apply(JSON.parse(JSON.stringify(DEFAULTS)));
  save();
  return Catalog.ITEMS;
}

// Ảnh tải lên đang được vật phẩm nào dùng (không cho xoá ảnh khỏi thư viện)
const itemUsingImage = (src) => Catalog.ITEMS.find((it) => it.board && it.board.type === 'image' && it.board.src === src);

// Script cho trình duyệt: thay danh sách vật phẩm (nạp ngay sau catalog.js)
const browserScript = () => `window.Catalog && (function (C, items) {
  C.ITEMS.splice(0, C.ITEMS.length, ...items);
  for (const k of Object.keys(C.byId)) delete C.byId[k];
  for (const it of items) C.byId[it.id] = it;
})(window.Catalog, ${JSON.stringify(Catalog.ITEMS)});\n`;

module.exports = {
  init, update, reset, itemUsingImage, browserScript, ShopError,
  current: () => Catalog.ITEMS,
  defaults: () => DEFAULTS,
  CLOCK_STYLES, LOCKED: [...LOCKED],
};
