// Cài đặt hệ thống do quản trị viên chỉnh (trang admin → Cài đặt hệ thống) — dùng chung cho server và trình duyệt.
// Danh sách mục, giá trị mặc định & cách kiểm tra nằm ở đây; giá trị đã lưu do config-store.js (server) giữ,
// trình duyệt nhận qua /api/site-config.js (window.SITE_CONFIG) và sự kiện socket 'site-config'.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // type: int (min, max) | text (max) | textarea (max) | tcs (danh sách nhịp 'phút|giây') | list (danh sách chữ)
  //       | missions (bảng nhiệm vụ) — unit: chữ hiển thị sau ô số
  const GROUPS = [
    { id: 'content', title: 'Nội dung trang chủ', desc: 'Chữ hiển thị trên web — đổi là mọi người thấy ngay.', fields: [
      { key: 'ANNOUNCE', label: 'Thông báo đầu trang', type: 'textarea', max: 200, def: '', hint: 'Hiện thành dải thông báo trên cùng mọi trang. Để trống = ẩn.' },
      { key: 'HERO_TAG', label: 'Nhãn banner', type: 'text', max: 30, def: 'Cờ tướng Việt' },
      { key: 'HERO_TITLE', label: 'Tiêu đề banner', type: 'textarea', max: 120, def: 'Đấu trí trên bàn cờ.\nKết kỳ hữu bốn phương.', hint: 'Xuống dòng để ngắt dòng trên banner.' },
      { key: 'PROMO_TITLE', label: 'Hộp gợi ý menu trái — tiêu đề', type: 'text', max: 40, def: 'Mời kỳ hữu vào bàn' },
      { key: 'PROMO_TEXT', label: 'Hộp gợi ý menu trái — nội dung', type: 'textarea', max: 160, def: 'Tạo phòng riêng và gửi link — bạn bè vào chơi ngay, không cần tài khoản.' },
    ] },
    { id: 'elo', title: 'Elo & uy tín', desc: 'Áp dụng cho tài khoản mới và các ván kết thúc từ bây giờ.', fields: [
      { key: 'START_RATING', label: 'Elo khởi đầu', type: 'int', min: 100, max: 3000, def: 1200 },
      { key: 'ELO_K', label: 'Hệ số K (Elo thay đổi tối đa mỗi ván)', type: 'int', min: 4, max: 100, def: 32 },
      { key: 'START_CREDIT', label: 'Uy tín khởi đầu', type: 'int', min: 0, max: 100000, def: 1000 },
      { key: 'MAX_CREDIT', label: 'Uy tín tối đa', type: 'int', min: 1, max: 100000, def: 1100 },
      { key: 'CREDIT_GAIN', label: 'Uy tín cộng mỗi ván chơi trọn', type: 'int', min: 0, max: 1000, def: 1 },
      { key: 'CREDIT_PENALTY', label: 'Uy tín trừ khi bỏ ván giữa chừng', type: 'int', min: 0, max: 1000, def: 10 },
    ] },
    { id: 'ranks', title: 'Bậc rank', desc: 'Elo tối thiểu để lên từng bậc (phải tăng dần). Bậc Đồng bắt đầu từ 0.', fields: [
      { key: 'RANK_SILVER', label: 'Bạc', type: 'int', min: 1, max: 5000, def: 1100, unit: 'Elo' },
      { key: 'RANK_GOLD', label: 'Vàng', type: 'int', min: 1, max: 5000, def: 1300, unit: 'Elo' },
      { key: 'RANK_PLATINUM', label: 'Bạch kim', type: 'int', min: 1, max: 5000, def: 1500, unit: 'Elo' },
      { key: 'RANK_DIAMOND', label: 'Kim cương', type: 'int', min: 1, max: 5000, def: 1700, unit: 'Elo' },
      { key: 'RANK_MASTER', label: 'Cao thủ', type: 'int', min: 1, max: 5000, def: 1900, unit: 'Elo' },
    ] },
    { id: 'match', title: 'Ghép trận & kết nối', desc: 'Cách hệ thống tìm đối thủ và giữ chỗ khi mất mạng.', fields: [
      { key: 'ACCEPT_SEC', label: 'Thời gian bấm "Chấp nhận" khi ghép được', type: 'int', min: 5, max: 60, def: 12, unit: 'giây' },
      { key: 'ABANDON_SEC', label: 'Giữ chỗ khi mất kết nối', type: 'int', min: 15, max: 600, def: 90, unit: 'giây' },
      { key: 'ROOM_TTL_MIN', label: 'Xoá phòng trống sau', type: 'int', min: 1, max: 1440, def: 30, unit: 'phút' },
      { key: 'MM_BASE', label: 'Chênh Elo ban đầu khi tìm đối thủ', type: 'int', min: 0, max: 2000, def: 100, unit: 'Elo' },
      { key: 'MM_STEP', label: 'Nới chênh Elo thêm mỗi lần', type: 'int', min: 0, max: 1000, def: 50, unit: 'Elo' },
      { key: 'MM_STEP_SEC', label: 'Nới sau mỗi', type: 'int', min: 1, max: 120, def: 5, unit: 'giây' },
      { key: 'MM_ANY_SEC', label: 'Ghép với bất kỳ ai sau', type: 'int', min: 5, max: 600, def: 60, unit: 'giây' },
    ] },
    { id: 'room', title: 'Phòng riêng (Chơi với bạn)', desc: 'Các nhịp người chơi chọn được khi tạo phòng.', fields: [
      { key: 'ROOM_TCS', label: 'Nhịp chơi', type: 'tcs', def: ['5|0', '10|0', '15|10', '30|0', '0|0'], hint: 'Mỗi nhịp dạng phút|giây cộng (vd 10|5). 0|0 = không giới hạn thời gian.' },
    ] },
    { id: 'chat', title: 'Cộng đồng & trò chuyện', fields: [
      { key: 'COMMUNITY_MAX_TEXT', label: 'Độ dài tối đa tin cộng đồng', type: 'int', min: 20, max: 2000, def: 500, unit: 'ký tự' },
      { key: 'COMMUNITY_GAP_SEC', label: 'Mỗi tài khoản gửi cách nhau ít nhất', type: 'int', min: 0, max: 600, def: 3, unit: 'giây' },
      { key: 'COMMUNITY_KEEP', label: 'Số tin cộng đồng giữ lại', type: 'int', min: 20, max: 2000, def: 300, unit: 'tin' },
      { key: 'CHAT_MAX_TEXT', label: 'Độ dài tối đa tin chat trong trận', type: 'int', min: 20, max: 1000, def: 300, unit: 'ký tự' },
    ] },
    { id: 'missions', title: 'Nhiệm vụ hằng ngày', desc: 'Mỗi ngày mỗi người nhận 3 nhiệm vụ trong các nhiệm vụ đang bật.', fields: [
      { key: 'MISSIONS', label: 'Danh sách nhiệm vụ', type: 'missions', def: [
        { id: 'play2', name: 'Chơi 2 ván online', goal: 2, reward: 20, on: true },
        { id: 'winRanked', name: 'Thắng 1 ván xếp hạng', goal: 1, reward: 30, on: true },
        { id: 'puzzle1', name: 'Giải 1 thế cờ', goal: 1, reward: 15, on: true },
        { id: 'aiWin', name: 'Thắng máy từ cấp 3 trở lên', goal: 1, reward: 15, on: true },
        { id: 'coin1', name: 'Chơi 1 ván Tranh xu', goal: 1, reward: 10, on: true },
        { id: 'ai2', name: 'Luyện 2 ván đấu máy', goal: 2, reward: 10, on: true },
        { id: 'puzzle3', name: 'Giải 3 thế cờ', goal: 3, reward: 25, on: true },
      ] },
    ] },
    { id: 'tour', title: 'Giải đấu', desc: 'Điểm Danh vọng mùa cho top 3 mỗi giải.', fields: [
      { key: 'BADGE_1', label: 'Hạng nhất', type: 'int', min: 0, max: 1000, def: 10, unit: 'điểm' },
      { key: 'BADGE_2', label: 'Hạng nhì', type: 'int', min: 0, max: 1000, def: 6, unit: 'điểm' },
      { key: 'BADGE_3', label: 'Hạng ba', type: 'int', min: 0, max: 1000, def: 3, unit: 'điểm' },
    ] },
    { id: 'engine', title: 'Engine phân tích (Pikafish)', desc: 'Giới hạn để server không bị quá tải.', fields: [
      { key: 'ENGINE_RATE_PER_MIN', label: 'Số yêu cầu tối đa mỗi phút / người', type: 'int', min: 10, max: 2000, def: 150, unit: 'lần' },
      { key: 'ENGINE_STREAMS_PER_IP', label: 'Phân tích liên tục cùng lúc / người', type: 'int', min: 1, max: 10, def: 2, unit: 'luồng' },
      { key: 'ENGINE_STREAM_MAX_SEC', label: 'Một lượt phân tích liên tục tối đa', type: 'int', min: 5, max: 300, def: 60, unit: 'giây' },
    ] },
    { id: 'account', title: 'Tài khoản', fields: [
      { key: 'SESSION_DAYS', label: 'Giữ đăng nhập trong', type: 'int', min: 1, max: 365, def: 30, unit: 'ngày', hint: 'Áp dụng cho lần đăng nhập mới.' },
      { key: 'ANALYSIS_MAX', label: 'Số thế cờ phân tích lưu tối đa / tài khoản', type: 'int', min: 5, max: 500, def: 50 },
      { key: 'REGIONS', label: 'Khu vực để chọn trong hồ sơ', type: 'list', max: 40, def: ['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Miền Bắc', 'Miền Trung', 'Tây Nguyên', 'Miền Nam', 'Nước ngoài'], hint: 'Mỗi dòng một khu vực.' },
    ] },
  ];
  const FIELDS = [].concat(...GROUPS.map((g) => g.fields));
  const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const defaults = () => Object.fromEntries(FIELDS.map((f) => [f.key, clone(f.def)]));

  class ConfigError extends Error {}
  const TC_RE = /^(\d{1,3})\|(\d{1,2})$/;

  function cleanField(f, v) {
    const bad = (msg) => { throw new ConfigError(`${f.label}: ${msg}`); };
    if (f.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) bad(`phải là số nguyên từ ${f.min} đến ${f.max}.`);
      return n;
    }
    if (f.type === 'text' || f.type === 'textarea') {
      let s = String(v == null ? '' : v).replace(/\r/g, '');
      if (f.type === 'text') s = s.replace(/\s+/g, ' ');
      s = s.trim();
      if (s.length > f.max) bad(`tối đa ${f.max} ký tự.`);
      return s;
    }
    if (f.type === 'tcs') {
      const list = (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
      if (!list.length || list.length > 10) bad('cần từ 1 đến 10 nhịp.');
      for (const t of list) {
        const m = t.match(TC_RE);
        if (!m || +m[1] > 180 || +m[2] > 60 || (+m[1] === 0 && +m[2] > 0)) bad(`"${t}" không hợp lệ (phút 0–180, giây 0–60).`);
      }
      return [...new Set(list)];
    }
    if (f.type === 'list') {
      const list = (Array.isArray(v) ? v : []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!list.length || list.length > 60) bad('cần từ 1 đến 60 mục.');
      if (list.some((x) => x.length > f.max)) bad(`mỗi mục tối đa ${f.max} ký tự.`);
      return [...new Set(list)];
    }
    if (f.type === 'missions') {
      const ids = new Set(f.def.map((m) => m.id));
      const byId = Object.fromEntries((Array.isArray(v) ? v : []).filter((m) => m && ids.has(m.id)).map((m) => [m.id, m]));
      const out = f.def.map((d) => {
        const m = byId[d.id] || d;
        const name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || d.name;
        const goal = Number(m.goal), reward = Number(m.reward);
        if (!Number.isInteger(goal) || goal < 1 || goal > 100) bad(`mục tiêu của "${name}" phải từ 1 đến 100.`);
        if (!Number.isInteger(reward) || reward < 0 || reward > 100000) bad(`thưởng của "${name}" phải từ 0 đến 100000 xu.`);
        return { id: d.id, name, goal, reward, on: m.on !== false };
      });
      if (out.filter((m) => m.on).length < 3) bad('cần bật ít nhất 3 nhiệm vụ.');
      return out;
    }
    return clone(f.def);
  }

  // Kiểm tra toàn bộ cài đặt (khoá thiếu → mặc định). Báo lỗi bằng tên dễ hiểu.
  function clean(input) {
    const x = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const f of FIELDS) out[f.key] = cleanField(f, x[f.key] === undefined ? f.def : x[f.key]);
    const tiers = [out.RANK_SILVER, out.RANK_GOLD, out.RANK_PLATINUM, out.RANK_DIAMOND, out.RANK_MASTER];
    if (tiers.some((v, i) => i && v <= tiers[i - 1])) throw new ConfigError('Bậc rank: Elo các bậc phải tăng dần (Bạc < Vàng < Bạch kim < Kim cương < Cao thủ).');
    if (out.START_CREDIT > out.MAX_CREDIT) throw new ConfigError('Uy tín khởi đầu không được lớn hơn uy tín tối đa.');
    return out;
  }
  // Bản sửa lỗi nhẹ (dùng khi nạp dữ liệu cũ): mục sai → mặc định
  function cleanLoose(input) {
    const x = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const f of FIELDS) {
      try { out[f.key] = cleanField(f, x[f.key] === undefined ? f.def : x[f.key]); } catch (e) { out[f.key] = clone(f.def); }
    }
    try { return clean(out); } catch (e) { return defaults(); }
  }

  // Bậc rank theo cài đặt → ghi vào Ranks.TIERS (giữ tên & màu)
  function applyTiers(cfg, Ranks) {
    if (!Ranks || !Ranks.TIERS) return;
    const base = [0, cfg.RANK_SILVER, cfg.RANK_GOLD, cfg.RANK_PLATINUM, cfg.RANK_DIAMOND, cfg.RANK_MASTER];
    Ranks.TIERS.forEach((t, i) => { if (base[i] !== undefined) t[0] = base[i]; });
  }
  const parseTc = (t) => { const [totalMin, incSec] = String(t).split('|').map(Number); return { totalMin, incSec }; };
  const tcLabel = (t) => (t === '0|0' ? 'Không giới hạn' : t.replace('|', '+'));

  return { GROUPS, FIELDS, BY_KEY, defaults, clean, cleanLoose, ConfigError, applyTiers, parseTc, tcLabel };
});
