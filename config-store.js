// Cài đặt hệ thống (trang admin → Cài đặt hệ thống) — lưu qua storage/ (data/site-config.json hoặc Supabase).
// `values` là object dùng chung: mọi module đọc CFG.X lúc cần nên luôn thấy giá trị mới nhất sau khi admin lưu.
const SiteConfig = require('./public/site-config.js');
const Ranks = require('./public/ranks.js');
const storage = require('./storage');

const values = SiteConfig.defaults();
const listeners = [];

function apply(next) {
  Object.assign(values, next);
  SiteConfig.applyTiers(values, Ranks);
  for (const fn of listeners) { try { fn(values); } catch (err) { console.error(err); } }
}
apply(values);

async function init() {
  const loaded = await storage.loadSiteConfig();
  if (loaded) apply(SiteConfig.cleanLoose(loaded));
}

function save() {
  Promise.resolve(storage.saveSiteConfig(values)).catch((err) => console.error('Không lưu được cài đặt hệ thống:', err.message));
}

function update(input) {
  apply(SiteConfig.clean({ ...values, ...(input || {}) }));
  save();
  return values;
}

function reset() {
  apply(SiteConfig.defaults());
  save();
  return values;
}

module.exports = {
  values, init, update, reset,
  onChange: (fn) => listeners.push(fn),
  defaults: SiteConfig.defaults,
  ConfigError: SiteConfig.ConfigError,
  browserScript: () => `window.SITE_CONFIG = ${JSON.stringify(values)};\nwindow.SiteConfig && window.Ranks && window.SiteConfig.applyTiers(window.SITE_CONFIG, window.Ranks);\n`,
};
