// Danh mục vật phẩm & quy tắc kinh tế xu — dùng chung cho server và trình duyệt.
// Xu là tiền trong game (không quy đổi tiền thật); vật phẩm chỉ đổi giao diện, không ảnh hưởng sức mạnh thi đấu.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ECONOMY = {
    RANKED_FEE: 10, // phí xu mỗi ván xếp hạng (trừ khi bắt đầu ván, không hoàn)
    STAKES: [50, 100, 200, 500], // mức đặt Tranh xu
    // Nhịp Tranh xu: Cờ chớp & Cờ nhanh ('phút|giây cộng')
    COIN_TCS: [
      { tc: '1|0', group: 'Cờ chớp' }, { tc: '3|0', group: 'Cờ chớp' }, { tc: '3|2', group: 'Cờ chớp' },
      { tc: '5|0', group: 'Cờ nhanh' }, { tc: '10|0', group: 'Cờ nhanh' }, { tc: '10|5', group: 'Cờ nhanh' },
    ],
    DAILY_BONUS: 20,
    PUZZLE_REWARD: 5,
  };

  // cat: 'board' | 'pieces' | 'clock'. price 0 = có sẵn cho mọi người.
  // board: { type:'default' } (theo Tượng Kỳ) | { type:'image', src } | { type:'classic', palette }
  // pieces: { style } ('default' = theo Tượng Kỳ); clock: { style }
  const ITEMS = [
    { id: 'board-default', cat: 'board', name: 'Theo Tượng Kỳ', desc: 'Bàn cờ chính thức', price: 0, board: { type: 'default' } },
    { id: 'board-wood', cat: 'board', name: 'Gỗ sáng', desc: 'Vân gỗ thật', price: 0, board: { type: 'image', src: '/assets/board.webp' } },
    { id: 'board-classic', cat: 'board', name: 'Cổ điển', desc: 'Nét vẽ truyền thống', price: 0, board: { type: 'classic', palette: 'classic' } },
    { id: 'board-thidau', cat: 'board', name: 'Thi Đấu', desc: 'Nền sáng, nét rõ như bàn giải', price: 100, board: { type: 'classic', palette: 'thidau' } },
    { id: 'board-tram', cat: 'board', name: 'Gỗ Trầm', desc: 'Gỗ sẫm màu, ấm', price: 150, board: { type: 'classic', palette: 'tram' } },
    { id: 'board-truc', cat: 'board', name: 'Trúc Thanh', desc: 'Sắc trúc xanh nhẹ', price: 150, board: { type: 'classic', palette: 'truc' } },
    { id: 'board-ngoc', cat: 'board', name: 'Ngọc Sáng', desc: 'Ngọc bích trong trẻo', price: 250, board: { type: 'classic', palette: 'ngoc' } },
    { id: 'board-devuong', cat: 'board', name: 'Đế Vương', desc: 'Son đỏ, viền vàng', price: 400, board: { type: 'classic', palette: 'devuong' } },

    { id: 'pieces-default', cat: 'pieces', name: 'Theo Tượng Kỳ', desc: 'Quân cờ chính thức', price: 0, pieces: { style: 'default' } },
    { id: 'pieces-wood', cat: 'pieces', name: 'Truyền thống', desc: 'Gỗ khắc chữ', price: 0, pieces: { style: 'wood' } },
    { id: 'pieces-classic', cat: 'pieces', name: 'Cổ điển', desc: 'Viền nét mảnh', price: 0, pieces: { style: 'classic' } },
    { id: 'pieces-modern', cat: 'pieces', name: 'Hiện đại', desc: 'Phẳng, tương phản cao', price: 0, pieces: { style: 'modern' } },
    { id: 'pieces-jade', cat: 'pieces', name: 'Ngọc bích', desc: 'Ngọc xanh mát', price: 150, pieces: { style: 'jade' } },
    { id: 'pieces-ebony', cat: 'pieces', name: 'Gỗ Mun', desc: 'Gỗ mun đen bóng', price: 200, pieces: { style: 'ebony' } },
    { id: 'pieces-whitejade', cat: 'pieces', name: 'Ngọc Trắng', desc: 'Ngọc trắng sứ', price: 250, pieces: { style: 'whitejade' } },
    { id: 'pieces-redjade', cat: 'pieces', name: 'Xích Ngọc', desc: 'Ngọc đỏ son', price: 300, pieces: { style: 'redjade' } },
    { id: 'pieces-royal', cat: 'pieces', name: 'Hoàng Gia', desc: 'Dát vàng', price: 500, pieces: { style: 'royal' } },

    { id: 'clock-classic', cat: 'clock', name: 'Cổ điển', desc: 'Mặc định', price: 0, clock: { style: 'classic' } },
    { id: 'clock-minimal', cat: 'clock', name: 'Tối giản', desc: 'Chỉ con số', price: 0, clock: { style: 'minimal' } },
    { id: 'clock-digital', cat: 'clock', name: 'Điện tử', desc: 'Màn LED xanh', price: 80, clock: { style: 'digital' } },
    { id: 'clock-wood', cat: 'clock', name: 'Mộc', desc: 'Khung gỗ', price: 80, clock: { style: 'wood' } },
    { id: 'clock-cinnabar', cat: 'clock', name: 'Đỏ son', desc: 'Sơn mài đỏ', price: 120, clock: { style: 'cinnabar' } },
    { id: 'clock-tournament', cat: 'clock', name: 'Thi đấu', desc: 'Đồng hồ giải đấu', price: 120, clock: { style: 'tournament' } },
  ];
  const byId = Object.fromEntries(ITEMS.map((x) => [x.id, x]));
  const DEFAULT_EQUIP = { board: 'board-default', pieces: 'pieces-default', clock: 'clock-classic' };
  const CATS = { board: 'Bàn cờ', pieces: 'Quân cờ', clock: 'Đồng hồ' };

  return { ECONOMY, ITEMS, byId, DEFAULT_EQUIP, CATS };
});
