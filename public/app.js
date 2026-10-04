(() => {
  'use strict';

  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const socket = io();

  // ---------- Danh tính ----------
  // Token theo từng tab (sessionStorage) để tải lại trang vẫn giữ được ghế,
  // nhưng 2 tab khác nhau vẫn là 2 người chơi khác nhau.
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  let token = safe(() => sessionStorage.getItem('xq-token'));
  if (!token) {
    token = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    safe(() => sessionStorage.setItem('xq-token', token));
  }
  // Mã người chơi cố định cho trình duyệt này (localStorage) — không cần đăng ký
  let uid = safe(() => localStorage.getItem('xq-uid'));
  if (!uid || !/^[A-Za-z0-9_-]{8,64}$/.test(uid)) {
    uid = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    safe(() => localStorage.setItem('xq-uid', uid));
  }
  // Phiên đăng nhập tài khoản (không bắt buộc)
  let session = safe(() => localStorage.getItem('xq-session'));
  let me = null; // thông tin tài khoản đang đăng nhập
  const storedName = () => (safe(() => localStorage.getItem('xq-name')) || '').trim();
  const getName = () => (me ? me.displayName : storedName() || 'Người chơi');

  // ---------- Trạng thái ----------
  let roomId = null;
  let state = null;
  let myColor = null;
  let selected = null;
  let targets = [];
  let lastMoveKey = null;
  // Xem lại: viewGame = 'live' (ván đang chơi) hoặc chỉ số trong state.archive;
  // viewPly = null nghĩa là đang ở nước mới nhất.
  let viewGame = 'live';
  let viewPly = null;
  let replayCache = { key: null, data: null };
  let archiveCount = -1;
  let unreadChat = 0;
  let analysisMode = false; // chỉ được xem lại sau khi bấm "Phân tích"

  // ---------- Lobby ----------
  // Ô "Tên của bạn" (khách) có ở nhiều trang — luôn đồng bộ với nhau
  document.querySelectorAll('.guest-name').forEach((inp) => {
    inp.value = storedName();
    inp.addEventListener('input', () => {
      safe(() => localStorage.setItem('xq-name', inp.value.trim()));
      document.querySelectorAll('.guest-name').forEach((o) => { if (o !== inp) o.value = inp.value; });
    });
  });

  for (const id of ['time-total', 'time-move']) {
    const saved = safe(() => localStorage.getItem('xq-' + id));
    if (saved !== null && [...$(id).options].some((o) => o.value === saved)) $(id).value = saved;
    $(id).addEventListener('change', () => safe(() => localStorage.setItem('xq-' + id, $(id).value)));
  }

  $('create').addEventListener('click', () => {
    const color = document.querySelector('input[name="color"]:checked').value;
    socket.emit('create', { name: getName(), token, uid, session, color, ...timeSettings() });
  });

  // ---------- Ghép trận ----------
  const mm = { active: false, since: 0, range: 100, searching: 1, rating: null, timer: null };
  const timeSettings = () => ({ totalMin: Number($('time-total').value), moveSec: Number($('time-move').value) });

  $('quick-match').addEventListener('click', () => {
    mm.active = true;
    mm.since = Date.now();
    mm.rating = me ? me.rating : 1200;
    $('mm-modal').classList.remove('hidden');
    renderMM();
    clearInterval(mm.timer);
    mm.timer = setInterval(renderMM, 250);
    socket.emit('mm-join', { name: getName(), token, uid, session, ...timeSettings() });
  });

  function stopMM() {
    mm.active = false;
    clearInterval(mm.timer);
    $('mm-modal').classList.add('hidden');
  }

  function renderMM() {
    const t = Math.floor((Date.now() - mm.since) / 1000);
    $('mm-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const range = mm.range === null ? 'mọi mức Elo' : `Elo ${mm.rating} ± ${mm.range}`;
    $('mm-info').textContent = `${range} · ${mm.searching} người đang tìm`;
  }

  $('mm-cancel').addEventListener('click', () => {
    socket.emit('mm-leave');
    stopMM();
  });

  socket.on('mm-status', (st) => {
    if (!st.queued) return stopMM();
    if (!mm.active) return;
    mm.since = Date.now() - (st.now - st.since);
    mm.range = st.range;
    mm.searching = st.searching;
    mm.rating = st.rating;
    renderMM();
  });

  socket.on('mm-found', (d) => {
    stopMM();
    toast(`Đã ghép với ${d.opponent} (Elo ${d.rating})${d.rated ? '' : ' · ván không tính Elo'}`);
  });

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (!code) return showLobbyError('Vui lòng nhập mã phòng.');
    socket.emit('join', { roomId: code, name: getName(), token, uid, session });
  });


  function showLobbyError(msg, kind) {
    $('lobby-err').textContent = msg;
    $('lobby-err').classList.toggle('info', kind === 'info');
  }

  // Mỗi mục menu là một trang riêng; 'game' là màn hình ván đấu (toàn màn hình)
  const SCREENS = {
    home: 'lobby', online: 'page-online', ai: 'page-ai', join: 'page-join', rules: 'page-rules', profile: 'profile',
    puzzles: 'page-puzzles', puzzle: 'page-puzzle', game: 'game',
  };
  let lastPage = 'home';
  function showScreen(name) {
    if (name === 'lobby' || !SCREENS[name]) name = 'home';
    for (const [key, id] of Object.entries(SCREENS)) $(id).classList.toggle('hidden', key !== name);
    $('shell').classList.toggle('hidden', name === 'game');
    document.querySelectorAll('.sb-item').forEach((b) => b.classList.toggle('active', b.dataset.go === name || (name === 'puzzle' && b.dataset.go === 'puzzles')));
    $('home-sidebar').classList.remove('open');
    if (name !== 'game') lastPage = name;
    window.scrollTo(0, 0);
  }

  // Vào thẳng phòng nếu link có ?room=XXXX
  const params = new URLSearchParams(location.search);
  const urlRoom = params.get('room');
  let spectate = params.has('watch'); // ?watch=1: chỉ xem, không ngồi vào ghế trống
  if (urlRoom) {
    $('code').value = urlRoom.toUpperCase();
    if (storedName() || spectate || session) {
      socket.emit('join', { roomId: urlRoom, name: getName(), token, uid, session, spectate });
    } else {
      showScreen('join');
      document.querySelector('#page-join .guest-name').focus();
      showLobbyError('Nhập tên rồi bấm "Vào" để tham gia phòng ' + urlRoom.toUpperCase() + '.');
    }
  }

  // ---------- Socket ----------
  socket.on('connect', () => {
    socket.emit('hello', { uid, session });
    if (mm.active) socket.emit('mm-join', { name: getName(), token, uid, session, ...timeSettings() });
    // Kết nối lại sau khi rớt mạng
    if (roomId) socket.emit('join', { roomId, name: getName(), token, uid, session, spectate });
  });

  socket.on('kicked', (reason) => {
    resetToLobby();
    showLobbyError(reason);
  });

  socket.on('room-closed', (msg) => {
    resetToLobby();
    showLobbyError(msg, 'info');
  });

  socket.on('disconnect', () => toast('Mất kết nối, đang thử kết nối lại...'));

  socket.on('joined', (data) => {
    roomId = data.roomId;
    myColor = data.color;
    showLobbyError('');
    $('room-code').textContent = roomId;
    history.replaceState(null, '', '?room=' + roomId + (spectate ? '&watch=1' : ''));
    renderChatHistory(data.chat || []);
    showScreen('game');
    if (data.note) toast(data.note);
    else if (!myColor && !spectate) toast('Phòng đã đủ người — bạn đang xem với tư cách khán giả.');
  });

  socket.on('state', (s) => {
    if (!ai.active && !review.active) applyState(s);
  });

  function applyState(s) {
    if (s.clock) clockOffset = Date.now() - s.clock.now;
    const prevColor = myColor;
    if (!s.result) analysisMode = false;
    state = s;
    myColor = s.you;
    if (prevColor !== myColor) drawStatic();

    const key = s.lastMove ? `${s.moveCount}` : null;
    if (key && key !== lastMoveKey && lastMoveKey !== null) playSound(!!s.lastMove.captured);
    lastMoveKey = key || '0';

    // Bỏ chọn nếu không còn hợp lệ
    if (selected) {
      const p = s.board[selected[0]][selected[1]];
      if (!p || p[0] !== myColor || s.turn !== myColor || s.result) {
        selected = null;
        targets = [];
      } else {
        targets = X.legalMovesFrom(s.board, selected[0], selected[1]);
      }
    }
    render();
  }

  socket.on('chat', addChat);

  socket.on('error-msg', (msg) => {
    if (mm.active) stopMM();
    if (!roomId) showLobbyError(msg);
    else toast(msg);
  });

  // ---------- Bàn cờ (SVG) ----------
  const svg = $('board');
  // Giao diện bàn cờ/quân cờ do quản trị viên chọn (xem board-render.js)
  const BR = window.BoardRender;
  let theme = BR.DEFAULT_THEME;
  let geo = BR.geometry(theme);
  const px = (c) => geo.xs[c];
  const py = (r) => geo.ys[r];

  function setTheme(t) {
    if (!t || !t.board || !t.pieces) return;
    theme = t;
    dynLayer = null;
    if (pz.ui) { pz.ui.theme = t; pz.ui.render(); setPzFrame(); }
    if (pz.list.length && !$('page-puzzles').classList.contains('hidden')) renderPuzzleGrid();
    if (typeof drawHero === 'function') drawHero();
    if (state) render();
    else applyBoardFrame();
  }

  function applyBoardFrame() {
    geo = BR.geometry(theme);
    const [, , w, h] = geo.viewBox;
    $('game').style.setProperty('--board-ar', (w / h).toFixed(4));
  }

  fetch('/api/theme').then((r) => r.json()).then(setTheme).catch(() => {});
  socket.on('theme', setTheme);
  const flipped = () => myColor === 'b';
  const toView = (r, c) => (flipped() ? [9 - r, 8 - c] : [r, c]);

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  let dynLayer;

  function drawStatic() {
    geo = BR.drawBoard(svg, theme, { flipped: flipped() });
    applyBoardFrame();
    dynLayer = el('g', {}, svg);
  }

  function drawPiece(p, x, y, isSel) {
    BR.drawPiece(dynLayer, theme, geo.unit, p, X.CHARS[p], x, y, isSel);
  }

  // Vòng đánh dấu (kích thước thiết kế cho ô 100 đơn vị, tự co theo bàn cờ)
  function mark(vr, vc, r, cls) {
    const g = el('g', { transform: `translate(${px(vc)} ${py(vr)}) scale(${geo.unit})` }, dynLayer);
    el('circle', { r, class: cls }, g);
  }

  function drawArrow(from, to) {
    const [fr, fc] = toView(...from), [tr, tc] = toView(...to);
    const x1 = px(fc), y1 = py(fr), x2 = px(tc), y2 = py(tr);
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const u = geo.unit;
    const hx = x2 - ux * 45 * u, hy = y2 - uy * 45 * u; // chân đầu mũi tên
    el('line', { x1, y1, x2: hx + ux * 3 * u, y2: hy + uy * 3 * u, class: 'best-arrow', style: `stroke-width:${17 * u}` }, dynLayer);
    const nx = -uy * 25 * u, ny = ux * 25 * u;
    el('polygon', { points: `${x2 - ux * 11 * u},${y2 - uy * 11 * u} ${hx + nx},${hy + ny} ${hx - nx},${hy - ny}`, class: 'best-arrow-head' }, dynLayer);
  }

  function render() {
    if (!state) return;
    if (!dynLayer) drawStatic();
    dynLayer.innerHTML = '';
    const v = currentView();
    const b = v.board;
    const lastMove = v.lastMove;

    if (lastMove) {
      const [fr, fc] = toView(...lastMove.from);
      mark(fr, fc, 30, 'last-from');
    }

    let checkedKing = v.inCheck ? X.findKing(b, v.turn) : null;
    if (v.result && v.result.reason === 'checkmate') {
      checkedKing = X.findKing(b, X.other(v.result.winner));
    }

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = b[r][c];
        if (!p) continue;
        const [vr, vc] = toView(r, c);
        const isSel = selected && selected[0] === r && selected[1] === c;
        drawPiece(p, px(vc), py(vr), isSel);

        if (lastMove && lastMove.to[0] === r && lastMove.to[1] === c) {
          mark(vr, vc, 49, 'last-to');
        }
        if (checkedKing && checkedKing[0] === r && checkedKing[1] === c) {
          mark(vr, vc, 50, 'check-glow');
        }
      }
    }

    for (const [r, c] of targets) {
      const [vr, vc] = toView(r, c);
      if (b[r][c]) mark(vr, vc, 47, 'target-cap');
      else mark(vr, vc, 13, 'target');
    }

    // Phân tích: mũi tên xanh chỉ nước tốt nhất ở thế cờ đang xem
    const entry = analysisEntry();
    const rec = entry && entry.results[v.ply];
    if (rec && rec.best) drawArrow(rec.best.from, rec.best.to);

    renderPlayers();
    renderStatus();
    renderActions();
    renderReplay(v);
    renderResult();
  }

  // ---------- Bảng kết quả ----------
  function renderResult() {
    const overlay = $('result-overlay');
    const show = !!state.result && !analysisMode;
    overlay.classList.toggle('hidden', !show);
    if (!show) return;

    const { winner, reason } = state.result;
    const moves = `Sau ${state.history.length} nước`;
    let title, sub, kind;
    if (!winner) {
      kind = 'draw';
      title = 'Hoà';
      sub = `Hai bên đồng ý hoà · ${moves}`;
    } else if (!myColor) {
      kind = 'win';
      title = `${colorName(winner)} thắng`;
      sub = `${state.players[winner] ? state.players[winner].name : ''} · ${reasonText[reason]} · ${moves}`;
    } else if (winner === myColor) {
      kind = 'win';
      title = 'Thắng';
      const why = { checkmate: 'Bạn chiếu bí đối phương', stalemate: 'Đối phương hết nước đi', resign: 'Đối phương đầu hàng', abandon: 'Đối phương đã rời bàn', timeout: 'Đối phương hết giờ' };
      sub = `${why[reason]} · ${moves}`;
    } else {
      kind = 'lose';
      title = 'Thua';
      const why = { checkmate: 'Bạn bị chiếu bí', stalemate: 'Bạn hết nước đi', resign: 'Bạn đã đầu hàng', abandon: 'Bạn đã rời bàn', timeout: 'Bạn đã hết giờ' };
      sub = `${why[reason]} · ${moves}`;
    }
    overlay.className = 'result-overlay ' + kind;
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;

    const hint = $('result-hint');
    const opponentGone = myColor && !state.players[X.other(myColor)];
    const asked = myColor && state.rematch.includes(myColor);
    const oppAsked = myColor && state.rematch.includes(X.other(myColor));
    hint.textContent = opponentGone ? 'Đối thủ đã rời bàn — đang chờ người chơi mới vào phòng...'
      : oppAsked && !asked ? 'Đối thủ muốn chơi lại!' : asked ? 'Đã mời — đang chờ đối thủ đồng ý...' : '';
    hint.classList.toggle('ask', !!(oppAsked && !asked));

    const rm = $('res-rematch');
    rm.classList.toggle('hidden', !myColor || opponentGone);
    rm.disabled = !!asked;
    rm.textContent = asked ? 'Đang chờ đối thủ...' : oppAsked ? 'Đồng ý chơi lại' : 'Chơi lại';
  }

  $('res-rematch').addEventListener('click', () => (state.ai ? aiRematch() : socket.emit('rematch')));
  $('res-leave').addEventListener('click', () => $('btn-leave').click());
  $('res-analysis').addEventListener('click', () => {
    analysisMode = true;
    viewGame = 'live';
    viewPly = null;
    // Mở tab "Nước đi" để thấy biên bản
    document.querySelector('.tab[data-tab="moves"]').click();
    render();
    toast('Dùng ◀ ▶ hoặc bấm vào nước đi để xem lại.');
  });

  svg.addEventListener('click', (e) => {
    if (!state) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    // Giao điểm gần nhất trên ảnh bàn cờ
    const nearest = (arr, v) => arr.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(arr[best] - v) ? i : best), 0);
    const vc = nearest(geo.xs, pt.x);
    const vr = nearest(geo.ys, pt.y);
    const tol = 70 * geo.unit;
    if (Math.abs(geo.xs[vc] - pt.x) > tol || Math.abs(geo.ys[vr] - pt.y) > tol) return;
    const [r, c] = toView(vr, vc); // phép lật là đối xứng nên dùng lại được
    onSquare(r, c);
  });

  function onSquare(r, c) {
    if (isReviewing()) {
      toast('Bạn đang xem lại — bấm ⏭ để về nước hiện tại.');
      return;
    }
    const canMove = myColor && state.started && !state.result && state.turn === myColor;
    const p = state.board[r][c];

    if (canMove && selected && targets.some(([tr, tc]) => tr === r && tc === c)) {
      const from = selected;
      if (state.ai) {
        selected = null;
        targets = [];
        aiApplyMove(from, [r, c]);
        return;
      }
      socket.emit('move', { from, to: [r, c] });
      // Hiển thị ngay, server sẽ gửi lại trạng thái chính thức
      state = {
        ...state,
        board: X.applyMove(state.board, from, [r, c]),
        lastMove: { from, to: [r, c], captured: p },
        history: [...state.history, { from, to: [r, c], captured: p }],
        turn: X.other(myColor),
        inCheck: false,
        clock: state.clock && state.clock.turnStartedAt ? {
          ...state.clock,
          [myColor]: state.clock[myColor] - (Date.now() - clockOffset - state.clock.turnStartedAt),
          turnStartedAt: Date.now() - clockOffset,
        } : state.clock,
      };
      selected = null;
      targets = [];
      render();
      return;
    }

    if (p && p[0] === myColor && canMove) {
      if (selected && selected[0] === r && selected[1] === c) {
        selected = null;
        targets = [];
      } else {
        selected = [r, c];
        targets = X.legalMovesFrom(state.board, r, c);
      }
    } else {
      if (myColor && p && p[0] === myColor && !canMove && state.started && !state.result) {
        toast('Chưa đến lượt bạn.');
      }
      selected = null;
      targets = [];
    }
    render();
  }

  // ---------- Bảng thông tin ----------
  const colorName = (c) => (c === 'r' ? 'Đỏ' : 'Đen');

  function renderPlayers() {
    const bottomColor = myColor || 'r';
    const topColor = X.other(bottomColor);
    fillPlayer($('p-top'), topColor);
    fillPlayer($('p-bottom'), bottomColor);
  }

  // Thẻ người chơi: ảnh đại diện (viền chạy theo thời gian nước đi), tên, dòng phụ, đồng hồ
  function fillPlayer(node, color) {
    const p = state.players[color];
    const isTurn = state.started && !state.result && state.turn === color;
    node.dataset.color = color;
    node.classList.toggle('turn', isTurn);
    node.replaceChildren();

    const av = document.createElement('div');
    av.className = 'pc-avatar';
    if (p && p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar;
      img.alt = '';
      av.appendChild(img);
    } else {
      const ini = document.createElement('span');
      ini.className = 'pc-initial' + (p && p.ai ? ' ai' : '') + (p ? '' : ' empty');
      ini.textContent = p ? (p.ai ? 'AI' : initial(p.name)) : '?';
      av.appendChild(ini);
    }
    const ring = document.createElementNS(NS, 'svg');
    ring.setAttribute('class', 'pc-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    for (const cls of ['track', 'bar']) {
      const r = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ class: cls, x: 3, y: 3, width: 94, height: 94, rx: 18, pathLength: 100 })) r.setAttribute(k, v);
      ring.appendChild(r);
    }
    const side = document.createElement('span');
    side.className = 'pc-side ' + color;
    side.title = color === 'r' ? 'Quân Đỏ' : 'Quân Đen';
    av.append(ring, side);

    const info = document.createElement('div');
    info.className = 'pc-info';
    const name = document.createElement('div');
    name.className = 'pc-name';
    name.textContent = p ? p.name + (color === myColor ? ' (bạn)' : '') : 'Đang chờ người chơi...';
    const sub = document.createElement('div');
    sub.className = 'pc-sub';
    if (p) {
      const label = p.ai ? 'Máy' : p.username ? '@' + p.username + (p.rating ? ' · Elo ' + p.rating : '') : state.review ? '' : 'Khách';
      if (!p.online) {
        const off = document.createElement('span');
        off.className = 'off';
        off.textContent = 'Mất kết nối';
        sub.append(off, label ? ' · ' + label : '');
      } else {
        sub.textContent = label;
      }
    }
    info.append(name, sub);
    if (clockInfo(color)) {
      const clk = document.createElement('span');
      clk.className = 'clock';
      clk.dataset.color = color;
      clk.append(document.createElement('b'), document.createElement('small'));
      info.appendChild(clk);
    }
    node.append(av, info);
    updatePlayer(node);
  }

  // ---------- Đồng hồ ----------
  let clockOffset = 0; // Date.now() của máy này - giờ server
  const fmtClock = (ms) => {
    const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };

  // Thời gian còn lại của một bên (tổng & nước hiện tại), null nếu phòng không giới hạn thời gian
  function clockInfo(color) {
    const st = state;
    if (!st || !st.settings || !st.clock || (!st.settings.totalMs && !st.settings.moveMs)) return null;
    const { totalMs, moveMs } = st.settings;
    const running = !!(st.clock.turnStartedAt && !st.result && st.turn === color);
    const elapsed = running ? Math.max(0, Date.now() - clockOffset - st.clock.turnStartedAt) : 0;
    return {
      running,
      total: totalMs ? Math.max(0, st.clock[color] - elapsed) : null,
      move: moveMs && st.turn === color && !st.result && st.started ? Math.max(0, moveMs - elapsed) : null,
    };
  }

  let lastBeep = null;
  function updateClock(el) {
    const info = clockInfo(el.dataset.color);
    if (!info) return;
    const [big, small] = el.children;
    big.textContent = info.total !== null ? fmtClock(info.total) : info.move !== null ? fmtClock(info.move) : '∞';
    small.textContent = info.total !== null && info.move !== null ? 'Nước ' + fmtClock(info.move) : '';
    const low = info.running && ((info.total !== null && info.total < 30000) || (info.move !== null && info.move < 10000));
    el.classList.toggle('running', info.running);
    el.classList.toggle('low', low);
    // Bíp mỗi giây trong 5 giây cuối của mình
    if (info.running && el.dataset.color === myColor) {
      const left = Math.min(info.total ?? Infinity, info.move ?? Infinity);
      const sec = Math.ceil(left / 1000);
      if (sec <= 5 && sec > 0 && sec !== lastBeep) { lastBeep = sec; playSound(false); }
    }
  }
  // Viền quanh ảnh: phần còn lại của thời gian nước đi (hoặc tổng thời gian nếu không giới hạn mỗi nước)
  function updatePlayer(node) {
    const color = node.dataset.color;
    const clk = node.querySelector('.clock');
    if (clk) updateClock(clk);
    const bar = node.querySelector('.pc-ring .bar');
    if (!bar || !state) return;
    const info = clockInfo(color);
    let frac = null;
    if (info && info.running) {
      frac = state.settings.moveMs ? info.move / state.settings.moveMs : info.total / state.settings.totalMs;
    } else if (node.classList.contains('turn')) {
      frac = 1; // lượt đi nhưng không tính giờ
    }
    node.classList.toggle('ring-on', frac !== null);
    if (frac === null) return;
    bar.style.strokeDashoffset = String(100 * (1 - Math.max(0, Math.min(1, frac))));
    bar.style.stroke = frac > 0.5 ? '#4caf7a' : frac > 0.2 ? '#e3c04b' : '#e05a47';
  }
  setInterval(() => document.querySelectorAll('.player[data-color]').forEach(updatePlayer), 200);

  function timeControlText(st) {
    if (!st) return '';
    const { totalMs, moveMs } = st;
    if (!totalMs && !moveMs) return '';
    const parts = [];
    parts.push(totalMs ? `${totalMs / 60000} phút mỗi bên` : 'Không giới hạn tổng');
    parts.push(moveMs ? `${moveMs >= 60000 ? moveMs / 60000 + ' phút' : moveMs / 1000 + ' giây'} mỗi nước` : 'không giới hạn mỗi nước');
    return '⏱ ' + parts.join(' · ');
  }

  function renderStatus() {
    const s = $('status');
    s.className = 'status';
    $('spectators').textContent = state.spectators ? `· ${state.spectators} người xem` : '';
    const tc = timeControlText(state.settings);
    $('time-control').textContent = tc;
    $('time-control').classList.toggle('hidden', !tc);
    // Hết ván: kết quả đã hiện ở giữa bàn cờ
    if (state.result) {
      s.classList.add('hidden');
      return;
    }
    let html;
    if (!state.started) {
      html = 'Đang chờ đối thủ vào phòng...<span class="hint">Bấm "Sao chép link mời" và gửi cho bạn bè.</span>';
    } else if (!myColor) {
      html = `Lượt ${colorName(state.turn)}${state.inCheck ? ' — đang bị chiếu!' : ''}`;
    } else if (state.turn === myColor) {
      html = state.inCheck ? 'Bạn đang bị chiếu! Hãy đỡ chiếu.' : 'Đến lượt bạn.';
      if (state.inCheck) s.classList.add('check');
    } else {
      html = state.ai ? 'Máy đang suy nghĩ...' : 'Đang chờ đối thủ đi...';
    }
    s.innerHTML = html;
  }

  function renderActions() {
    const playing = myColor && state.started && !state.result;
    $('btn-draw').classList.toggle('hidden', !playing || !!state.ai);
    $('btn-undo').classList.toggle('hidden', !(state.ai && playing && aiCanUndo()));
    $('btn-resign').classList.toggle('hidden', !playing);
    $('btn-draw').disabled = state.drawOffer === myColor;
    $('btn-draw').textContent = state.drawOffer === myColor ? 'Đã xin hoà' : 'Xin hoà';
    $('draw-banner').classList.toggle('hidden', !(playing && state.drawOffer && state.drawOffer !== myColor));
    // Hết ván: các nút Chơi lại / Rời bàn nằm trong bảng kết quả giữa bàn cờ
    $('btn-leave').classList.toggle('hidden', !!state.result);
    $('btn-close-analysis').classList.toggle('hidden', !(state.result && analysisMode));
    $('btn-close-analysis').textContent = state.review ? '← Về trang tài khoản' : 'Thoát phân tích';
  }

  $('btn-resign').addEventListener('click', () => {
    if (!confirm('Bạn chắc chắn muốn đầu hàng?')) return;
    if (state.ai) aiResign();
    else socket.emit('resign');
  });
  $('btn-draw').addEventListener('click', () => socket.emit('offer-draw'));
  $('accept-draw').addEventListener('click', () => socket.emit('offer-draw'));
  $('decline-draw').addEventListener('click', () => socket.emit('decline-draw'));
  $('btn-close-analysis').addEventListener('click', () => {
    if (state && state.review) {
      resetToLobby();
      openProfile();
      return;
    }
    analysisMode = false;
    viewGame = 'live';
    viewPly = null;
    render();
  });
  $('btn-leave').addEventListener('click', () => {
    const playing = state && myColor && state.started && !state.result && state.history.length;
    if (state && state.ai) {
      if (playing && !confirm('Thoát ván đang chơi với máy?')) return;
    } else {
      if (playing && !confirm('Ván đang diễn ra — rời bàn bây giờ bạn sẽ bị xử thua. Tiếp tục?')) return;
      socket.emit('leave');
    }
    resetToLobby();
  });

  function resetToLobby() {
    if (review.active) {
      review.active = false;
      setAiUi(false);
    }
    if (ai.active) {
      ai.active = false;
      ai.reqId++; // bỏ qua nước máy đang tính dở
      setAiUi(false);
    }
    roomId = null;
    state = null;
    myColor = null;
    selected = null;
    targets = [];
    lastMoveKey = null;
    dynLayer = null;
    viewGame = 'live';
    viewPly = null;
    archiveCount = -1;
    analysisMode = false;
    spectate = false;
    history.replaceState(null, '', location.pathname + (lastPage === 'home' ? '' : '#/' + lastPage));
    showScreen(lastPage);
  }

  // ---------- Chơi với máy ----------
  const LEVEL_NAMES = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const ai = { active: false, level: 'medium', human: 'r', color: 'b', game: null, archive: [], worker: null, reqId: 0, startedAt: 0 };
  const turnAt = (ply) => (ply % 2 === 0 ? 'r' : 'b');

  function aiWorker() {
    if (!ai.worker) {
      ai.worker = new Worker('engine.js');
      ai.worker.onmessage = (e) => onAiMove(e.data);
      ai.worker.onerror = () => toast('Máy gặp lỗi khi tính nước đi.');
    }
    return ai.worker;
  }

  function setAiUi(on) {
    $('room-prefix').textContent = on ? 'Chơi với máy ·' : 'Phòng';
    $('copy').classList.toggle('hidden', on);
    const chatTab = document.querySelector('.tab[data-tab="chat"]');
    chatTab.classList.toggle('hidden', on);
    if (on) document.querySelector('.tab[data-tab="moves"]').click();
  }

  $('play-ai').addEventListener('click', () => {
    const pick = document.querySelector('input[name="ai-color"]:checked').value;
    const human = pick === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : pick;
    const level = document.querySelector('input[name="level"]:checked').value;
    ai.active = true;
    ai.level = level;
    ai.archive = [];
    an.aiSession++;
    selected = null;
    targets = [];
    viewGame = 'live';
    viewPly = null;
    archiveCount = -1;
    analysisMode = false;
    showLobbyError('');
    $('room-code').textContent = LEVEL_NAMES[level];
    setAiUi(true);
    showScreen('game');
    newAiGame(human);
  });

  function newAiGame(human) {
    ai.human = human;
    ai.color = X.other(human);
    ai.reqId++;
    ai.game = {
      board: X.initialBoard(),
      history: [],
      result: null,
      names: { [human]: getName(), [ai.color]: `Máy (${LEVEL_NAMES[ai.level]})` },
    };
    lastMoveKey = null;
    syncAi();
    maybeAiTurn();
  }

  function aiState() {
    const g = ai.game;
    const turn = turnAt(g.history.length);
    return {
      ai: true, roomId: null, board: g.board, turn,
      lastMove: g.history[g.history.length - 1] || null,
      moveCount: g.history.length, history: g.history, gameNames: g.names, archive: ai.archive,
      result: g.result, inCheck: !g.result && X.isInCheck(g.board, turn),
      players: {
        [ai.human]: { name: g.names[ai.human], online: true, avatar: me ? me.avatar : null, username: me ? me.username : null, rating: me ? me.rating : null },
        [ai.color]: { name: g.names[ai.color], online: true, ai: true },
      },
      spectators: 0, drawOffer: null, rematch: [], started: true, you: ai.human,
    };
  }

  const syncAi = () => applyState(aiState());

  function aiApplyMove(from, to) {
    const g = ai.game;
    const turn = turnAt(g.history.length);
    if (g.result || !X.isLegalMove(g.board, turn, from, to)) return false;
    const captured = g.board[to[0]][to[1]];
    g.board = X.applyMove(g.board, from, to);
    g.history.push({ from, to, captured });
    const next = X.other(turn);
    if (!X.hasAnyLegalMove(g.board, next)) {
      g.result = { winner: turn, reason: X.isInCheck(g.board, next) ? 'checkmate' : 'stalemate' };
      saveAiGame();
    }
    syncAi();
    maybeAiTurn();
    return true;
  }

  function maybeAiTurn() {
    const g = ai.game;
    if (!ai.active || g.result || turnAt(g.history.length) !== ai.color) return;
    const id = ++ai.reqId;
    ai.startedAt = Date.now();
    // Gửi kèm các thế cờ đã qua để máy tránh đi lặp lại
    const { boards } = X.replay(g.history);
    aiWorker().postMessage({ id, board: g.board, side: ai.color, level: ai.level, boards });
  }

  function onAiMove({ id, move }) {
    if (!ai.active || id !== ai.reqId) return; // đã đi lại / ván mới → bỏ qua
    // Chờ tối thiểu 0,5 giây cho tự nhiên
    const wait = Math.max(0, 500 - (Date.now() - ai.startedAt));
    setTimeout(() => {
      if (!ai.active || id !== ai.reqId) return;
      if (move && aiApplyMove(move.from, move.to)) return;
      // Dự phòng: đi một nước hợp lệ bất kỳ
      const b = ai.game.board;
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          if (b[r][c] && b[r][c][0] === ai.color) {
            const t = X.legalMovesFrom(b, r, c);
            if (t.length) { aiApplyMove([r, c], t[0]); return; }
          }
        }
      }
    }, wait);
  }

  // Đi lại: lùi về lượt gần nhất của người chơi
  function aiUndoTarget() {
    const g = ai.game;
    for (let n = g.history.length - 1; n >= 0; n--) if (turnAt(n) === ai.human) return n;
    return -1;
  }
  const aiCanUndo = () => ai.game && !ai.game.result && aiUndoTarget() >= 0;

  $('btn-undo').addEventListener('click', () => {
    if (!state || !state.ai || !aiCanUndo()) return;
    const n = aiUndoTarget();
    const g = ai.game;
    ai.reqId++; // huỷ nước máy đang tính
    g.history = g.history.slice(0, n);
    g.board = X.replay(g.history).boards[n];
    selected = null;
    targets = [];
    lastMoveKey = null;
    syncAi();
  });

  function aiResign() {
    ai.reqId++;
    ai.game.result = { winner: ai.color, reason: 'resign' };
    saveAiGame();
    syncAi();
  }

  function aiRematch() {
    const g = ai.game;
    if (g.history.length) {
      ai.archive.push({ n: ai.archive.length + 1, players: { ...g.names }, result: g.result, history: g.history, endedAt: Date.now() });
      if (ai.archive.length > 20) ai.archive.shift();
    }
    viewGame = 'live';
    viewPly = null;
    analysisMode = false;
    newAiGame(ai.human);
  }

  // ---------- Tài khoản ----------
  const review = { active: false };

  async function accountApi(method, url, body) {
    const res = await fetch('/api/account' + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: 'Bearer ' + session } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && session) logoutLocal();
    if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra.');
    return json;
  }

  function setSession(token, account) {
    session = token;
    me = account;
    safe(() => localStorage.setItem('xq-session', token));
    socket.emit('hello', { uid, session });
    renderAuth();
  }

  function logoutLocal() {
    session = null;
    me = null;
    safe(() => localStorage.removeItem('xq-session'));
    socket.emit('hello', { uid });
    renderAuth();
  }

  socket.on('auth-invalid', () => {
    if (!session) return;
    logoutLocal();
    toast('Bạn đã bị đăng xuất.');
  });

  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

  // Ảnh đại diện (hoặc chữ cái đầu nếu chưa có ảnh)
  function fillAvatar(el, account) {
    el.replaceChildren();
    if (account && account.avatar) {
      const img = document.createElement('img');
      img.src = account.avatar;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = initial(account && account.displayName);
    }
  }

  function renderAuth() {
    const bar = $('auth-bar');
    bar.replaceChildren();
    const btn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn wide ' + cls;
      b.textContent = text;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    if (me) {
      const user = document.createElement('button');
      user.className = 'sb-user';
      user.title = 'Tài khoản & lịch sử';
      const av = document.createElement('span');
      av.className = 'avatar';
      fillAvatar(av, me);
      const txt = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = me.displayName;
      const sm = document.createElement('small');
      sm.textContent = '@' + me.username;
      txt.append(b, sm);
      user.append(av, txt);
      user.addEventListener('click', () => navigate('profile'));
      bar.appendChild(user);
      btn('Đăng xuất', 'ghost', logout);
    } else {
      btn('Đăng ký', 'primary big', () => openAuth('register'));
      btn('Đăng nhập', 'big', () => openAuth('login'));
      const note = document.createElement('p');
      note.className = 'sb-note';
      note.textContent = 'Khách vẫn chơi được, đăng ký để lưu lịch sử.';
      bar.appendChild(note);
    }
    document.querySelectorAll('.name-field').forEach((f) => f.classList.toggle('hidden', !!me));
  }

  async function logout() {
    await accountApi('POST', '/logout').catch(() => {});
    logoutLocal();
    showScreen('lobby');
    toast('Đã đăng xuất.');
  }

  // Hộp đăng nhập / đăng ký
  function openAuth(mode) {
    $('auth-err').textContent = '';
    $('auth-modal').classList.remove('hidden');
    switchAuth(mode);
  }
  function switchAuth(mode) {
    document.querySelectorAll('.atab').forEach((t) => t.classList.toggle('active', t.dataset.auth === mode));
    $('login-form').classList.toggle('hidden', mode !== 'login');
    $('register-form').classList.toggle('hidden', mode !== 'register');
    $('auth-err').textContent = '';
    setTimeout(() => $(mode === 'login' ? 'li-user' : 'rg-user').focus(), 0);
  }
  document.querySelectorAll('.atab').forEach((t) => t.addEventListener('click', () => switchAuth(t.dataset.auth)));
  $('auth-close').addEventListener('click', () => $('auth-modal').classList.add('hidden'));
  $('auth-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('auth-modal').classList.add('hidden'); });

  async function submitAuth(form, url, body) {
    const btn = form.querySelector('button');
    btn.disabled = true;
    $('auth-err').textContent = '';
    try {
      const { token, account } = await accountApi('POST', url, body);
      setSession(token, account);
      $('auth-modal').classList.add('hidden');
      form.reset();
      toast(`Xin chào, ${account.displayName}!`);
    } catch (err) {
      $('auth-err').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/login', { username: $('li-user').value, password: $('li-pass').value });
  });
  $('register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('rg-pass').value !== $('rg-pass2').value) {
      $('auth-err').textContent = 'Hai mật khẩu không khớp.';
      return;
    }
    submitAuth(e.target, '/register', { username: $('rg-user').value, displayName: $('rg-name').value || $('rg-user').value, password: $('rg-pass').value });
  });

  // Ván đánh với máy → lưu vào lịch sử nếu đã đăng nhập
  function saveAiGame() {
    const g = ai.game;
    if (!me || g.saved || !g.result || !g.history.length) return;
    g.saved = true;
    accountApi('POST', '/ai-games', {
      moves: g.history.map((m) => ({ from: m.from, to: m.to })),
      humanColor: ai.human, level: ai.level, resigned: g.result.reason === 'resign',
    }).then((d) => { me = d.account; }).catch(() => { g.saved = false; });
  }

  // ---------- Trang tài khoản ----------
  const LEVEL_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const REASON_LABEL = { checkmate: 'chiếu bí', stalemate: 'hết nước', resign: 'đầu hàng', draw: 'thoả thuận hoà', abandon: 'rời bàn', timeout: 'hết giờ' };
  const fmtDateTime = (t) => new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function openProfile() {
    if (!session) return openAuth('login');
    showScreen('profile');
    try {
      const [meRes, { games }] = await Promise.all([accountApi('GET', '/me'), accountApi('GET', '/games?limit=100')]);
      onMe(meRes);
      renderProfile(games);
    } catch (err) {
      toast(err.message);
      if (!session) showScreen('lobby');
    }
  }

  // Chất liệu thẻ kỳ hữu (public/ranks.js)
  const { cardTier } = window.Ranks;

  let regions = [];
  function onMe(res) {
    me = res.account;
    if (res.regions) regions = res.regions;
    if (res.dailyBonus) toast(`+${res.dailyBonus} xu thưởng đăng nhập hôm nay!`);
    renderAuth();
    if (!$('profile').classList.contains('hidden')) renderProfileHeader();
  }

  function renderProfileHeader() {
    fillAvatar($('pf-avatar'), me);
    $('pf-avatar-del').classList.toggle('hidden', !me.avatar);
    // Huy hiệu dưới ảnh: điểm Elo
    const badge = $('pf-rank');
    badge.replaceChildren();
    const gem = document.createElement('i');
    gem.className = 'gem';
    badge.append(gem, `Elo ${me.rating}`);
    badge.title = 'Điểm Elo — chỉ đổi khi đánh online với người có tài khoản';
    $('pf-name').textContent = me.displayName;
    $('pf-meta-id').textContent = 'ID: @' + me.username;
    $('pf-meta-region').textContent = 'Khu vực: ' + (me.region || 'Chưa đặt');
    const credit = $('pf-meta-credit');
    credit.replaceChildren('Uy tín: ');
    const u = document.createElement('u');
    u.textContent = me.credit;
    credit.appendChild(u);

    const pill = (cls, icon, value, sub, title) => {
      const p = document.createElement('div');
      p.className = 'pf-pill';
      p.title = title;
      const i = document.createElement('span');
      i.className = 'pi ' + cls;
      i.textContent = icon;
      const t = document.createElement('span');
      t.append(String(value));
      const sm = document.createElement('small');
      sm.textContent = sub;
      t.appendChild(sm);
      p.append(i, t);
      return p;
    };
    $('pf-pills').replaceChildren(
      pill('coin', '¥', me.coins.toLocaleString('vi-VN'), 'Xu', 'Xu: +20 mỗi ngày đăng nhập, +10 mỗi ván online'),
      pill('elo', '♟', me.stats.online.games + me.stats.ai.games, 'Ván đã chơi', 'Tổng số ván online và với máy'),
      pill('fire', '🔥', me.streak, `Kỷ lục ${me.bestStreak}`, 'Chuỗi thắng online hiện tại'),
    );
    const totalGames = me.stats.online.games + me.stats.ai.games;
    $('pf-mc-tag').textContent = cardTier(totalGames);
    $('pf-mc-games').textContent = `${totalGames} ván đã chơi`;

    $('pf-display').value = me.displayName;
    const sel = $('pf-region');
    if (sel.options.length <= 1) for (const r of regions) sel.add(new Option(r, r));
    sel.value = me.region || '';
  }

  function renderProfile(games) {
    renderProfileHeader();

    const group = (title, st) => {
      const wrap = document.createElement('div');
      wrap.className = 'pf-group';
      const h = document.createElement('h3');
      h.textContent = title;
      const cards = document.createElement('div');
      cards.className = 'pf-cards';
      const rate = st.games ? Math.round((st.wins / st.games) * 100) + '%' : '—';
      for (const [v, label, cls] of [[st.games, 'Số ván'], [st.wins, 'Thắng', 'w'], [st.losses, 'Thua', 'l'], [st.draws, 'Hoà'], [rate, 'Tỉ lệ thắng']]) {
        const c = document.createElement('div');
        if (cls) c.className = cls;
        const b = document.createElement('b');
        b.textContent = v;
        const sp = document.createElement('span');
        sp.textContent = label;
        c.append(b, sp);
        cards.appendChild(c);
      }
      wrap.append(h, cards);
      return wrap;
    };
    $('pf-stats').replaceChildren(group('Chơi online', me.stats.online), group('Chơi với máy', me.stats.ai));

    const list = $('pf-games');
    if (!games.length) {
      const e = document.createElement('div');
      e.className = 'pf-empty';
      e.textContent = 'Chưa có ván nào. Các ván bạn chơi khi đã đăng nhập sẽ được lưu ở đây.';
      list.replaceChildren(e);
      return;
    }
    list.replaceChildren(...games.map((g) => {
      const row = document.createElement('div');
      row.className = 'pf-game';
      const res = document.createElement('span');
      res.className = 'res ' + g.outcome;
      res.textContent = { win: 'Thắng', loss: 'Thua', draw: 'Hoà' }[g.outcome];
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('b');
      title.textContent = 'vs ' + g.opponent;
      const sub = document.createElement('span');
      const dot = document.createElement('i');
      dot.className = 'dot ' + g.color;
      const mode = g.mode === 'ai' ? `Với máy (${LEVEL_LABEL[g.level] || ''})` : 'Online';
      sub.append(dot, `${g.color === 'r' ? 'Đỏ' : 'Đen'} · ${mode} · ${REASON_LABEL[g.reason] || ''} · ${g.moveCount} nước · ${fmtDateTime(g.endedAt)}`);
      if (g.ratingChange !== null && g.ratingChange !== undefined) {
        const chg = document.createElement('span');
        chg.className = 'elo-chg ' + (g.ratingChange >= 0 ? 'up' : 'down');
        chg.textContent = ` · Elo ${g.ratingChange >= 0 ? '+' : ''}${g.ratingChange}`;
        sub.appendChild(chg);
      }
      info.append(title, sub);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Xem lại';
      btn.addEventListener('click', () => openReview(g.id));
      row.append(res, info, btn);
      return row;
    }));
  }

  // Chuyển mục bên phải: Lịch sử / Thống kê / Cài đặt
  function showPfPanel(name) {
    for (const p of ['history', 'stats', 'settings']) $('pf-panel-' + p).classList.toggle('hidden', p !== name);
    document.querySelectorAll('.pf-mi[data-pf]').forEach((b) => b.classList.toggle('active', b.dataset.pf === name));
    if (window.matchMedia('(max-width: 960px)').matches) $('pf-panel-' + name).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => showPfPanel(b.dataset.pf)));
  showPfPanel('history');
  $('pf-logout').addEventListener('click', logout);
  $('pf-perks').addEventListener('click', () => $('perks-modal').classList.remove('hidden'));
  $('pf-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  $('help-rules').addEventListener('click', () => {
    $('help-modal').classList.add('hidden');
    navigate('rules');
  });
  $('pf-share').addEventListener('click', async () => {
    const data = { title: 'Cờ Tướng Online', text: `Chơi cờ tướng với mình nhé!${me ? ` Tìm mình: @${me.username}` : ''}`, url: location.origin };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(`${data.text} ${data.url}`); toast('Đã sao chép lời mời — dán gửi cho bạn bè nhé!'); }
    } catch { /* người dùng huỷ chia sẻ */ }
  });
  $('feedback-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await accountApi('POST', '/feedback', { message: $('fb-message').value, contact: $('fb-contact').value, name: getName() });
      e.target.reset();
      $('help-modal').classList.add('hidden');
      toast('Cảm ơn bạn đã góp ý!');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  $('pf-region-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      onMe(await accountApi('PATCH', '/me', { region: $('pf-region').value }));
      toast('Đã lưu khu vực.');
    } catch (err) {
      toast(err.message);
    }
  });
  $('pf-name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      onMe(await accountApi('PATCH', '/me', { displayName: $('pf-display').value }));
      toast('Đã đổi tên hiển thị.');
    } catch (err) {
      toast(err.message);
    }
  });
  $('pf-pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await accountApi('PATCH', '/me', { currentPassword: $('pf-cur').value, newPassword: $('pf-new').value });
      e.target.reset();
      toast('Đã đổi mật khẩu.');
    } catch (err) {
      toast(err.message);
    }
  });

  // Đổi ảnh đại diện: cắt vuông giữa ảnh, thu về 256x256 rồi tải lên
  $('pf-avatar-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Không đọc được ảnh.'));
        im.src = url;
      });
      const size = 256, crop = Math.min(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.88));
      const res = await fetch('/api/account/avatar', {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + session }, body: blob,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Tải ảnh lên thất bại.');
      me = json.account;
      renderAuth();
      fillAvatar($('pf-avatar'), me);
      $('pf-avatar-del').classList.remove('hidden');
      toast('Đã đổi ảnh đại diện.');
    } catch (err) {
      toast(err.message);
    }
  });
  $('pf-avatar-del').addEventListener('click', async () => {
    try {
      ({ account: me } = await accountApi('DELETE', '/avatar'));
      renderAuth();
      fillAvatar($('pf-avatar'), me);
      $('pf-avatar-del').classList.add('hidden');
      toast('Đã xoá ảnh đại diện.');
    } catch (err) {
      toast(err.message);
    }
  });

  // Mở lại một ván đã lưu ở chế độ Phân tích
  async function openReview(id) {
    let game;
    try {
      ({ game } = await accountApi('GET', '/games/' + id));
    } catch (err) {
      return toast(err.message);
    }
    const history = [];
    let board = X.initialBoard();
    for (const [fr, fc, tr, tc] of game.moves) {
      history.push({ from: [fr, fc], to: [tr, tc], captured: board[tr][tc] });
      board = X.applyMove(board, [fr, fc], [tr, tc]);
    }
    const names = { r: game.players.r.name, b: game.players.b.name };
    review.active = true;
    selected = null;
    targets = [];
    viewGame = 'live';
    viewPly = 0;
    archiveCount = -1;
    lastMoveKey = null;
    analysisMode = true;
    setAiUi(true);
    $('room-prefix').textContent = 'Xem lại ·';
    $('room-code').textContent = fmtDateTime(game.endedAt);
    showScreen('game');
    applyState({
      review: true, reviewId: game.id, roomId: null, board, turn: history.length % 2 ? 'b' : 'r',
      lastMove: history[history.length - 1] || null, moveCount: history.length, history, gameNames: names,
      archive: [], result: game.result, inCheck: false,
      players: { r: { name: names.r, online: true }, b: { name: names.b, online: true } },
      spectators: 0, drawOffer: null, rematch: [], started: true,
      you: game.players.b.accountId === me.id ? 'b' : 'r',
    });
  }

  // ---------- Trang chủ: menu trái ----------
  // Điều hướng theo địa chỉ: #/online, #/ai, #/join, #/rules, #/profile (trang chủ: #/)
  function navigate(name) {
    const hash = name === 'home' ? '#/' : '#/' + name;
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  function route() {
    if (roomId || ai.active || review.active) return; // đang trong ván
    const [, name = 'home', arg] = location.hash.match(/^#\/(\w+)(?:\/(\w+))?/) || [];
    showLobbyError('');
    if (name === 'profile') return openProfile();
    if (name === 'puzzles') return openPuzzles();
    if (name === 'puzzle' && arg) return openPuzzle(arg);
    showScreen(name);
  }
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.sb-item').forEach((b) => b.addEventListener('click', () => {
    $('home-sidebar').classList.remove('open');
    navigate(b.dataset.go);
  }));
  $('sb-menu-btn').addEventListener('click', () => $('home-sidebar').classList.toggle('open'));
  $('sb-backdrop').addEventListener('click', () => $('home-sidebar').classList.remove('open'));
  for (const id of ['perks-modal', 'help-modal']) {
    $(id).addEventListener('click', (e) => {
      if (e.target === e.currentTarget || e.target.hasAttribute('data-close')) $(id).classList.add('hidden');
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['auth-modal', 'perks-modal', 'help-modal'].forEach((id) => $(id).classList.add('hidden'));
  });

  // ---------- Bài tập ----------
  const DIFF_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const pz = { list: [], filter: 'all', cur: null, board: null, turn: 'r', ply: 0, played: [], ui: null, busy: false, done: false, hints: 0 };
  const authHeader = () => (session ? { Authorization: 'Bearer ' + session } : {});
  const sameMv = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeader() } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra.');
    return json;
  }

  async function openPuzzles() {
    showScreen('puzzles');
    try {
      ({ puzzles: pz.list } = await fetchJson('/api/puzzles'));
      renderPuzzleGrid();
    } catch (err) {
      toast(err.message);
    }
  }

  // Ảnh xem trước thế cờ (SVG tĩnh)
  function puzzleThumb(p) {
    const svg = document.createElementNS(NS, 'svg');
    const g = BR.drawBoard(svg, theme, { flipped: p.side === 'b' });
    const flip = p.side === 'b';
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = p.board[r][c];
        if (!piece) continue;
        const [vr, vc] = flip ? [9 - r, 8 - c] : [r, c];
        BR.drawPiece(svg, theme, g.unit, piece, X.CHARS[piece], g.xs[vc], g.ys[vr]);
      }
    }
    return svg;
  }

  function renderPuzzleGrid() {
    const unsolved = $('pz-unsolved').checked;
    const list = pz.list.filter((p) => (pz.filter === 'all' || p.difficulty === pz.filter) && (!unsolved || !p.solved));
    const solvedCount = pz.list.filter((p) => p.solved).length;
    $('pz-progress').textContent = me ? `Đã giải ${solvedCount}/${pz.list.length} bài` : `${pz.list.length} bài · đăng nhập để lưu bài đã giải`;
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'pz-empty';
      e.textContent = pz.list.length ? 'Không có bài phù hợp với bộ lọc.' : 'Chưa có bài tập nào.';
      $('pz-grid').replaceChildren(e);
      return;
    }
    $('pz-grid').replaceChildren(...list.map((p) => {
      const a = document.createElement('a');
      a.className = 'pz-card';
      a.href = '#/puzzle/' + p.id;
      const info = document.createElement('div');
      info.className = 'pz-info';
      const title = document.createElement('b');
      title.textContent = p.title;
      const tags = document.createElement('div');
      tags.className = 'pz-tags';
      const diff = document.createElement('span');
      diff.className = 'diff ' + p.difficulty;
      diff.textContent = DIFF_LABEL[p.difficulty];
      tags.append(diff, `${p.side === 'r' ? 'Đỏ' : 'Đen'} đi · ${p.moves} nước`);
      if (p.solved) {
        const ok = document.createElement('span');
        ok.className = 'solved-tag';
        ok.textContent = '✓ Đã giải';
        tags.appendChild(ok);
      }
      info.append(title, tags);
      a.append(puzzleThumb(p), info);
      return a;
    }));
  }

  document.querySelectorAll('#pz-filter button').forEach((b) => b.addEventListener('click', () => {
    pz.filter = b.dataset.f;
    document.querySelectorAll('#pz-filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderPuzzleGrid();
  }));
  $('pz-unsolved').addEventListener('change', renderPuzzleGrid);

  function setPzFrame() {
    if (!pz.ui || !pz.ui.geo) return;
    const [, , w, h] = pz.ui.geo.viewBox;
    $('pz-frame').style.setProperty('--pz-ar', (w / h).toFixed(4));
  }

  async function openPuzzle(id) {
    showScreen('puzzle');
    let puzzle;
    try {
      ({ puzzle } = await fetchJson('/api/puzzles/' + encodeURIComponent(id)));
    } catch (err) {
      toast(err.message);
      return navigate('puzzles');
    }
    if (!pz.list.length) fetchJson('/api/puzzles').then((d) => { pz.list = d.puzzles; }).catch(() => {});
    pz.cur = puzzle;
    if (!pz.ui) pz.ui = new window.BoardUI($('pz-board'), { theme, onClick: onPuzzleClick });
    pz.ui.theme = theme;
    pz.ui.flipped = puzzle.side === 'b';
    $('pz-title').textContent = puzzle.title;
    const meta = $('pz-meta');
    meta.replaceChildren();
    const diff = document.createElement('span');
    diff.className = 'diff ' + puzzle.difficulty;
    diff.textContent = DIFF_LABEL[puzzle.difficulty];
    meta.append(diff, `${puzzle.moves} nước · ${puzzle.solvedBy} người đã giải`);
    if (puzzle.solved) {
      const ok = document.createElement('span');
      ok.className = 'solved-tag';
      ok.textContent = '✓ Bạn đã giải';
      meta.appendChild(ok);
    }
    $('pz-desc').textContent = puzzle.description || '';
    resetPuzzle();
    setPzFrame();
  }

  function pzStatus(html, cls = '') {
    $('pz-status').className = 'pz-status ' + cls;
    $('pz-status').innerHTML = html;
  }
  const sideName = (s) => (s === 'r' ? 'Đỏ' : 'Đen');
  const turnHtml = (s, text) => `<span class="turn-dot ${s}"></span>${text}`;

  function resetPuzzle() {
    const p = pz.cur;
    pz.board = p.board.map((row) => row.slice());
    pz.turn = p.side;
    pz.ply = 0;
    pz.played = [];
    pz.busy = false;
    pz.done = false;
    pz.hints = 0;
    pz.ui.set({ board: pz.board, selected: null, targets: [], lastMove: null, hint: null, flash: null });
    pzStatus(turnHtml(p.side, `Bạn cầm quân ${sideName(p.side)} — hãy tìm nước đi tốt nhất.`));
    renderPzMoves();
  }

  function renderPzMoves() {
    const list = $('pz-moves');
    list.replaceChildren();
    let b = pz.cur.board;
    const notes = pz.played.map((m) => { const n = X.notation(b, m.from, m.to); b = X.applyMove(b, m.from, m.to); return n; });
    for (let i = 0; i < notes.length; i += 2) {
      const li = document.createElement('li');
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = i / 2 + 1 + '.';
      li.appendChild(no);
      for (const k of [i, i + 1]) {
        const sp = document.createElement('span');
        if (k < notes.length) { sp.textContent = notes[k]; sp.className = (k % 2 === 0) === (pz.cur.side === 'r') ? 'r' : 'b'; }
        li.appendChild(sp);
      }
      list.appendChild(li);
    }
  }

  function onPuzzleClick(r, c) {
    if (pz.busy || pz.done || pz.turn !== pz.cur.side) return;
    const ui = pz.ui;
    const p = pz.board[r][c];
    if (ui.selected && ui.targets.some(([tr, tc]) => tr === r && tc === c)) {
      tryPuzzleMove(ui.selected, [r, c]);
    } else if (p && p[0] === pz.turn) {
      const same = ui.selected && ui.selected[0] === r && ui.selected[1] === c;
      ui.set({ selected: same ? null : [r, c], targets: same ? [] : X.legalMovesFrom(pz.board, r, c), hint: null });
    } else {
      ui.set({ selected: null, targets: [] });
    }
  }

  function applyPuzzleMove(m) {
    const captured = pz.board[m.to[0]][m.to[1]];
    pz.board = X.applyMove(pz.board, m.from, m.to);
    pz.played.push(m);
    pz.ply++;
    pz.turn = X.other(pz.turn);
    pz.ui.set({ board: pz.board, lastMove: m, selected: null, targets: [], hint: null, flash: null });
    playSound(!!captured);
    renderPzMoves();
  }

  function tryPuzzleMove(from, to) {
    const sol = pz.cur.solution;
    const move = { from, to };
    const last = pz.ply === sol.length - 1;
    const nb = X.applyMove(pz.board, from, to);
    const mate = X.isInCheck(nb, X.other(pz.turn)) && !X.hasAnyLegalMove(nb, X.other(pz.turn));
    if (sameMv(move, sol[pz.ply]) || (last && mate)) {
      applyPuzzleMove(move);
      if (pz.ply >= sol.length) return puzzleSolved();
      // Đối phương đáp trả theo lời giải
      pz.busy = true;
      pzStatus('✓ Chính xác! Đối phương đang đáp trả…', 'ok');
      setTimeout(() => {
        if (!pz.cur || pz.done) return;
        applyPuzzleMove(sol[pz.ply]);
        pz.busy = false;
        pzStatus(turnHtml(pz.cur.side, 'Tiếp tục — tìm nước tiếp theo.'));
      }, 650);
      return;
    }
    // Sai: cho thấy nước vừa đi rồi đặt lại
    pz.busy = true;
    const prev = pz.ui.lastMove;
    pz.ui.set({ board: nb, lastMove: move, selected: null, targets: [], flash: { at: to } });
    pzStatus('✗ Chưa đúng — thử nước khác nhé.', 'bad');
    setTimeout(() => {
      pz.ui.set({ board: pz.board, lastMove: prev, flash: null });
      pz.busy = false;
    }, 800);
  }

  async function puzzleSolved() {
    pz.done = true;
    pzStatus(`🎉 Chính xác! Bạn đã giải xong bài${pz.hints ? ` (dùng ${pz.hints} gợi ý)` : ''}.`, 'ok');
    try {
      const res = await fetchJson(`/api/puzzles/${pz.cur.id}/solve`, { method: 'POST', body: JSON.stringify({ moves: pz.played }) });
      const item = pz.list.find((p) => p.id === pz.cur.id);
      if (item) item.solved = true;
      if (res.account) { me = res.account; renderAuth(); }
      if (res.coins) toast(`+${res.coins} xu cho lần đầu giải bài này!`);
      else if (!session) toast('Đăng nhập để lưu bài đã giải và nhận xu.');
    } catch (err) {
      toast(err.message);
    }
  }

  $('pz-reset').addEventListener('click', () => pz.cur && resetPuzzle());
  $('pz-hint').addEventListener('click', () => {
    if (!pz.cur || pz.done || pz.busy || pz.turn !== pz.cur.side) return;
    pz.hints++;
    pz.ui.set({ hint: pz.cur.solution[pz.ply].from, selected: null, targets: [] });
    pzStatus(turnHtml(pz.cur.side, '💡 Gợi ý: hãy đi quân được khoanh xanh.'));
  });
  $('pz-show').addEventListener('click', () => {
    if (!pz.cur) return;
    resetPuzzle();
    pz.done = true;
    pz.busy = true;
    pzStatus('Đang xem lời giải…');
    pz.cur.solution.forEach((m, i) => setTimeout(() => {
      if (!pz.done) return;
      applyPuzzleMove(m);
      if (i === pz.cur.solution.length - 1) { pz.busy = false; pzStatus('Đó là lời giải. Bấm "Làm lại" để tự giải.'); }
    }, 700 * (i + 1)));
  });
  $('pz-next').addEventListener('click', () => {
    if (!pz.cur) return navigate('puzzles');
    const i = pz.list.findIndex((p) => p.id === pz.cur.id);
    const next = pz.list.slice(i + 1).find((p) => !p.solved) || pz.list[i + 1];
    if (next) navigate('puzzle/' + next.id);
    else { toast('Bạn đã tới bài cuối cùng.'); navigate('puzzles'); }
  });

  // ---------- Bàn cờ minh hoạ ở trang chủ ----------
  // Một thế khai cuộc tự chơi lặp lại; huy hiệu là đánh giá thật của máy cho từng nước
  const HERO_MOVES = [
    [[7, 7], [7, 4], 'good'], [[0, 7], [2, 6], 'good'], [[9, 7], [7, 6], 'good'], [[0, 8], [0, 7], 'good'],
    [[9, 8], [9, 7], 'good'], [[3, 4], [4, 4], 'mistake'], [[7, 4], [4, 4], 'good'],
  ];
  const HERO_BADGE = { good: ['✓', '#6fae3f'], mistake: ['?', '#f08a3c'], blunder: ['??', '#e05a47'], best: ['★', '#3aa676'] };
  let heroStep = 0, heroTimer = null;

  function drawHero() {
    const heroSvg = $('hero-board');
    const g = BR.drawBoard(heroSvg, theme);
    const [, , w, h] = g.viewBox;
    $('hero-frame').style.setProperty('--hero-ar', (w / h).toFixed(4));
    let b = X.initialBoard();
    for (let i = 0; i < heroStep; i++) b = X.applyMove(b, HERO_MOVES[i][0], HERO_MOVES[i][1]);
    const layer = el('g', {}, heroSvg);
    const mv = HERO_MOVES[heroStep - 1];
    const markAt = (r, c, rad, cls) => {
      const m = el('g', { transform: `translate(${g.xs[c]} ${g.ys[r]}) scale(${g.unit})` }, layer);
      el('circle', { r: rad, class: cls }, m);
    };
    if (mv) markAt(mv[0][0], mv[0][1], 30, 'last-from');
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) if (b[r][c]) BR.drawPiece(layer, theme, g.unit, b[r][c], X.CHARS[b[r][c]], g.xs[c], g.ys[r]);
    }
    if (mv) {
      const [sym, color] = HERO_BADGE[mv[2]];
      const u = g.unit;
      const badge = el('g', { class: 'hero-badge', transform: `translate(${g.xs[mv[1][1]] + 34 * u} ${g.ys[mv[1][0]] - 34 * u}) scale(${u})` }, layer);
      el('circle', { r: 24, fill: color, stroke: '#fff', 'stroke-width': 3 }, badge);
      el('text', { y: 1, 'font-size': sym.length > 1 ? 24 : 30 }, badge).textContent = sym;
    }
  }

  function heroTick() {
    clearTimeout(heroTimer);
    const visible = !$('lobby').classList.contains('hidden') && !$('shell').classList.contains('hidden') && !document.hidden;
    if (visible) {
      heroStep = heroStep >= HERO_MOVES.length ? 0 : heroStep + 1;
      drawHero();
    }
    heroTimer = setTimeout(heroTick, heroStep === HERO_MOVES.length ? 3500 : heroStep === 0 ? 1500 : 1300);
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    heroStep = HERO_MOVES.length; // không chạy hiệu ứng: hiện thế cờ cuối
    drawHero();
  } else {
    drawHero();
    heroTimer = setTimeout(heroTick, 1200);
  }

  renderAuth();
  if (!urlRoom) route();
  if (session) {
    accountApi('GET', '/me').then(onMe).catch(() => {});
  }

  $('copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Đã sao chép link mời!');
    } catch {
      prompt('Sao chép link này gửi cho bạn bè:', link);
    }
  });

  // ---------- Xem lại ván cờ ----------
  const reasonText = { checkmate: 'chiếu bí', stalemate: 'hết nước đi', resign: 'đầu hàng', draw: 'hoà', abandon: 'rời bàn', timeout: 'hết giờ' };

  function viewedGame() {
    if (viewGame !== 'live' && state.archive[viewGame]) return state.archive[viewGame];
    viewGame = 'live';
    // Tên người chơi của ván (giữ lại cả khi một bên đã rời bàn)
    const seatNames = { r: state.players.r && state.players.r.name, b: state.players.b && state.players.b.name };
    const names = state.gameNames && state.gameNames.r ? state.gameNames : seatNames;
    return { n: state.archive.length + 1, history: state.history, result: state.result, players: names };
  }

  function replayData(game) {
    const key = `${viewGame}:${state.archive.length}:${game.history.length}`;
    if (replayCache.key !== key) replayCache = { key, data: X.replay(game.history) };
    return replayCache.data;
  }

  const isReviewing = () => viewGame !== 'live' || viewPly !== null;
  // Chỉ được xem lại khi ván đã kết thúc và người dùng đã bấm "Phân tích"
  const canReview = () => !!state.result && analysisMode;

  function currentView() {
    if (!canReview()) {
      viewGame = 'live';
      viewPly = null;
    }
    const game = viewedGame();
    const total = game.history.length;
    if (viewGame === 'live' && viewPly !== null && viewPly >= total) viewPly = null;
    if (!isReviewing()) {
      return { board: state.board, lastMove: state.lastMove, ply: total, total, live: true,
        result: state.result, turn: state.turn, inCheck: state.inCheck };
    }
    const ply = Math.max(0, Math.min(viewPly === null ? total : viewPly, total));
    const board = replayData(game).boards[ply];
    const turn = ply % 2 === 0 ? 'r' : 'b';
    return { board, lastMove: ply ? game.history[ply - 1] : null, ply, total, live: false,
      result: ply === total ? game.result : null, turn, inCheck: X.isInCheck(board, turn) };
  }

  function goTo(ply) {
    if (!canReview()) return toast(state.result ? 'Bấm "Phân tích" để xem lại ván cờ.' : 'Chỉ xem lại được khi ván đã kết thúc.');
    const total = viewedGame().history.length;
    ply = Math.max(0, Math.min(ply, total));
    viewPly = viewGame === 'live' && ply === total ? null : ply;
    selected = null;
    targets = [];
    render();
  }

  function resultText(result, players) {
    if (!result) return '';
    if (!result.winner) return 'Kết quả: Hoà';
    const loser = X.other(result.winner);
    const why = result.reason === 'resign' ? `${players[loser] || colorName(loser)} đầu hàng` : reasonText[result.reason];
    return `Kết quả: ${colorName(result.winner)} (${players[result.winner] || '?'}) thắng — ${why}`;
  }

  function renderGamePicker() {
    if (archiveCount === state.archive.length) return;
    archiveCount = state.archive.length;
    const sel = $('game-pick');
    sel.innerHTML = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    };
    add('live', state.review ? 'Ván đã lưu' : `Ván ${state.archive.length + 1} (đang chơi)`);
    for (let i = state.archive.length - 1; i >= 0; i--) {
      const g = state.archive[i];
      const res = !g.result.winner ? 'hoà' : `${colorName(g.result.winner)} thắng`;
      add(i, `Ván ${g.n}: ${g.players.r} vs ${g.players.b} — ${res}`);
    }
    sel.value = String(viewGame);
  }

  function renderReplay(v) {
    renderGamePicker();
    const reviewable = canReview();
    const label = $('rp-label');
    if (!reviewable) label.textContent = state.result ? 'Bấm "Phân tích" để xem lại' : 'Xem lại khi hết ván';
    else label.textContent = v.total ? `Nước ${v.ply}/${v.total}` : 'Chưa có nước đi';
    if (!v.live && viewGame === 'live') label.textContent += ' · đang xem lại';
    label.classList.toggle('review', !v.live);
    $('rp-first').disabled = $('rp-prev').disabled = !reviewable || v.ply === 0;
    $('rp-next').disabled = !reviewable || v.ply === v.total;
    $('rp-last').disabled = !reviewable || v.live; // ⏭ luôn đưa về nước mới nhất của ván đang chơi
    $('game-pick').disabled = !reviewable;
    $('game-pick').value = String(viewGame);
    $('download').disabled = !reviewable;
    $('move-list').classList.toggle('locked', !reviewable);

    const game = viewedGame();
    const { notes } = replayData(game);
    const anEntry = analysisEntry();
    renderAnalysis(v, game, anEntry);
    const list = $('move-list');
    list.innerHTML = '';
    if (!notes.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Chưa có nước đi nào.';
      list.appendChild(li);
    }
    let current = null;
    for (let i = 0; i < notes.length; i += 2) {
      const li = document.createElement('li');
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = i / 2 + 1 + '.';
      li.appendChild(no);
      for (const k of [i, i + 1]) {
        if (k >= notes.length) break;
        const btn = document.createElement('button');
        btn.textContent = notes[k];
        btn.className = k % 2 === 0 ? 'r' : 'b';
        const q = anEntry && classify(anEntry, k);
        if (q) {
          const tag = document.createElement('span');
          tag.className = 'q q-' + q.key;
          tag.textContent = q.sym;
          tag.title = q.label;
          btn.appendChild(tag);
        }
        if (v.ply === k + 1) { btn.classList.add('current'); current = btn; }
        btn.disabled = !reviewable;
        btn.addEventListener('click', () => goTo(k + 1));
        li.appendChild(btn);
      }
      list.appendChild(li);
    }
    if (game.result) {
      const li = document.createElement('li');
      li.className = 'result-line';
      li.textContent = resultText(game.result, game.players);
      list.appendChild(li);
    }
    if (current) {
      const lr = list.getBoundingClientRect(), cr = current.getBoundingClientRect();
      if (cr.top < lr.top) list.scrollTop -= lr.top - cr.top + 6;
      else if (cr.bottom > lr.bottom) list.scrollTop += cr.bottom - lr.bottom + 6;
    } else if (v.ply === 0) {
      list.scrollTop = 0;
    }
  }

  // ---------- Phân tích đánh giá từng nước ----------
  // Máy phân tích lần lượt từng thế cờ (Web Worker riêng), so nước đã đi với nước tốt nhất.
  const MATE = 30000;
  const QUALITY = [
    { key: 'best', sym: '★', label: 'Nước tốt nhất', max: 0 },
    { key: 'good', sym: '✓', label: 'Nước tốt', max: 60 },
    { key: 'inacc', sym: '?!', label: 'Thiếu chính xác', max: 150 },
    { key: 'mistake', sym: '?', label: 'Sai lầm', max: 350 },
    { key: 'blunder', sym: '??', label: 'Sai lầm nghiêm trọng', max: Infinity },
  ];
  const an = { worker: null, cache: new Map(), job: null, reqId: 0, aiSession: 0 };
  const clampScore = (v) => Math.max(-2000, Math.min(2000, v));

  function analysisKey(game) {
    const owner = state.review ? 'rv' + state.reviewId : state.ai ? 'ai' + an.aiSession : roomId;
    return `${owner}:${game.n}:${game.history.length}`;
  }

  // Kết quả phân tích của ván đang xem (chỉ khi đang ở chế độ Phân tích); tự bắt đầu nếu chưa có
  function analysisEntry() {
    if (!state || !analysisMode || !canReview()) return null;
    const game = viewedGame();
    const key = analysisKey(game);
    let entry = an.cache.get(key);
    if (!entry) {
      entry = { key, results: [], total: game.history.length + 1, done: false };
      an.cache.set(key, entry);
    }
    if (!entry.done && (!an.job || an.job.key !== key)) startAnalysis(game, entry);
    return entry;
  }

  function anWorker() {
    if (!an.worker) {
      an.worker = new Worker('engine.js');
      an.worker.onmessage = (e) => {
        const job = an.job;
        if (!job || e.data.id !== job.id) return;
        job.entry.results.push(e.data.result);
        if (state) render();
        nextAnalysis();
      };
    }
    return an.worker;
  }

  function startAnalysis(game, entry) {
    an.job = { id: ++an.reqId, key: entry.key, entry, history: game.history, boards: X.replay(game.history).boards };
    nextAnalysis();
  }

  function nextAnalysis() {
    const job = an.job;
    const i = job.entry.results.length;
    if (i >= job.entry.total) {
      job.entry.done = true;
      an.job = null;
      if (state) render();
      return;
    }
    const m = job.history[i];
    anWorker().postMessage({
      type: 'analyze', id: job.id, board: job.boards[i], side: turnAt(i),
      played: m ? { from: m.from, to: m.to } : null,
      boards: job.boards.slice(0, i + 1),
    });
  }

  // Đánh giá nước thứ i (0 = nước đầu tiên của Đỏ)
  function classify(entry, i) {
    const r = entry.results[i];
    if (!r || r.playedScore === null || r.playedScore === undefined) return null;
    const loss = Math.max(0, clampScore(r.bestScore) - clampScore(r.playedScore));
    const m = viewedGame().history[i];
    const isBest = r.best && m && r.best.from[0] === m.from[0] && r.best.from[1] === m.from[1] && r.best.to[0] === m.to[0] && r.best.to[1] === m.to[1];
    const q = isBest ? QUALITY[0] : QUALITY.slice(1).find((x) => loss <= x.max);
    return { ...q, loss };
  }

  // Điểm thế cờ thứ i theo góc nhìn Đỏ
  function redEval(entry, i) {
    const r = entry.results[i];
    if (!r) return null;
    return turnAt(i) === 'r' ? r.bestScore : -r.bestScore;
  }

  function evalText(v) {
    if (Math.abs(v) > MATE - 500) {
      const moves = Math.ceil((MATE - Math.abs(v)) / 2);
      if (!moves) return `${v > 0 ? 'Đỏ' : 'Đen'} đã chiếu bí`;
      return `${v > 0 ? 'Đỏ' : 'Đen'} chiếu bí sau ${moves} nước`;
    }
    if (Math.abs(v) < 20) return 'Cân bằng';
    return `${v > 0 ? 'Đỏ' : 'Đen'} hơn ${(Math.abs(v) / 100).toFixed(1)}`;
  }

  function renderAnalysis(v, game, entry) {
    $('an-box').classList.toggle('hidden', !entry);
    if (!entry) return;
    const n = entry.results.length, total = entry.total;
    $('an-progress').classList.toggle('hidden', entry.done);
    $('an-progress-text').textContent = `Máy đang phân tích... ${Math.min(n, total)}/${total}`;
    $('an-bar').style.width = `${Math.round((n / total) * 100)}%`;

    // Độ chính xác & số nước theo từng loại cho mỗi bên
    const rows = ['r', 'b'].map((side) => {
      let accSum = 0, cnt = 0;
      const counts = Object.fromEntries(QUALITY.map((x) => [x.key, 0]));
      for (let i = 0; i < game.history.length; i++) {
        if (turnAt(i) !== side) continue;
        const q = classify(entry, i);
        if (!q) continue;
        counts[q.key]++;
        accSum += 100 * Math.exp(-q.loss / 350);
        cnt++;
      }
      const row = document.createElement('div');
      row.className = 'an-row';
      const who = document.createElement('div');
      who.className = 'who';
      const dot = document.createElement('i');
      dot.className = 'dot ' + side;
      const name = document.createElement('span');
      name.textContent = (game.players && game.players[side]) || colorName(side);
      who.append(dot, name);
      const acc = document.createElement('span');
      acc.className = 'acc';
      acc.textContent = cnt ? `${Math.round(accSum / cnt)}%` : '—';
      acc.title = 'Độ chính xác';
      const cs = document.createElement('span');
      cs.className = 'counts';
      for (const x of QUALITY) {
        if (x.key === 'good') continue;
        const c = document.createElement('span');
        const tag = document.createElement('span');
        tag.className = 'q q-' + x.key;
        tag.textContent = x.sym;
        c.title = x.label;
        c.append(tag, ' ' + counts[x.key]);
        cs.appendChild(c);
      }
      row.append(who, acc, cs);
      return row;
    });
    $('an-summary').replaceChildren(...rows);

    // Biểu đồ thế trận (trên = Đỏ ưu thế, dưới = Đen ưu thế)
    const chart = $('an-chart');
    const W = 300, H = 60, N = Math.max(1, total - 1);
    const y = (val) => H / 2 - (clampScore(val) / 1200) * (H / 2 - 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const e = redEval(entry, i);
      pts.push(`${((i / N) * W).toFixed(1)},${Math.max(2, Math.min(H - 2, y(e))).toFixed(1)}`);
    }
    const NS2 = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => { const e = document.createElementNS(NS2, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const parts = [mk('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'zero' })];
    if (pts.length > 1) {
      const lastX = pts[pts.length - 1].split(',')[0];
      parts.push(mk('polygon', { points: `0,${H / 2} ${pts.join(' ')} ${lastX},${H / 2}`, class: 'area' }));
      parts.push(mk('polyline', { points: pts.join(' '), class: 'line' }));
    }
    const cx = (v.ply / N) * W;
    parts.push(mk('line', { x1: cx, y1: 0, x2: cx, y2: H, class: 'cursor' }));
    chart.replaceChildren(...parts);

    // Nhận xét nước đang xem
    const detail = $('an-detail');
    detail.replaceChildren();
    const { boards, notes } = replayData(game);
    const line = (cls) => { const d = document.createElement('div'); if (cls) d.className = cls; detail.appendChild(d); return d; };
    const cur = entry.results[v.ply];
    if (v.ply === 0) {
      line().textContent = 'Thế cờ ban đầu.';
    } else {
      const i = v.ply - 1;
      const q = classify(entry, i);
      const head = line();
      const b = document.createElement('b');
      b.textContent = `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${notes[i]}`;
      head.appendChild(b);
      if (q) {
        const tag = document.createElement('span');
        tag.className = 'q q-' + q.key;
        tag.textContent = q.sym;
        head.append(' ', tag, ' ' + q.label);
        const r = entry.results[i];
        if (q.key !== 'best' && r.best) {
          head.append(' · Nước tốt hơn: ');
          const bb = document.createElement('b');
          bb.textContent = X.notation(boards[i], r.best.from, r.best.to);
          head.appendChild(bb);
        }
      } else {
        head.append(' · đang phân tích...');
      }
    }
    if (cur) {
      const info = line('muted');
      const e = redEval(entry, v.ply);
      info.textContent = `Đánh giá: ${evalText(e)}`;
      if (cur.best) info.textContent += ` · Mũi tên xanh: nước tốt nhất tiếp theo (${X.notation(boards[v.ply], cur.best.from, cur.best.to)})`;
    }
  }

  $('an-chart').addEventListener('click', (e) => {
    const entry = analysisEntry();
    if (!entry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    goTo(Math.round(((e.clientX - rect.left) / rect.width) * (entry.total - 1)));
  });

  $('rp-first').addEventListener('click', () => goTo(0));
  $('rp-prev').addEventListener('click', () => goTo(currentView().ply - 1));
  $('rp-next').addEventListener('click', () => goTo(currentView().ply + 1));
  $('rp-last').addEventListener('click', () => {
    viewGame = 'live';
    $('game-pick').value = 'live';
    viewPly = null;
    render();
  });
  $('game-pick').addEventListener('change', (e) => {
    if (!canReview()) return;
    viewGame = e.target.value === 'live' ? 'live' : Number(e.target.value);
    viewPly = viewGame === 'live' ? null : 0;
    selected = null;
    targets = [];
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (!state || $('game').classList.contains('hidden')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !canReview()) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); $('rp-prev').click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); $('rp-next').click(); }
  });

  $('download').addEventListener('click', () => {
    if (!canReview()) return;
    const game = viewedGame();
    const { notes } = replayData(game);
    const lines = [
      'Cờ Tướng Online — Phòng ' + roomId + ' — Ván ' + game.n,
      'Đỏ: ' + (game.players.r || '?'),
      'Đen: ' + (game.players.b || '?'),
      resultText(game.result, game.players) || 'Kết quả: chưa kết thúc',
      '',
    ];
    for (let i = 0; i < notes.length; i += 2) {
      lines.push(`${i / 2 + 1}. ${notes[i].padEnd(7)} ${notes[i + 1] || ''}`.trimEnd());
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `co-tuong-${roomId}-van-${game.n}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Tab Nước đi / Chat
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('tab-moves').classList.toggle('hidden', tab.dataset.tab !== 'moves');
      $('tab-chat').classList.toggle('hidden', tab.dataset.tab !== 'chat');
      if (tab.dataset.tab === 'chat') {
        unreadChat = 0;
        $('chat-badge').classList.add('hidden');
        $('chat-log').scrollTop = $('chat-log').scrollHeight;
      }
    });
  });

  // ---------- Chat ----------
  function renderChatHistory(list) {
    $('chat-log').innerHTML = '';
    unreadChat = 0;
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Chưa có tin nhắn.';
      $('chat-log').appendChild(e);
    }
    list.forEach(addChat);
    unreadChat = 0;
    $('chat-badge').classList.add('hidden');
  }

  function addChat(msg) {
    if (!msg.system && $('tab-chat').classList.contains('hidden')) {
      unreadChat++;
      $('chat-badge').textContent = unreadChat;
      $('chat-badge').classList.remove('hidden');
    }
    const log = $('chat-log');
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const row = document.createElement('div');
    if (msg.system) {
      row.className = 'sys';
      row.textContent = msg.text;
    } else {
      row.className = 'msg';
      const b = document.createElement('b');
      b.className = msg.color || 's';
      b.textContent = msg.name + ': ';
      row.append(b, document.createTextNode(msg.text));
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    socket.emit('chat', text);
    $('chat-input').value = '';
  });

  // ---------- Tiện ích ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  let audioCtx;
  function playSound(capture) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = capture ? 220 : 420;
      g.gain.setValueAtTime(0.25, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.16);
    } catch { /* bỏ qua nếu trình duyệt chặn âm thanh */ }
  }
})();
