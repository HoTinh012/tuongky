// Cài đặt chế độ chơi do quản trị viên chỉnh: nhịp & xu của Xếp hạng, Tranh xu, các khoản thưởng.
// Lưu qua storage/ (data/economy.json hoặc khoá 'economy' trong bảng settings của Supabase).
// Giá trị được ghi thẳng vào Catalog.ECONOMY nên mọi nơi đọc Catalog.ECONOMY.X đều thấy ngay bản mới.
const Catalog = require('./public/catalog.js');
const storage = require('./storage');

const E = Catalog.ECONOMY;
const DEFAULTS = JSON.parse(JSON.stringify(E));

class EconomyError extends Error {}

// Số nguyên trong [min, max], sai thì báo lỗi bằng tên dễ hiểu
function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new EconomyError(`${label} phải là số nguyên từ ${min} đến ${max}.`);
  return n;
}

// Kiểm tra toàn bộ cài đặt, trả về bản sạch (không lẫn khoá lạ)
function clean(input) {
  const x = input && typeof input === 'object' ? input : {};
  const tc = x.RANKED_TC || {};
  const out = {
    RANKED_TC: { totalMin: int(tc.totalMin, 1, 180, 'Thời gian mỗi bên (Xếp hạng)'), incSec: int(tc.incSec, 0, 60, 'Giây cộng mỗi nước (Xếp hạng)') },
    RANKED_FEE: int(x.RANKED_FEE, 0, 100000, 'Phí xếp hạng'),
    RANKED_REWARD_PLAY: int(x.RANKED_REWARD_PLAY, 0, 100000, 'Thưởng chơi trọn ván xếp hạng'),
    RANKED_REWARD_WIN: int(x.RANKED_REWARD_WIN, 0, 100000, 'Thưởng thắng ván xếp hạng'),
    AI_REWARD_PLAY: int(x.AI_REWARD_PLAY, 0, 100000, 'Thưởng mỗi ván đấu máy'),
    AI_REWARD_WIN: int(x.AI_REWARD_WIN, 0, 100000, 'Thưởng thắng máy'),
    START_COINS: int(x.START_COINS, 0, 10000000, 'Xu tặng khi tạo tài khoản'),
    DAILY_BONUS: int(x.DAILY_BONUS, 0, 100000, 'Thưởng đăng nhập mỗi ngày'),
    PUZZLE_REWARD: int(x.PUZZLE_REWARD, 0, 100000, 'Thưởng giải cờ thế'),
  };
  // Mức đặt Tranh xu: 1–10 mức, không trùng, xếp tăng dần
  if (!Array.isArray(x.STAKES) || !x.STAKES.length || x.STAKES.length > 10) throw new EconomyError('Cần từ 1 đến 10 mức đặt xu.');
  out.STAKES = [...new Set(x.STAKES.map((v) => int(v, 1, 10000000, 'Mức đặt xu')))].sort((a, b) => a - b);
  // Nhịp Tranh xu: 1–12 nhịp, mỗi nhịp 'phút|giây' thuộc một nhóm (vd Cờ chớp / Cờ nhanh)
  if (!Array.isArray(x.COIN_TCS) || !x.COIN_TCS.length || x.COIN_TCS.length > 12) throw new EconomyError('Cần từ 1 đến 12 nhịp Tranh xu.');
  const seen = new Set();
  out.COIN_TCS = x.COIN_TCS.map((t) => {
    const m = /^(\d+)\|(\d+)$/.exec(String(t && t.tc));
    if (!m) throw new EconomyError('Nhịp Tranh xu không hợp lệ.');
    const tcStr = `${int(m[1], 1, 180, 'Phút (Tranh xu)')}|${int(m[2], 0, 60, 'Giây cộng (Tranh xu)')}`;
    if (seen.has(tcStr)) throw new EconomyError(`Nhịp ${tcStr.replace('|', '+')} bị trùng.`);
    seen.add(tcStr);
    const group = String((t && t.group) || '').trim().slice(0, 20);
    if (!group) throw new EconomyError('Mỗi nhịp Tranh xu cần tên nhóm (vd Cờ chớp).');
    return { tc: tcStr, group };
  });
  return out;
}

function save() {
  Promise.resolve(storage.saveEconomy(JSON.parse(JSON.stringify(current())))).catch((err) => console.error('Không lưu được cài đặt chế độ chơi:', err.message));
}

const current = () => {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = E[k];
  return out;
};

// Nạp khi khởi động server (thiếu khoá nào thì giữ mặc định; bản lưu hỏng thì bỏ qua)
async function init() {
  const saved = await storage.loadEconomy();
  if (!saved) return;
  try {
    Object.assign(E, clean({ ...JSON.parse(JSON.stringify(DEFAULTS)), ...saved }));
  } catch (err) {
    console.error('Cài đặt chế độ chơi đã lưu không hợp lệ, dùng mặc định:', err.message);
  }
}

function update(input) {
  Object.assign(E, clean(input));
  save();
  return current();
}

function reset() {
  Object.assign(E, JSON.parse(JSON.stringify(DEFAULTS)));
  save();
  return current();
}

// Script cho trình duyệt: ghi đè Catalog.ECONOMY bằng cài đặt hiện tại (nạp ngay sau catalog.js)
const browserScript = () => `window.Catalog && Object.assign(window.Catalog.ECONOMY, ${JSON.stringify(current())});\n`;

module.exports = { init, current, defaults: () => JSON.parse(JSON.stringify(DEFAULTS)), update, reset, browserScript, EconomyError };
