// Danh sách chức năng của web quản trị viên bật/tắt được (trang admin → Chức năng web) — dùng chung cho server và trình duyệt.
// Trạng thái hiện tại: server giữ trong features-store.js, trình duyệt nhận qua /api/features.js (window.FEATURES_ON).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Features = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUPS = [
    { title: 'Chơi cờ', items: [
      { key: 'ranked', label: 'Đấu xếp hạng', desc: 'Ghép trận tự động, tính Elo.' },
      { key: 'coin', label: 'Chơi nhanh', desc: 'Đặt xu, thắng ăn xu của đối thủ.' },
      { key: 'tables', label: 'Bàn chơi', desc: 'Danh sách bàn đang chờ để vào ngồi.' },
      { key: 'room', label: 'Chơi với bạn', desc: 'Tạo phòng riêng, gửi link hoặc mời bạn bè.' },
      { key: 'spectate', label: 'Xem trận', desc: 'Mục "Trận đấu hot" và vào xem ván người khác.' },
      { key: 'chat', label: 'Trò chuyện trong trận', desc: 'Khung chat giữa hai người chơi.' },
    ] },
    { title: 'Luyện tập', items: [
      { key: 'ai', label: 'Đấu máy', desc: 'Chơi với AI 9 cấp độ.' },
      { key: 'analysis', label: 'Phân tích', desc: 'Bàn phân tích có engine, lưu thế cờ.' },
      { key: 'puzzles', label: 'Cờ thế', desc: 'Giải thế cờ, nhận xu thưởng.' },
    ] },
    { title: 'Cộng đồng', items: [
      { key: 'community', label: 'Tường cộng đồng', desc: 'Trò chuyện & chia sẻ thế cờ ở trang chủ.' },
      { key: 'friends', label: 'Bạn bè', desc: 'Kết bạn, tìm kỳ thủ, mời vào bàn.' },
      { key: 'tournaments', label: 'Giải đấu', desc: 'Xem và đăng ký giải đấu.' },
      { key: 'ranking', label: 'Bảng xếp hạng', desc: 'Bảng Elo, chuỗi thắng, cờ thế.' },
    ] },
    { title: 'Tài khoản & xu', items: [
      { key: 'register', label: 'Đăng ký tài khoản mới', desc: 'Tắt: chỉ tài khoản đã có mới đăng nhập được.' },
      { key: 'shop', label: 'Cửa hàng', desc: 'Mua vật phẩm bằng xu (Túi đồ vẫn dùng được).' },
      { key: 'missions', label: 'Nhiệm vụ hằng ngày', desc: 'Nhiệm vụ và nhận thưởng xu.' },
      { key: 'feedback', label: 'Góp ý', desc: 'Người chơi gửi góp ý cho quản trị viên.' },
    ] },
  ];
  const LIST = [].concat(...GROUPS.map((g) => g.items));
  const BY_KEY = Object.fromEntries(LIST.map((f) => [f.key, f]));
  const defaults = () => Object.fromEntries(LIST.map((f) => [f.key, true]));
  // Chỉ giữ khoá hợp lệ, thiếu thì coi như bật
  const clean = (x) => Object.fromEntries(LIST.map((f) => [f.key, !(x && x[f.key] === false)]));
  const offMessage = (key) => `Chức năng "${(BY_KEY[key] || { label: key }).label}" đang tạm tắt.`;

  return { GROUPS, LIST, BY_KEY, defaults, clean, offMessage };
});
