// Vẽ bàn cờ & quân cờ theo "giao diện" (theme) — dùng chung cho trang chơi và trang quản trị.
// theme = {
//   board:  { type: 'image', name, src, width, height, xs: [9 toạ độ cột], ys: [10 toạ độ hàng], bg }
//         | { type: 'classic', name },
//   pieces: { style: 'wood'|'classic'|'jade'|'modern', font: 'kai'|'song'|'hei', red: '#hex', black: '#hex' }
// }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  const WOOD_BOARD = {
    type: 'image', name: 'Gỗ sáng', src: '/assets/board.webp', width: 1280, height: 1280,
    xs: [57, 216, 361, 502, 641, 781, 922, 1064, 1217],
    ys: [53, 188, 319, 448, 575, 705, 835, 963, 1093, 1225],
    bg: '#fdecca',
  };
  const CLASSIC_BOARD = { type: 'classic', name: 'Cổ điển (vẽ)' };
  const BUILTIN_BOARDS = [WOOD_BOARD, CLASSIC_BOARD];

  const DEFAULT_THEME = {
    board: WOOD_BOARD,
    pieces: { style: 'wood', font: 'kai', red: '#c42d24', black: '#2a2622' },
  };

  const PIECE_STYLES = { wood: 'Gỗ khắc', classic: 'Cổ điển', jade: 'Ngọc bích', modern: 'Hiện đại' };
  const FONTS = {
    kai: { name: 'Khải (thư pháp)', family: '"LXGW WenKai TC", "Kaiti TC", "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif', size: 60 },
    song: { name: 'Tống (chân phương)', family: '"Noto Serif TC", "Songti TC", "Songti SC", "SimSun", serif', size: 54 },
    hei: { name: 'Hắc (hiện đại)', family: '"Noto Sans TC", "PingFang TC", "Heiti TC", "Microsoft JhengHei", sans-serif', size: 50 },
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Toạ độ giao điểm, tỉ lệ quân cờ (unit: 1 = ô 100 đơn vị) và viewBox
  function geometry(theme) {
    const b = theme.board;
    if (b.type === 'image') {
      const { xs, ys } = b;
      const unit = Math.min((xs[8] - xs[0]) / 8, (ys[9] - ys[0]) / 9) / 100;
      const reach = 58 * unit; // bán kính quân + bóng đổ
      const padL = Math.max(0, reach - xs[0]), padR = Math.max(0, xs[8] + reach - b.width);
      const padT = Math.max(0, reach - ys[0]), padB = Math.max(0, ys[9] + reach + 10 * unit - b.height);
      return { xs, ys, unit, viewBox: [-padL, -padT, b.width + padL + padR, b.height + padT + padB] };
    }
    return {
      xs: Array.from({ length: 9 }, (_, c) => 50 + 100 * c),
      ys: Array.from({ length: 10 }, (_, r) => 50 + 100 * r),
      unit: 1,
      viewBox: [0, 0, 900, 1000],
    };
  }

  function defs(svg) {
    const d = el('defs', {}, svg);
    const radial = (id, stops, attrs = {}) => {
      const g = el('radialGradient', { id, ...attrs }, d);
      for (const [o, c] of stops) el('stop', { offset: o, 'stop-color': c }, g);
    };
    const linear = (id, stops) => {
      const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, d);
      for (const [o, c] of stops) el('stop', { offset: o, 'stop-color': c }, g);
    };
    radial('br-shadow', [['0%', 'rgba(40,20,5,0.45)'], ['70%', 'rgba(40,20,5,0.18)'], ['100%', 'rgba(40,20,5,0)']]);
    radial('br-wood-face', [['0%', '#fcebd0'], ['55%', '#f1d2a3'], ['100%', '#ddb078']], { cx: '38%', cy: '32%', r: '72%' });
    linear('br-wood-edge', [['0%', '#c99461'], ['100%', '#95643a']]);
    radial('br-classic-face', [['0%', '#fdf0d5'], ['100%', '#e2bc7e']], { cx: '35%', cy: '30%', r: '75%' });
    radial('br-jade-face', [['0%', '#f1fbf4'], ['50%', '#b9e2c8'], ['100%', '#6fb38e']], { cx: '38%', cy: '30%', r: '75%' });
    linear('br-jade-edge', [['0%', '#4f9a72'], ['100%', '#24523a']]);
    const classicBg = el('linearGradient', { id: 'br-classic-bg', x1: 0, y1: 0, x2: 1, y2: 1 }, d);
    for (const [o, c] of [['0%', '#e9c98f'], ['55%', '#d9a95f'], ['100%', '#cf9d52']]) el('stop', { offset: o, 'stop-color': c }, classicBg);
    const grain = el('pattern', { id: 'br-grain', patternUnits: 'userSpaceOnUse', width: 92, height: 26 }, d);
    for (const [y, w] of [[4, 1.2], [11, 0.8], [17, 1.4], [23, 0.7]]) {
      el('path', { d: `M0 ${y} Q23 ${y - 3} 46 ${y + 1} T92 ${y}`, fill: 'none', stroke: 'rgba(150,95,45,0.13)', 'stroke-width': w }, grain);
    }
  }

  function drawClassicBoard(svg, flipped) {
    el('rect', { x: 0, y: 0, width: 900, height: 1000, fill: 'url(#br-classic-bg)' }, svg);
    const g = el('g', { stroke: '#5a3a1a', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'square' }, svg);
    const pos = (v) => 50 + v * 100;
    el('rect', { x: 50, y: 50, width: 800, height: 900, 'stroke-width': 6 }, g);
    for (let r = 0; r < 10; r++) el('line', { x1: 50, y1: pos(r), x2: 850, y2: pos(r) }, g);
    for (let c = 1; c < 8; c++) {
      el('line', { x1: pos(c), y1: 50, x2: pos(c), y2: 450 }, g);
      el('line', { x1: pos(c), y1: 550, x2: pos(c), y2: 950 }, g);
    }
    for (const [r0, r1] of [[0, 2], [7, 9]]) {
      el('line', { x1: pos(3), y1: pos(r0), x2: pos(5), y2: pos(r1) }, g);
      el('line', { x1: pos(5), y1: pos(r0), x2: pos(3), y2: pos(r1) }, g);
    }
    const marks = [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]];
    for (const [r, c] of marks) {
      const x = pos(c), y = pos(r), d = 8, l = 18;
      for (const sx of [-1, 1]) {
        if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
        for (const sy of [-1, 1]) {
          el('polyline', { points: `${x + sx * (d + l)},${y + sy * d} ${x + sx * d},${y + sy * d} ${x + sx * d},${y + sy * (d + l)}` }, g);
        }
      }
    }
    const text = { 'font-family': FONTS.kai.family, 'font-size': 56, fill: '#6b4423', opacity: 0.75, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'letter-spacing': 12 };
    el('text', { x: 250, y: 500, ...text }, svg).textContent = flipped ? '漢 界' : '楚 河';
    el('text', { x: 650, y: 500, ...text }, svg).textContent = flipped ? '楚 河' : '漢 界';
  }

  // Xoá và vẽ lại nền bàn cờ. Trả về hình học để đặt quân.
  function drawBoard(svg, theme, { flipped = false } = {}) {
    const geo = geometry(theme);
    svg.innerHTML = '';
    svg.setAttribute('viewBox', geo.viewBox.join(' '));
    defs(svg);
    const b = theme.board;
    if (b.type === 'image') {
      const [x, y, w, h] = geo.viewBox;
      el('rect', { x, y, width: w, height: h, fill: b.bg || '#e9c98f' }, svg);
      el('image', { href: b.src, x: 0, y: 0, width: b.width, height: b.height, preserveAspectRatio: 'none' }, svg);
    } else {
      drawClassicBoard(svg, flipped);
    }
    return geo;
  }

  // Vẽ một quân cờ tại (x, y). piece: 'rK', 'bP'...; ch: chữ trên quân.
  function drawPiece(parent, theme, unit, piece, ch, x, y, selected = false) {
    const ps = theme.pieces;
    const side = piece[0];
    const ink = side === 'r' ? ps.red : ps.black;
    const font = FONTS[ps.font] || FONTS.kai;
    const g = el('g', {
      class: `piece ${side}${selected ? ' selected' : ''}`,
      transform: `translate(${x} ${y - (selected ? 6 * unit : 0)}) scale(${unit})`,
    }, parent);
    const text = (attrs, fill) => {
      const t = el('text', {
        'font-family': font.family, 'font-size': font.size, 'font-weight': 700,
        'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none', fill, ...attrs,
      }, g);
      t.textContent = ch;
    };

    switch (ps.style) {
      case 'classic':
        el('circle', { cx: 2, cy: 12, r: 46, fill: 'rgba(0,0,0,0.35)' }, g);
        el('circle', { cy: 6, r: 46, fill: '#9a6a32', stroke: '#6e4520', 'stroke-width': 2 }, g);
        el('circle', { r: 46, fill: 'url(#br-classic-face)', stroke: '#7a4e22', 'stroke-width': 3 }, g);
        el('circle', { r: 39, fill: 'none', stroke: ink, 'stroke-width': 2.5 }, g);
        text({ y: 1 }, ink);
        break;
      case 'jade':
        el('circle', { cx: 4, cy: 10, r: 53, fill: 'url(#br-shadow)' }, g);
        el('circle', { cy: 6, r: 46, fill: 'url(#br-jade-edge)' }, g);
        el('circle', { r: 46, fill: 'url(#br-jade-face)', stroke: 'rgba(30,80,55,0.45)', 'stroke-width': 1 }, g);
        el('circle', { r: 38, fill: 'none', stroke: 'rgba(255,255,255,0.75)', 'stroke-width': 2 }, g);
        text({ x: 1.2, y: 2.6 }, 'rgba(255,255,255,0.7)');
        text({ y: 1 }, ink);
        break;
      case 'modern':
        el('circle', { cy: 6, r: 48, fill: 'rgba(0,0,0,0.25)' }, g);
        el('circle', { r: 46, fill: ink, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 1 }, g);
        el('circle', { r: 39, fill: 'none', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': 2.5 }, g);
        text({ y: 1 }, '#ffffff');
        break;
      default: // wood — gỗ khắc chữ
        el('circle', { cx: 4, cy: 10, r: 53, fill: 'url(#br-shadow)' }, g);
        el('circle', { cy: 6, r: 46, fill: 'url(#br-wood-edge)' }, g);
        el('circle', { r: 46, fill: 'url(#br-wood-face)', stroke: 'rgba(120,75,35,0.35)', 'stroke-width': 1 }, g);
        el('circle', { r: 46, fill: 'url(#br-grain)' }, g);
        el('circle', { cx: 0.8, cy: 1.3, r: 38, fill: 'none', stroke: 'rgba(255,244,222,0.85)', 'stroke-width': 1.4 }, g);
        el('circle', { r: 38, fill: 'none', stroke: 'rgba(140,90,45,0.75)', 'stroke-width': 2 }, g);
        text({ x: 1.3, y: 2.8 }, 'rgba(255,246,228,0.9)');
        text({ y: 1 }, ink);
    }
    if (selected) el('circle', { r: 49, fill: 'none', stroke: '#1d6fe0', 'stroke-width': 4 }, g);
    return g;
  }

  // Font chữ Hán từ Google Fonts — chỉ tải đúng các chữ dùng trên quân cờ
  const FONT_CSS = 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@700&family=Noto+Serif+TC:wght@700&family=Noto+Sans+TC:wght@700&display=swap&text='
    + encodeURIComponent('帥仕相馬車炮兵將士象卒楚河漢界');

  return { DEFAULT_THEME, BUILTIN_BOARDS, PIECE_STYLES, FONTS, FONT_CSS, geometry, drawBoard, drawPiece };
});
