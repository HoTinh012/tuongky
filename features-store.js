// Bật/tắt chức năng của web (trang admin → Chức năng web) — lưu qua storage/ (data/features.json hoặc Supabase).
// Server kiểm tra on(key) trước khi xử lý; trình duyệt ẩn phần tương ứng (xem public/features.js).
const Features = require('./public/features.js');
const storage = require('./storage');

let state = Features.defaults();

async function init() {
  const loaded = await storage.loadFeatures();
  if (loaded) state = Features.clean(loaded);
}

function update(next) {
  state = Features.clean({ ...state, ...(next || {}) });
  Promise.resolve(storage.saveFeatures(state)).catch((err) => console.error('Không lưu được bật/tắt chức năng:', err.message));
  return state;
}

module.exports = {
  init, update,
  current: () => state,
  on: (key) => state[key] !== false,
  offMessage: Features.offMessage,
  browserScript: () => `window.FEATURES_ON = ${JSON.stringify(state)};\n`,
};
