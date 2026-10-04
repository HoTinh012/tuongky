// Hạng người chơi theo điểm Elo & chất liệu thẻ kỳ hữu — dùng chung cho trang chơi và trang quản trị.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ranks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [điểm bắt đầu, tên hạng, màu]; mỗi hạng chia 5 sao
  const TIERS = [[0, 'Đồng', '#d29a6a'], [1100, 'Bạc', '#c9d3df'], [1300, 'Vàng', '#f2c35b'], [1500, 'Bạch kim', '#7fd1c7'],
    [1700, 'Kim cương', '#8fb4ff'], [1900, 'Cao thủ', '#ff8a7a']];

  function rankOf(rating) {
    let i = 0;
    while (i + 1 < TIERS.length && rating >= TIERS[i + 1][0]) i++;
    const [base, name, color] = TIERS[i];
    const lo = i === 0 ? 700 : base;
    const step = i + 1 < TIERS.length ? (TIERS[i + 1][0] - lo) / 5 : 100;
    const stars = Math.max(1, Math.min(5, Math.floor((rating - lo) / step) + 1));
    return { name, stars, color, label: `${name} ${stars}★` };
  }

  // Chất liệu thẻ kỳ hữu theo tổng số ván đã chơi
  const cardTier = (games) => (games >= 200 ? 'Hoàng kim' : games >= 50 ? 'Ngọc bích' : games >= 10 ? 'Gỗ đàn' : 'Gỗ thông');

  return { TIERS, rankOf, cardTier };
});
