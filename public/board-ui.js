// Bàn cờ tương tác gọn nhẹ (dùng cho trang Bài tập và trình soạn bài tập trong admin).
// Cần board-render.js (BoardRender) và xiangqi.js (Xiangqi).
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const BR = root.BoardRender, X = root.Xiangqi;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  class BoardUI {
    // opts: { theme, flipped, onClick(r, c) }
    constructor(svg, opts = {}) {
      this.svg = svg;
      this.theme = opts.theme || BR.DEFAULT_THEME;
      this.flipped = !!opts.flipped;
      this.onClick = opts.onClick || null;
      this.board = X.initialBoard();
      this.selected = null; // [r, c]
      this.targets = []; // [[r, c]]
      this.lastMove = null; // { from, to }
      this.hint = null; // [r, c] — ô được gợi ý
      this.flash = null; // { at: [r, c], color } — nháy đỏ khi đi sai
      svg.style.cursor = 'pointer';
      svg.style.touchAction = 'manipulation';
      svg.addEventListener('click', (e) => this._click(e));
    }

    set(props) {
      Object.assign(this, props);
      this.render();
    }

    view(r, c) { return this.flipped ? [9 - r, 8 - c] : [r, c]; }

    render() {
      const g = (this.geo = BR.drawBoard(this.svg, this.theme, { flipped: this.flipped }));
      const layer = el('g', {}, this.svg);
      const u = g.unit;
      const at = (r, c) => { const [vr, vc] = this.view(r, c); return [g.xs[vc], g.ys[vr]]; };
      const ring = (r, c, rad, attrs) => { const [x, y] = at(r, c); el('circle', { cx: x, cy: y, r: rad * u, ...attrs }, layer); };

      if (this.lastMove) {
        ring(this.lastMove.from[0], this.lastMove.from[1], 30, { fill: 'rgba(29,111,224,.16)', stroke: 'rgba(29,111,224,.6)', 'stroke-width': 3 * u, 'stroke-dasharray': `${8 * u} ${6 * u}` });
      }
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (!p) continue;
          const [x, y] = at(r, c);
          const sel = this.selected && this.selected[0] === r && this.selected[1] === c;
          BR.drawPiece(layer, this.theme, u, p, X.CHARS[p], x, y, sel);
        }
      }
      if (this.lastMove) ring(this.lastMove.to[0], this.lastMove.to[1], 49, { fill: 'none', stroke: '#1d6fe0', 'stroke-width': 5 * u });
      if (this.hint) ring(this.hint[0], this.hint[1], 50, { fill: 'none', stroke: '#2ea05a', 'stroke-width': 7 * u });
      if (this.flash) ring(this.flash.at[0], this.flash.at[1], 50, { fill: 'rgba(224,40,27,.25)', stroke: '#e0281b', 'stroke-width': 6 * u });
      for (const [r, c] of this.targets) {
        if (this.board[r][c]) ring(r, c, 47, { fill: 'none', stroke: 'rgba(29,111,224,.85)', 'stroke-width': 6 * u });
        else ring(r, c, 13, { fill: 'rgba(29,111,224,.6)' });
      }
    }

    _click(e) {
      if (!this.onClick || !this.geo) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());
      const nearest = (arr, v) => arr.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(arr[best] - v) ? i : best), 0);
      const vc = nearest(this.geo.xs, pt.x), vr = nearest(this.geo.ys, pt.y);
      const tol = 70 * this.geo.unit;
      if (Math.abs(this.geo.xs[vc] - pt.x) > tol || Math.abs(this.geo.ys[vr] - pt.y) > tol) return;
      const [r, c] = this.view(vr, vc); // phép lật là đối xứng
      this.onClick(r, c);
    }
  }

  root.BoardUI = BoardUI;
})(typeof self !== 'undefined' ? self : this);
