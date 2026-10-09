// Tab "Phân tích" (trang Đấu máy): bàn cờ tự do + engine phân tích liên tục, giống phần mềm Pikafish.
// - Đi quân cho cả hai bên, tua lại / rẽ nhánh, lật bàn, bày thế cờ, nhập / xuất FEN
// - Pikafish trên server (POST /api/engine/stream) hoặc Fairy-Stockfish trên trình duyệt (engine-pro.js)
// - Nhiều phương án (MultiPV), độ sâu / số nút / tốc độ, thanh thế trận, mũi tên nước tốt nhất
// Cần xiangqi.js, board-render.js, board-ui.js. Dùng: AnalysisBoard.open(container, { getTheme, toast })
(function (root) {
  'use strict';
  const X = root.Xiangqi;
  const NS = 'http://www.w3.org/2000/svg';
  const MATE = 30000, MATE_NEAR = 29000;
  const PIECES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
  const PIECE_NAME = { K: 'Tướng', A: 'Sĩ', B: 'Tượng', N: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
    return e;
  }
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const other = (s) => (s === 'r' ? 'b' : 'r');
  const sideName = (s) => (s === 'r' ? 'Đỏ' : 'Đen');

  // ---------- FEN & toạ độ engine (Pikafish: cột a–i, hàng 0–9 tính từ phía Đỏ) ----------
  function toFen(b, side) {
    const rows = b.map((row) => {
      let s = '', empty = 0;
      for (const p of row) {
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p[0] === 'r' ? p[1] : p[1].toLowerCase();
      }
      return s + (empty || '');
    });
    return `${rows.join('/')} ${side === 'r' ? 'w' : 'b'} - - 0 1`;
  }
  // Trả về { board, side } hoặc chuỗi lỗi
  function parseFen(text) {
    const parts = String(text || '').trim().split(/\s+/);
    const rows = (parts[0] || '').split('/');
    if (rows.length !== 10) return 'FEN phải có 10 hàng (ngăn cách bằng dấu /).';
    const map = { k: 'K', a: 'A', b: 'B', e: 'B', n: 'N', h: 'N', r: 'R', c: 'C', p: 'P' };
    const board = [];
    for (const row of rows) {
      const out = [];
      for (const ch of row) {
        if (/[1-9]/.test(ch)) { for (let i = 0; i < Number(ch); i++) out.push(null); continue; }
        const t = map[ch.toLowerCase()];
        if (!t) return `Ký tự "${ch}" không hợp lệ trong FEN.`;
        out.push((ch === ch.toUpperCase() ? 'r' : 'b') + t);
      }
      if (out.length !== 9) return 'Mỗi hàng của FEN phải đủ 9 cột.';
      board.push(out);
    }
    const side = /^[bB]$/.test(parts[1] || 'w') ? 'b' : 'r';
    const err = X.validatePosition(board, side);
    return err || { board, side };
  }
  const sq = (r, c) => `${String.fromCharCode(97 + c)}${9 - r}`;
  const toUci = (m) => sq(...m.from) + sq(...m.to);
  function fromUci(s) {
    const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s || '');
    return m ? { from: [9 - Number(m[2]), m[1].charCodeAt(0) - 97], to: [9 - Number(m[4]), m[3].charCodeAt(0) - 97] } : null;
  }
  const same = (a, b) => a && b && a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];

  // Điểm theo phía Đỏ → nhãn ngắn
  function scoreText(score) {
    if (Math.abs(score) > MATE_NEAR) return `${score > 0 ? '+' : '−'}M${Math.ceil((MATE - Math.abs(score)) / 2)}`;
    const v = score / 100;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  }
  function verdict(score) {
    if (Math.abs(score) > MATE_NEAR) {
      const n = Math.ceil((MATE - Math.abs(score)) / 2);
      return `${score > 0 ? 'Đỏ' : 'Đen'} chiếu bí sau ${n} nước`;
    }
    const v = score / 100;
    return v > 3 ? 'Đỏ thắng thế' : v > 1 ? 'Đỏ ưu thế' : v > 0.3 ? 'Đỏ hơi nhỉnh' : v >= -0.3 ? 'Cân bằng'
      : v >= -1 ? 'Đen hơi nhỉnh' : v >= -3 ? 'Đen ưu thế' : 'Đen thắng thế';
  }
  // Điểm "phẳng" để so sánh (chiếu bí → rất lớn, càng nhanh càng lớn)
  const flat = (s) => (Math.abs(s) > MATE_NEAR ? Math.sign(s) * (3000 - (MATE - Math.abs(s))) : Math.max(-2500, Math.min(2500, s)));
  // Tỉ lệ thắng ước tính của bên đang đi (0–1) — độ dài thanh mạnh/yếu
  const winRate = (s) => 1 / (1 + Math.exp(-flat(s) / 250));
  // Đánh giá một nước theo số điểm mất so với nước tốt nhất (cùng góc nhìn bên đang đi)
  const QUALITY = [
    { max: 5, key: 'best', label: '★ Tốt nhất' },
    { max: 40, key: 'good', label: '✓ Tốt' },
    { max: 100, key: 'ok', label: 'Chấp nhận được' },
    { max: 200, key: 'inacc', label: '?! Không chính xác' },
    { max: 400, key: 'mistake', label: '? Sai lầm' },
    { max: Infinity, key: 'blunder', label: '?? Sai lầm nặng' },
  ];
  const bestScore = (lines) => lines.reduce((m, l) => (flat(l.score) > flat(m) ? l.score : m), lines[0].score);
  const quality = (best, score) => QUALITY.find((q) => flat(best) - flat(score) <= q.max);
  const fmtNum = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));

  // ---------- Trạng thái ----------
  const st = {
    mounted: false, deps: null, ui: null, el: {},
    start: X.initialBoard(), startSide: 'r', moves: [], ply: 0, selected: null, targets: [], flip: false,
    edit: null, // { board, side, pick } khi đang bày thế cờ
    evals: new Map(), evalWorker: null, // điểm từng thế cờ cho biểu đồ thế trận
    eng: { on: true, kind: 'pikafish', multipv: 3, arrow: true, info: null, done: false, error: '', token: 0, abort: null, worker: null, serverOk: null },
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
  };

  function boardsUpTo(ply) {
    const out = [st.start];
    let b = st.start;
    for (let i = 0; i < ply; i++) { b = X.applyMove(b, st.moves[i].from, st.moves[i].to); out.push(b); }
    return out;
  }
  const curBoard = () => boardsUpTo(st.ply)[st.ply];
  const sideAt = (ply) => (ply % 2 === 0 ? st.startSide : other(st.startSide));

  // ---------- Dựng giao diện ----------
  function mount(container) {
    const E = st.el;
    const btn = (label, title, onclick, cls = 'btn sm') => h('button', { class: cls, title, 'aria-label': title, onclick, text: label });
    E.evalFill = h('i');
    E.chart = h('div', { class: 'ab-chart', title: 'Bấm để nhảy tới nước đó' });
    E.chart.addEventListener('click', (e) => {
      const r = E.chart.getBoundingClientRect();
      const n = st.moves.length;
      if (!n) return;
      goto(Math.round(((e.clientX - r.left) / r.width) * n));
    });
    E.evalNum = h('span');
    E.svg = document.createElementNS(NS, 'svg');
    E.svg.setAttribute('role', 'img');
    E.svg.setAttribute('aria-label', 'Bàn cờ phân tích');
    E.frame = h('div', { class: 'pz-board-frame ab-frame' }, E.svg);
    E.status = h('div', { class: 'ab-status' }); // không hiển thị (giữ để mã cũ không lỗi)
    E.saveRow = h('div', { class: 'ab-saverow' },
      h('button', { class: 'btn primary sm', title: 'Lưu thế cờ & các nước đã đi vào Lịch sử luyện tập', onclick: () => saveCurrent() },
        'Lưu vào lịch sử'));
    E.editBar = h('div', { class: 'ab-editbar hidden' });
    E.toolbar = h('div', { class: 'ab-toolbar' },
      btn('⏮', 'Về đầu', () => goto(0)), btn('◀', 'Lùi một nước (←)', () => goto(st.ply - 1)),
      btn('▶', 'Tiến một nước (→)', () => goto(st.ply + 1)), btn('⏭', 'Về nước cuối', () => goto(st.moves.length)),
      h('span', { class: 'ab-sep' }),
      btn('Lật bàn', 'Lật bàn cờ', () => { st.flip = !st.flip; renderBoard(); }),
      btn('Đi lại', 'Xoá nước cuối', () => { if (st.moves.length) { st.moves.pop(); st.ply = Math.min(st.ply, st.moves.length); changed(); } }),
      btn('Bàn mới', 'Bắt đầu lại từ thế ban đầu', () => setPosition(X.initialBoard(), 'r')),
      btn('Bày thế cờ', 'Tự xếp quân lên bàn', () => startEdit()),
      btn('Lưu', 'Lưu thế cờ & các nước đã đi vào Lịch sử luyện tập', () => saveCurrent(), 'btn sm ab-save'));

    // Engine
    E.engOn = h('input', { type: 'checkbox', class: 'toggle', 'aria-label': 'Bật phân tích' });
    E.engKind = h('select', { class: 'sel-sm', 'aria-label': 'Engine' },
      h('option', { value: 'pikafish', text: 'Pikafish (server)' }), h('option', { value: 'fairy', text: 'Fairy-Stockfish (trình duyệt)' }));
    E.multipv = h('select', { class: 'sel-sm', 'aria-label': 'Số phương án' },
      ...[1, 2, 3, 5, 10].map((n) => h('option', { value: String(n), text: `${n} phương án` })),
      h('option', { value: 'all', text: 'Tất cả nước' }));
    E.arrow = h('input', { type: 'checkbox' });
    E.score = h('b', { class: 'ab-score' });
    E.verdict = h('span', { class: 'ab-verdict' });
    E.stats = h('div', { class: 'ab-stats' });
    E.lines = h('ol', { class: 'ab-lines' });
    E.filter = h('small', { class: 'ab-filter' });
    E.engMsg = h('p', { class: 'ab-msg' });
    const engCard = h('div', { class: 'card ab-card' },
      h('div', { class: 'card-head plain' }, h('div', {}, h('h3', { text: 'Engine phân tích' }),
        h('p', { text: 'Điểm theo phía Đỏ (đơn vị: tốt) · thanh = tỉ lệ thắng của bên đang đi' })), E.engOn),
      h('div', { class: 'ab-controls' }, E.engKind, E.multipv, h('label', { class: 'check' }, E.arrow, ' Mũi tên')),
      h('div', { class: 'ab-scorebox' }, E.score, E.verdict), E.stats, E.filter, E.lines, E.engMsg);

    E.moveList = h('ol', { class: 'ab-moves' });
    const movesCard = h('div', { class: 'card ab-card' },
      h('div', { class: 'card-head plain' }, h('h3', { text: 'Biên bản' }), h('small', { class: 'muted', text: 'Bấm nước để quay lại' })), E.moveList);

    E.fen = h('input', { class: 'ab-fen', spellcheck: 'false', 'aria-label': 'FEN' });
    const fenCard = h('div', { class: 'card ab-card' },
      h('div', { class: 'card-head plain' }, h('h3', { text: 'FEN' })), E.fen,
      h('div', { class: 'row tight' },
        btn('Nạp FEN', 'Nạp thế cờ từ FEN', () => {
          const r = parseFen(E.fen.value);
          if (typeof r === 'string') return st.deps.toast(r);
          setPosition(r.board, r.side);
        }),
        btn('Sao chép', 'Sao chép FEN', async () => {
          try { await navigator.clipboard.writeText(E.fen.value); st.deps.toast('Đã sao chép FEN.'); } catch { E.fen.select(); }
        })));

    // Bố cục giống bàn đấu: trái = biên bản + FEN, giữa = bàn cờ, phải = engine phân tích
    container.replaceChildren(h('div', { class: 'ab-layout' },
      // Trái: biên bản + thanh thế trận (ngang) bên dưới. Khung FEN đã bỏ.
      h('div', { class: 'ab-left' }, movesCard,
        h('div', { class: 'card ab-card ab-evalcard' }, h('div', { class: 'card-head plain' }, h('h3', { text: 'Thế trận' }), E.evalNum),
          E.chart, h('small', { class: 'ab-chart-note', text: 'Trên vạch giữa: Đỏ ưu thế · dưới: Đen ưu thế. Bấm để nhảy tới nước.' }))),
      h('div', { class: 'ab-main' },
        h('div', { class: 'ab-board-row' }, E.frame),
        E.toolbar, E.editBar),
      h('div', { class: 'ab-right' }, engCard)));

    st.ui = new root.BoardUI(E.svg, { theme: st.deps.getTheme(), onClick: onBoardClick });
    const saved = (k, d) => store.get('tk-ab-' + k) ?? d;
    st.eng.on = saved('on', '1') === '1';
    st.eng.kind = saved('kind', 'pikafish');
    st.eng.multipv = saved('multipv', '3');
    st.eng.arrow = saved('arrow', '1') === '1';
    E.engOn.checked = st.eng.on; E.engKind.value = st.eng.kind; E.multipv.value = String(st.eng.multipv); E.arrow.checked = st.eng.arrow;
    E.engOn.addEventListener('change', () => { st.eng.on = E.engOn.checked; store.set('tk-ab-on', st.eng.on ? '1' : '0'); restartEngine(); });
    E.engKind.addEventListener('change', () => { st.eng.kind = E.engKind.value; store.set('tk-ab-kind', st.eng.kind); restartEngine(); });
    E.multipv.addEventListener('change', () => { st.eng.multipv = E.multipv.value; store.set('tk-ab-multipv', E.multipv.value); restartEngine(); });
    E.arrow.addEventListener('change', () => { st.eng.arrow = E.arrow.checked; store.set('tk-ab-arrow', st.eng.arrow ? '1' : '0'); renderBoard(); });
    document.addEventListener('keydown', (e) => {
      if (!container.offsetParent || st.edit || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft') { goto(st.ply - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { goto(st.ply + 1); e.preventDefault(); }
    });
    st.mounted = true;
  }

  // ---------- Bàn cờ ----------
  function onBoardClick(r, c) {
    if (st.edit) return editClick(r, c);
    const b = curBoard();
    const side = sideAt(st.ply);
    const p = b[r][c];
    if (st.selected && st.targets.some(([tr, tc]) => tr === r && tc === c)) {
      play({ from: st.selected, to: [r, c] });
      return;
    }
    if (p && p[0] === side) {
      st.selected = [r, c];
      st.targets = X.legalMovesFrom(b, r, c);
    } else {
      st.selected = null; st.targets = [];
    }
    renderBoard();
    renderEngine(); // lọc danh sách theo quân đang chọn
  }

  // Đi một nước ở vị trí đang xem: trùng nước kế tiếp thì tiến lên, khác thì rẽ nhánh (bỏ các nước sau)
  function play(m) {
    if (same(st.moves[st.ply], m)) st.ply++;
    else { st.moves = st.moves.slice(0, st.ply); st.moves.push(m); st.ply++; }
    changed();
  }
  function goto(ply) {
    const n = Math.max(0, Math.min(st.moves.length, ply));
    if (n === st.ply) return;
    st.ply = n;
    changed();
  }
  function setPosition(board, side) {
    st.start = board; st.startSide = side; st.moves = []; st.ply = 0;
    changed();
  }
  // ---------- Biểu đồ thế trận theo từng nước ----------
  // Điểm (theo phía Đỏ) của từng thế cờ, khoá = thế đầu + các nước đã đi
  const posKey = (ply) => toFen(st.start, st.startSide) + '|' + st.moves.slice(0, ply).map(toUci).join(' ');
  let filling = false;
  function fillEvals() {
    if (filling) return;
    const n = st.moves.length;
    let ply = -1;
    for (let i = 0; i <= n; i++) if (!st.evals.has(posKey(i))) { ply = i; break; }
    if (ply < 0) return;
    filling = true;
    if (!st.evalWorker) st.evalWorker = new Worker('engine-pro.js');
    const boards = boardsUpTo(ply);
    const key = posKey(ply), side = sideAt(ply);
    const id = Date.now() + Math.random();
    const done = (e) => {
      if (e.data.id !== id) return;
      st.evalWorker.removeEventListener('message', done);
      const res = e.data.result;
      let sc = res ? res.bestScore : 0;
      if (res && !res.best) sc = -MATE; // hết nước đi = bên đang đi thua
      if (!st.evals.has(key)) st.evals.set(key, { score: side === 'r' ? sc : -sc, depth: res ? res.depth : 0 });
      filling = false;
      renderChart();
      fillEvals();
    };
    st.evalWorker.addEventListener('message', done);
    st.evalWorker.postMessage({ type: 'analyze', id, board: boards[ply], side, played: null, boards });
  }

  function renderChart() {
    const E = st.el;
    if (!E.chart) return;
    const n = st.moves.length;
    const W = 200, H = 90, pad = 4;
    const clampY = (s) => { const f = Math.abs(s) > MATE_NEAR ? Math.sign(s) * 2000 : s; return Math.tanh(f / 260); }; // ±1 tốt ≈ 37%, ±3 tốt ≈ 82% nửa chiều cao
    const x = (i) => (n ? pad + (i / n) * (W - pad * 2) : W / 2);
    const y = (v) => H / 2 - v * (H / 2 - pad);
    const pts = [];
    for (let i = 0; i <= n; i++) { const e = st.evals.get(posKey(i)); if (e) pts.push([i, clampY(e.score)]); }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svgEl('rect', { x: 0, y: 0, width: W, height: H / 2, class: 'ch-red-bg' }, svg);
    svgEl('rect', { x: 0, y: H / 2, width: W, height: H / 2, class: 'ch-black-bg' }, svg);
    // Lưới kẻ: ngang ở các mức ±1, ±3 tốt; dọc theo nước đi (ván dài thì giãn cách cho đỡ rối)
    const LEVELS = [300, 100, -100, -300];
    for (const lv of LEVELS) svgEl('line', { x1: 0, y1: y(clampY(lv)), x2: W, y2: y(clampY(lv)), class: 'ch-grid', 'vector-effect': 'non-scaling-stroke' }, svg);
    const step = n <= 16 ? 1 : n <= 40 ? 2 : n <= 80 ? 5 : 10;
    const vticks = [];
    for (let i = step; i < n; i += step) vticks.push(i);
    for (const i of vticks) svgEl('line', { x1: x(i), y1: 0, x2: x(i), y2: H, class: 'ch-grid v', 'vector-effect': 'non-scaling-stroke' }, svg);
    if (pts.length >= 1) {
      const line = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const area = `${x(pts[0][0]).toFixed(1)},${H / 2} ${line} ${x(pts[pts.length - 1][0]).toFixed(1)},${H / 2}`;
      // Vùng đỏ (trên vạch) & đen (dưới vạch): cắt cùng một vùng bằng 2 hình chữ nhật
      const clipTop = svgEl('clipPath', { id: 'ab-clip-top' }, svg); svgEl('rect', { x: 0, y: 0, width: W, height: H / 2 }, clipTop);
      const clipBot = svgEl('clipPath', { id: 'ab-clip-bot' }, svg); svgEl('rect', { x: 0, y: H / 2, width: W, height: H / 2 }, clipBot);
      svgEl('polygon', { points: area, class: 'ch-red', 'clip-path': 'url(#ab-clip-top)' }, svg);
      svgEl('polygon', { points: area, class: 'ch-black', 'clip-path': 'url(#ab-clip-bot)' }, svg);
      svgEl('polyline', { points: line, class: 'ch-line', 'vector-effect': 'non-scaling-stroke' }, svg);
    }
    svgEl('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'ch-mid', 'vector-effect': 'non-scaling-stroke' }, svg);
    // Nước đang xem
    svgEl('line', { x1: x(st.ply), y1: 0, x2: x(st.ply), y2: H, class: 'ch-cur', 'vector-effect': 'non-scaling-stroke' }, svg);
    E.chart.replaceChildren(svg);
    // Nhãn (HTML để chữ không bị méo khi biểu đồ co giãn)
    for (const [lv, txt] of [[300, '+3'], [100, '+1'], [0, '0'], [-100, '−1'], [-300, '−3']]) {
      const lab = h('span', { class: 'ch-ylab' + (lv > 0 ? ' red' : lv < 0 ? ' black' : ''), text: txt });
      lab.style.top = `${(y(clampY(lv)) / H) * 100}%`;
      E.chart.appendChild(lab);
    }
    const labelEvery = Math.max(step, Math.ceil(n / 8)); // tối đa ~8 số dưới trục
    for (let i = labelEvery; i < n; i += labelEvery) {
      const lab = h('span', { class: 'ch-xlab', text: String(i) });
      lab.style.left = `${(x(i) / W) * 100}%`;
      E.chart.appendChild(lab);
    }
    const cur = st.evals.get(posKey(st.ply));
    if (cur) {
      const dot = h('i', { class: 'ch-dot' });
      dot.style.left = `${(x(st.ply) / W) * 100}%`;
      dot.style.top = `${(y(clampY(cur.score)) / H) * 100}%`;
      E.chart.appendChild(dot);
    }
    const pending = n + 1 - pts.length;
    E.chart.dataset.pending = pending > 0 ? `Đang tính ${pending} nước…` : '';
  }

  function changed() {
    st.selected = null; st.targets = [];
    st.eng.info = null; // kết quả cũ không còn đúng với thế cờ mới
    setTimeout(fillEvals, 300);
    renderAll();
    restartEngine();
  }

  function renderBoard() {
    const E = st.el;
    const b = st.edit ? st.edit.board : curBoard();
    const last = !st.edit && st.ply > 0 ? st.moves[st.ply - 1] : null;
    st.ui.set({ theme: st.deps.getTheme(), board: b, flipped: st.flip, selected: st.selected, targets: st.targets, lastMove: last });
    const [, , w, hh] = st.ui.geo.viewBox;
    E.frame.style.setProperty('--pz-ar', (w / hh).toFixed(4));
    // Mũi tên nước tốt nhất của engine
    const info = st.eng.info;
    if (!st.edit && st.eng.on && st.eng.arrow && info && info.lines.length) {
      const g = st.ui.geo, u = g.unit;
      const layer = svgEl('g', {}, E.svg);
      info.lines.slice(0, Math.min(3, info.lines.length)).reverse().forEach((l, i, arr) => {
        const m = fromUci(l.move);
        if (!m) return;
        const at = (r, c) => { const [vr, vc] = st.ui.view(r, c); return [g.xs[vc], g.ys[vr]]; };
        const [x1, y1] = at(...m.from), [x2, y2] = at(...m.to);
        const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const hx = x2 - ux * 45 * u, hy = y2 - uy * 45 * u, nx = -uy * 25 * u, ny = ux * 25 * u;
        const cls = i === arr.length - 1 ? 'best-arrow' : 'alt-arrow';
        svgEl('line', { x1, y1, x2: hx + ux * 3 * u, y2: hy + uy * 3 * u, class: cls, style: `stroke-width:${(i === arr.length - 1 ? 17 : 11) * u}` }, layer);
        svgEl('polygon', { points: `${x2 - ux * 11 * u},${y2 - uy * 11 * u} ${hx + nx},${hy + ny} ${hx - nx},${hy - ny}`, class: cls + '-head' }, layer);
      });
    }
    // Chỉ dẫn trên bàn: chọn một quân → mỗi ô đến hiện điểm, tô màu theo chất lượng nước
    if (!st.edit && st.eng.on && st.selected && info && info.lines.length) {
      const g = st.ui.geo, u = g.unit;
      const layer = svgEl('g', { class: 'ab-badges' }, E.svg);
      const side = sideAt(st.ply), best = bestScore(info.lines);
      for (const l of info.lines) {
        const m = fromUci(l.move);
        if (!m || m.from[0] !== st.selected[0] || m.from[1] !== st.selected[1]) continue;
        const [vr, vc] = st.ui.view(...m.to);
        const x = g.xs[vc], y = g.ys[vr] - 42 * u;
        const q = quality(best, l.score);
        const text = scoreText(side === 'r' ? l.score : -l.score);
        const w = (text.length * 15 + 16) * u;
        svgEl('rect', { x: x - w / 2, y: y - 15 * u, width: w, height: 30 * u, rx: 15 * u, class: 'ab-badge q-' + q.key }, layer);
        const t = svgEl('text', { x, y: y + 7 * u, 'text-anchor': 'middle', 'font-size': 21 * u, class: 'ab-badge-text' }, layer);
        t.textContent = text;
      }
    }
  }

  function renderAll() {
    const E = st.el;
    renderBoard();
    const b = curBoard();
    const side = sideAt(st.ply);
    E.fen.value = toFen(b, side);
    const over = !X.hasAnyLegalMove(b, side);
    E.status.textContent = st.edit ? 'Đang bày thế cờ — chọn quân bên dưới rồi bấm lên bàn'
      : over ? `${sideName(side)} hết nước đi — ${sideName(other(side))} thắng`
        : `Lượt ${sideName(side)}${X.isInCheck(b, side) ? ' · đang bị chiếu!' : ''} · nước ${st.ply}/${st.moves.length}`;
    // Biên bản: mỗi dòng một cặp nước
    const boards = boardsUpTo(st.moves.length);
    const items = [];
    const offset = st.startSide === 'b' ? 1 : 0;
    for (let i = 0; i < st.moves.length; i++) {
      const k = i + offset;
      const name = X.notation(boards[i], st.moves[i].from, st.moves[i].to);
      const cell = h('button', { class: 'ab-mv' + (i + 1 === st.ply ? ' cur' : ''), text: name, onclick: () => goto(i + 1) });
      if (k % 2 === 0 || i === 0) items.push(h('li', {}, h('span', { class: 'ab-no', text: `${Math.floor(k / 2) + 1}.` }), k % 2 === 1 ? h('span', { class: 'ab-mv empty', text: '…' }) : null));
      items[items.length - 1].append(cell);
    }
    E.moveList.replaceChildren(...(items.length ? items : [h('li', { class: 'muted ab-empty', text: 'Chưa có nước nào — đi quân trên bàn để bắt đầu.' })]));
    const cur = E.moveList.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    renderEngine();
    renderChart();
  }

  // ---------- Engine ----------
  function renderEngine() {
    const E = st.el, eng = st.eng;
    const info = eng.info;
    const b = curBoard(), side = sideAt(st.ply);
    const red = (s) => (side === 'r' ? s : -s); // engine chấm theo bên đang đi → đổi sang phía Đỏ
    if (!eng.on || st.edit) {
      E.score.textContent = '—'; E.verdict.textContent = st.edit ? 'Đang bày thế cờ' : 'Đã tắt phân tích';
      E.stats.textContent = ''; E.lines.replaceChildren(); E.engMsg.textContent = ''; E.filter.textContent = '';
      E.evalFill.style.width = '50%'; E.evalNum.textContent = '';
      return;
    }
    if (!info || !info.lines.length) {
      E.score.textContent = '…'; E.verdict.textContent = eng.error ? '' : 'Đang tính…';
      E.stats.textContent = ''; E.lines.replaceChildren(); E.filter.textContent = '';
    } else {
      const top = red(info.lines[0].score);
      E.score.textContent = scoreText(top);
      E.score.className = 'ab-score' + (top > 30 ? ' red' : top < -30 ? ' black' : '');
      E.verdict.textContent = verdict(top);
      const clamp = Math.abs(top) > MATE_NEAR ? Math.sign(top) * 2000 : top;
      E.evalFill.style.width = `${Math.round(50 + 50 * Math.tanh(clamp / 500))}%`;
      E.evalNum.textContent = scoreText(top);
      E.stats.replaceChildren(
        h('span', { text: info.depth >= 200 ? 'Độ sâu tối đa (đã tìm ra kết cục)' : `Độ sâu ${info.depth}${info.seldepth ? '/' + info.seldepth : ''}` }),
        h('span', { text: `${fmtNum(info.nodes)} nút` }),
        h('span', { text: `${fmtNum(info.nps)}/giây` }),
        h('span', { text: `${(info.time / 1000).toFixed(1)} giây` }),
        h('span', { class: 'ab-state', text: eng.done ? 'Đã dừng' : 'Đang tính…' }));
      const best = bestScore(info.lines);
      const sel = st.selected;
      const sorted = info.lines.slice().sort((a, c) => flat(c.score) - flat(a.score));
      const shown = sel ? sorted.filter((l) => { const m = fromUci(l.move); return m && m.from[0] === sel[0] && m.from[1] === sel[1]; }) : sorted;
      const p = sel && b[sel[0]][sel[1]];
      E.filter.textContent = sel
        ? (shown.length ? `Các nước của ${PIECE_NAME[p[1]]} đang chọn — bấm ra ngoài để xem tất cả`
          : `Chưa có điểm cho ${PIECE_NAME[p[1]]} này — chọn "Tất cả nước" để máy chấm mọi nước`)
        : `${shown.length} nước · bấm một nước để đi`;
      E.lines.replaceChildren(...shown.map((l) => {
        // Đổi chuỗi nước sang ký hiệu Việt (P2-5 M8.7 …)
        let bb = b, s = side;
        const names = [];
        for (const u of l.pv) {
          const m = fromUci(u);
          if (!m || !bb[m.from[0]][m.from[1]] || bb[m.from[0]][m.from[1]][0] !== s) break;
          names.push(X.notation(bb, m.from, m.to));
          bb = X.applyMove(bb, m.from, m.to); s = other(s);
        }
        const sc = red(l.score);
        const q = quality(best, l.score);
        const wr = Math.round(winRate(l.score) * 100);
        const first = fromUci(l.move);
        return h('li', { class: 'ab-line q-' + q.key, title: 'Bấm để đi nước này', onclick: () => first && play(first) },
          h('div', { class: 'ab-lhead' },
            h('b', { class: 'ab-lmove', text: names[0] || l.move }),
            h('span', { class: 'ab-qtag', text: q.label }),
            h('span', { class: 'ab-lscore' + (sc > 30 ? ' red' : sc < -30 ? ' black' : ''), text: scoreText(sc) })),
          h('div', { class: 'ab-strength', title: `Tỉ lệ thắng ước tính của ${sideName(side)} sau nước này: ${wr}%` },
            h('i', { style: `width:${wr}%` }), h('span', { text: `${wr}%` })),
          names.length > 1 ? h('small', { class: 'ab-sample' }, 'Diễn biến mẫu: ', names.slice(1).join('  ')) : null,
          l.depth < 200 ? h('small', { class: 'ab-ldepth', text: `độ sâu ${l.depth}` }) : null);
      }));
    }
    E.engMsg.textContent = eng.error;
  }

  function stopEngine() {
    const eng = st.eng;
    eng.token++;
    if (eng.abort) { eng.abort.abort(); eng.abort = null; }
    if (eng.worker) eng.worker.postMessage({ type: 'stop' });
  }

  let restartTimer = null;
  function restartEngine() {
    stopEngine();
    const eng = st.eng;
    eng.info = null; eng.done = false; eng.error = '';
    clearTimeout(restartTimer);
    if (!eng.on || st.edit) { renderEngine(); renderBoard(); return; }
    const b = curBoard(), side = sideAt(st.ply);
    if (!X.hasAnyLegalMove(b, side)) { eng.error = 'Hết nước đi — không cần phân tích.'; eng.done = true; renderEngine(); return; }
    renderEngine();
    restartTimer = setTimeout(() => runEngine(eng.token), 120); // gom các lần bấm nhanh
  }

  async function runEngine(token) {
    const eng = st.eng;
    const pos = { fen: toFen(st.start, st.startSide), moves: st.moves.slice(0, st.ply).map(toUci), multipv: eng.multipv === 'all' ? 128 : Number(eng.multipv) || 3, movetime: 60000 };
    const onInfo = (info) => {
      if (token !== eng.token) return;
      eng.info = info;
      if (info.lines.length) {
        const k = posKey(st.ply), prev = st.evals.get(k), sc = sideAt(st.ply) === 'r' ? info.lines[0].score : -info.lines[0].score;
        if (!prev || info.depth >= prev.depth) { st.evals.set(k, { score: sc, depth: info.depth }); renderChart(); }
      }
      renderEngine();
      renderBoard();
    };
    const onDone = () => { if (token !== eng.token) return; eng.done = true; renderEngine(); };
    const onError = (msg) => { if (token !== eng.token) return; eng.error = msg; eng.done = true; renderEngine(); };

    if (eng.kind === 'pikafish') {
      if (eng.serverOk === null) {
        try { eng.serverOk = !!(await (await fetch('/api/engine')).json()).available; } catch { eng.serverOk = false; }
      }
      if (!eng.serverOk) return onError('Server chưa cài Pikafish (npm run setup:engine) — hãy chọn Fairy-Stockfish.');
      const ctrl = new AbortController();
      eng.abort = ctrl;
      try {
        const res = await fetch('/api/engine/stream', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pos), signal: ctrl.signal,
        });
        if (!res.ok) return onError((await res.json().catch(() => ({}))).error || 'Engine bận, thử lại sau.');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line) continue;
            const msg = JSON.parse(line);
            if (msg.type === 'info') onInfo(msg);
            else if (msg.type === 'done') onDone();
            else if (msg.type === 'error') onError(msg.error);
          }
        }
        onDone();
      } catch (err) {
        if (err.name !== 'AbortError') onError('Mất kết nối tới engine.');
      }
      return;
    }
    // Fairy-Stockfish trong worker
    if (!eng.worker) {
      eng.worker = new Worker('engine-pro.js');
      eng.worker.onmessage = (e) => {
        const d = e.data, cb = eng.handlers; // hàm xử lý của lượt tính hiện tại
        if (!cb || d.id !== eng.streamId) return;
        if (d.info) cb.onInfo(d.info);
        else if (d.done) cb.onDone();
        else if (d.error) cb.onError(d.error);
      };
    }
    eng.handlers = { onInfo, onDone, onError };
    eng.streamId = token;
    eng.worker.postMessage({ type: 'stream', id: token, ...pos });
  }

  // ---------- Bày thế cờ ----------
  function startEdit() {
    stopEngine();
    st.edit = { board: curBoard().map((r) => r.slice()), side: sideAt(st.ply), pick: 'rP' };
    renderEditBar();
    renderAll();
  }
  function editClick(r, c) {
    const e = st.edit;
    e.board[r][c] = e.pick === 'x' || e.board[r][c] === e.pick ? null : e.pick;
    renderBoard();
  }
  function renderEditBar() {
    const E = st.el, e = st.edit;
    E.editBar.classList.toggle('hidden', !e);
    E.toolbar.classList.toggle('hidden', !!e);
    E.saveRow.classList.toggle('hidden', !!e);
    if (!e) return;
    const chip = (code) => h('button', {
      class: 'ab-chip ' + code[0] + (e.pick === code ? ' active' : ''), title: `${PIECE_NAME[code[1]]} ${code[0] === 'r' ? 'đỏ' : 'đen'}`,
      text: X.CHARS[code], onclick: () => { e.pick = code; renderEditBar(); },
    });
    const sideSel = h('select', { class: 'sel-sm', 'aria-label': 'Bên đi trước', onchange: (ev) => { e.side = ev.target.value; } },
      h('option', { value: 'r', text: 'Đỏ đi trước', selected: e.side === 'r' }), h('option', { value: 'b', text: 'Đen đi trước', selected: e.side === 'b' }));
    E.editBar.replaceChildren(
      h('div', { class: 'ab-palette' }, ...PIECES.map((t) => chip('r' + t))),
      h('div', { class: 'ab-palette' }, ...PIECES.map((t) => chip('b' + t)),
        h('button', { class: 'ab-chip x' + (e.pick === 'x' ? ' active' : ''), title: 'Xoá quân', text: '✕', onclick: () => { e.pick = 'x'; renderEditBar(); } })),
      h('p', { class: 'muted ab-edit-tip', text: 'Chọn quân rồi bấm lên giao điểm để đặt; bấm lại vào quân giống hệt (hoặc dùng ✕) để xoá.' }),
      h('div', { class: 'row tight ab-edit-actions' },
        sideSel,
        h('button', { class: 'btn sm', text: 'Thế ban đầu', onclick: () => { e.board = X.initialBoard(); renderBoard(); } }),
        h('button', { class: 'btn sm', text: 'Xoá bàn', onclick: () => { e.board = Array.from({ length: 10 }, () => Array(9).fill(null)); renderBoard(); } }),
        h('button', { class: 'btn sm', text: 'Huỷ', onclick: () => { st.edit = null; renderEditBar(); renderAll(); restartEngine(); } }),
        h('button', {
          class: 'btn sm primary', text: 'Xong',
          onclick: () => {
            const err = X.validatePosition(e.board, e.side);
            if (err) return st.deps.toast(err);
            st.edit = null;
            renderEditBar();
            setPosition(e.board, e.side);
          },
        })));
  }

  // ---------- Lưu thế cờ vào Lịch sử luyện tập (lưu trên trình duyệt này) ----------
  const SAVE_KEY = 'tk-analysis-saved';
  const SAVE_MAX = 50;
  function savedList() {
    try { const v = JSON.parse(store.get(SAVE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function writeSaved(list) { store.set(SAVE_KEY, JSON.stringify(list.slice(0, SAVE_MAX))); }
  function saveCurrent() {
    const fen = toFen(st.start, st.startSide);
    const moves = st.moves.map(toUci);
    // Tên tự đặt: các nước đầu theo ký hiệu Việt, hoặc "Thế cờ tự bày"
    const boards = boardsUpTo(Math.min(st.moves.length, 6));
    const names = st.moves.slice(0, 6).map((m, i) => X.notation(boards[i], m.from, m.to));
    const isStart = fen === toFen(X.initialBoard(), 'r');
    const title = names.length ? (isStart ? '' : 'Thế cờ · ') + names.join(' ') + (st.moves.length > 6 ? ' …' : '') : (isStart ? 'Thế cờ ban đầu' : 'Thế cờ tự bày');
    const list = savedList().filter((x) => !(x.fen === fen && JSON.stringify(x.moves) === JSON.stringify(moves)));
    const info = st.eng.info && st.eng.info.lines[0];
    const side = sideAt(st.ply);
    list.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, fen, moves, ply: st.ply, savedAt: Date.now(),
      score: info ? (side === 'r' ? info.score : -info.score) : null,
    });
    writeSaved(list);
    st.deps.toast('Đã lưu vào Lịch sử luyện tập.');
  }
  function openSaved(item) {
    const pos = parseFen(item.fen);
    if (typeof pos === 'string') return false;
    const moves = (item.moves || []).map(fromUci).filter(Boolean);
    st.start = pos.board; st.startSide = pos.side; st.moves = moves; st.ply = Math.min(item.ply ?? moves.length, moves.length);
    st.edit = null;
    return true;
  }

  // ---------- API ----------
  root.AnalysisBoard = {
    // Mở tab (lần đầu thì dựng giao diện). pos tuỳ chọn: { board, side, moves } để phân tích một ván có sẵn.
    open(container, deps, pos) {
      st.deps = deps;
      if (!st.mounted) mount(container);
      if (pos) { st.start = pos.board; st.startSide = pos.side || 'r'; st.moves = pos.moves || []; st.ply = pos.ply ?? st.moves.length; }
      renderEditBar();
      renderAll();
      restartEngine();
      setTimeout(fillEvals, 300);
    },
    // Rời tab: dừng engine để không giữ CPU server
    close() { if (st.mounted) { stopEngine(); clearTimeout(restartTimer); } },
    setTheme() { if (st.mounted) renderBoard(); },
    parseFen, toFen,
    // Lịch sử luyện tập: danh sách thế cờ đã lưu, mở lại một thế, xoá
    saved: savedList,
    openSaved(container, deps, item) {
      st.deps = deps;
      if (!st.mounted) mount(container);
      if (!openSaved(item)) return deps.toast('Không mở được thế cờ đã lưu.');
      renderEditBar();
      renderAll();
      restartEngine();
      setTimeout(fillEvals, 300);
    },
    removeSaved(id) { writeSaved(savedList().filter((x) => x.id !== id)); },
    scoreText,
  };
})(typeof self !== 'undefined' ? self : this);
