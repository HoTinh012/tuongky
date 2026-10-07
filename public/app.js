(() => {
  'use strict';

  const X = window.Xiangqi;
  const BR = window.BoardRender;
  const { rankOf, TIERS } = window.Ranks;
  const Catalog = window.Catalog;
  const ECON = Catalog.ECONOMY;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const socket = io();

  // ---------- Tiện ích DOM ----------
  // h('div', { class: 'x', text: '...', onclick }, ...con)
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
  // Thay toàn bộ nội dung, bỏ qua các phần tử rỗng (null/false)
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  function icon(name, cls = '') {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', ('ico ' + cls).trim());
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }
  function svgEl(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
  const initials = (name) => {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)) || '?').toUpperCase();
  };
  const fmtDate = (t) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtTime = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = (t) => new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDuration = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000)), m = Math.floor(t / 60), s = t % 60;
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Ảnh đại diện (hoặc chữ cái đầu)
  function avatarEl(person, cls = '') {
    const a = h('span', { class: ('avatar ' + cls).trim() });
    const text = person && person.ai ? 'AI' : initials(person && (person.displayName || person.name));
    // Ảnh lỗi (vd bị xoá khỏi Storage) → hiện chữ cái đầu
    if (person && person.avatar) a.appendChild(h('img', { src: person.avatar, alt: '', onerror: () => { a.textContent = text; } }));
    else a.textContent = text;
    if (person && person.ai) a.classList.add('ai');
    return a;
  }

  // ---------- Danh tính ----------
  // Token theo từng tab (sessionStorage) để tải lại trang vẫn giữ được ghế,
  // nhưng 2 tab khác nhau vẫn là 2 người chơi khác nhau.
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const store = {
    get: (k) => safe(() => localStorage.getItem(k)),
    set: (k, v) => safe(() => localStorage.setItem(k, v)),
    json: (k, d) => safe(() => JSON.parse(localStorage.getItem(k))) || d,
  };
  let token = safe(() => sessionStorage.getItem('xq-token'));
  if (!token) {
    token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    safe(() => sessionStorage.setItem('xq-token', token));
  }
  // Mã người chơi cố định cho trình duyệt này (localStorage) — không cần đăng ký
  let uid = store.get('xq-uid');
  if (!uid || !/^[A-Za-z0-9_-]{8,64}$/.test(uid)) {
    uid = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    store.set('xq-uid', uid);
  }
  // Phiên đăng nhập tài khoản (không bắt buộc)
  let session = store.get('xq-session');
  let me = null; // tài khoản đang đăng nhập
  const storedName = () => (store.get('xq-name') || '').trim();
  const getName = () => (me ? me.displayName : storedName() || 'Người chơi');

  // ---------- Trạng thái ván ----------
  let roomId = null;
  let state = null;
  let myColor = null;
  let selected = null;
  let targets = [];
  let lastMoveKey = null;
  // Xem lại: viewGame = 'live' (ván đang chơi) hoặc chỉ số trong state.archive; viewPly = null là nước mới nhất.
  let viewGame = 'live';
  let viewPly = null;
  let replayCache = { key: null, data: null };
  let archiveCount = -1;
  let analysisMode = false; // chỉ được xem lại sau khi bấm "Phân tích"
  let hintMove = null; // gợi ý của máy (đấu máy)
  let resultSeen = null; // { key, at } — lúc thấy ván kết thúc (tính thời lượng)

  // ---------- Nhịp chơi ----------
  // 'tổng phút|giây cộng mỗi nước'
  const TC_LABEL = { '5|0': '5+0', '10|0': '10+0', '15|10': '15+10', '30|0': '30+0', '0|0': 'Không giới hạn' };
  const parseTc = (v) => { const [totalMin, incSec] = v.split('|').map(Number); return { totalMin, incSec }; };
  let playTc = ['5|0', '10|0', '15|10'].includes(store.get('tk-play-tc')) ? store.get('tk-play-tc') : '10|0';
  let roomTc = TC_LABEL[store.get('tk-room-tc')] ? store.get('tk-room-tc') : '10|0';

  function tcText(st) {
    if (!st || (!st.totalMs && !st.moveMs)) return 'Không giới hạn thời gian';
    const parts = [];
    if (st.totalMs) parts.push(`${st.totalMs / 60000}+${(st.incMs || 0) / 1000}`);
    if (st.moveMs) parts.push(`tối đa ${st.moveMs >= 60000 ? st.moveMs / 60000 + ' phút' : st.moveMs / 1000 + ' giây'} mỗi nước`);
    return 'Nhịp ' + parts.join(' · ');
  }
  const tcShort = (st) => (!st || (!st.totalMs && !st.moveMs) ? '∞' : st.totalMs ? `${st.totalMs / 60000}+${(st.incMs || 0) / 1000}` : `${st.moveMs / 1000}s/nước`);

  function setupTcPickers() {
    const paint = () => {
      document.querySelectorAll('#tc-grid .tc-card').forEach((b) => { b.classList.toggle('active', b.dataset.tc === playTc); b.setAttribute('aria-checked', b.dataset.tc === playTc); });
      document.querySelectorAll('#room-tc .chip').forEach((b) => b.classList.toggle('active', b.dataset.tc === roomTc));
      $('qm-tc').textContent = TC_LABEL[playTc];
    };
    document.querySelectorAll('#tc-grid .tc-card').forEach((b) => b.addEventListener('click', () => { playTc = b.dataset.tc; store.set('tk-play-tc', playTc); paint(); }));
    document.querySelectorAll('#room-tc .chip').forEach((b) => b.addEventListener('click', () => { roomTc = b.dataset.tc; store.set('tk-room-tc', roomTc); paint(); }));
    const saved = store.get('tk-room-move');
    if (saved !== null && [...$('room-move').options].some((o) => o.value === saved)) $('room-move').value = saved;
    $('room-move').addEventListener('change', () => store.set('tk-room-move', $('room-move').value));
    paint();
  }
  setupTcPickers();

  // Ô "Tên của bạn" (khách) có ở nhiều trang — luôn đồng bộ với nhau
  document.querySelectorAll('.guest-name').forEach((inp) => {
    inp.value = storedName();
    inp.addEventListener('input', () => {
      store.set('xq-name', inp.value.trim());
      document.querySelectorAll('.guest-name').forEach((o) => { if (o !== inp) o.value = inp.value; });
    });
  });

  // ---------- Chơi với bạn: tạo phòng / vào phòng ----------
  const roomOptions = () => {
    const color = document.querySelector('input[name="color"]:checked').value;
    const { totalMin, incSec } = parseTc(roomTc);
    return {
      name: getName(), token, uid, session, color, totalMin, incSec, moveSec: Number($('room-move').value),
      rules: { spectators: $('rule-spectators').checked, takeback: $('rule-takeback').checked },
    };
  };
  $('create').addEventListener('click', () => socket.emit('create', roomOptions()));
  // Mời kỳ hữu: tạo phòng và gửi thông báo cho bạn ấy
  function inviteFriend(f) {
    if (!me) return openAuth('login');
    socket.emit('invite-friend', { ...roomOptions(), to: f.id });
    toast(`Đã tạo phòng và gửi lời mời tới ${f.displayName}.`);
  }
  async function renderInviteList() {
    const box = $('invite-list');
    if (!session) return box.replaceChildren(h('div', { class: 'mini-empty' }, 'Đăng nhập và kết bạn để mời trực tiếp.'));
    try {
      const data = await accountApi('GET', '/social');
      const list = [...data.friends].sort((a, b) => (b.online - a.online) || (a.playing - b.playing));
      box.replaceChildren(...(list.length ? list.slice(0, 8).map((f) => h('div', { class: 'mini-row' },
        avatarEl(f), h('span', { class: 'grow' }, h('b', { text: f.displayName }), ' ',
          h('small', { class: f.online ? 'up' : 'muted', text: f.playing ? '· đang chơi' : f.online ? '· online' : '· offline' })),
        h('button', { class: 'btn sm', text: 'Mời', onclick: () => inviteFriend(f) }))) : [h('div', { class: 'mini-empty' }, 'Chưa có kỳ hữu — ', h('a', { href: '#/friends', text: 'tìm bạn bè' }))]));
    } catch { box.replaceChildren(); }
  }

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (!code) return showLobbyError('Vui lòng nhập mã phòng.');
    socket.emit('join', { roomId: code, name: getName(), token, uid, session });
  });

  function watchRoom(id) {
    spectate = true;
    socket.emit('join', { roomId: id, name: getName(), token, uid, session, spectate: true });
  }

  function showLobbyError(msg, kind) {
    $('lobby-err').textContent = msg;
    $('lobby-err').classList.toggle('info', kind === 'info');
  }

  // ---------- Ghép trận (Q02 Tìm đối thủ) ----------
  const TIPS = [
    'Pháo đầu, Mã đội — khai cuộc kinh điển nhưng đừng quên ra Xe sớm.',
    'Trước mỗi nước, hỏi mình: đối thủ vừa đe doạ gì?',
    'Tốt qua sông như Xe nhỏ — đừng xem nhẹ.',
    'Còn ít thời gian? Ưu tiên nước an toàn, giữ cung Tướng chắc chắn.',
    'Sau ván, bấm “Phân tích” để biết nước nào hay, nước nào hớ.',
  ];
  // mode: 'ranked' (Xếp hạng) | 'coin' (Tranh xu)
  const mm = { active: false, since: 0, range: 100, searching: 1, rating: null, timer: null, settings: null, tip: 0, mode: 'ranked', stake: null, found: null };

  function startMatchmaking(settings, mode = 'ranked', stake = null) {
    if (mode === 'coin' && !me) { openAuth('login'); return toast('Tranh xu cần đăng nhập tài khoản.'); }
    const need = mode === 'coin' ? stake : me ? ECON.RANKED_FEE : 0;
    if (me && me.coins < need) return toast(`Không đủ xu — cần ${need} xu, bạn có ${fmt(me.coins)} xu.`);
    mm.active = true;
    mm.since = Date.now();
    mm.range = 100;
    mm.rating = me ? me.rating : 1200;
    mm.settings = settings;
    mm.mode = mode;
    mm.stake = stake;
    mm.found = null;
    mm.tip = Math.floor(Math.random() * TIPS.length);
    showLobbyError('');
    resetOppCard();
    $('mm-accept-box').classList.add('hidden');
    $('mm-cancel').classList.remove('hidden');
    $('mm-tc').textContent = tcShort({ totalMs: settings.totalMin * 60000, incMs: settings.incSec * 1000, moveMs: settings.moveSec * 1000 });
    document.querySelector('#page-search .eyebrow').textContent = mode === 'coin' ? `Chơi nhanh · Tranh xu ${stake} xu` : 'Chơi nhanh · Xếp hạng';
    document.querySelector('#page-search .search-card .tag').textContent = mode === 'coin' ? `Tranh xu · ${stake} xu` : me ? `Xếp hạng · phí ${ECON.RANKED_FEE} xu` : 'Ghép trận';
    showScreen('search');
    renderMM();
    clearInterval(mm.timer);
    mm.timer = setInterval(renderMM, 250);
    socket.emit('mm-join', { name: getName(), token, uid, session, ...settings, mode, stake });
  }
  function resetOppCard() {
    $('mm-opp-av').textContent = '?';
    $('mm-opp-av').classList.remove('found');
    $('mm-opp-name').textContent = 'Chưa có đối thủ';
    $('mm-opp-sub').textContent = 'Hệ thống đang tìm người có Elo gần bạn nhất.';
    $('mm-opp-tag').textContent = 'Đang chờ ghép…';
  }

  $('quick-match').addEventListener('click', () => startMatchmaking({ ...parseTc(playTc), moveSec: 0 }, 'ranked'));

  function stopMM() {
    mm.active = false;
    mm.found = null;
    clearInterval(mm.timer);
  }
  function cancelMM(toPlay = true) {
    if (mm.active) socket.emit('mm-leave');
    stopMM();
    if (toPlay) showScreen('play');
  }
  $('mm-cancel').addEventListener('click', () => cancelMM());
  $('mm-cancel-top').addEventListener('click', () => cancelMM());

  function renderMM() {
    const t = Math.floor((Date.now() - mm.since) / 1000);
    $('mm-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const rank = rankOf(mm.rating);
    $('mm-elo').textContent = fmt(mm.rating);
    $('mm-tier').textContent = rank.name;
    $('mm-range').textContent = mm.range === null ? 'Mọi mức Elo' : `±${mm.range} Elo`;
    $('mm-searching').textContent = mm.searching;
    if (!mm.found) {
      $('mm-info').textContent = mm.range === null ? 'Đã nới rộng — ghép với bất kỳ ai đang tìm.' : `Tìm đối thủ Elo ${fmt(mm.rating - mm.range)}–${fmt(mm.rating + mm.range)}`;
    } else {
      // Đếm ngược thời gian xác nhận
      const left = Math.max(0, mm.found.deadline - (Date.now() - mm.found.skew));
      $('mm-accept-left').textContent = `(${Math.ceil(left / 1000)})`;
      $('mm-accept-bar').style.width = `${(left / mm.found.total) * 100}%`;
    }
    $('mm-tip').textContent = TIPS[(mm.tip + Math.floor(t / 7)) % TIPS.length];
  }

  socket.on('mm-status', (st) => {
    if (!st.queued) {
      if (mm.active) cancelMM();
      if (st.reason) { showLobbyError(st.reason); toast(st.reason); }
      return;
    }
    if (!mm.active) return;
    mm.since = Date.now() - (st.now - st.since);
    mm.range = st.range;
    mm.searching = st.searching;
    mm.rating = st.rating;
    renderMM();
  });

  // Tìm thấy đối thủ → chờ hai bên bấm Chấp nhận
  socket.on('mm-found', (d) => {
    if (!mm.active) return socket.emit('mm-decline', { matchId: d.matchId });
    mm.found = { id: d.matchId, deadline: d.deadline, skew: Date.now() - d.now, total: Math.max(1000, d.deadline - d.now) };
    $('mm-opp-av').textContent = initials(d.opponent);
    $('mm-opp-av').classList.add('found');
    $('mm-opp-name').textContent = d.opponent;
    $('mm-opp-sub').textContent = `Elo ${fmt(d.rating)}${d.mode === 'coin' ? ` · Tranh xu ${d.stake} xu` : d.rated ? ` · tính Elo, phí ${d.fee} xu` : ' · không tính Elo'}`;
    $('mm-opp-tag').textContent = 'Chờ xác nhận';
    $('mm-info').textContent = 'Đã tìm thấy đối thủ — bấm Chấp nhận để vào bàn.';
    $('mm-accept-info').textContent = `${d.opponent} (Elo ${fmt(d.rating)})${d.mode === 'coin' ? ` · đặt ${d.stake} xu` : d.rated ? ` · phí ${d.fee} xu` : ''}`;
    $('mm-accept-box').classList.remove('hidden');
    $('mm-cancel').classList.add('hidden');
    $('mm-accept').disabled = false;
    playSound(false);
    renderMM();
  });
  socket.on('mm-opponent-accepted', () => { $('mm-opp-tag').textContent = 'Đối thủ đã chấp nhận'; });
  socket.on('mm-requeue', (d) => {
    mm.found = null;
    $('mm-accept-box').classList.add('hidden');
    $('mm-cancel').classList.remove('hidden');
    resetOppCard();
    toast(d.reason);
  });
  $('mm-accept').addEventListener('click', () => {
    if (!mm.found) return;
    socket.emit('mm-accept', { matchId: mm.found.id });
    $('mm-accept').disabled = true;
    $('mm-info').textContent = 'Đã chấp nhận — chờ đối thủ…';
  });
  $('mm-decline').addEventListener('click', () => {
    if (mm.found) socket.emit('mm-decline', { matchId: mm.found.id });
    stopMM();
    showScreen('play');
  });

  // ---------- Tranh xu (Q01) ----------
  let coinTc = ECON.COIN_TCS.some((x) => x.tc === store.get('tk-coin-tc')) ? store.get('tk-coin-tc') : '5|0';
  let coinStake = ECON.STAKES.includes(Number(store.get('tk-coin-stake'))) ? Number(store.get('tk-coin-stake')) : ECON.STAKES[0];
  function renderCoinCard() {
    const coins = me ? me.coins : 0;
    $('coin-balance').textContent = me ? `${fmt(coins)} xu` : 'Cần đăng nhập';
    $('coin-tc').replaceChildren(...ECON.COIN_TCS.map((x) => h('button', {
      class: 'chip' + (x.tc === coinTc ? ' active' : ''), onclick: () => { coinTc = x.tc; store.set('tk-coin-tc', coinTc); renderCoinCard(); },
    }, x.tc.replace('|', '+'), h('small', { text: x.group }))));
    // Chỉ cho chọn mức mà số dư đủ
    if (me && coinStake > coins) coinStake = [...ECON.STAKES].reverse().find((v) => v <= coins) || ECON.STAKES[0];
    $('coin-stakes').replaceChildren(...ECON.STAKES.map((v) => h('button', {
      class: 'chip gold' + (v === coinStake ? ' active' : ''), disabled: me && v > coins ? true : null,
      title: me && v > coins ? 'Không đủ xu' : null,
      onclick: () => { coinStake = v; store.set('tk-coin-stake', String(v)); renderCoinCard(); },
    }, `${v} xu`)));
    const btn = $('coin-match');
    const enough = me && coins >= coinStake;
    btn.disabled = !!me && !enough;
    btn.querySelector('span').textContent = !me ? 'Đăng nhập để tranh xu' : enough ? `Tìm trận · đặt ${coinStake} xu · ${coinTc.replace('|', '+')}` : 'Không đủ xu';
  }
  $('coin-match').addEventListener('click', () => {
    if (!me) return openAuth('login');
    startMatchmaking({ ...parseTc(coinTc), moveSec: 0 }, 'coin', coinStake);
  });

  // ---------- Điều hướng ----------
  const SCREENS = {
    home: 'lobby', play: 'page-play', search: 'page-search', room: 'page-room', ai: 'page-ai', puzzle: 'page-puzzle',
    ranking: 'page-ranking', tournaments: 'page-tournaments', tournament: 'page-tournament', friends: 'page-friends', inventory: 'page-inventory',
    rules: 'page-rules', profile: 'profile', game: 'game',
  };
  const PAGE_TITLE = {
    home: 'Trang chủ', play: 'Chơi nhanh', search: 'Tìm đối thủ', room: 'Chơi với bạn', ai: 'Đấu máy', puzzle: 'Cờ thế',
    ranking: 'Xếp hạng', tournaments: 'Giải đấu', tournament: 'Giải đấu', friends: 'Bạn bè', inventory: 'Túi đồ', rules: 'Luật chơi', profile: 'Hồ sơ kỳ thủ', game: 'Bàn cờ',
  };
  let lastPage = 'home';
  let currentScreen = 'home';

  const KIND_NAMES = { ranked: 'Xếp hạng', match: 'Ghép trận', coin: 'Tranh xu', room: 'Phòng riêng', tournament: 'Giải đấu', ai: 'Đấu máy' };
  const KIND_TITLE = { ranked: 'Bàn xếp hạng', match: 'Bàn ghép trận', coin: 'Bàn tranh xu', room: 'Phòng riêng', tournament: 'Bàn giải đấu' };
  // Mục menu trái & breadcrumb của màn hiện tại
  function navOf(name) {
    if (name === 'search' || name === 'room') return 'play';
    if (name === 'puzzle') return 'ai';
    if (name === 'tournament') return 'tournaments';
    if (name === 'game') return state && state.review ? 'profile' : (state && state.ai) ? 'ai' : state && state.tournament ? 'tournaments' : 'play';
    return name;
  }
  function crumbsOf(name) {
    const play = ['Chơi nhanh', '#/play'], aiC = ['Đấu máy', '#/ai'];
    switch (name) {
      case 'search': return [play, ['Tìm đối thủ']];
      case 'room': return [play, ['Chơi với bạn']];
      case 'ai': return aiTab === 'puzzles' ? [aiC, ['Cờ thế']] : aiTab === 'history' ? [aiC, ['Lịch sử luyện tập']] : [['Đấu máy']];
      case 'puzzle': return [aiC, ['Cờ thế', '#/puzzles'], [pz.cur ? pz.cur.title : '…']];
      case 'inventory': return invMode === 'shop' ? [['Túi đồ', '#/inventory'], ['Cửa hàng']] : [['Túi đồ']];
      case 'tournament': return [['Giải đấu', '#/tournaments'], [tour.cur ? tour.cur.name : '…']];
      case 'game':
        if (state && state.review) return [[state.publicReplay ? 'Xem lại' : 'Hồ sơ kỳ thủ', state.publicReplay ? null : '#/profile'], ['Xem lại ván']];
        if (state && state.ai) return [aiC, ['Bàn luyện tập']];
        if (state && state.tournament) return [['Giải đấu', '#/tournaments'], [state.tournament.name, '#/tournament/' + state.tournament.id], [`Vòng ${state.tournament.round}`]];
        return [play, [KIND_TITLE[state && state.kind] || 'Bàn cờ online']];
      default: return [[PAGE_TITLE[name] || 'Trang chủ']];
    }
  }
  function updateCrumbs() {
    const nav = $('crumbs');
    const items = [['Tượng Kỳ', '#/'], ...crumbsOf(currentScreen)];
    nav.replaceChildren(...items.flatMap(([label, href], i) => {
      const last = i === items.length - 1;
      const node = last || !href ? h('b', { text: label }) : h('a', { href, text: label });
      return i ? [h('span', { text: '/' }), node] : [node];
    }));
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.go === navOf(currentScreen)));
    document.title = `${items[items.length - 1][0]} · Tượng Kỳ`;
  }

  function showScreen(name) {
    if (name === 'lobby' || !SCREENS[name]) name = 'home';
    for (const [key, id] of Object.entries(SCREENS)) $(id).classList.toggle('hidden', key !== name);
    $('sidebar').classList.remove('open');
    if (name !== 'game' && name !== 'search') lastPage = name;
    currentScreen = name;
    updateCrumbs();
    window.scrollTo(0, 0);
    if (name === 'home' || name === 'play') refreshLive();
    $('notif-panel').classList.add('hidden');
  }

  const inGame = () => !!(roomId || ai.active || review.active);
  function navigate(name) {
    if (inGame() && !leaveGame()) return;
    const hash = name === 'home' ? '#/' : '#/' + name;
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  // Điều hướng theo địa chỉ: #/play, #/ai, #/puzzles, #/ranking... (trang chủ: #/)
  function route() {
    if (inGame()) return; // đang trong ván
    if (mm.active) { cancelMM(false); toast('Đã huỷ tìm trận.'); }
    let [, name = 'home', arg] = location.hash.match(/^#\/(\w+)(?:\/(\w+))?/) || [];
    showLobbyError('');
    if (name === 'online') name = 'play';
    if (name === 'join') name = 'room';
    if (name === 'puzzles') return openAi('puzzles');
    if (name === 'ai') return openAi(arg === 'history' ? 'history' : 'ai');
    if (name === 'puzzle' && arg) return openPuzzle(arg);
    if (name === 'profile') return openProfile();
    if (name === 'ranking') return openRanking();
    if (name === 'friends') return openFriends();
    if (name === 'inventory') return openInventory('bag');
    if (name === 'shop') return openInventory('shop');
    if (name === 'tournaments') return openTournaments();
    if (name === 'tournament' && arg) return openTournament(arg);
    if (name === 'replay' && arg) return openPublicReplay(arg);
    if (name === 'search') name = 'play';
    showScreen(name);
    if (name === 'home') renderHome();
    if (name === 'play') renderPlay();
    if (name === 'room') renderInviteList();
  }
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    navigate(b.dataset.go);
  }));
  // Link điều hướng (breadcrumb, logo, thẻ...) khi đang trong ván: rời ván trước
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || !inGame()) return;
    e.preventDefault();
    if (leaveGame()) location.hash = a.getAttribute('href');
  });
  $('sb-menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('sb-backdrop').addEventListener('click', () => $('sidebar').classList.remove('open'));
  $('sb-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  for (const id of ['help-modal', 'edit-modal', 'share-modal', 'report-modal']) {
    $(id).addEventListener('click', (e) => {
      if (e.target === e.currentTarget || e.target.closest('[data-close]')) $(id).classList.add('hidden');
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['auth-modal', 'help-modal', 'edit-modal', 'share-modal', 'report-modal', 'notif-panel'].forEach((id) => $(id).classList.add('hidden'));
  });

  // Vào thẳng phòng nếu link có ?room=XXXX
  const params = new URLSearchParams(location.search);
  const urlRoom = params.get('room');
  let spectate = params.has('watch'); // ?watch=1: chỉ xem, không ngồi vào ghế trống
  if (urlRoom) {
    $('code').value = urlRoom.toUpperCase();
    if (storedName() || spectate || session) {
      socket.emit('join', { roomId: urlRoom, name: getName(), token, uid, session, spectate });
    } else {
      showScreen('room');
      document.querySelector('#page-room .col-side .guest-name').focus();
      showLobbyError('Nhập tên rồi bấm "Vào phòng" để tham gia phòng ' + urlRoom.toUpperCase() + '.');
    }
  }

  // ---------- Socket ----------
  let wasDisconnected = false;
  socket.on('connect', () => {
    socket.emit('hello', { uid, session });
    $('conn-banner').classList.add('hidden');
    if (wasDisconnected) toast('Đã kết nối lại.');
    wasDisconnected = false;
    if (mm.active) socket.emit('mm-join', { name: getName(), token, uid, session, ...mm.settings, mode: mm.mode, stake: mm.stake });
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

  // Mất kết nối: hiện thanh báo ở trên cùng cho tới khi kết nối lại
  socket.on('disconnect', () => {
    wasDisconnected = true;
    $('conn-banner').classList.remove('hidden');
  });
  // Thông báo mới (lời mời kết bạn, mời đấu, giải đấu...)
  socket.on('notify', ({ notification: n, unread }) => {
    if (me) { me.unread = unread; renderAuth(); }
    notifs.list = [n, ...notifs.list.filter((x) => x.id !== n.id)];
    if (!$('notif-panel').classList.contains('hidden')) renderNotifications();
    toast(notifText(n));
    playSound(false);
    if (n.type === 'friend_request' || n.type === 'friend_accept') { if (currentScreen === 'friends') openFriends(); }
    if (n.type === 'tournament' && currentScreen === 'tournament' && tour.cur && tour.cur.id === n.data.tid) openTournament(n.data.tid, true);
  });

  socket.on('joined', (data) => {
    stopMM();
    if (data.roomId !== roomId) {
      // Phòng mới: bỏ trạng thái xem lại / phân tích của ván trước
      analysisMode = false;
      viewGame = 'live';
      viewPly = null;
      archiveCount = -1;
      hintMove = null;
      selected = null;
      targets = [];
    }
    roomId = data.roomId;
    myColor = data.color;
    showLobbyError('');
    $('room-code').textContent = roomId;
    history.replaceState(null, '', '?room=' + roomId + (spectate ? '&watch=1' : ''));
    renderChatHistory(data.chat || []);
    setGameUi('room');
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
    // Ghi lại lúc ván vừa kết thúc (để tính thời lượng)
    const gameKey = `${s.roomId || (s.ai ? 'ai' + an.aiSession : 'rv')}:${(s.archive || []).length}`;
    if (s.result && (!state || !state.result) && state) {
      resultSeen = { key: gameKey, at: Date.now() };
      // Ván online vừa xong: cập nhật Elo / xu trên thanh trên
      if (session && !s.ai && !s.review && s.you) setTimeout(() => accountApi('GET', '/me').then(onMe).catch(() => {}), 400);
    }
    if (!s.result && resultSeen && resultSeen.key === gameKey) resultSeen = null;
    state = s;
    myColor = s.you;
    if (prevColor !== myColor) drawStatic();

    const key = s.lastMove ? `${s.moveCount}` : null;
    if (key && key !== lastMoveKey && lastMoveKey !== null) playSound(!!s.lastMove.captured);
    if (key !== lastMoveKey) hintMove = null;
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
    if (mm.active) cancelMM();
    if (!roomId) showLobbyError(msg);
    else toast(msg);
  });

  // ---------- Giao diện bàn cờ: theo Tượng Kỳ + đồ trang bị trong Túi đồ ----------
  const svg = $('board');
  let serverTheme = BR.DEFAULT_THEME;
  // Bộ trang bị (mã vật phẩm trong catalog.js): tài khoản lưu trên server, khách lưu trên trình duyệt (chỉ đồ miễn phí)
  const GUEST_EQUIP = 'tk-equip2';
  const freeOnly = (eq) => Object.fromEntries(Object.entries(Catalog.DEFAULT_EQUIP).map(([cat, def]) => {
    const it = Catalog.byId[eq && eq[cat]];
    return [cat, it && it.cat === cat && it.price === 0 ? it.id : def];
  }));
  let equip = freeOnly(store.json(GUEST_EQUIP, {}));
  // Vật phẩm → cấu hình vẽ bàn cờ
  function itemTheme(eq) {
    const b = Catalog.byId[eq.board] || Catalog.byId[Catalog.DEFAULT_EQUIP.board];
    const p = Catalog.byId[eq.pieces] || Catalog.byId[Catalog.DEFAULT_EQUIP.pieces];
    const board = b.board.type === 'default' ? serverTheme.board
      : b.board.type === 'image' ? BR.BUILTIN_BOARDS.find((x) => x.src === b.board.src) || serverTheme.board
        : { type: 'classic', name: b.name, palette: b.board.palette };
    const pieces = p.pieces.style === 'default' ? serverTheme.pieces : { ...serverTheme.pieces, style: p.pieces.style };
    return { board, pieces };
  }
  const effectiveTheme = () => itemTheme(equip);
  // Đổi bộ trang bị đang dùng (khi đăng nhập / đăng xuất / trang bị mới)
  function setEquip(eq) {
    const next = { ...Catalog.DEFAULT_EQUIP, ...(eq || {}) };
    if (JSON.stringify(next) === JSON.stringify(equip)) return;
    equip = next;
    applyClockStyle();
    setTheme();
  }
  let theme = effectiveTheme();
  let geo = BR.geometry(theme);
  const px = (c) => geo.xs[c];
  const py = (r) => geo.ys[r];

  const CLOCK_CLASSES = ['clock-digital', 'clock-wood', 'clock-minimal', 'clock-cinnabar', 'clock-tournament'];
  const clockStyle = (id) => ((Catalog.byId[id] || {}).clock || { style: 'classic' }).style;
  function applyClockStyle() {
    document.body.classList.remove(...CLOCK_CLASSES);
    const st = clockStyle(equip.clock);
    if (st !== 'classic') document.body.classList.add('clock-' + st);
  }
  applyClockStyle();

  function setTheme(t) {
    if (t && t.board && t.pieces) serverTheme = t;
    theme = effectiveTheme();
    dynLayer = null;
    if (pz.ui) { pz.ui.theme = theme; pz.ui.render(); setPzFrame(); }
    if (pz.list.length && aiTab === 'puzzles') renderPuzzleGrid();
    renderMinis();
    if (state) render();
    else applyBoardFrame();
  }

  function applyBoardFrame() {
    geo = BR.geometry(theme);
    const [, , w, h2] = geo.viewBox;
    $('game').style.setProperty('--board-ar', (w / h2).toFixed(4));
  }

  fetch('/api/theme').then((r) => r.json()).then(setTheme).catch(() => {});
  socket.on('theme', setTheme);
  const flipped = () => myColor === 'b';
  const toView = (r, c) => (flipped() ? [9 - r, 8 - c] : [r, c]);

  // Bàn cờ nhỏ (xem trước, trận hot, cờ thế...)
  function miniBoard(target, board, { flip = false, lastMove = null, th = theme } = {}) {
    const g = BR.drawBoard(target, th, { flipped: flip });
    const at = (r, c) => (flip ? [g.xs[8 - c], g.ys[9 - r]] : [g.xs[c], g.ys[r]]);
    if (lastMove) {
      const [x, y] = at(...lastMove.from);
      svgEl('circle', { cx: x, cy: y, r: 30 * g.unit, class: 'last-from', 'stroke-width': 3 * g.unit }, target);
    }
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        const [x, y] = at(r, c);
        BR.drawPiece(target, th, g.unit, p, X.CHARS[p], x, y);
      }
    }
    if (lastMove) {
      const [x, y] = at(...lastMove.to);
      svgEl('circle', { cx: x, cy: y, r: 49 * g.unit, fill: 'none', stroke: '#2f6fd6', 'stroke-width': 5 * g.unit }, target);
    }
    return g;
  }

  let dynLayer;

  function drawStatic() {
    geo = BR.drawBoard(svg, theme, { flipped: flipped() });
    applyBoardFrame();
    dynLayer = svgEl('g', {}, svg);
  }

  function drawPiece(p, x, y, isSel) {
    BR.drawPiece(dynLayer, theme, geo.unit, p, X.CHARS[p], x, y, isSel);
  }

  // Vòng đánh dấu (kích thước thiết kế cho ô 100 đơn vị, tự co theo bàn cờ)
  function mark(vr, vc, r, cls) {
    const g = svgEl('g', { transform: `translate(${px(vc)} ${py(vr)}) scale(${geo.unit})` }, dynLayer);
    svgEl('circle', { r, class: cls }, g);
  }

  function drawArrow(from, to, cls = 'best-arrow') {
    const [fr, fc] = toView(...from), [tr, tc] = toView(...to);
    const x1 = px(fc), y1 = py(fr), x2 = px(tc), y2 = py(tr);
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const u = geo.unit;
    const hx = x2 - ux * 45 * u, hy = y2 - uy * 45 * u; // chân đầu mũi tên
    svgEl('line', { x1, y1, x2: hx + ux * 3 * u, y2: hy + uy * 3 * u, class: cls, style: `stroke-width:${17 * u}` }, dynLayer);
    const nx = -uy * 25 * u, ny = ux * 25 * u;
    svgEl('polygon', { points: `${x2 - ux * 11 * u},${y2 - uy * 11 * u} ${hx + nx},${hy + ny} ${hx - nx},${hy - ny}`, class: cls + '-head' }, dynLayer);
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
    // Gợi ý (đấu máy): mũi tên xanh dương
    if (hintMove && v.live && !state.result) drawArrow(hintMove.from, hintMove.to, 'hint-arrow');

    renderHeader();
    renderPlayers();
    renderStatus();
    renderActions();
    renderReplay(v);
    renderResult();
    if (currentScreen === 'game') updateCrumbs(); // menu & breadcrumb theo loại ván (đấu máy / xếp hạng / phòng)
  }

  // ---------- Đầu trang ván cờ ----------
  // mode: 'room' | 'ai' | 'review'
  let gameMode = 'room';
  function setGameUi(mode) {
    gameMode = mode;
    $('chat-card').classList.toggle('hidden', mode !== 'room');
    $('copy').classList.toggle('hidden', mode !== 'room');
  }
  // Nhãn loại ván ở đầu trang
  function kindLabel(st) {
    if (st.tournament) return `${st.tournament.name} · Vòng ${st.tournament.round} ·`;
    if (st.kind === 'ranked') return `Xếp hạng · phí ${st.fee || ECON.RANKED_FEE} xu · Phòng`;
    if (st.kind === 'coin') return `Tranh xu ${st.stake} xu · Phòng`;
    if (st.kind === 'match') return 'Ghép trận · Phòng';
    const rules = [];
    if (st.rules && st.rules.takeback) rules.push('cho đi lại');
    if (st.rules && !st.rules.spectators) rules.push('không cho xem');
    return `Phòng riêng${rules.length ? ' (' + rules.join(', ') + ')' : ''} ·`;
  }

  function renderHeader() {
    const title = $('game-title');
    if (state.result && !analysisMode) return; // tiêu đề kết quả do renderResult đặt
    if (state.review) title.textContent = 'Nhìn lại ván đã chơi.';
    else if (state.ai) title.textContent = 'Rèn kỹ nghệ cùng máy.';
    else if (!state.started) title.textContent = state.players.r && state.players.b ? 'Hai kỳ thủ đã vào bàn.' : 'Đang chờ đối thủ vào bàn…';
    else if (!myColor) title.textContent = 'Bạn đang xem trực tiếp.';
    else title.textContent = 'Một ván cờ hay đang mở ra.';
    if (state.result && analysisMode) title.textContent = 'Phân tích ván cờ.';
    if (gameMode === 'room') $('room-prefix').textContent = kindLabel(state);
    $('copy').classList.toggle('hidden', gameMode !== 'room' || state.kind !== 'room');
    $('spectators').textContent = state.spectators ? `· ${state.spectators} người xem` : '';
    $('time-control').textContent = state.ai ? `Máy ${LEVEL_LABEL[ai.level] || ''} · ${ai.assist ? 'có gợi ý & đi lại' : 'không gợi ý'}`
      : state.review ? 'Dùng ◀ ▶ hoặc phím ← → để tua từng nước' : tcText(state.settings);
  }

  // ---------- G02: Kết thúc ván ----------
  const reasonText = { checkmate: 'chiếu bí', stalemate: 'hết nước đi', resign: 'đầu hàng', draw: 'hoà', abandon: 'rời bàn', timeout: 'hết giờ' };
  const colorName = (c) => (c === 'r' ? 'Đỏ' : 'Đen');

  function renderResult() {
    const ended = !!state.result && !analysisMode;
    $('game').classList.toggle('ended', ended);
    if (!ended) return;

    const { winner, reason } = state.result;
    const n = state.history.length;
    const persp = myColor || 'r'; // góc nhìn: mình (hoặc bên Đỏ nếu đang xem)
    const opp = X.other(persp);
    let kind, title, sub, ico, headline;
    if (!winner) {
      kind = 'draw'; title = 'Hoà cờ'; ico = 'draw'; headline = 'Một ván cờ cân tài cân sức.';
      sub = `Hai bên đồng ý hoà · sau ${n} nước`;
    } else if (!myColor) {
      kind = 'win'; title = `${colorName(winner)} thắng`; ico = 'trophy'; headline = 'Ván đấu đã khép lại.';
      sub = `${state.players[winner] ? state.players[winner].name : ''} · ${reasonText[reason]} · sau ${n} nước`;
    } else if (winner === myColor) {
      kind = 'win'; title = 'Bạn thắng!'; ico = 'trophy'; headline = 'Một chiến thắng xứng đáng.';
      const why = { checkmate: 'Chiếu bí', stalemate: 'Đối phương hết nước đi', resign: 'Đối phương đầu hàng', abandon: 'Đối phương đã rời bàn', timeout: 'Đối phương hết giờ' };
      sub = `${why[reason]} · sau ${n} nước`;
    } else {
      kind = 'lose'; title = 'Bạn thua'; ico = 'flag'; headline = 'Thua keo này, ta bày keo khác.';
      const why = { checkmate: 'Bị chiếu bí', stalemate: 'Bạn hết nước đi', resign: 'Bạn đã đầu hàng', abandon: 'Bạn đã rời bàn', timeout: 'Bạn đã hết giờ' };
      sub = `${why[reason]} · sau ${n} nước`;
    }
    $('game-title').textContent = headline;
    $('result-card').className = 'card result-card ' + kind;
    $('result-ico').replaceChildren(icon(ico));
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;

    // Hai bên + tỉ số + Elo/xu thay đổi
    const rc = state.result.ratingChange || null;
    const cc = state.result.coinChange || null;
    const sideEl = (c) => {
      const p = state.players[c] || { name: (state.gameNames && state.gameNames[c]) || colorName(c) };
      const sub2 = p.ai ? 'Máy' : p.rating ? `Elo ${fmt(p.rating)}` : p.username ? '@' + p.username : 'Khách';
      const av = avatarEl(p);
      if (c === myColor) av.classList.add('me');
      const box = h('div', { class: 'vs-side' }, av, h('b', { text: p.name }), h('small', { text: `${colorName(c)} · ${sub2}` }));
      if (rc && rc[c] !== undefined) box.appendChild(h('small', { class: 'elo-chg ' + (rc[c] >= 0 ? 'up' : 'down'), text: `Elo ${signed(rc[c])}` }));
      return box;
    };
    const score = !winner ? '½–½' : winner === persp ? '1–0' : '0–1';
    $('result-vs').replaceChildren(sideEl(persp), h('div', { class: 'vs-score', text: score }), sideEl(opp));
    const deltas = [];
    if (myColor && rc && rc[myColor] !== undefined) deltas.push(h('span', { class: 'delta ' + (rc[myColor] >= 0 ? 'up' : 'down') }, `${signed(rc[myColor])} Elo`));
    const coins = myColor ? (state.ai ? ai.coinDelta : cc && cc[myColor]) : null;
    if (coins) deltas.push(h('span', { class: 'delta coin' + (coins < 0 ? ' down' : '') }, icon('coin', 'sm'), `${signed(coins)} xu`));
    if (myColor && state.kind === 'ranked' && state.fee) deltas.push(h('span', { class: 'delta' }, `đã trừ ${state.fee} xu phí`));
    if (myColor && !rc && !state.ai && state.kind !== 'room' && state.kind !== 'coin' && state.started) deltas.push(h('span', { class: 'delta' }, 'Không tính Elo'));
    const old = $('result-card').querySelector('.delta-row');
    if (old) old.remove();
    if (deltas.length) $('result-vs').after(h('div', { class: 'delta-row' }, deltas));

    // Mời chơi lại / tái đấu
    const hint = $('result-hint');
    const opponentGone = myColor && !state.ai && !state.players[X.other(myColor)];
    const asked = myColor && state.rematch.includes(myColor);
    const oppAsked = myColor && state.rematch.includes(X.other(myColor));
    hint.textContent = opponentGone ? 'Đối thủ đã rời bàn.' + (state.matchmaking ? '' : ' Đang chờ người chơi mới vào phòng...')
      : oppAsked && !asked ? 'Đối thủ muốn tái đấu!' : asked ? 'Đã mời — đang chờ đối thủ đồng ý...' : '';
    hint.className = 'result-hint' + (oppAsked && !asked ? ' ask' : '');

    const main = $('res-rematch'), alt = $('res-alt');
    const rematchLabel = asked ? 'Đang chờ đối thủ...' : oppAsked ? 'Đồng ý tái đấu' : 'Tái đấu';
    main.disabled = false;
    alt.classList.add('hidden');
    main.classList.remove('hidden');
    if (state.tournament) {
      // Ván giải đấu: về trang giải xem vòng tiếp theo
      main.replaceChildren(icon('trophy'), 'Về trang giải');
    } else if (!myColor) {
      main.classList.add('hidden');
    } else if (state.ai) {
      main.replaceChildren(icon('play'), 'Ván mới');
    } else if (state.matchmaking) {
      // Chơi tiếp = tìm trận mới đúng chế độ & thiết lập vừa chơi (doc §10.3)
      main.replaceChildren(icon('swords'), state.kind === 'coin' ? `Tìm trận mới · ${state.stake} xu` : 'Tìm trận mới');
    } else if (opponentGone) {
      main.classList.add('hidden');
    } else {
      main.replaceChildren(icon('play'), rematchLabel === 'Tái đấu' ? 'Chơi lại' : rematchLabel);
      main.disabled = !!asked;
    }

    // Thống kê ván
    let caps = 0, checks = 0;
    const { boards } = replayData(viewedGame());
    state.history.forEach((m, i) => {
      if (turnAt(i) !== persp) return;
      if (m.captured) caps++;
      if (boards[i + 1] && X.isInCheck(boards[i + 1], opp)) checks++;
    });
    const key = `${state.roomId || (state.ai ? 'ai' + an.aiSession : 'rv')}:${(state.archive || []).length}`;
    const startAt = state.ai ? ai.game.startedAt : state.startedAt ? state.startedAt + clockOffset : null;
    const dur = resultSeen && resultSeen.key === key && startAt ? fmtDuration(resultSeen.at - startAt) : '—';
    $('result-stats').replaceChildren(
      ...[['Số nước', n], ['Thời lượng', dur], ['Quân bắt được', caps], ['Lần chiếu tướng', checks]]
        .map(([k, v]) => h('div', {}, h('small', { text: k }), h('b', { text: String(v) }))),
    );
    $('result-stats').style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';

    renderRadar(persp);
  }

  // Sáu chỉ số lục giác (theo đánh giá của máy cho các nước của bên persp)
  const RADAR_AXES = ['Khai cuộc', 'Trung cuộc', 'Tàn cuộc', 'Chính xác', 'Chiến thuật', 'Quản lý thời gian'];
  function radarMetrics(entry, side, game) {
    const { boards } = replayData(game);
    const acc = { open: [], mid: [], end: [], all: [] };
    let opps = 0, found = 0;
    for (let i = 0; i < game.history.length; i++) {
      if (turnAt(i) !== side) continue;
      const q = classify(entry, i);
      if (!q) continue;
      const a = 100 * Math.exp(-q.loss / 350);
      acc.all.push(a);
      (i < 20 ? acc.open : i < 60 ? acc.mid : acc.end).push(a);
      // Cơ hội chiến thuật: nước tốt nhất là ăn quân hoặc chiếu tướng
      const best = entry.results[i] && entry.results[i].best;
      if (best) {
        const bd = boards[i];
        const tactical = !!bd[best.to[0]][best.to[1]] || X.isInCheck(X.applyMove(bd, best.from, best.to), X.other(side));
        if (tactical) { opps++; if (q.loss <= 60) found++; }
      }
    }
    const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
    // Quản lý thời gian: còn ≥ 50% quỹ giờ khi kết thúc = 100 điểm; hết giờ = 0
    let time = null;
    const st = state.settings;
    if (!state.ai && !state.review && st && st.totalMs && state.clock) {
      if (state.result.reason === 'timeout' && state.result.winner !== side) time = 0;
      else time = Math.round(Math.min(1, Math.max(0, state.clock[side] / st.totalMs) * 2) * 100);
    }
    return [avg(acc.open), avg(acc.mid), avg(acc.end), avg(acc.all), opps ? Math.round((100 * found) / opps) : null, time];
  }

  function renderRadar(side) {
    const game = viewedGame();
    const entry = game.history.length >= 8 ? ensureAnalysis(game) : null;
    const chart = $('radar');
    chart.replaceChildren();
    const cx = 160, cy = 128, R = 92;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    };
    for (const lv of [0.25, 0.5, 0.75, 1]) {
      svgEl('polygon', { class: 'web', points: RADAR_AXES.map((_, i) => pt(i, lv).join(',')).join(' ') }, chart);
    }
    RADAR_AXES.forEach((label, i) => {
      const [x, y] = pt(i, 1);
      svgEl('line', { class: 'axis', x1: cx, y1: cy, x2: x, y2: y }, chart);
      const [tx, ty] = pt(i, 1.2);
      const t = svgEl('text', { x: tx, y: ty, 'text-anchor': Math.abs(tx - cx) < 5 ? 'middle' : tx > cx ? 'start' : 'end', 'dominant-baseline': 'middle' }, chart);
      t.textContent = label;
    });
    const sub = $('radar-sub');
    const legend = $('radar-legend');
    const tags = [h('span', { class: 'tag soft', text: reasonText[state.result.reason] || '' })];
    if (!state.ai && !state.review) tags.push(h('span', { class: 'tag soft', text: tcShort(state.settings) }));
    $('end-tags').replaceChildren(...tags);
    if (!entry) {
      sub.textContent = 'Ván quá ngắn để chấm điểm (cần ít nhất 8 nước).';
      legend.replaceChildren(...RADAR_AXES.map((label) => h('li', {}, h('span', { text: label }), h('b', { text: '—' }))));
      $('end-ins-title').textContent = 'Ván kết thúc sớm';
      $('end-ins-text').textContent = 'Ván cờ quá ngắn để chấm điểm chi tiết. Bạn vẫn có thể mở phân tích để xem lại từng nước.';
      return;
    }
    if (!entry.done) {
      sub.textContent = `Máy đang chấm điểm từng nước… ${Math.min(entry.results.length, entry.total)}/${entry.total}`;
    } else {
      sub.textContent = `Đánh giá của máy cho quân ${colorName(side)}${side === myColor ? ' của bạn' : ''}`;
    }
    const vals = radarMetrics(entry, side, game);
    const pts = vals.map((v, i) => pt(i, (v === null ? 50 : v) / 100));
    svgEl('polygon', { class: 'shape', points: pts.map((p) => p.join(',')).join(' ') }, chart);
    pts.forEach(([x, y]) => svgEl('circle', { class: 'pt', cx: x, cy: y, r: 3.5 }, chart));
    legend.replaceChildren(...RADAR_AXES.map((label, i) => h('li', {}, h('span', { text: label }), h('b', { text: vals[i] === null ? '—' : String(vals[i]) }))));

    // Nhận xét nhanh ở cột bàn cờ
    if (!entry.done) {
      $('end-ins-title').textContent = 'Đang chấm điểm ván cờ…';
      $('end-ins-text').textContent = 'Máy đang đánh giá từng nước: nước hay, thiếu chính xác hay sai lầm.';
      return;
    }
    let worst = null, bestCount = 0;
    for (let i = 0; i < game.history.length; i++) {
      if (turnAt(i) !== side) continue;
      const q = classify(entry, i);
      if (!q) continue;
      if (q.key === 'best') bestCount++;
      if (!worst || q.loss > worst.loss) worst = { i, ...q };
    }
    const { notes } = replayData(game);
    if (worst && worst.loss > 150) {
      const r = entry.results[worst.i];
      $('end-ins-title').textContent = `Nước cần xem lại: ${Math.floor(worst.i / 2) + 1}. ${notes[worst.i]} ${worst.sym}`;
      $('end-ins-text').textContent = `${worst.label}${r && r.best ? ` — máy gợi ý ${X.notation(replayData(game).boards[worst.i], r.best.from, r.best.to)}` : ''}. Bạn có ${bestCount} nước tốt nhất trong ván.`;
    } else {
      $('end-ins-title').textContent = 'Một ván cờ chắc tay';
      $('end-ins-text').textContent = `Độ chính xác ${vals[3] ?? '—'}% với ${bestCount} nước tốt nhất. Mở phân tích để xem từng nước.`;
    }
  }

  function enterAnalysis() {
    if (!state || !state.result) return;
    analysisMode = true;
    viewGame = 'live';
    viewPly = null;
    render();
    window.scrollTo(0, 0);
    toast('Dùng ◀ ▶ hoặc bấm vào nước đi để xem lại.');
  }

  $('res-rematch').addEventListener('click', () => {
    if (state.tournament) {
      const tid = state.tournament.id;
      socket.emit('leave');
      resetToLobby();
      return navigate('tournament/' + tid);
    }
    if (state.ai) return aiRematch();
    if (state.matchmaking) {
      const st = state.settings || {};
      const settings = { totalMin: (st.totalMs || 0) / 60000, incSec: (st.incMs || 0) / 1000, moveSec: (st.moveMs || 0) / 1000 };
      const mode = state.kind === 'coin' ? 'coin' : 'ranked', stake = state.stake;
      socket.emit('leave');
      resetToLobby();
      startMatchmaking(settings, mode, stake);
      return;
    }
    socket.emit('rematch');
  });
  $('res-alt').addEventListener('click', () => socket.emit('rematch'));
  $('res-leave').addEventListener('click', () => $('btn-leave').click());
  $('res-analysis').addEventListener('click', enterAnalysis);
  $('end-analysis').addEventListener('click', enterAnalysis);
  // ---------- Chia sẻ kết quả: thẻ ảnh + link xem lại ----------
  const share = { blob: null, text: '', gameId: null };
  const shareGameId = () => (state.review ? state.reviewId : state.ai ? ai.game.savedId || null : state.result && state.result.gameId) || null;
  let logoImg = null;
  const loadLogo = () => logoImg || (logoImg = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/assets/logo-mark.png';
  }));

  async function openShare() {
    if (!state || !state.result) return;
    share.gameId = shareGameId();
    const rc = state.result.ratingChange, cc = state.result.coinChange;
    const persp = myColor || 'r';
    const coins = myColor ? (state.ai ? ai.coinDelta : cc && cc[myColor]) : null;
    const elo = myColor && rc && rc[myColor] !== undefined ? rc[myColor] : null;
    const names = { r: (state.players.r && state.players.r.name) || (state.gameNames && state.gameNames.r) || 'Đỏ', b: (state.players.b && state.players.b.name) || (state.gameNames && state.gameNames.b) || 'Đen' };
    // Tiêu đề tự tính (ở chế độ Phân tích thẻ kết quả không được vẽ lại)
    const w = state.result.winner;
    const title = !w ? 'Hoà cờ' : !myColor ? `${names[w]} thắng` : w === myColor ? 'Chiến thắng!' : 'Thất bại';
    const info = {
      title, sub: `${(reasonText[state.result.reason] || 'kết thúc').replace(/^./, (x) => x.toUpperCase())} · ${state.history.length} nước · ${fmtDate(Date.now())}`,
      kind: state.ai ? `Đấu máy · ${LEVEL_LABEL[ai.level] || ''}` : state.review ? 'Xem lại ván' : KIND_NAMES[state.kind] || 'Online',
      persp, names, winner: w, elo, coins,
      board: X.replay(state.history).boards[state.history.length], lastMove: state.history[state.history.length - 1] || null,
      link: share.gameId ? `${location.host}/#/replay/${share.gameId}` : location.host,
    };
    share.text = [`Tượng Kỳ — ${info.title}`, info.sub, elo !== null ? `Elo ${signed(elo)}` : null].filter(Boolean).join(' · ');
    $('share-link').disabled = !share.gameId;
    $('share-link').title = share.gameId ? '' : 'Đăng nhập để lưu ván và có link xem lại';
    $('share-modal').classList.remove('hidden');
    await drawShareCard($('share-canvas'), info);
    share.blob = await new Promise((resolve) => $('share-canvas').toBlob(resolve, 'image/png'));
  }

  async function drawShareCard(cv, info) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const font = (w, px) => `${w} ${px}px "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif`;
    // Nền
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b1512'); bg.addColorStop(1, '#2c1d17');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.78, H * 0.5, 20, W * 0.78, H * 0.5, 420);
    glow.addColorStop(0, 'rgba(198,29,29,0.35)'); glow.addColorStop(1, 'rgba(198,29,29,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // Logo
    const logo = await loadLogo();
    if (logo) ctx.drawImage(logo, 64, 52, 64, 64);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 34); ctx.textBaseline = 'middle';
    ctx.fillText('Tượng Kỳ', logo ? 142 : 64, 84);
    ctx.fillStyle = '#cbbfb2'; ctx.font = font(600, 22);
    ctx.fillText(info.kind, 64, 160);
    // Kết quả
    ctx.fillStyle = info.title === 'Thất bại' ? '#f0d9c9' : '#f2cf72';
    let size = 76;
    do { ctx.font = font(800, size); size -= 4; } while (ctx.measureText(info.title).width > 590 && size > 36);
    ctx.fillText(info.title, 60, 240);
    ctx.fillStyle = '#e6dcd2'; ctx.font = font(500, 26);
    ctx.fillText(info.sub, 64, 304);
    // Hai bên
    const opp = info.persp === 'r' ? 'b' : 'r';
    const clip = (t, max) => { let x = t; while (ctx.measureText(x).width > max && x.length > 1) x = x.slice(0, -1); return x === t ? t : x + '…'; };
    const side = (c, y) => {
      ctx.fillStyle = c === 'r' ? '#c61d1d' : '#111';
      ctx.beginPath(); ctx.arc(84, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e6c27a'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = font(700, 28);
      ctx.fillText(clip(info.names[c], 380), 120, y);
      const sc = !info.winner ? '½' : info.winner === c ? '1' : '0';
      ctx.font = font(800, 30); ctx.fillStyle = info.winner === c ? '#f2cf72' : '#cbbfb2';
      ctx.textAlign = 'right'; ctx.fillText(sc, 560, y); ctx.textAlign = 'left';
    };
    side(info.persp, 380); side(opp, 436);
    // Elo / xu
    let x = 64;
    const pill = (text, color) => {
      ctx.font = font(700, 24);
      const w = ctx.measureText(text).width + 36;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.roundRect(x, 486, w, 46, 23); ctx.fill();
      ctx.fillStyle = color; ctx.fillText(text, x + 18, 510);
      x += w + 12;
    };
    if (info.elo !== null) pill(`${signed(info.elo)} Elo`, info.elo >= 0 ? '#7ddc9b' : '#ff9a8a');
    if (info.coins) pill(`${signed(info.coins)} xu`, '#f2cf72');
    // Link
    ctx.fillStyle = '#9d8f82'; ctx.font = font(500, 22);
    ctx.fillText(info.link, 64, 584);
    // Bàn cờ thế cuối
    drawCanvasBoard(ctx, info.board, info.lastMove, 690, 40, 440, info.persp === 'b');
  }

  function drawCanvasBoard(ctx, board, last, left, top, width, flip) {
    const cell = width / 9.2, ox = left + cell * 0.6, oy = top + cell * 0.6;
    const H2 = cell * 10.2;
    ctx.fillStyle = '#e9c98f';
    ctx.beginPath(); ctx.roundRect(left, top, width, H2, 14); ctx.fill();
    ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = 2;
    const X0 = (c) => ox + c * cell, Y0 = (r) => oy + r * cell;
    for (let r = 0; r < 10; r++) { ctx.beginPath(); ctx.moveTo(X0(0), Y0(r)); ctx.lineTo(X0(8), Y0(r)); ctx.stroke(); }
    for (let c = 0; c < 9; c++) {
      ctx.beginPath();
      if (c === 0 || c === 8) { ctx.moveTo(X0(c), Y0(0)); ctx.lineTo(X0(c), Y0(9)); }
      else { ctx.moveTo(X0(c), Y0(0)); ctx.lineTo(X0(c), Y0(4)); ctx.moveTo(X0(c), Y0(5)); ctx.lineTo(X0(c), Y0(9)); }
      ctx.stroke();
    }
    for (const [r1, r2] of [[0, 2], [7, 9]]) {
      ctx.beginPath(); ctx.moveTo(X0(3), Y0(r1)); ctx.lineTo(X0(5), Y0(r2)); ctx.moveTo(X0(5), Y0(r1)); ctx.lineTo(X0(3), Y0(r2)); ctx.stroke();
    }
    const P = (r, c) => (flip ? [X0(8 - c), Y0(9 - r)] : [X0(c), Y0(r)]);
    if (last) {
      ctx.fillStyle = 'rgba(46,158,91,0.35)';
      for (const [r, c] of [last.from, last.to]) { const [px, py] = P(r, c); ctx.beginPath(); ctx.arc(px, py, cell * 0.46, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      const [px, py] = P(r, c);
      ctx.fillStyle = '#f6e7c8';
      ctx.beginPath(); ctx.arc(px, py, cell * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = p[0] === 'r' ? '#b21f1f' : '#222'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = p[0] === 'r' ? '#b21f1f' : '#1b1b1b';
      ctx.font = `700 ${Math.round(cell * 0.5)}px "Songti SC", "Noto Serif CJK SC", "SimSun", serif`;
      ctx.fillText(X.CHARS[p], px, py + 1);
    }
    ctx.textAlign = 'left';
  }

  $('res-share').addEventListener('click', openShare);
  $('share-download').addEventListener('click', () => {
    const a = h('a', { href: $('share-canvas').toDataURL('image/png'), download: `tuongky-${share.gameId || 'ket-qua'}.png` });
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('share-native').addEventListener('click', async () => {
    const url = share.gameId ? replayUrl(share.gameId) : location.origin;
    try {
      const file = share.blob && new File([share.blob], 'tuongky-ket-qua.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Tượng Kỳ', text: `${share.text} ${url}` });
      else if (navigator.share) await navigator.share({ title: 'Tượng Kỳ', text: share.text, url });
      else { $('share-download').click(); toast('Trình duyệt không hỗ trợ chia sẻ — đã tải ảnh về máy.'); }
    } catch { /* người dùng huỷ chia sẻ */ }
  });
  $('share-link').addEventListener('click', () => share.gameId && copyReplayLink(share.gameId));

  svg.addEventListener('click', (e) => {
    if (!state || $('game').classList.contains('ended')) return;
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
      hintMove = null;
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
          [myColor]: state.clock[myColor] - (Date.now() - clockOffset - state.clock.turnStartedAt) + ((state.settings && state.settings.incMs) || 0),
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

  // ---------- Thẻ người chơi ----------
  function renderPlayers() {
    const bottomColor = myColor || 'r';
    fillPlayer($('p-top'), X.other(bottomColor));
    fillPlayer($('p-bottom'), bottomColor);
  }

  // Ảnh đại diện (viền chạy theo thời gian nước đi), tên, dòng phụ, đồng hồ
  function fillPlayer(node, color) {
    const p = state.players[color];
    const isTurn = state.started && !state.result && state.turn === color;
    node.dataset.color = color;
    node.classList.toggle('turn', isTurn);
    node.classList.toggle('me', color === myColor);
    node.replaceChildren();

    const av = h('div', { class: 'pc-avatar' });
    if (p && p.avatar) av.appendChild(h('img', { src: p.avatar, alt: '' }));
    else av.appendChild(h('span', { class: 'pc-initial' + (p && p.ai ? ' ai' : '') + (p ? '' : ' empty'), text: p ? (p.ai ? 'AI' : initials(p.name)) : '?' }));
    const ring = svgEl('svg', { class: 'pc-ring', viewBox: '0 0 100 100' });
    for (const cls of ['track', 'bar']) svgEl('rect', { class: cls, x: 3, y: 3, width: 94, height: 94, rx: 26, pathLength: 100 }, ring);
    av.append(ring, h('span', { class: 'pc-side ' + color, title: color === 'r' ? 'Quân Đỏ' : 'Quân Đen' }));

    const info = h('div', { class: 'pc-info' });
    const waitingFor = state.reservedNames && state.reservedNames[color];
    info.appendChild(h('div', { class: 'pc-name', text: p ? p.name + (color === myColor ? ' (bạn)' : '') : waitingFor ? `Chờ ${waitingFor} vào bàn…` : 'Đang chờ người chơi...' }));
    const sub = h('div', { class: 'pc-sub' });
    if (p) {
      const label = p.ai ? (state.review ? 'Máy' : `Máy · ${LEVEL_LABEL[ai.level] || ''}`) : p.username ? '@' + p.username + (p.rating ? ` · Elo ${fmt(p.rating)} · ${rankOf(p.rating).name}` : '') : state.review ? colorName(color) : 'Khách';
      if (!p.online) sub.append(h('span', { class: 'off', text: 'Mất kết nối' }), label ? ' · ' + label : '');
      else sub.textContent = label;
    }
    // Phòng riêng: dấu "Sẵn sàng" trước khi vào ván
    if (p && state.kind === 'room' && !state.started && (state.ready || []).includes(color)) sub.prepend(h('span', { class: 'pc-ready', text: '✓ Sẵn sàng · ' }));
    info.appendChild(sub);
    node.append(av, info);
    if (clockInfo(color)) {
      node.appendChild(h('span', { class: 'clock', 'data-color': color }, h('b'), h('small')));
    }
    updatePlayer(node);
  }

  // ---------- Đồng hồ ----------
  let clockOffset = 0; // Date.now() của máy này - giờ server
  const fmtClock = (ms) => {
    const t = Math.ceil(ms / 1000), hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (hh ? hh + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
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
  function updateClock(node) {
    const info = clockInfo(node.dataset.color);
    if (!info) return;
    const [big, small] = node.children;
    big.textContent = info.total !== null ? fmtClock(info.total) : info.move !== null ? fmtClock(info.move) : '∞';
    small.textContent = info.total !== null && info.move !== null ? 'Nước ' + fmtClock(info.move) : '';
    const low = info.running && ((info.total !== null && info.total < 30000) || (info.move !== null && info.move < 10000));
    node.classList.toggle('running', info.running);
    node.classList.toggle('low', low);
    // Bíp mỗi giây trong 5 giây cuối của mình
    if (info.running && node.dataset.color === myColor) {
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
    bar.style.stroke = frac > 0.5 ? '#2e9e5b' : frac > 0.2 ? '#d9a520' : '#c61d1d';
  }
  setInterval(() => {
    document.querySelectorAll('.player[data-color]').forEach(updatePlayer);
    if (state && currentScreen === 'game') renderOffline();
  }, 200);

  function renderStatus() {
    const s = $('status');
    s.className = 'status-box';
    if (state.result) {
      s.textContent = 'Ván đã kết thúc — ' + (resultText(state.result, viewedGame().players) || '').replace('Kết quả: ', '');
      return;
    }
    let html;
    const dot = (c) => `<span class="turn-dot ${c}"></span>`;
    if (!state.started && state.players.r && state.players.b) {
      html = 'Chờ hai bên sẵn sàng…<span class="hint">Đồng hồ chạy khi cả hai bấm "Sẵn sàng".</span>';
    } else if (!state.started && state.tournament) {
      const dl = state.tournament.deadline;
      html = `Chờ đối thủ vào bàn…<span class="hint">${dl ? `Hạn vào bàn ${fmtTime(dl)} — ` : ''}bên vắng mặt quá hạn sẽ bị xử thua theo luật giải.</span>`;
    } else if (!state.started) {
      html = 'Đang chờ đối thủ vào phòng...<span class="hint">Bấm "Sao chép link mời" và gửi cho bạn bè.</span>';
    } else if (!myColor) {
      html = `${dot(state.turn)}Lượt ${colorName(state.turn)}${state.inCheck ? ' — đang bị chiếu!' : ''}`;
    } else if (state.turn === myColor) {
      html = dot(myColor) + (state.inCheck ? 'Bạn đang bị chiếu! Hãy đỡ chiếu.' : 'Đến lượt bạn.');
      if (state.inCheck) s.classList.add('check');
    } else {
      html = dot(X.other(myColor)) + (state.ai ? 'Máy đang suy nghĩ...' : 'Đang chờ đối thủ đi...');
    }
    s.innerHTML = html;
  }

  // Đối thủ mất kết nối: đếm ngược tới lúc bị xử thua
  function renderOffline() {
    const banner = $('offline-banner');
    const opp = myColor && state && !state.ai && !state.review && state.players[X.other(myColor)];
    const show = !!(opp && !opp.online && opp.offlineSince && !state.result && state.started);
    banner.classList.toggle('hidden', !show);
    if (!show) return;
    const left = Math.max(0, opp.offlineSince + clockOffset + (state.graceMs || 90000) - Date.now());
    $('offline-text').textContent = `${opp.name} mất kết nối — ${state.history.length ? 'xử thắng cho bạn' : 'ghế được giải phóng'} sau ${fmtClock(left)} nếu không quay lại.`;
  }

  function renderActions() {
    const playing = myColor && state.started && !state.result;
    // Phòng riêng: nút Sẵn sàng khi đủ 2 người
    const readyPhase = myColor && state.kind === 'room' && !state.started && !state.result && state.players.r && state.players.b;
    $('ready-box').classList.toggle('hidden', !readyPhase);
    if (readyPhase) {
      const mine = (state.ready || []).includes(myColor), theirs = (state.ready || []).includes(X.other(myColor));
      $('ready-text').textContent = mine ? (theirs ? 'Bắt đầu!' : 'Đã sẵn sàng — chờ đối thủ…') : theirs ? 'Đối thủ đã sẵn sàng — tới bạn!' : 'Đối thủ đã vào bàn. Bấm Sẵn sàng để bắt đầu.';
      $('btn-ready').querySelector('span').textContent = mine ? 'Huỷ sẵn sàng' : 'Sẵn sàng';
      $('btn-ready').classList.toggle('primary', !mine);
    }
    // Xin đi lại (phòng riêng có bật luật)
    const canTakeback = playing && state.rules && state.rules.takeback && !state.ai;
    $('btn-takeback').classList.toggle('hidden', !canTakeback);
    if (canTakeback) {
      const asked = state.takebackOffer === myColor;
      $('btn-takeback').disabled = asked || !state.history.some((_, i) => turnAt(i) === myColor);
      $('btn-takeback').querySelector('span').textContent = asked ? 'Đã xin đi lại' : 'Xin đi lại';
    }
    $('takeback-banner').classList.toggle('hidden', !(playing && state.takebackOffer && state.takebackOffer !== myColor));
    renderOffline();
    $('btn-draw').classList.toggle('hidden', !playing || !!state.ai);
    $('btn-undo').classList.toggle('hidden', !(state.ai && ai.assist && playing && aiCanUndo()));
    $('btn-hint').classList.toggle('hidden', !(state.ai && ai.assist && playing && state.turn === myColor));
    $('btn-resign').classList.toggle('hidden', !playing);
    $('btn-draw').disabled = state.drawOffer === myColor;
    $('btn-draw').querySelector('span').textContent = state.drawOffer === myColor ? 'Đã xin hoà' : 'Xin hoà';
    $('draw-banner').classList.toggle('hidden', !(playing && state.drawOffer && state.drawOffer !== myColor));
    $('btn-leave').classList.toggle('hidden', !!state.result && !state.review);
    $('btn-close-analysis').classList.toggle('hidden', !(state.result && analysisMode));
    $('btn-close-analysis').textContent = state.review ? '← Về hồ sơ' : 'Xem kết quả ván';
  }

  $('btn-resign').addEventListener('click', () => {
    if (!confirm('Bạn chắc chắn muốn đầu hàng?')) return;
    if (state.ai) aiResign();
    else socket.emit('resign');
  });
  $('btn-draw').addEventListener('click', () => socket.emit('offer-draw'));
  $('btn-ready').addEventListener('click', () => socket.emit('ready', !(state.ready || []).includes(myColor)));
  $('btn-takeback').addEventListener('click', () => socket.emit('takeback'));
  $('accept-takeback').addEventListener('click', () => socket.emit('takeback'));
  $('decline-takeback').addEventListener('click', () => socket.emit('decline-takeback'));
  $('accept-draw').addEventListener('click', () => socket.emit('offer-draw'));
  $('decline-draw').addEventListener('click', () => socket.emit('decline-draw'));
  $('btn-close-analysis').addEventListener('click', () => {
    if (state && state.review) {
      resetToLobby();
      navigate('profile');
      return;
    }
    analysisMode = false;
    viewGame = 'live';
    viewPly = null;
    render();
    window.scrollTo(0, 0);
  });

  // Rời ván (có hỏi lại nếu đang chơi). Trả về false nếu người dùng huỷ.
  function leaveGame() {
    const playing = state && myColor && state.started && !state.result && state.history.length;
    if (state && state.ai) {
      if (playing && !confirm('Thoát ván đang chơi với máy?')) return false;
    } else if (!review.active) {
      if (playing && !confirm('Ván đang diễn ra — rời bàn bây giờ bạn sẽ bị xử thua. Tiếp tục?')) return false;
      socket.emit('leave');
    }
    resetToLobby();
    return true;
  }
  $('btn-leave').addEventListener('click', () => leaveGame());

  function resetToLobby() {
    if (review.active) review.active = false;
    if (ai.active) {
      ai.active = false;
      ai.reqId++; // bỏ qua nước máy đang tính dở
    }
    roomId = null;
    state = null;
    myColor = null;
    selected = null;
    targets = [];
    lastMoveKey = null;
    dynLayer = null;
    hintMove = null;
    viewGame = 'live';
    viewPly = null;
    archiveCount = -1;
    analysisMode = false;
    spectate = false;
    $('game').classList.remove('ended');
    history.replaceState(null, '', location.pathname + (lastPage === 'home' ? '' : '#/' + (lastPage === 'ai' && aiTab === 'puzzles' ? 'puzzles' : lastPage)));
    showScreen(lastPage);
    if (lastPage === 'home') renderHome();
    if (lastPage === 'play') renderPlay();
  }

  // ---------- Đấu máy ----------
  const AI_LEVELS = [
    { id: 'l1', name: 'Tập sự', elo: 800 }, { id: 'l2', name: 'Nhập môn', elo: 1000 },
    { id: 'l3', name: 'Kỳ hữu', elo: 1200 }, { id: 'l4', name: 'Trung cấp', elo: 1400 },
    { id: 'l5', name: 'Cao cấp', elo: 1600 }, { id: 'l6', name: 'Kiện tướng', elo: 1800 },
    { id: 'l7', name: 'Đại kiện tướng', elo: 2000 }, { id: 'l8', name: 'Kỳ vương', elo: 2200 },
  ];
  const LEVEL_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  AI_LEVELS.forEach((l, i) => { LEVEL_LABEL[l.id] = `Cấp ${i + 1} · ${l.name}`; });
  const LEVEL_SHORT = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  AI_LEVELS.forEach((l, i) => { LEVEL_SHORT[l.id] = `Cấp ${i + 1}`; });

  const ai = {
    active: false, level: AI_LEVELS.some((l) => l.id === store.get('tk-ai-level')) ? store.get('tk-ai-level') : 'l4',
    assist: store.get('tk-ai-assist') !== '0',
    human: 'r', color: 'b', game: null, archive: [], worker: null, reqId: 0, startedAt: 0, coinDelta: null,
  };
  const turnAt = (ply) => (ply % 2 === 0 ? 'r' : 'b');

  function aiWorker() {
    if (!ai.worker) {
      ai.worker = new Worker('engine.js');
      ai.worker.onmessage = (e) => onAiMove(e.data);
      ai.worker.onerror = () => toast('Máy gặp lỗi khi tính nước đi.');
    }
    return ai.worker;
  }

  function renderLevels() {
    const grid = $('level-grid');
    grid.replaceChildren(...AI_LEVELS.map((l, i) => h('button', {
      class: 'level' + (l.id === ai.level ? ' active' : ''), role: 'radio', 'aria-checked': l.id === ai.level,
      onclick: () => { ai.level = l.id; store.set('tk-ai-level', l.id); renderLevels(); },
    }, h('small', { text: `Cấp ${i + 1}` }), h('b', { text: l.name }), h('em', { text: `~${fmt(l.elo)} Elo` }))));
    const idx = AI_LEVELS.findIndex((l) => l.id === ai.level);
    $('level-note').textContent = idx < 3 ? 'Cấp 1–3 phù hợp người mới: máy thỉnh thoảng đi nước chưa tối ưu.'
      : idx < 5 ? 'Cấp 4–5: máy tính trước nhiều nước, hợp với người đã quen khai cuộc.'
        : 'Từ cấp 6 máy tính rất sâu và không nương tay — chuẩn bị tinh thần!';
    renderAiPreview();
  }

  function renderAiPreview() {
    const pick = document.querySelector('input[name="ai-color"]:checked').value;
    const l = AI_LEVELS.find((x) => x.id === ai.level);
    const idx = AI_LEVELS.indexOf(l);
    $('ai-preview-sub').textContent = `Cấp ${idx + 1} · ${l.name} — ước tính ~${fmt(l.elo)} Elo`;
    $('ai-tags').replaceChildren(
      h('span', { class: 'tag', text: `Cấp ${idx + 1} · ${l.name}` }),
      h('span', { class: 'tag soft', text: pick === 'r' ? 'Quân Đỏ' : pick === 'b' ? 'Quân Đen' : 'Màu ngẫu nhiên' }),
      h('span', { class: 'tag soft', text: ai.assist ? 'Có gợi ý & đi lại' : 'Không gợi ý' }),
    );
    if (aiTab === 'ai' && currentScreen === 'ai') miniBoard($('ai-board'), X.initialBoard(), { flip: pick === 'b' });
  }
  document.querySelectorAll('input[name="ai-color"]').forEach((r) => r.addEventListener('change', renderAiPreview));
  $('ai-assist').checked = ai.assist;
  $('ai-assist').addEventListener('change', () => { ai.assist = $('ai-assist').checked; store.set('tk-ai-assist', ai.assist ? '1' : '0'); renderAiPreview(); });

  $('play-ai').addEventListener('click', () => {
    const pick = document.querySelector('input[name="ai-color"]:checked').value;
    const human = pick === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : pick;
    ai.active = true;
    ai.archive = [];
    an.aiSession++;
    selected = null;
    targets = [];
    viewGame = 'live';
    viewPly = null;
    archiveCount = -1;
    analysisMode = false;
    showLobbyError('');
    $('room-prefix').textContent = 'Đấu máy ·';
    $('room-code').textContent = LEVEL_LABEL[ai.level];
    setGameUi('ai');
    showScreen('game');
    newAiGame(human);
  });

  function newAiGame(human) {
    ai.human = human;
    ai.color = X.other(human);
    ai.reqId++;
    ai.coinDelta = null;
    hintMove = null;
    ai.game = {
      board: X.initialBoard(),
      history: [],
      result: null,
      startedAt: Date.now(),
      names: { [human]: getName(), [ai.color]: `Máy (${LEVEL_SHORT[ai.level]})` },
    };
    lastMoveKey = null;
    resultSeen = null;
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
    hint.reqId++;
    g.history = g.history.slice(0, n);
    g.board = X.replay(g.history).boards[n];
    selected = null;
    targets = [];
    lastMoveKey = null;
    syncAi();
  });

  // Gợi ý: máy (cấp 5) tính nước tốt cho người chơi, vẽ mũi tên xanh dương
  const hint = { worker: null, reqId: 0 };
  $('btn-hint').addEventListener('click', () => {
    if (!state || !state.ai || state.result || state.turn !== myColor) return;
    if (!hint.worker) {
      hint.worker = new Worker('engine.js');
      hint.worker.onmessage = (e) => {
        if (e.data.id !== hint.reqId || !state || !state.ai || !e.data.move) return;
        hintMove = e.data.move;
        $('btn-hint').disabled = false;
        render();
      };
    }
    const g = ai.game;
    $('btn-hint').disabled = true;
    setTimeout(() => { $('btn-hint').disabled = false; }, 2500);
    hint.worker.postMessage({ id: ++hint.reqId, board: g.board, side: ai.human, level: 'l5', boards: X.replay(g.history).boards });
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

  // ---------- Trang Đấu máy: tab AI / Cờ thế / Lịch sử ----------
  let aiTab = 'ai';
  function openAi(tab) {
    aiTab = tab;
    document.querySelectorAll('#ai-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.aiTab === tab));
    for (const p of ['ai', 'puzzles', 'history']) $('ai-panel-' + p).classList.toggle('hidden', p !== tab);
    showScreen('ai');
    if (tab === 'ai') renderLevels();
    if (tab === 'puzzles') openPuzzles();
    if (tab === 'history') renderAiHistory();
  }
  document.querySelectorAll('#ai-tabs .tab').forEach((t) => t.addEventListener('click', () => {
    navigate(t.dataset.aiTab === 'puzzles' ? 'puzzles' : t.dataset.aiTab === 'history' ? 'ai/history' : 'ai');
  }));

  // Ô trống kèm nút đăng nhập (cho khách)
  const loginEmpty = (text) => h('div', { class: 'empty' }, h('p', { text }),
    h('button', { class: 'btn primary', text: 'Đăng nhập / Đăng ký', onclick: () => openAuth('login') }));

  async function myGames() {
    const { games } = await accountApi('GET', '/games?limit=100');
    return games;
  }

  async function renderAiHistory() {
    const box = $('ai-history');
    if (!session) return box.replaceChildren(loginEmpty('Đăng nhập để lưu và xem lại các ván đấu máy.'));
    box.replaceChildren(h('div', { class: 'empty', text: 'Đang tải…' }));
    try {
      const [all, sum, list] = await Promise.all([myGames(), accountApi('GET', '/summary').catch(() => null),
        pz.list.length ? null : fetchJson('/api/puzzles').catch(() => null)]);
      if (list) pz.list = list.puzzles;
      const games = all.filter((g) => g.mode === 'ai');
      const log = sum ? sum.summary.puzzleLog : [];
      const pzTitle = (id) => (pz.list.find((p) => p.id === id) || {}).title || 'Bài cờ thế';
      fill(box,
        games.length ? gamesTable(games, { ai: true }) : h('div', { class: 'empty', text: 'Chưa có ván đấu máy nào được lưu.' }),
        h('div', { class: 'card-head pad' }, h('div', {}, h('h3', { text: 'Cờ thế đã giải' }), h('p', { text: log.length ? `${log.length} lần giải gần nhất` : 'Giải cờ thế để luyện chiến thuật' }))),
        log.length ? h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Bài' }), h('th', { class: 'num', text: 'Thời gian' }), h('th', { class: 'num', text: 'Số lần thử' }), h('th', { class: 'num hide-sm', text: 'Gợi ý' }), h('th'))),
          h('tbody', {}, log.map((x) => h('tr', {},
            h('td', {}, h('b', { text: pzTitle(x.id) }), h('small', { class: 'muted sub', text: fmtDateTime(x.at) })),
            h('td', { class: 'num', text: fmtDuration(x.ms) }), h('td', { class: 'num', text: String(x.attempts) }), h('td', { class: 'num hide-sm', text: String(x.hints) }),
            h('td', { class: 'num' }, h('a', { class: 'btn sm', href: '#/puzzle/' + x.id, text: 'Giải lại' })))))) : h('div', { class: 'empty' }, h('a', { class: 'btn', href: '#/puzzles', text: 'Mở kho cờ thế' })));
    } catch (err) {
      box.replaceChildren(h('div', { class: 'empty', text: err.message }));
    }
  }

  // Bảng lịch sử ván (dùng cho Hồ sơ & Lịch sử luyện tập)
  function gamesTable(games, { ai: aiOnly = false } = {}) {
    const head = h('tr', {}, h('th', { text: aiOnly ? 'Cấp độ' : 'Đối thủ' }), h('th', { class: 'hide-sm', text: aiOnly ? 'Màu quân' : 'Chế độ' }),
      h('th', { text: 'Kết quả' }), h('th', { class: 'num', text: aiOnly ? 'Nước' : 'Elo' }), h('th', { class: 'num hide-sm', text: aiOnly ? 'Ngày' : 'Nước' }), h('th'));
    const rows = games.map((g) => h('tr', {},
      h('td', {}, h('div', { class: 'player-cell' },
        avatarEl({ name: g.opponent, ai: g.mode === 'ai' }),
        h('span', {}, h('b', { text: aiOnly ? LEVEL_LABEL[g.level] || g.opponent : g.opponent }), h('small', { text: `${reasonText[g.reason] || ''} · ${fmtDateTime(g.endedAt)}` })))),
      h('td', { class: 'hide-sm' }, aiOnly ? h('span', {}, h('i', { class: 'side-dot ' + g.color }), ' ' + colorName(g.color))
        : g.mode === 'ai' ? `Đấu máy · ${LEVEL_SHORT[g.level] || ''}`
          : h('span', {}, KIND_NAMES[g.kind] || 'Online', h('small', { class: 'muted sub', text: [tcLabel(g.tc), g.stake ? `cược ${fmt(g.stake)} xu` : '', g.tournament ? g.tournament.name : ''].filter(Boolean).join(' · ') }))),
      h('td', {}, h('span', { class: 'res ' + g.outcome, text: { win: 'Thắng', loss: 'Thua', draw: 'Hoà' }[g.outcome] })),
      h('td', { class: 'num' }, aiOnly ? String(g.moveCount) : h('span', { class: 'chg-cell' },
        g.ratingChange === null || g.ratingChange === undefined ? h('span', { class: 'muted', text: '—' })
          : h('span', { class: 'elo-chg ' + (g.ratingChange >= 0 ? 'up' : 'down'), text: signed(g.ratingChange) }),
        g.coinChange ? h('small', { class: 'coin-chg ' + (g.coinChange >= 0 ? 'up' : 'down'), text: `${signed(g.coinChange)} xu` }) : null)),
      h('td', { class: 'num hide-sm', text: aiOnly ? fmtDate(g.endedAt) : String(g.moveCount) }),
      h('td', { class: 'num nowrap' }, h('button', { class: 'btn sm', text: 'Xem lại', onclick: () => openReview(g.id) }),
        h('button', { class: 'btn sm ghost icon-only', title: 'Sao chép link xem lại', 'aria-label': 'Sao chép link xem lại', onclick: () => copyReplayLink(g.id) }, icon('link', 'sm')))));
    return h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows));
  }
  const replayUrl = (id) => `${location.origin}/#/replay/${id}`;
  async function copyReplayLink(id) {
    try { await navigator.clipboard.writeText(replayUrl(id)); toast('Đã sao chép link xem lại — gửi cho bạn bè nhé!'); }
    catch { prompt('Link xem lại ván:', replayUrl(id)); }
  }
  function tcLabel(tc) {
    if (!tc) return '';
    if (tc.totalMs) return `${tc.totalMs / 60000}+${(tc.incMs || 0) / 1000}`;
    if (tc.moveMs) return `${tc.moveMs / 1000}s/nước`;
    return 'Không giới hạn';
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

  function setSession(tok, account) {
    session = tok;
    me = account;
    if (me.equip) setEquip(me.equip);
    store.set('xq-session', tok);
    socket.emit('hello', { uid, session });
    renderAuth();
  }

  function logoutLocal() {
    session = null;
    me = null;
    setEquip(freeOnly(store.json(GUEST_EQUIP, {})));
    safe(() => localStorage.removeItem('xq-session'));
    socket.emit('hello', { uid });
    renderAuth();
  }

  socket.on('auth-invalid', () => {
    if (!session) return;
    logoutLocal();
    toast('Bạn đã bị đăng xuất.');
  });

  // Thanh trên: xu + thẻ người dùng, hoặc nút Đăng nhập / Đăng ký
  function renderAuth() {
    const bar = $('auth-bar');
    if (me) {
      const rank = rankOf(me.rating);
      bar.replaceChildren(
        h('a', { class: 'coin-pill', href: '#/shop', title: 'Xu: dùng cho vật phẩm & Tranh xu — bấm để mở Cửa hàng' }, icon('coin'), fmt(me.coins)),
        h('button', { class: 'icon-btn bell-btn', title: 'Thông báo', 'aria-label': 'Thông báo', onclick: toggleNotifications },
          icon('bell'), me.unread ? h('span', { class: 'badge', text: me.unread > 9 ? '9+' : String(me.unread) }) : null),
        h('button', { class: 'user-chip', title: 'Hồ sơ kỳ thủ', onclick: () => navigate('profile') },
          avatarEl(me), h('span', {}, h('b', { text: me.displayName }), h('small', { text: `Elo ${fmt(me.rating)} · ${rank.name}` })), icon('down')),
      );
    } else {
      bar.replaceChildren(
        h('button', { class: 'btn ghost', text: 'Đăng nhập', onclick: () => openAuth('login') }),
        h('button', { class: 'btn primary', text: 'Đăng ký', onclick: () => openAuth('register') }),
      );
    }
    document.querySelectorAll('.name-field').forEach((f) => f.classList.toggle('hidden', !!me));
    if (currentScreen === 'home') renderHome();
    if (currentScreen === 'play') renderPlay();
    if (currentScreen === 'ai' && aiTab === 'ai') renderAiPreview();
    if (currentScreen === 'inventory' && !invBusy) renderInventory();
  }

  // ---------- Thông báo ----------
  const notifs = { list: [], loaded: false };
  function notifText(n) {
    const d = n.data || {};
    switch (n.type) {
      case 'friend_request': return `${d.from ? d.from.displayName : 'Một kỳ thủ'} muốn kết bạn với bạn.`;
      case 'friend_accept': return `${d.from ? d.from.displayName : 'Kỳ hữu'} đã đồng ý kết bạn.`;
      case 'invite': return `${d.from ? d.from.displayName : 'Kỳ hữu'} mời bạn vào phòng ${d.roomId}${d.tc ? ' · ' + tcShort(d.tc) : ''}.`;
      case 'tournament': return d.text || `Cập nhật giải ${d.name || ''}`;
      default: return d.text || 'Thông báo mới';
    }
  }
  const NOTIF_ICON = { friend_request: 'user-plus', friend_accept: 'users', invite: 'swords', tournament: 'trophy' };
  async function toggleNotifications() {
    const panel = $('notif-panel');
    if (!panel.classList.contains('hidden')) return panel.classList.add('hidden');
    panel.classList.remove('hidden');
    try { notifs.list = (await accountApi('GET', '/notifications')).notifications; notifs.loaded = true; } catch { /* bỏ qua */ }
    renderNotifications();
    // Mở bảng = đã đọc
    if (me && me.unread) setTimeout(() => accountApi('POST', '/notifications/read', {}).then((d) => { me = d.account; renderAuth(); }).catch(() => {}), 1200);
  }
  function renderNotifications() {
    const list = $('notif-list');
    if (!notifs.list.length) return list.replaceChildren(h('div', { class: 'mini-empty' }, 'Chưa có thông báo nào.'));
    list.replaceChildren(...notifs.list.slice(0, 30).map((n) => {
      const d = n.data || {};
      const acts = [];
      if (n.type === 'friend_request' && d.from) {
        acts.push(h('button', { class: 'btn sm primary', text: 'Chấp nhận', onclick: () => socialDo('accept', d.from.id, 'Đã kết bạn!') }),
          h('button', { class: 'btn sm', text: 'Từ chối', onclick: () => socialDo('decline', d.from.id) }));
      }
      if (n.type === 'invite' && d.roomId) acts.push(h('button', { class: 'btn sm primary', text: 'Vào phòng', onclick: () => joinRoomCode(d.roomId) }));
      if (n.type === 'tournament' && d.roomId) acts.push(h('button', { class: 'btn sm primary', text: 'Vào bàn', onclick: () => joinRoomCode(d.roomId) }));
      if (n.type === 'tournament' && d.tid) acts.push(h('a', { class: 'btn sm', href: '#/tournament/' + d.tid, text: 'Xem giải', onclick: () => $('notif-panel').classList.add('hidden') }));
      return h('div', { class: 'notif-item' + (n.read ? '' : ' unread') },
        h('span', { class: 'ni-ico' }, icon(NOTIF_ICON[n.type] || 'bell', 'sm')),
        h('div', { class: 'ni-body' }, h('span', { text: notifText(n) }), h('small', { text: fmtDateTime(n.at) }), acts.length ? h('div', { class: 'row' }, acts) : null));
    }));
  }
  $('notif-readall').addEventListener('click', async () => {
    try { me = (await accountApi('POST', '/notifications/read', {})).account; notifs.list.forEach((n) => { n.read = true; }); renderAuth(); renderNotifications(); } catch (err) { toast(err.message); }
  });
  document.addEventListener('click', (e) => {
    const panel = $('notif-panel');
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('.bell-btn')) panel.classList.add('hidden');
  });
  // Vào phòng theo mã (lời mời, bàn giải đấu)
  function joinRoomCode(code) {
    $('notif-panel').classList.add('hidden');
    if (inGame() && !leaveGame()) return;
    spectate = false;
    socket.emit('join', { roomId: code, name: getName(), token, uid, session });
  }

  async function logout() {
    await accountApi('POST', '/logout').catch(() => {});
    logoutLocal();
    navigate('home');
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
      const { token: tok, account } = await accountApi('POST', url, body);
      setSession(tok, account);
      $('auth-modal').classList.add('hidden');
      form.reset();
      toast(`Xin chào, ${account.displayName}!`);
      if (!roomId && !ai.active && !review.active) route(); // tải lại trang đang xem với dữ liệu tài khoản
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
    const before = me.coins;
    accountApi('POST', '/ai-games', {
      moves: g.history.map((m) => ({ from: m.from, to: m.to })),
      humanColor: ai.human, level: ai.level, resigned: g.result.reason === 'resign',
    }).then((d) => {
      me = d.account;
      g.savedId = d.id;
      ai.coinDelta = me.coins - before || null;
      renderAuth();
      if (state && state.ai) render();
    }).catch(() => { g.saved = false; });
  }

  let regions = [];
  function onMe(res) {
    me = res.account;
    if (me.equip) setEquip(me.equip);
    if (res.regions) regions = res.regions;
    if (res.dailyBonus) toast(`+${res.dailyBonus} xu thưởng đăng nhập hôm nay!`);
    renderAuth();
  }

  // ---------- H01 Trang chủ ----------
  function renderHome() {
    const hr = new Date().getHours();
    $('home-eyebrow').textContent = hr >= 5 && hr < 11 ? 'Chào buổi sáng, kỳ thủ' : hr >= 11 && hr < 13 ? 'Chào buổi trưa, kỳ thủ'
      : hr >= 13 && hr < 18 ? 'Chào buổi chiều, kỳ thủ' : 'Chào buổi tối, kỳ thủ';
    $('home-title').textContent = `Chào ${me ? me.displayName : storedName() || 'bạn'}, đến giờ khai cuộc.`;
    const card = $('home-form');
    if (me) {
      const st = me.stats.online;
      const rate = st.games ? Math.round((st.wins / st.games) * 100) : null;
      const rank = rankOf(me.rating);
      card.replaceChildren(
        h('div', { class: 'card-head' }, h('div', {}, h('h3', { text: 'Phong độ của bạn' }), h('p', { text: `${rank.label} · ${fmt(me.coins)} xu` })),
          h('a', { class: 'link-more', href: '#/profile' }, 'Hồ sơ', icon('chev', 'sm'))),
        h('div', { class: 'form-stats' },
          h('div', {}, h('small', { text: 'Elo hiện tại' }), h('b', { text: fmt(me.rating) }), h('em', { text: `Chuỗi thắng ${me.streak} · kỷ lục ${me.bestStreak}` })),
          h('div', {}, h('small', { text: 'Tỉ lệ thắng' }), h('b', { text: rate === null ? '—' : rate + '%' }), h('em', { text: `${st.wins} thắng · ${st.draws} hoà · ${st.losses} thua` }))),
        h('p', { class: 'note', text: 'Elo chỉ thay đổi ở ván online giữa hai tài khoản.' }),
      );
    } else {
      card.replaceChildren(
        h('div', { class: 'card-head' }, h('div', {}, h('h3', { text: 'Lưu lại hành trình kỳ thủ' }), h('p', { text: 'Khách vẫn chơi được ngay.' }))),
        h('p', { class: 'muted', text: 'Tạo tài khoản miễn phí để có Elo xếp hạng, nhận xu mỗi ngày, lưu lịch sử và phân tích lại mọi ván cờ.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Tạo tài khoản', onclick: () => openAuth('register') }),
          h('button', { class: 'btn', text: 'Đăng nhập', onclick: () => openAuth('login') })),
      );
    }
    renderLiveLists();
    if (!pz.list.length) fetchJson('/api/puzzles').then((d) => { pz.list = d.puzzles; setHomePz(); }).catch(() => {});
    else setHomePz();
    renderHomeMissions();
    renderHomeTour();
    renderHomeShop();
  }

  // Nhiệm vụ hằng ngày (nguồn xu)
  async function renderHomeMissions(box = $('home-missions')) {
    const head = h('div', { class: 'card-head' }, h('div', {}, h('h3', { text: 'Nhiệm vụ hôm nay' }), h('p', { text: 'Hoàn thành để nhận xu — làm mới mỗi ngày' })), icon('gift', 'accent'));
    if (!session) return box.replaceChildren(head, h('p', { class: 'muted', text: 'Đăng nhập để nhận nhiệm vụ hằng ngày và thưởng xu.' }),
      h('button', { class: 'btn primary', text: 'Đăng nhập', onclick: () => openAuth('login') }));
    let missions = [];
    try { ({ missions } = await accountApi('GET', '/missions')); } catch { return; }
    box.replaceChildren(head, ...missions.map((m) => h('div', { class: 'mission' + (m.done ? ' done' : '') },
      h('div', { class: 'mission-top' }, h('b', { text: m.name }),
        m.claimed ? h('span', { class: 'tag green', text: 'Đã nhận' })
          : m.done ? h('button', { class: 'btn sm primary', onclick: () => claimMission(m) }, icon('gift', 'sm'), `Nhận ${m.reward} xu`)
            : h('span', { class: 'reward' }, icon('coin', 'sm'), `+${m.reward}`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${(m.progress / m.goal) * 100}%` })),
      h('small', { class: 'muted', text: `${m.progress}/${m.goal}` }))));
  }
  async function claimMission(m) {
    try {
      const d = await accountApi('POST', `/missions/${m.id}/claim`);
      me = d.account;
      renderAuth();
      toast(`Nhận xu thành công: +${d.coins} xu!`);
      renderHomeMissions();
    } catch (err) { toast(err.message); }
  }

  // Giải đang mở / sắp diễn ra
  async function renderHomeTour() {
    const box = $('home-tour');
    let list = [];
    try { ({ tournaments: list } = await fetchJson('/api/tournaments')); } catch { /* bỏ qua */ }
    const active = list.filter((t) => ['open', 'checkin', 'running'].includes(t.status))
      .sort((a, b) => (b.registered - a.registered) || (a.startAt - b.startAt));
    const t = active[0];
    const head = h('div', { class: 'card-head' }, h('div', {}, h('h3', { text: 'Giải đang diễn ra' }), h('p', { text: t ? t.statusName : 'Lịch giải của Tượng Kỳ' })),
      h('a', { class: 'link-more', href: '#/tournaments' }, 'Tất cả', icon('chev', 'sm')));
    if (!t) return box.replaceChildren(head, h('p', { class: 'muted', text: 'Chưa có giải nào đang mở. Leo bảng Elo để sẵn sàng nhé!' }));
    const cta = t.status === 'checkin' && t.registered && !t.checkedIn ? 'Check-in ngay' : t.registered ? 'Xem chi tiết' : t.status === 'running' ? 'Xem giải' : 'Đăng ký';
    box.replaceChildren(head, h('b', { text: t.name }),
      h('div', { class: 'tour-meta' }, h('span', {}, icon('calendar', 'sm'), fmtDateTime(t.startAt)), h('span', {}, icon('users', 'sm'), `${t.players}/${t.maxPlayers}`),
        h('span', {}, icon('clock', 'sm'), `${t.tc.totalMin}+${t.tc.incSec}`), t.prizes[0] ? h('span', {}, icon('coin', 'sm'), `${fmt(t.prizes[0])} xu`) : null),
      h('a', { class: 'btn primary block', href: '#/tournament/' + t.id, text: cta }));
  }

  // Vật phẩm mới / gợi ý cửa hàng
  function renderHomeShop() {
    const box = $('home-shop');
    const fresh = me ? (me.freshItems || 0) : 0;
    const featured = Catalog.ITEMS.filter((x) => x.price > 0).sort((a, b) => b.price - a.price)[Math.floor(Date.now() / 864e5) % 5];
    const thumb = h('div', { class: 'inv-thumb' });
    drawItemThumb(thumb, featured);
    box.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', { text: fresh ? 'Vật phẩm mới' : 'Cửa hàng' }), h('p', { text: fresh ? `${fresh} vật phẩm mới nhận trong Túi đồ` : 'Gợi ý hôm nay' })),
        h('a', { class: 'link-more', href: fresh ? '#/inventory' : '#/shop' }, fresh ? 'Trang bị' : 'Xem', icon('chev', 'sm'))),
      thumb, h('div', { class: 'inv-meta' }, h('span', {}, h('b', { text: featured.name }), h('small', { text: `${Catalog.CATS[featured.cat]} · ${featured.desc}` })),
        h('span', { class: 'price' }, icon('coin', 'sm'), fmt(featured.price))));
  }
  const setHomePz = () => { if (pz.list.length) $('home-pz-desc').textContent = `${pz.list.length} thế cờ theo độ khó, giải lần đầu +5 xu.`; };

  // ---------- Trận đấu hot ----------
  let live = { online: null, playing: null, searching: 0, matches: [] };
  let liveTimer = null;
  async function refreshLive() {
    clearTimeout(liveTimer);
    try {
      live = await fetchJson('/api/live');
      renderLiveLists();
    } catch { /* bỏ qua */ }
    liveTimer = setTimeout(() => { if (currentScreen === 'home' || currentScreen === 'play') refreshLive(); }, 10000);
  }

  function liveItem(m) {
    const pl = (c) => h('div', { class: 'pl' }, h('i', { class: 'side-dot ' + c }), h('span', { text: m.players[c].name }),
      m.players[c].rating ? h('em', { text: fmt(m.players[c].rating) }) : null);
    return h('a', { class: 'live-item', href: `?room=${m.roomId}&watch=1`, onclick: (e) => { e.preventDefault(); watchRoom(m.roomId); } },
      h('div', { class: 'vs' }, pl('r'), pl('b')),
      h('div', { class: 'meta' }, h('b', {}, icon('eye', 'sm'), `${m.spectators} xem`), h('span', { text: `Nước ${m.moveCount} · ${tcShort(m.settings)}` })));
  }

  function renderLiveLists() {
    const empty = () => h('div', { class: 'live-empty' }, 'Chưa có ván nào đang diễn ra — ', h('a', { href: '#/play', text: 'mở màn ngay' }));
    for (const [id, limit] of [['home-live', 3], ['play-live', 5]]) {
      const box = $(id);
      box.replaceChildren(...(live.matches.length ? live.matches.slice(0, limit).map(liveItem) : [empty()]));
    }
    $('hero-online').textContent = live.online === null ? '—' : fmt(live.online);
    $('hero-playing').textContent = live.playing === null ? '—' : fmt(live.playing);
    $('play-stats').textContent = live.online === null ? '' : `${fmt(live.online)} người đang online · ${fmt(live.playing)} ván đang diễn ra · ${fmt(live.searching)} người đang tìm trận`;
    if (currentScreen === 'play') renderPlayBoard();
  }

  // ---------- Q01 Chơi nhanh ----------
  function renderPlay() {
    if (me) {
      const rank = rankOf(me.rating);
      $('play-elo-line').textContent = `Elo của bạn: ${fmt(me.rating)} · ${rank.label} · phí ${ECON.RANKED_FEE} xu/ván (thắng +20, thua +10 xu thưởng)`;
      $('ranked-fee-tag').textContent = `Phí ${ECON.RANKED_FEE} xu`;
      $('quick-match').disabled = me.coins < ECON.RANKED_FEE;
    } else {
      $('play-elo-line').textContent = 'Bạn đang chơi với tư cách khách — ghép trận không tính Elo. Đăng nhập để chơi xếp hạng.';
      $('ranked-fee-tag').textContent = 'Xếp hạng';
      $('quick-match').disabled = false;
    }
    renderCoinCard();
    renderPlayBoard();
  }
  function renderPlayBoard() {
    const top = live.matches[0];
    if (top) {
      $('play-board-title').textContent = 'Trận nổi bật';
      $('play-board-sub').textContent = `${top.players.r.name} vs ${top.players.b.name} · nước ${top.moveCount}`;
      miniBoard($('play-board'), top.board, { lastMove: top.lastMove });
    } else {
      $('play-board-title').textContent = 'Bàn cờ đang chờ';
      $('play-board-sub').textContent = 'Mỗi ván cờ là một cuộc gặp.';
      miniBoard($('play-board'), X.initialBoard());
    }
  }

  // Vẽ lại các bàn cờ nhỏ đang hiện (khi đổi giao diện)
  function renderMinis() {
    if (currentScreen === 'play') renderPlayBoard();
    if (currentScreen === 'ai' && aiTab === 'ai') renderAiPreview();
    if (currentScreen === 'inventory') renderInventory();
  }

  // ---------- P01 Hồ sơ kỳ thủ ----------
  const pf = { games: [], shown: 15, rank: null, summary: null };

  async function openProfile() {
    if (!session) {
      showScreen(lastPage === 'profile' ? 'home' : lastPage);
      openAuth('login');
      return;
    }
    showScreen('profile');
    try {
      const [meRes, games, board, sum] = await Promise.all([
        accountApi('GET', '/me'), myGames(), fetchJson('/api/leaderboard?by=rating').catch(() => null),
        accountApi('GET', '/summary').catch(() => null),
      ]);
      onMe(meRes);
      pf.games = games;
      pf.summary = sum ? sum.summary : null;
      pf.shown = 15;
      pf.rank = board && board.me ? board.me.rank : null;
      renderProfile();
    } catch (err) {
      toast(err.message);
      if (!session) showScreen('home');
    }
  }

  // Chuỗi Elo theo thời gian (dựng ngược từ Elo hiện tại và các ván có tính Elo)
  function ratingSeries() {
    const rated = pf.games.filter((g) => g.ratingChange !== null && g.ratingChange !== undefined);
    const pts = [{ t: Date.now(), v: me.rating }];
    let r = me.rating;
    for (const g of rated) { r -= g.ratingChange; pts.push({ t: g.endedAt, v: r }); }
    return pts.reverse().slice(-41);
  }

  function renderProfile() {
    const rank = rankOf(me.rating);
    const av = $('pf-avatar');
    av.replaceChildren();
    if (me.avatar) av.appendChild(h('img', { src: me.avatar, alt: '' }));
    else av.textContent = initials(me.displayName);
    $('pf-avatar-del').classList.toggle('hidden', !me.avatar);
    $('pf-name').textContent = me.displayName;
    $('pf-rank').textContent = rank.label;
    $('pf-meta').textContent = `@${me.username} · ${me.region || 'Chưa đặt khu vực'} · Tham gia ${fmtDate(me.createdAt)}`;
    $('pf-bio').replaceChildren(h('span', { class: 'tag gold' }, icon('coin', 'sm'), `${fmt(me.coins)} xu`), ' ',
      h('span', { class: 'tag soft', text: `Uy tín ${fmt(me.credit)}` }), ' ', h('span', { class: 'tag soft' }, icon('fire', 'sm'), `Chuỗi thắng ${me.streak}`));

    const series = ratingSeries();
    const sum = pf.summary;
    const peak = Math.max(...series.map((p) => p.v), sum ? sum.peakRating || 0 : 0);
    const on = me.stats.online, aiSt = me.stats.ai;
    const total = on.games + aiSt.games;
    const wins = on.wins + aiSt.wins, draws = on.draws + aiSt.draws, losses = on.losses + aiSt.losses;
    const card = (label, value, sub) => h('div', { class: 'stat-card' }, h('small', { text: label }), h('b', { text: value }), h('em', { text: sub }));
    $('pf-stats').replaceChildren(
      card('Elo hiện tại', fmt(me.rating), `Cao nhất ${fmt(peak)}`),
      card('Tỉ lệ thắng', total ? Math.round((wins / total) * 100) + '%' : '—', `${wins} thắng · ${draws} hoà · ${losses} thua`),
      card('Tổng số ván', fmt(total), `${on.games} online · ${aiSt.games} đấu máy`),
      card('Hạng', pf.rank ? '#' + fmt(pf.rank) : '—', pf.rank ? 'Trên bảng Elo' : 'Chơi ván xếp hạng để lên bảng'),
    );
    renderRatingChart(series);

    // Lịch sử đấu
    const tbl = $('pf-games');
    const body = tbl.querySelector('tbody');
    $('pf-games-sub').textContent = pf.games.length ? `${pf.games.length} ván gần nhất` : '';
    if (!pf.games.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, h('div', { class: 'empty', text: 'Chưa có ván nào. Các ván bạn chơi khi đã đăng nhập sẽ được lưu ở đây.' }))));
    } else {
      body.replaceChildren(...gamesTable(pf.games.slice(0, pf.shown)).querySelector('tbody').children);
    }
    $('pf-more').classList.toggle('hidden', pf.games.length <= pf.shown);

    // Thành tích
    const ach = [
      { ico: 'piece', name: 'Khai cuộc', desc: 'Chơi ván đầu tiên', cur: total, goal: 1 },
      { ico: 'fire', name: 'Chuỗi lửa', desc: 'Thắng 5 ván online liên tiếp', cur: me.bestStreak, goal: 5 },
      { ico: 'puzzle', name: 'Giải mã thế cờ', desc: 'Giải 10 bài cờ thế', cur: me.puzzlesSolved, goal: 10 },
      { ico: 'swords', name: 'Kỳ thủ chăm chỉ', desc: 'Chơi 50 ván', cur: total, goal: 50 },
      { ico: 'star', name: 'Hạng Vàng', desc: 'Đạt 1.300 Elo', cur: me.rating, goal: 1300 },
    ];
    const badges = sum ? sum.badges.slice(0, 6) : [];
    $('pf-ach').replaceChildren(
      ...(sum ? [h('div', { class: 'ach season' }, h('span', { class: 'ach-ico' }, icon('crown')),
        h('div', {}, h('b', { text: `${sum.season.name} · ${fmt(sum.seasonPoints)} điểm danh vọng` }), h('small', { text: 'Thắng 3 · hoà 1 ở ván Xếp hạng, Tranh xu, Giải đấu' })))] : []),
      ...badges.map((b) => h('div', { class: 'ach' }, h('span', { class: 'ach-ico' }, icon('trophy')),
        h('div', {}, h('b', { text: b.name }), h('small', { text: `Huy hiệu giải đấu · ${fmtDate(b.at)}` })))),
      ...ach.map((a) => {
        const done = a.cur >= a.goal;
        return h('div', { class: 'ach' + (done ? '' : ' locked') }, h('span', { class: 'ach-ico' }, icon(a.ico)),
          h('div', {}, h('b', { text: a.name }), h('small', { text: done ? a.desc + ' · Đã đạt' : `${a.desc} · ${fmt(Math.min(a.cur, a.goal))}/${fmt(a.goal)}` })));
      }));

    // Thống kê theo chế độ & nhịp yêu thích
    $('pf-fav').textContent = sum && sum.favoriteTc ? `Nhịp yêu thích: ${sum.favoriteTc.tc} (${sum.favoriteTc.games} ván)` : 'Chơi vài ván để có thống kê';
    const modes = sum ? sum.byKind : [];
    $('pf-modes').replaceChildren(...[...(modes.length ? modes.map((k) => h('div', { class: 'mode-stat' },
      h('b', { text: KIND_NAMES[k.kind] || k.label }),
      h('span', { class: 'muted', text: `${k.games} ván · ${k.wins}T ${k.draws}H ${k.losses}B` }),
      h('span', { class: 'bar' }, h('i', { style: `width:${k.games ? Math.round((k.wins / k.games) * 100) : 0}%` })))) : [h('p', { class: 'muted', text: 'Chưa có ván nào.' })]),
    sum && sum.coinStats.games ? h('p', { class: 'muted small', text: `Tranh xu: ${sum.coinStats.games} ván · lãi/lỗ ${signed(sum.coinStats.net)} xu` }) : null].filter(Boolean));

    // Bộ trang bị đang dùng
    const eq = (sum && sum.equip) || me.equip || Catalog.DEFAULT_EQUIP;
    $('pf-equip').replaceChildren(...Object.entries(Catalog.CATS).flatMap(([cat, label]) => {
      const it = Catalog.byId[eq[cat]] || Catalog.byId[Catalog.DEFAULT_EQUIP[cat]];
      return [h('dt', { text: label }), h('dd', { text: it.name })];
    }));

    // Mục tiêu tiếp theo
    const idx = TIERS.findIndex(([base], i) => me.rating >= base && (i === TIERS.length - 1 || me.rating < TIERS[i + 1][0]));
    const goal = $('pf-goal');
    if (idx < TIERS.length - 1) {
      const [base] = TIERS[idx], [next, nextName] = TIERS[idx + 1];
      const lo = idx === 0 ? 700 : base;
      const pct = Math.max(0, Math.min(100, ((me.rating - lo) / (next - lo)) * 100));
      goal.replaceChildren(h('small', { class: 'muted', text: 'Mục tiêu tiếp theo' }), h('b', { text: `Lên hạng ${nextName}` }),
        h('p', { text: `Còn ${fmt(next - me.rating)} Elo nữa để đạt ${nextName} (${fmt(next)} Elo).` }),
        h('div', { class: 'progress' }, h('i', { style: `width:${pct.toFixed(1)}%` })),
        h('a', { class: 'btn primary block', href: '#/play' }, icon('swords'), 'Tìm trận xếp hạng'));
    } else {
      goal.replaceChildren(h('b', { text: 'Bạn đã ở hạng cao nhất' }), h('p', { text: 'Giữ vững phong độ và bảo vệ vị trí trên bảng xếp hạng!' }),
        h('a', { class: 'btn primary block', href: '#/play' }, 'Tìm trận xếp hạng'));
    }

    // Biểu mẫu cài đặt
    $('pf-display').value = me.displayName;
    const sel = $('pf-region');
    if (sel.options.length <= 1) for (const r of regions) sel.add(new Option(r, r));
    sel.value = me.region || '';
  }
  $('pf-more').addEventListener('click', () => { pf.shown += 15; renderProfile(); });

  function renderRatingChart(series) {
    const chart = $('pf-chart');
    chart.replaceChildren();
    const rated = series.length - 1;
    $('pf-chart-sub').textContent = rated ? `${rated} ván xếp hạng gần nhất` : '';
    if (rated < 1) {
      const t = svgEl('text', { x: 320, y: 90, 'text-anchor': 'middle' }, chart);
      t.textContent = 'Chơi ván xếp hạng (cả hai bên đều đăng nhập) để thấy biểu đồ Elo.';
      return;
    }
    const W = 640, H = 180, L = 40, B = 20, T = 10;
    const vals = series.map((p) => p.v);
    let lo = Math.floor((Math.min(...vals) - 10) / 50) * 50, hi = Math.ceil((Math.max(...vals) + 10) / 50) * 50;
    if (hi - lo < 100) hi = lo + 100;
    const x = (i) => L + (i / (series.length - 1)) * (W - L - 8);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    for (let k = 0; k <= 2; k++) {
      const v = lo + ((hi - lo) * k) / 2;
      svgEl('line', { class: 'grid', x1: L, x2: W, y1: y(v), y2: y(v) }, chart);
      const t = svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, chart);
      t.textContent = fmt(v);
    }
    const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`);
    svgEl('polygon', { class: 'area', points: `${x(0)},${H - B} ${pts.join(' ')} ${x(series.length - 1)},${H - B}` }, chart);
    svgEl('polyline', { class: 'line', points: pts.join(' ') }, chart);
    const last = series[series.length - 1];
    svgEl('circle', { cx: x(series.length - 1), cy: y(last.v), r: 4, fill: 'var(--red)' }, chart);
  }

  $('pf-edit').addEventListener('click', () => $('edit-modal').classList.remove('hidden'));
  $('pf-logout').addEventListener('click', logout);
  $('pf-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  $('help-rules').addEventListener('click', () => {
    $('help-modal').classList.add('hidden');
    navigate('rules');
  });
  $('pf-share').addEventListener('click', async () => {
    const data = { title: 'Tượng Kỳ', text: `Chơi cờ tướng với mình trên Tượng Kỳ nhé!${me ? ` Tìm mình: @${me.username}` : ''}`, url: location.origin };
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
  const afterEdit = (res, msg) => { onMe(res); if (currentScreen === 'profile') renderProfile(); toast(msg); };
  $('pf-region-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { afterEdit(await accountApi('PATCH', '/me', { region: $('pf-region').value }), 'Đã lưu khu vực.'); } catch (err) { toast(err.message); }
  });
  $('pf-name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { afterEdit(await accountApi('PATCH', '/me', { displayName: $('pf-display').value }), 'Đã đổi tên hiển thị.'); } catch (err) { toast(err.message); }
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
      if (currentScreen === 'profile') renderProfile();
      toast('Đã đổi ảnh đại diện.');
    } catch (err) {
      toast(err.message);
    }
  });
  $('pf-avatar-del').addEventListener('click', async () => {
    try {
      ({ account: me } = await accountApi('DELETE', '/avatar'));
      renderAuth();
      if (currentScreen === 'profile') renderProfile();
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
    showReplay(game, game.players.b.accountId === me.id ? 'b' : 'r');
  }

  // Link xem lại công khai (#/replay/<mã ván>) — ai có link cũng xem được
  async function openPublicReplay(id) {
    if (inGame() && !leaveGame()) return;
    // Mở thẳng từ link: chờ biết tài khoản để nhận ra mình có phải người chơi không
    if (session && !me) { try { onMe(await accountApi('GET', '/me')); } catch { /* khách */ } }
    let game;
    try {
      ({ game } = await fetchJson('/api/replay/' + encodeURIComponent(id)));
    } catch (err) {
      toast(err.message);
      return navigate('');
    }
    // Người xem không phải người chơi → xem như khán giả (không có "bạn")
    const mine = !me ? null : game.players.r.username === me.username ? 'r' : game.players.b.username === me.username ? 'b' : null;
    showReplay(game, mine, true);
  }

  function showReplay(game, mine, isPublic) {
    const hist = [];
    let board = X.initialBoard();
    for (const [fr, fc, tr, tc] of game.moves) {
      hist.push({ from: [fr, fc], to: [tr, tc], captured: board[tr][tc] });
      board = X.applyMove(board, [fr, fc], [tr, tc]);
    }
    const names = { r: game.players.r.name, b: game.players.b.name };
    const isAi = (c) => (isPublic ? !!game.players[c].ai : game.mode === 'ai' && mine !== c);
    review.active = true;
    selected = null;
    targets = [];
    viewGame = 'live';
    viewPly = 0;
    archiveCount = -1;
    lastMoveKey = null;
    analysisMode = true;
    setGameUi('review');
    $('room-prefix').textContent = `Xem lại${game.kind && KIND_NAMES[game.kind] ? ' ' + KIND_NAMES[game.kind].toLowerCase() : ''} ·`;
    $('room-code').textContent = fmtDateTime(game.endedAt);
    applyState({
      review: true, reviewId: game.id, publicReplay: !!isPublic, roomId: null, board, turn: hist.length % 2 ? 'b' : 'r',
      lastMove: hist[hist.length - 1] || null, moveCount: hist.length, history: hist, gameNames: names,
      archive: [], result: game.result, inCheck: false, kind: game.kind || null,
      players: {
        r: { name: names.r, online: true, ai: isAi('r'), avatar: game.players.r.avatar || null },
        b: { name: names.b, online: true, ai: isAi('b'), avatar: game.players.b.avatar || null },
      },
      spectators: 0, drawOffer: null, rematch: [], started: true, you: mine,
    });
    showScreen('game');
  }

  // ---------- R01 Xếp hạng ----------
  let rankBy = 'rating';
  const RANK_COL = { rating: 'Elo', friends: 'Elo', season: 'Danh vọng', streak: 'Chuỗi thắng', coin: 'Thắng Tranh xu', puzzles: 'Bài đã giải' };
  const RANK_UNIT = { rating: 'Elo', friends: 'Elo', season: 'điểm danh vọng', streak: 'trận thắng liên tiếp', coin: 'ván thắng Tranh xu', puzzles: 'bài' };
  const RANK_EMPTY = {
    rating: 'Đăng nhập và chơi ván xếp hạng để ghi tên mình lên bảng.', friends: 'Kết bạn để so tài Elo với kỳ hữu.',
    season: 'Thắng ván Xếp hạng, Tranh xu hoặc Giải đấu để có điểm Danh vọng mùa này (thắng 3, hoà 1).',
    streak: 'Thắng liên tiếp các ván online để lên bảng.', coin: 'Chơi Tranh xu để lên bảng.', puzzles: 'Giải cờ thế để lên bảng.',
  };
  const RANK_CTA = { puzzles: ['#/puzzles', 'Giải cờ thế'], friends: ['#/friends', 'Tìm thêm kỳ hữu'], coin: ['#/play', 'Chơi Tranh xu'], season: ['#/play', 'Chơi xếp hạng'] };
  async function openRanking() {
    showScreen('ranking');
    document.querySelectorAll('#rank-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.by === rankBy));
    $('rank-col').textContent = RANK_COL[rankBy];
    if (rankBy === 'friends' && !session) {
      $('rank-total').textContent = '';
      $('rank-podium').replaceChildren(h('div', { class: 'card empty-card', style: 'grid-column:1/-1' }, icon('users', 'xl'), h('b', { text: 'Bảng xếp hạng bạn bè' }),
        h('p', { text: 'Đăng nhập để so Elo với các kỳ hữu của bạn.' }), h('button', { class: 'btn primary', text: 'Đăng nhập', onclick: () => openAuth('login') })));
      $('rank-table').querySelector('tbody').replaceChildren();
      $('rank-me').replaceChildren(h('h3', { text: 'Vị trí của bạn' }), h('p', { class: 'muted', text: 'Đăng nhập để xem.' }));
      return;
    }
    let data;
    try {
      data = await fetchJson('/api/leaderboard?by=' + rankBy);
    } catch (err) {
      return toast(err.message);
    }
    $('rank-total').textContent = (rankBy === 'season' && data.season ? `${data.season.name} · kết thúc ${fmtDate(data.season.end - 1)} · ` : '')
      + (data.total ? `${fmt(data.total)} kỳ thủ trên bảng` : '');
    const val = (p) => fmt(p.value);
    const rate = (p) => (p.games ? Math.round((p.wins / p.games) * 100) + '%' : '—');
    const sub = (p) => [p.username ? '@' + p.username : null, p.region].filter(Boolean).join(' · ');
    // Ba người dẫn đầu
    const top = data.players.slice(0, 3);
    $('rank-podium').replaceChildren(...(top.length ? top.map((p, i) => h('div', { class: 'podium-card' + (i === 0 ? ' first' : '') },
      h('div', { class: 'pc-top' }, h('span', { text: `#${i + 1}` }), icon(i === 0 ? 'trophy' : 'star', 'sm')),
      h('div', { class: 'who' }, avatarEl(p), h('div', {}, h('b', { text: p.displayName }), h('small', { text: sub(p) || rankOf(p.rating).label }))),
      h('div', { class: 'val' }, val(p), h('small', { text: RANK_COL[rankBy] })))) : [h('div', { class: 'card empty-card', style: 'grid-column:1/-1' },
      icon('rank', 'xl'), h('b', { text: 'Bảng xếp hạng đang chờ những kỳ thủ đầu tiên' }),
      h('p', { text: RANK_EMPTY[rankBy] }))]));
    const rows = data.players.slice(3).map((p) => h('tr', { class: me && p.username === me.username ? 'me' : '' },
      h('td', {}, h('span', { class: 'rank-no', text: p.rank })),
      h('td', {}, h('div', { class: 'player-cell' }, avatarEl(p), h('span', {}, h('b', { text: p.displayName }), h('small', { text: sub(p) })))),
      h('td', { class: 'num' }, h('b', { text: val(p) })),
      h('td', { class: 'num hide-sm', text: fmt(p.games) }),
      h('td', { class: 'num hide-sm', text: rate(p) })));
    $('rank-table').querySelector('tbody').replaceChildren(...(rows.length ? rows
      : [h('tr', {}, h('td', { colspan: 5 }, h('div', { class: 'empty', text: data.players.length ? 'Chỉ có những kỳ thủ trên.' : 'Chưa có ai trên bảng.' })))]));

    // Vị trí của bạn
    const box = $('rank-me');
    box.className = 'card rank-me';
    if (!me) {
      box.replaceChildren(h('h3', { text: 'Vị trí của bạn' }), h('p', { class: 'muted', text: 'Đăng nhập để có Elo và ghi tên lên bảng xếp hạng.' }),
        h('button', { class: 'btn primary block', text: 'Đăng nhập / Đăng ký', onclick: () => openAuth('login') }));
      return;
    }
    const mine = data.me;
    const above = mine && mine.rank > 1 ? data.players[mine.rank - 2] : null;
    box.replaceChildren(
      h('h3', { text: 'Vị trí của bạn' }),
      h('div', { class: 'player-cell' }, avatarEl(me), h('span', {}, h('b', { text: me.displayName }), h('small', { class: 'muted', text: rankOf(me.rating).label }))),
      h('div', { class: 'form-stats', style: 'width:100%' },
        h('div', {}, h('small', { text: 'Thứ hạng' }), h('b', { text: mine ? '#' + fmt(mine.rank) : '—' })),
        h('div', {}, h('small', { text: RANK_COL[rankBy] }), h('b', { text: mine ? val(mine) : rankBy === 'rating' || rankBy === 'friends' ? fmt(me.rating) : '0' }))),
      h('p', { class: 'muted', text: !mine ? 'Bạn chưa có tên trên bảng này.' : above ? `Còn ${fmt(above.value - mine.value + 1)} ${RANK_UNIT[rankBy]} để vượt ${above.displayName}.` : 'Bạn đang dẫn đầu bảng — giữ vững nhé!' }),
      h('a', { class: 'btn primary block', href: (RANK_CTA[rankBy] || ['#/play'])[0] }, (RANK_CTA[rankBy] || [0, 'Tìm trận xếp hạng'])[1]),
    );
  }
  document.querySelectorAll('#rank-tabs button').forEach((b) => b.addEventListener('click', () => { rankBy = b.dataset.by; openRanking(); }));

  // ---------- T01 Giải đấu (doc §16) ----------
  const tour = { tab: 'open', list: [], cur: null, timer: null };
  const TOUR_TABS = { open: ['open'], soon: ['checkin'], live: ['running'], done: ['finished', 'cancelled'] };
  const TOUR_EMPTY = { open: 'Chưa có giải nào đang mở đăng ký.', soon: 'Chưa có giải nào đang check-in.', live: 'Chưa có giải nào đang thi đấu.', done: 'Chưa có giải nào kết thúc.' };
  const TOUR_TAG = { open: 'green', checkin: 'gold', running: '', finished: 'soft', cancelled: 'soft' };
  const tourTc = (tc) => `${tc.totalMin}+${tc.incSec}`;
  const untilText = (t) => {
    const ms = t - Date.now();
    if (ms <= 0) return 'đã đến giờ';
    const m = Math.ceil(ms / 60000);
    return m < 60 ? `còn ${m} phút` : m < 1440 ? `còn ${Math.floor(m / 60)} giờ ${m % 60} phút` : `còn ${Math.floor(m / 1440)} ngày`;
  };

  // Tự làm mới khi đang xem giải (cặp đấu, kết quả thay đổi theo vòng)
  function tourAutoRefresh() {
    clearInterval(tour.timer);
    tour.timer = setInterval(() => {
      if (document.hidden) return;
      if (currentScreen === 'tournaments') openTournaments(true);
      else if (currentScreen === 'tournament' && tour.cur) openTournament(tour.cur.id, true);
      else clearInterval(tour.timer);
    }, 10000);
  }

  async function openTournaments(silent) {
    if (!silent) showScreen('tournaments');
    try { ({ tournaments: tour.list } = await fetchJson('/api/tournaments')); } catch (err) { if (!silent) toast(err.message); return; }
    renderTournaments();
    if (!silent) tourAutoRefresh();
  }

  function tourCta(t) {
    if (t.status === 'checkin' && t.registered && !t.checkedIn) return ['Check-in', 'primary'];
    if (['open', 'checkin'].includes(t.status) && !t.registered) return [t.players >= t.maxPlayers ? 'Đã đủ người' : 'Đăng ký', 'primary'];
    if (t.status === 'running' && t.registered) return ['Vào giải', 'primary'];
    return [t.status === 'finished' ? 'Kết quả' : 'Chi tiết', ''];
  }

  function renderTournaments() {
    const list = tour.list;
    document.querySelectorAll('#tour-tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.t === tour.tab);
      const n = list.filter((t) => TOUR_TABS[b.dataset.t].includes(t.status)).length;
      b.dataset.n = n;
    });
    // Hero: giải của tôi đang diễn ra, nếu không thì giải sắp tới gần nhất
    const active = list.filter((t) => ['open', 'checkin', 'running'].includes(t.status));
    const hero = active.find((t) => t.registered) || active.sort((a, b) => a.startAt - b.startAt)[0];
    const heroBox = $('tour-hero');
    if (hero) {
      const [cta] = tourCta(hero);
      heroBox.replaceChildren(
        h('div', { class: 'hero-body' },
          h('p', { class: 'eyebrow', text: hero.registered ? 'Giải của bạn' : 'Giải sắp diễn ra' }),
          h('h2', { text: hero.name }),
          h('p', { class: 'hero-meta' }, h('span', {}, icon('trophy', 'sm'), hero.formatName), h('span', {}, icon('calendar', 'sm'), fmtDateTime(hero.startAt)),
            h('span', {}, icon('clock', 'sm'), tourTc(hero.tc)), h('span', {}, icon('users', 'sm'), `${hero.players}/${hero.maxPlayers} kỳ thủ`)),
          h('p', { class: 'hero-sub', text: hero.status === 'running' ? `Đang thi đấu · vòng ${hero.rounds}${hero.totalRounds ? '/' + hero.totalRounds : ''}` : `${hero.statusName} · bắt đầu ${untilText(hero.startAt)}` })),
        h('div', { class: 'hero-side' },
          hero.prizes[0] ? h('div', { class: 'prize' }, h('small', { text: 'Giải nhất' }), h('b', {}, icon('coin'), `${fmt(hero.prizes[0])} xu`)) : null,
          h('a', { class: 'btn primary', href: '#/tournament/' + hero.id, text: cta })));
      heroBox.classList.remove('hidden');
    } else heroBox.classList.add('hidden');

    const shown = list.filter((t) => TOUR_TABS[tour.tab].includes(t.status))
      .sort((a, b) => (tour.tab === 'done' ? (b.finishedAt || b.startAt) - (a.finishedAt || a.startAt) : a.startAt - b.startAt));
    $('tour-list').replaceChildren(...(shown.length ? shown.map((t) => {
      const [cta, cls] = tourCta(t);
      return h('a', { class: 'tour-card', href: '#/tournament/' + t.id },
        h('span', { class: 'tour-ico' }, icon('trophy')),
        h('div', {},
          h('h3', {}, t.name, h('span', { class: 'tag ' + TOUR_TAG[t.status], text: t.statusName }), t.registered ? h('span', { class: 'tag', text: t.checkedIn ? 'Đã check-in' : 'Đã đăng ký' }) : null),
          h('div', { class: 'tour-meta' },
            h('span', {}, t.formatName), h('span', {}, icon('calendar', 'sm'), fmtDateTime(t.startAt)), h('span', {}, icon('clock', 'sm'), tourTc(t.tc)),
            h('span', {}, icon('users', 'sm'), `${t.players}/${t.maxPlayers}`), h('span', {}, icon('coin', 'sm'), t.entryFee ? `Lệ phí ${fmt(t.entryFee)} xu` : 'Miễn phí')),
          t.winner ? h('div', { class: 'tour-meta' }, h('span', {}, icon('trophy', 'sm'), `Vô địch: ${t.winner}`)) : null),
        h('div', { class: 'tour-side' },
          t.prizes[0] ? h('b', {}, `${fmt(t.prizes[0])} xu`) : h('small', { class: 'muted', text: 'Không thưởng xu' }),
          h('span', { class: 'btn sm ' + cls, text: cta })));
    }) : [h('div', { class: 'card empty' }, h('p', { text: TOUR_EMPTY[tour.tab] }), h('a', { class: 'btn', href: '#/play', text: 'Chơi xếp hạng trong lúc chờ' }))]));
  }
  document.querySelectorAll('#tour-tabs button').forEach((b) => b.addEventListener('click', () => { tour.tab = b.dataset.t; renderTournaments(); }));

  async function tourAction(action) {
    const t = tour.cur;
    if (!session) return openAuth('login');
    if (action === 'register' && t.entryFee && !confirm(`Đăng ký "${t.name}" với lệ phí ${fmt(t.entryFee)} xu?\nLệ phí được hoàn nếu bạn rút lui trước giờ đấu hoặc giải bị huỷ.`)) return;
    if (action === 'unregister' && !confirm(`Rút khỏi "${t.name}"?${t.entryFee ? ` Bạn được hoàn ${fmt(t.entryFee)} xu.` : ''}`)) return;
    try {
      const d = await fetchJson(`/api/tournaments/${t.id}/${action}`, { method: 'POST', body: '{}' });
      me = d.account;
      renderAuth();
      tour.cur = d.tournament;
      renderTournament();
      toast({ register: 'Đã đăng ký! Nhớ check-in trước giờ đấu.', unregister: 'Đã rút khỏi giải.', checkin: 'Đã check-in — chờ ghép cặp vòng 1.' }[action]);
    } catch (err) { toast(err.message); }
  }

  async function openTournament(id, silent) {
    if (!silent) {
      showScreen('tournament');
      if (!tour.cur || tour.cur.id !== id) {
        tour.cur = null;
        $('td-head').replaceChildren(h('p', { class: 'muted', text: 'Đang tải giải đấu…' }));
        ['td-board', 'td-rounds', 'td-me', 'td-info', 'td-players'].forEach((x) => $(x).replaceChildren());
      }
    }
    try {
      ({ tournament: tour.cur } = await fetchJson('/api/tournaments/' + encodeURIComponent(id)));
    } catch (err) {
      if (!silent) $('td-head').replaceChildren(h('h1', { text: 'Không tìm thấy giải' }), h('p', { class: 'muted', text: err.message }));
      return;
    }
    renderTournament();
    updateCrumbs();
    if (!silent) tourAutoRefresh();
  }

  const roundName = (t, n) => {
    if (t.format !== 'knockout' || !t.bracketSize) return `Vòng ${n}`;
    const left = t.bracketSize / 2 ** (n - 1);
    return left === 2 ? 'Chung kết' : left === 4 ? 'Bán kết' : left === 8 ? 'Tứ kết' : `Vòng 1/${left / 2}`;
  };
  const scoreText = (pr) => {
    if (!pr.b) return 'Miễn đấu';
    if (pr.status === 'playing') return 'Đang đấu';
    if (pr.status === 'pending') return 'Chờ vào bàn';
    return { r: '1 – 0', b: '0 – 1', draw: '½ – ½', double: '0 – 0' }[pr.result] || '—';
  };
  // Người đi tiếp ở thể thức loại trực tiếp (hoà → hạt giống cao hơn)
  function koWinner(t, pr) {
    if (pr.status !== 'done') return null;
    if (!pr.b || pr.result === 'r') return pr.r;
    if (pr.result === 'b') return pr.b;
    const seed = (id) => (t.standings.find((p) => p.id === id) || {}).seed || 999;
    return seed(pr.r) <= seed(pr.b) ? pr.r : pr.b;
  }

  function renderTournament() {
    const t = tour.cur;
    if (!t) return;
    const myId = me && me.id;
    const mine = t.standings.find((p) => p.id === myId);

    // Đầu trang + nút hành động chính
    const acts = [];
    if (['open', 'checkin'].includes(t.status)) {
      if (!session) acts.push(h('button', { class: 'btn primary', text: 'Đăng nhập để đăng ký', onclick: () => openAuth('login') }));
      else if (!t.registered) acts.push(h('button', { class: 'btn primary', disabled: t.players >= t.maxPlayers ? true : null, onclick: () => tourAction('register') }, t.players >= t.maxPlayers ? 'Đã đủ người' : t.entryFee ? `Đăng ký · ${fmt(t.entryFee)} xu` : 'Đăng ký miễn phí'));
      else {
        if (t.status === 'checkin' && !t.checkedIn) acts.push(h('button', { class: 'btn primary', onclick: () => tourAction('checkin') }, icon('check'), 'Check-in'));
        else acts.push(h('span', { class: 'tag green', text: t.checkedIn ? 'Đã check-in' : 'Đã đăng ký' }));
        acts.push(h('button', { class: 'btn sm ghost', text: 'Rút lui', onclick: () => tourAction('unregister') }));
      }
      acts.push(h('small', { class: 'muted', text: t.status === 'open' ? `Check-in mở lúc ${fmtTime(t.startAt - t.checkinMin * 60000)} · bắt đầu ${untilText(t.startAt)}` : `Bắt đầu ${untilText(t.startAt)} — chưa check-in sẽ bị loại` }));
    } else if (t.status === 'running' && t.myGame) {
      acts.push(t.myGame.roomId ? h('button', { class: 'btn primary', onclick: () => joinRoomCode(t.myGame.roomId) }, icon('swords'), `Vào bàn · ${roundName(t, t.myGame.round)}`)
        : h('span', { class: 'tag gold', text: 'Đang tạo bàn…' }));
      if (t.myGame.deadline) acts.push(h('small', { class: 'muted', text: `Vào bàn trước ${fmtTime(t.myGame.deadline)}, quá giờ bị xử thua` }));
    } else if (t.status === 'running') acts.push(h('small', { class: 'muted', text: mine ? (mine.out ? 'Bạn đã dừng bước — theo dõi các vòng còn lại nhé.' : 'Chờ các bàn khác kết thúc để ghép vòng sau.') : 'Giải đang thi đấu.' }));
    else if (t.status === 'finished' && t.winner) acts.push(h('span', { class: 'tag gold' }, icon('trophy', 'sm'), `Vô địch: ${t.winner}`));
    $('td-head').replaceChildren(
      h('span', { class: 'tour-ico' }, icon('trophy')),
      h('div', {},
        h('p', { class: 'eyebrow', text: `${t.formatName} · ${t.statusName}` }),
        h('h1', { text: t.name }),
        h('div', { class: 'tour-meta' }, h('span', {}, icon('calendar', 'sm'), fmtDateTime(t.startAt)), h('span', {}, icon('clock', 'sm'), tourTc(t.tc)),
          h('span', {}, icon('users', 'sm'), `${t.players}/${t.maxPlayers} kỳ thủ`), t.status === 'running' || t.status === 'finished' ? h('span', {}, `Vòng ${t.rounds.length}${t.totalRounds ? '/' + t.totalRounds : ''}`) : null),
        t.description ? h('p', { class: 'muted', text: t.description }) : null),
      h('div', { class: 'acts' }, acts));

    // Bảng chính: nhánh đấu (loại trực tiếp) hoặc bảng điểm
    const board = $('td-board');
    if (t.format === 'knockout' && t.rounds.length) {
      const total = Math.log2(t.bracketSize || 2);
      const cols = [];
      for (let n = 1; n <= total; n++) {
        const r = t.rounds.find((x) => x.n === n);
        const boxes = r ? r.pairings.map((pr) => {
          const w = koWinner(t, pr);
          const line = (id, name) => h('div', { class: (w && w === id ? 'win' : '') + (id && id === myId ? ' me' : '') },
            h('span', { text: name || (id ? '?' : 'Miễn đấu') }), h('small', { text: id && w ? (w === id ? '✓' : '') : '' }));
          return h('div', { class: 'match-box' }, line(pr.r, pr.rName), line(pr.b, pr.bName));
        }) : Array.from({ length: (t.bracketSize || 2) / 2 ** n }, () => h('div', { class: 'match-box' }, h('div', {}, h('span', { class: 'muted', text: 'Chờ kết quả' })), h('div', {}, h('span', { class: 'muted', text: 'Chờ kết quả' }))));
        cols.push(h('div', { class: 'bracket-round' }, h('h4', { text: roundName(t, n) }), boxes));
      }
      board.replaceChildren(h('div', { class: 'card-head' }, h('h3', { text: 'Nhánh đấu' })), h('div', { class: 'bracket' }, cols));
    } else if (t.standings.length) {
      const showBh = t.format === 'swiss';
      const started = t.status === 'running' || t.status === 'finished';
      board.replaceChildren(h('div', { class: 'card-head' }, h('h3', { text: started ? 'Bảng xếp hạng giải' : 'Danh sách đăng ký' })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Kỳ thủ' }), h('th', { text: 'Elo' }), started ? h('th', { text: 'Điểm' }) : null, started && showBh ? h('th', { text: 'Buchholz' }) : null)),
          h('tbody', {}, t.standings.map((p, i) => h('tr', { class: p.id === myId ? 'me' : '' },
            h('td', {}, p.place && p.place <= 3 ? h('span', { class: 'medal m' + p.place, text: p.place }) : String(p.place || i + 1)),
            h('td', {}, h('span', { class: 'player-cell' }, avatarEl({ displayName: p.name, avatar: p.avatar }), h('b', { text: p.name }))),
            h('td', { text: fmt(p.rating) }),
            started ? h('td', {}, h('b', { text: String(p.score).replace('.5', '½').replace(/^0½/, '½') })) : null,
            started && showBh ? h('td', { text: p.buchholz }) : null))))));
    } else board.replaceChildren(h('h3', { text: 'Danh sách đăng ký' }), h('p', { class: 'muted', text: 'Chưa có kỳ thủ nào đăng ký. Hãy là người đầu tiên!' }));

    // Các vòng & cặp đấu
    const roundsBox = $('td-rounds');
    if (!t.rounds.length) roundsBox.replaceChildren(h('h3', { text: 'Lịch thi đấu' }), h('p', { class: 'muted', text: t.status === 'cancelled' ? 'Giải đã huỷ — lệ phí đã được hoàn.' : 'Cặp đấu vòng 1 được ghép khi giải bắt đầu.' }));
    else roundsBox.replaceChildren(h('h3', { text: 'Lịch thi đấu' }), ...[...t.rounds].reverse().map((r) => h('div', {},
      h('h4', { class: 'round-title', text: `${roundName(t, r.n)}${r.finishedAt ? ' · đã xong' : ' · đang đấu'}` }),
      r.pairings.map((pr) => h('div', { class: 'pairing' },
        h('span', { class: (pr.result === 'r' ? 'win' : '') + (pr.r === myId ? ' me' : ''), text: pr.rName }),
        h('span', { class: 'score', text: scoreText(pr) }),
        h('span', { class: 'p2 ' + (pr.result === 'b' ? 'win' : '') + (pr.b === myId ? ' me' : ''), text: pr.bName || '—' }),
        pr.gameId ? h('a', { class: 'btn sm ghost', href: '#/replay/' + pr.gameId, text: 'Xem lại' })
          : pr.roomId && pr.status === 'playing' ? h('button', { class: 'btn sm ghost', onclick: () => watchRoom(pr.roomId) }, icon('eye', 'sm'), 'Xem')
            : h('span'))))));

    // Thẻ của tôi
    const meBox = $('td-me');
    if (!session) meBox.replaceChildren(h('h3', { text: 'Tham gia giải' }), h('p', { class: 'muted', text: 'Đăng nhập để đăng ký, check-in và nhận thông báo vào bàn.' }), h('button', { class: 'btn primary block', text: 'Đăng nhập', onclick: () => openAuth('login') }));
    else if (!mine) meBox.replaceChildren(h('h3', { text: 'Bạn chưa tham gia' }), h('p', { class: 'muted', text: ['open', 'checkin'].includes(t.status) ? 'Đăng ký để giữ chỗ. Lệ phí được hoàn nếu bạn rút lui trước giờ đấu.' : 'Giải đã đóng đăng ký — bạn vẫn có thể theo dõi các vòng đấu.' }));
    else {
      const rows = [['Trạng thái', t.status === 'finished' ? (mine.place ? `Hạng ${mine.place}` : 'Đã kết thúc') : mine.out ? 'Đã dừng bước' : t.status === 'running' ? 'Đang thi đấu' : t.checkedIn ? 'Đã check-in' : 'Đã đăng ký']];
      if (t.status === 'running' || t.status === 'finished') rows.push(['Điểm', String(mine.score)]);
      if (t.myGame) rows.push(['Bàn hiện tại', `${roundName(t, t.myGame.round)} · cầm ${t.myGame.color === 'r' ? 'Đỏ' : 'Đen'} gặp ${t.myGame.opponent || '—'}`]);
      fill(meBox, h('h3', { text: 'Của bạn' }), h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        t.myGame && t.myGame.roomId ? h('button', { class: 'btn primary block', onclick: () => joinRoomCode(t.myGame.roomId) }, icon('swords'), 'Vào bàn') : null);
    }

    // Thông tin & giải thưởng
    const rules = { knockout: 'Thua là dừng bước. Hoà thì hạt giống cao hơn đi tiếp.', roundrobin: 'Mỗi kỳ thủ gặp tất cả. Thắng 1, hoà ½, thua 0.', swiss: `${t.totalRounds || '—'} vòng, ghép người cùng điểm, không gặp lại. Hoà điểm xét Buchholz.` };
    $('td-info').replaceChildren(h('h3', { text: 'Thể lệ & giải thưởng' }), h('p', { class: 'muted', text: rules[t.format] }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Nhịp' }), h('dd', { text: `${t.tc.totalMin} phút + ${t.tc.incSec} giây/nước` }),
        h('dt', { text: 'Lệ phí' }), h('dd', { text: t.entryFee ? `${fmt(t.entryFee)} xu` : 'Miễn phí' }),
        h('dt', { text: 'Check-in' }), h('dd', { text: `${t.checkinMin} phút trước giờ đấu` }),
        h('dt', { text: 'Vắng mặt' }), h('dd', { text: `Quá ${t.noShowMin} phút không vào bàn bị xử thua` }),
        ...['Hạng nhất', 'Hạng nhì', 'Hạng ba'].flatMap((k, i) => t.prizes[i] ? [h('dt', { text: k }), h('dd', {}, icon('coin', 'sm'), `${fmt(t.prizes[i])} xu + huy hiệu`)] : [])),
      h('p', { class: 'muted small', text: 'Ván giải đấu tính Elo. Top 3 nhận huy hiệu và điểm Danh vọng mùa.' }));

    // Kỳ thủ
    const pl = $('td-players');
    pl.replaceChildren(h('h3', { text: `Kỳ thủ (${t.players})` }),
      ...(t.standings.length ? [...t.standings].sort((a, b) => (a.seed || 999) - (b.seed || 999) || b.rating - a.rating).slice(0, 64).map((p) => h('div', { class: 'player-cell' + (p.id === myId ? ' me' : '') },
        avatarEl({ displayName: p.name, avatar: p.avatar }),
        h('span', { class: 'grow' }, h('b', { text: p.name }), h('small', { class: 'muted', text: `Elo ${fmt(p.rating)}${p.seed ? ' · hạt giống ' + p.seed : ''}` })),
        t.status === 'checkin' ? h('span', { class: 'tag ' + (p.checkedIn ? 'green' : ''), text: p.checkedIn ? 'Đã check-in' : 'Chưa' }) : p.out ? h('span', { class: 'tag', text: 'Dừng' }) : null))
        : [h('p', { class: 'muted', text: 'Chưa có ai.' })]));
  }

  // ---------- F01 Bạn bè & Social (doc §17) ----------
  const fr = { tab: 'friends', data: null, sel: null, results: null, suggest: null };
  const FR_TITLES = { friends: 'Bạn bè', requests: 'Lời mời kết bạn', activity: 'Hoạt động của kỳ hữu', suggest: 'Gợi ý kết bạn', blocked: 'Đã chặn' };

  async function openFriends() {
    showScreen('friends');
    if (!session) {
      $('fr-count').textContent = '';
      $('fr-list').replaceChildren(loginEmpty('Đăng nhập để kết bạn, xem ai đang online và mời đấu.'));
      $('fr-detail').replaceChildren(h('h3', { text: 'Kỳ hữu' }), h('p', { class: 'muted', text: 'Chọn một kỳ thủ để xem hồ sơ và lịch sử đối đầu.' }));
      return;
    }
    try { fr.data = await accountApi('GET', '/social'); } catch (err) { return toast(err.message); }
    renderFriends();
    if (fr.sel) loadFriendDetail(fr.sel);
    else renderFriendDetail(null);
  }

  // Kết bạn / chấp nhận / từ chối / xoá / chặn / bỏ chặn
  async function socialDo(action, userId, okMsg) {
    try {
      const d = await accountApi('POST', '/social/' + action, { userId });
      fr.data = d;
      me = d.account;
      renderAuth();
      if (okMsg) toast(okMsg);
      if (currentScreen === 'friends') {
        renderFriends();
        if (fr.sel === userId) loadFriendDetail(userId);
        if (fr.results) searchPlayers($('fr-search').value);
      }
    } catch (err) { toast(err.message); }
  }

  const statusOf = (f) => (f.playing ? h('span', { class: 'status on' }, icon('swords', 'sm'), 'Đang chơi')
    : f.online ? h('span', { class: 'status on' }, h('i', { class: 'dot green' }), 'Online')
      : h('span', { class: 'status', text: `Offline · ${f.lastSeen ? fmtDate(f.lastSeen) : ''}` }));
  // Nút quan hệ (kết bạn / đã gửi / chấp nhận)
  function relationBtn(p) {
    if (p.relation === 'friend') return h('span', { class: 'tag green', text: 'Kỳ hữu' });
    if (p.relation === 'sent') return h('button', { class: 'btn sm', text: 'Huỷ lời mời', onclick: () => socialDo('decline', p.id, 'Đã huỷ lời mời.') });
    if (p.relation === 'incoming') return h('button', { class: 'btn sm primary', text: 'Chấp nhận', onclick: () => socialDo('accept', p.id, 'Đã kết bạn!') });
    return h('button', { class: 'btn sm primary', onclick: () => socialDo('request', p.id, 'Đã gửi lời mời kết bạn.') }, icon('user-plus', 'sm'), 'Kết bạn');
  }
  function personRow(p, acts, sub) {
    return h('div', { class: 'fr-row' + (fr.sel === p.id ? ' active' : '') },
      h('button', { class: 'fr-open', onclick: () => loadFriendDetail(p.id) }, avatarEl(p),
        h('span', { class: 'info' }, h('b', { text: p.displayName }), sub || h('small', { text: `@${p.username} · Elo ${fmt(p.rating)}` }))),
      h('span', { class: 'acts' }, acts));
  }

  async function renderFriends() {
    const d = fr.data;
    if (!d) return;
    document.querySelectorAll('#fr-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === fr.tab));
    $('fr-req-count').textContent = d.incoming.length;
    $('fr-req-count').classList.toggle('hidden', !d.incoming.length);
    $('fr-list-title').textContent = FR_TITLES[fr.tab];
    const list = $('fr-list');
    const empty = (text, cta) => h('div', { class: 'empty' }, h('p', { text }), cta || null);
    if (fr.tab === 'friends') {
      const friends = [...d.friends].sort((a, b) => (b.playing - a.playing) || (b.online - a.online) || a.displayName.localeCompare(b.displayName));
      $('fr-count').textContent = `${friends.length} kỳ hữu · ${friends.filter((f) => f.online).length} đang online`;
      list.replaceChildren(...(friends.length ? friends.map((f) => personRow(f, [
        f.playing && f.roomId ? h('button', { class: 'btn sm', onclick: () => watchRoom(f.roomId) }, icon('eye', 'sm'), 'Xem') : null,
        h('button', { class: 'btn sm primary', disabled: f.playing ? true : null, onclick: () => inviteFriend(f) }, icon('swords', 'sm'), 'Mời đấu'),
      ], h('small', {}, statusOf(f), ` · Elo ${fmt(f.rating)}`))) : [empty('Chưa có kỳ hữu nào. Tìm theo tên ở trên hoặc xem tab Gợi ý.')]));
    } else if (fr.tab === 'requests') {
      $('fr-count').textContent = `${d.incoming.length} lời mời đến · ${d.outgoing.length} đã gửi`;
      const rows = [
        ...d.incoming.map((p) => personRow(p, [
          h('button', { class: 'btn sm primary', text: 'Chấp nhận', onclick: () => socialDo('accept', p.id, 'Đã kết bạn!') }),
          h('button', { class: 'btn sm', text: 'Từ chối', onclick: () => socialDo('decline', p.id) })], h('small', { text: 'Muốn kết bạn với bạn' }))),
        ...d.outgoing.map((p) => personRow(p, [h('button', { class: 'btn sm', text: 'Huỷ', onclick: () => socialDo('decline', p.id, 'Đã huỷ lời mời.') })], h('small', { text: 'Đã gửi lời mời' }))),
      ];
      list.replaceChildren(...(rows.length ? rows : [empty('Không có lời mời nào.')]));
    } else if (fr.tab === 'activity') {
      $('fr-count').textContent = 'Kết quả gần đây của kỳ hữu';
      list.replaceChildren(...(d.activity.length ? d.activity.map((a) => h('div', { class: 'activity' },
        avatarEl(a.friend), h('span', { class: 'grow' }, h('b', { text: a.friend.displayName }), ` ${{ win: 'thắng', loss: 'thua', draw: 'hoà' }[a.outcome]} ${a.opponent}`,
          h('small', { class: 'muted', text: ` · ${KIND_NAMES[a.kind] || 'Online'} · ${fmtDateTime(a.endedAt)}` })),
        h('a', { class: 'btn sm', href: '#/replay/' + a.id, text: 'Xem lại' }))) : [empty('Kỳ hữu chưa có ván nào gần đây.')]));
    } else if (fr.tab === 'suggest') {
      $('fr-count').textContent = 'Những kỳ thủ bạn từng đối đầu';
      if (!fr.suggest) {
        list.replaceChildren(h('div', { class: 'empty', text: 'Đang tải…' }));
        const seen = new Map();
        try {
          for (const g of await myGames()) {
            if (g.opponentId && !seen.has(g.opponentId) && !d.friends.some((f) => f.id === g.opponentId)) seen.set(g.opponentId, g);
          }
        } catch { /* bỏ qua */ }
        fr.suggest = [...seen.values()];
      }
      list.replaceChildren(...(fr.suggest.length ? fr.suggest.map((g) => personRow({ id: g.opponentId, displayName: g.opponent, username: '', rating: 0 },
        [relationBtn({ id: g.opponentId, relation: d.outgoing.some((x) => x.id === g.opponentId) ? 'sent' : d.incoming.some((x) => x.id === g.opponentId) ? 'incoming' : 'none' })],
        h('small', { text: `Đối đầu lần cuối ${fmtDate(g.endedAt)}` }))) : [empty('Chơi vài ván online để có gợi ý kết bạn.')]));
    } else {
      $('fr-count').textContent = `${d.blocked.length} kỳ thủ`;
      list.replaceChildren(...(d.blocked.length ? d.blocked.map((p) => personRow(p, [h('button', { class: 'btn sm', text: 'Bỏ chặn', onclick: () => socialDo('unblock', p.id, 'Đã bỏ chặn.') })])) : [empty('Bạn chưa chặn ai.')]));
    }
  }
  document.querySelectorAll('#fr-tabs button').forEach((b) => b.addEventListener('click', () => { fr.tab = b.dataset.t; renderFriends(); }));

  // Tìm kỳ thủ
  async function searchPlayers(q) {
    if (!session) return openAuth('login');
    q = String(q || '').trim();
    if (q.length < 2) return toast('Nhập ít nhất 2 ký tự để tìm.');
    try {
      const { results } = await accountApi('GET', '/social/search?q=' + encodeURIComponent(q));
      fr.results = results;
      $('fr-results-card').classList.remove('hidden');
      $('fr-results').replaceChildren(...(results.length ? results.map((p) => personRow(p, [relationBtn(p)],
        h('small', {}, `@${p.username} · Elo ${fmt(p.rating)}${p.region ? ' · ' + p.region : ''} · `, statusOf(p))))
        : [h('div', { class: 'empty', text: 'Không tìm thấy kỳ thủ phù hợp.' })]));
    } catch (err) { toast(err.message); }
  }
  $('fr-search-form').addEventListener('submit', (e) => { e.preventDefault(); searchPlayers($('fr-search').value); });
  $('fr-results-close').addEventListener('click', () => { fr.results = null; $('fr-results-card').classList.add('hidden'); });

  // Hồ sơ ngắn + lịch sử đối đầu
  async function loadFriendDetail(id) {
    fr.sel = id;
    document.querySelectorAll('#page-friends .fr-row').forEach((r) => r.classList.remove('active'));
    try {
      const d = await accountApi('GET', '/players/' + encodeURIComponent(id));
      renderFriendDetail(d);
      if (fr.data) renderFriends();
    } catch (err) { toast(err.message); }
  }
  function renderFriendDetail(d) {
    const box = $('fr-detail');
    if (!d) return box.replaceChildren(h('h3', { text: 'Kỳ hữu' }), h('p', { class: 'muted', text: 'Chọn một kỳ thủ để xem hồ sơ và lịch sử đối đầu.' }));
    const p = d.player, hh = d.headToHead;
    const rank = rankOf(p.rating);
    const st = p.stats.online;
    fill(box,
      avatarEl(p, 'dark'), h('h3', { text: p.displayName }),
      h('p', { class: 'muted', text: `@${p.username} · ${rank.label}${p.region ? ' · ' + p.region : ''}` }),
      h('div', {}, statusOf(p)),
      h('div', { class: 'h2h' }, ...[['Elo', fmt(p.rating)], ['Ván online', st.games], ['Chuỗi tốt nhất', p.bestStreak]].map(([k, v]) => h('div', {}, h('b', { text: v }), h('small', { text: k })))),
      h('h4', { class: 'round-title', text: `Đối đầu với bạn: ${hh.games} ván` }),
      h('div', { class: 'h2h' }, ...[['Thắng', hh.wins], ['Hoà', hh.draws], ['Thua', hh.losses]].map(([k, v]) => h('div', {}, h('b', { text: v }), h('small', { text: k })))),
      hh.recent.length ? h('div', { class: 'recent' }, hh.recent.map((g) => h('div', {}, h('a', { href: '#/replay/' + g.id, text: fmtDateTime(g.endedAt) }),
        h('span', { class: 'res ' + g.outcome, text: { win: 'Thắng', loss: 'Thua', draw: 'Hoà' }[g.outcome] })))) : null,
      p.badges.length ? h('div', { class: 'tag-row' }, p.badges.map((b) => h('span', { class: 'tag gold' }, icon('trophy', 'sm'), b.name))) : null,
      p.relation === 'friend' ? h('button', { class: 'btn primary block', disabled: p.playing ? true : null, onclick: () => inviteFriend(p) }, icon('swords'), 'Mời đấu') : null,
      p.playing && p.roomId ? h('button', { class: 'btn block', onclick: () => watchRoom(p.roomId) }, icon('eye'), 'Xem trận đang chơi') : null,
      p.relation === 'blocked' ? null : relationBtn(p),
      h('div', { class: 'row wrap' },
        p.relation === 'friend' ? h('button', { class: 'btn sm ghost', onclick: () => confirm(`Xoá ${p.displayName} khỏi danh sách kỳ hữu?`) && socialDo('remove', p.id, 'Đã xoá kỳ hữu.') }, 'Xoá bạn') : null,
        p.relation === 'blocked' ? h('button', { class: 'btn sm', onclick: () => socialDo('unblock', p.id, 'Đã bỏ chặn.') }, 'Bỏ chặn')
          : h('button', { class: 'btn sm ghost', onclick: () => confirm(`Chặn ${p.displayName}? Hai bạn sẽ không ghép trận và không gửi lời mời cho nhau.`) && socialDo('block', p.id, 'Đã chặn.') }, icon('ban', 'sm'), 'Chặn'),
        h('button', { class: 'btn sm ghost', onclick: () => openReport(p) }, icon('alert', 'sm'), 'Báo cáo')),
    );
  }

  // Báo cáo kỳ thủ
  let reportTarget = null;
  function openReport(p) {
    reportTarget = p;
    $('report-target').textContent = `Kỳ thủ: ${p.displayName}${p.username ? ' (@' + p.username + ')' : ''}. Báo cáo được gửi tới quản trị viên.`;
    $('report-reason').value = '';
    $('report-modal').classList.remove('hidden');
  }
  $('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await accountApi('POST', '/social/report', { userId: reportTarget.id, reason: $('report-reason').value });
      $('report-modal').classList.add('hidden');
      toast('Đã gửi báo cáo — cảm ơn bạn!');
    } catch (err) { toast(err.message); }
  });

  // ---------- I01 Túi đồ & S01 Cửa hàng ----------
  // Túi đồ = vật phẩm đã sở hữu & trang bị; Cửa hàng = khám phá & mua bằng xu (doc §13–14)
  let invMode = 'bag', invBusy = false;
  const inv = { cat: 'board', sel: null, owned: null, fresh: [] };
  const ownedIds = () => (me && inv.owned ? inv.owned : Catalog.ITEMS.filter((x) => x.price === 0).map((x) => x.id));
  const owns = (id) => ownedIds().includes(id);

  // Ảnh mẫu vật phẩm
  function drawItemThumb(thumb, it, base = equip) {
    thumb.replaceChildren();
    if (it.cat === 'clock') {
      thumb.className = 'inv-thumb clock-' + it.clock.style;
      thumb.appendChild(h('div', { class: 'clock-demo running' }, h('b', { text: '05:00' })));
      return;
    }
    const s2 = svgEl('svg', { role: 'img', 'aria-label': it.name });
    thumb.appendChild(s2);
    const th = itemTheme({ ...base, [it.cat]: it.id });
    if (it.cat === 'board') {
      miniBoard(s2, X.initialBoard(), { th });
      s2.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    } else {
      const b = Array.from({ length: 10 }, () => Array(9).fill(null));
      b[8][3] = 'bN'; b[8][5] = 'bC'; b[9][3] = 'rA'; b[9][4] = 'rK'; b[9][5] = 'rA';
      const g = miniBoard(s2, b, { th });
      const pad = 62 * g.unit, x0 = g.xs[3] - pad, y0 = g.ys[8] - pad;
      s2.setAttribute('viewBox', `${x0} ${y0} ${g.xs[5] + pad - x0} ${g.ys[9] + pad - y0}`);
    }
  }

  async function openInventory(mode = 'bag') {
    invMode = mode;
    showScreen('inventory');
    if (session) {
      try {
        const { inventory } = await accountApi('GET', '/inventory');
        inv.owned = inventory.owned;
        inv.fresh = inventory.fresh;
        setEquip(inventory.equip);
      } catch (err) { toast(err.message); }
    } else {
      inv.owned = null;
      inv.fresh = [];
    }
    if (!inv.sel || Catalog.byId[inv.sel].cat !== inv.cat) inv.sel = equip[inv.cat];
    renderInventory();
  }

  function renderInventory() {
    const cat = inv.cat;
    const shop = invMode === 'shop';
    document.querySelectorAll('#inv-mode .tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === invMode));
    document.querySelectorAll('#inv-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    $('inv-eyebrow').textContent = shop ? 'Cửa hàng' : 'Túi đồ';
    $('inv-title').textContent = shop ? 'Cửa hàng vật phẩm.' : 'Túi đồ của bạn.';
    $('inv-coins').replaceChildren(icon('coin'), me ? `${fmt(me.coins)} xu` : 'Khách');
    updateCrumbs();
    const items = Catalog.ITEMS.filter((it) => it.cat === cat && (shop || owns(it.id)));
    $('inv-cat-title').textContent = Catalog.CATS[cat];
    $('inv-count').textContent = shop ? `${items.filter((it) => !owns(it.id)).length} vật phẩm chưa sở hữu` : `${items.length} vật phẩm đã sở hữu`;
    if (!items.some((it) => it.id === inv.sel)) inv.sel = items.some((it) => it.id === equip[cat]) ? equip[cat] : items[0] && items[0].id;
    $('inv-grid').replaceChildren(...items.map((it) => {
      const thumb = h('div', { class: 'inv-thumb' });
      drawItemThumb(thumb, it);
      const using = equip[cat] === it.id, have = owns(it.id), isNew = inv.fresh.includes(it.id);
      const status = using ? h('span', { class: 'tag', text: 'Đang dùng' })
        : isNew ? h('span', { class: 'tag new', text: 'Mới' })
          : have ? h('span', { class: 'tag soft', text: it.price ? 'Đã sở hữu' : 'Miễn phí' })
            : h('span', { class: 'price' }, icon('coin', 'sm'), fmt(it.price));
      return h('button', { class: 'inv-item' + (inv.sel === it.id ? ' selected' : '') + (have ? '' : ' locked'), onclick: () => { inv.sel = it.id; renderInventory(); } },
        thumb, h('div', { class: 'inv-meta' }, h('span', {}, h('b', { text: it.name }), h('small', { text: it.desc })), status));
    }));
    // Xem trước: bộ đang dùng + vật phẩm đang chọn
    const sel = Catalog.byId[inv.sel];
    const preview = { ...equip, ...(sel ? { [sel.cat]: sel.id } : {}) };
    miniBoard($('inv-board'), X.initialBoard(), { th: itemTheme(preview) });
    const box = document.querySelector('.inv-preview');
    box.classList.remove(...CLOCK_CLASSES);
    const cs = clockStyle(preview.clock);
    if (cs !== 'classic') box.classList.add('clock-' + cs);
    $('inv-set').replaceChildren(...Object.entries(Catalog.CATS).flatMap(([c, label]) => [h('dt', { text: label }), h('dd', { text: (Catalog.byId[preview[c]] || {}).name || '—' })]));
    const btn = $('inv-equip');
    btn.disabled = false;
    btn.classList.add('primary');
    if (!sel) { btn.disabled = true; btn.textContent = 'Chọn vật phẩm'; return; }
    const using = equip[sel.cat] === sel.id;
    $('inv-state').textContent = using ? 'Đang dùng' : owns(sel.id) ? 'Đã sở hữu' : 'Chưa mở khoá';
    if (owns(sel.id)) {
      btn.textContent = using ? 'Đang trang bị' : `Trang bị ${sel.name}`;
      btn.disabled = using;
      $('inv-note').textContent = me ? 'Bộ trang bị lưu theo tài khoản, dùng được trên mọi thiết bị.' : 'Khách: bộ trang bị lưu trên trình duyệt này. Đăng nhập để mua thêm vật phẩm.';
    } else if (!me) {
      btn.textContent = `Đăng nhập để mua · ${fmt(sel.price)} xu`;
      $('inv-note').textContent = 'Vật phẩm mua bằng xu kiếm trong game (nhiệm vụ, thắng ván, cờ thế, giải đấu).';
    } else if (me.coins < sel.price) {
      btn.textContent = `Không đủ xu — cần ${fmt(sel.price)} xu`;
      btn.disabled = true;
      $('inv-note').textContent = `Bạn còn thiếu ${fmt(sel.price - me.coins)} xu. Làm nhiệm vụ hằng ngày hoặc giải cờ thế để kiếm thêm.`;
    } else {
      btn.textContent = `Mua · ${fmt(sel.price)} xu`;
      $('inv-note').textContent = `Sau khi mua còn ${fmt(me.coins - sel.price)} xu. Vật phẩm chỉ đổi giao diện, không ảnh hưởng thi đấu.`;
    }
  }
  document.querySelectorAll('#inv-tabs button').forEach((b) => b.addEventListener('click', () => { inv.cat = b.dataset.cat; inv.sel = equip[inv.cat]; renderInventory(); }));
  document.querySelectorAll('#inv-mode .tab').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.mode === 'shop' ? 'shop' : 'inventory')));
  $('inv-equip').addEventListener('click', async () => {
    const sel = Catalog.byId[inv.sel];
    if (!sel) return;
    if (!owns(sel.id)) {
      if (!me) return openAuth('login');
      if (!confirm(`Mua "${sel.name}" với giá ${fmt(sel.price)} xu?`)) return;
      invBusy = true;
      try {
        const d = await accountApi('POST', '/shop/buy', { itemId: sel.id });
        me = d.account;
        inv.owned = d.inventory.owned;
        inv.fresh = d.inventory.fresh;
        renderAuth();
        toast(`Đã mua "${sel.name}" — bấm Trang bị để dùng ngay.`);
      } catch (err) { toast(err.message); } finally { invBusy = false; }
      return renderInventory();
    }
    if (me) {
      invBusy = true;
      try {
        const d = await accountApi('POST', '/inventory/equip', { equip: { [sel.cat]: sel.id } });
        me = d.account;
        inv.fresh = d.inventory.fresh;
        setEquip(d.inventory.equip);
        renderAuth();
      } catch (err) { return toast(err.message); } finally { invBusy = false; }
    } else {
      setEquip({ ...equip, [sel.cat]: sel.id });
      store.set(GUEST_EQUIP, JSON.stringify(equip));
    }
    renderInventory();
    toast('Trang bị thành công!');
  });

  // ---------- Cờ thế ----------
  const DIFF_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const pz = { list: [], filter: 'all', topic: 'all', cur: null, board: null, turn: 'r', ply: 0, played: [], ui: null, busy: false, done: false, hints: 0, attempts: 1, startedAt: 0, revealed: false };
  const TOPIC_LABEL = { mate: 'Chiếu bí', capture: 'Bắt quân', defense: 'Phòng thủ', endgame: 'Tàn cuộc' };
  const pzFiltered = () => pz.list.filter((p) => (pz.filter === 'all' || p.difficulty === pz.filter) && (pz.topic === 'all' || (p.topic || 'mate') === pz.topic));
  // Bài nên làm tiếp: bài chưa giải ngay sau bài mở gần nhất (theo bộ lọc), nếu không có thì bài chưa giải đầu tiên
  function pzContinueTarget() {
    const list = pzFiltered();
    let last = null;
    try { last = localStorage.getItem('tk-pz-last'); } catch { /* bỏ qua */ }
    const i = list.findIndex((p) => p.id === last);
    if (i >= 0 && !list[i].solved) return list[i];
    return list.slice(i + 1).find((p) => !p.solved) || list.find((p) => !p.solved) || null;
  }
  const authHeader = () => (session ? { Authorization: 'Bearer ' + session } : {});
  const sameMv = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeader() } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra.');
    return json;
  }

  async function openPuzzles() {
    try {
      ({ puzzles: pz.list } = await fetchJson('/api/puzzles'));
      renderPuzzleGrid();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderPuzzleGrid() {
    const unsolved = $('pz-unsolved').checked;
    const list = pzFiltered().filter((p) => !unsolved || !p.solved);
    const cont = pzContinueTarget();
    $('pz-continue').classList.toggle('hidden', !cont);
    $('pz-continue').onclick = () => cont && navigate('puzzle/' + cont.id);
    const solvedCount = pz.list.filter((p) => p.solved).length;
    $('pz-progress').textContent = session ? `Đã giải ${solvedCount}/${pz.list.length} bài` : `${pz.list.length} bài · đăng nhập để lưu bài đã giải`;
    if (!list.length) {
      $('pz-grid').replaceChildren(h('div', { class: 'card empty-card pz-empty' }, icon('puzzle', 'xl'),
        h('b', { text: pz.list.length ? 'Không có bài phù hợp với bộ lọc.' : 'Chưa có bài cờ thế nào.' })));
      return;
    }
    $('pz-grid').replaceChildren(...list.map((p) => {
      const thumb = svgEl('svg', { role: 'img', 'aria-label': p.title });
      miniBoard(thumb, p.board, { flip: p.side === 'b' });
      return h('a', { class: 'pz-card', href: '#/puzzle/' + p.id }, thumb,
        h('div', { class: 'pz-info' }, h('b', { text: p.title }),
          h('div', { class: 'pz-tags' }, h('span', { class: 'diff ' + p.difficulty, text: DIFF_LABEL[p.difficulty] }), h('span', { class: 'topic', text: TOPIC_LABEL[p.topic] || 'Chiếu bí' }),
            `${colorName(p.side)} đi · ${p.moves} nước`, p.solved ? h('span', { class: 'solved-tag', text: '✓ Đã giải' }) : null)));
    }));
  }

  document.querySelectorAll('#pz-filter button').forEach((b) => b.addEventListener('click', () => {
    pz.filter = b.dataset.f;
    document.querySelectorAll('#pz-filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderPuzzleGrid();
  }));
  $('pz-unsolved').addEventListener('change', renderPuzzleGrid);
  $('pz-topic').addEventListener('change', () => { pz.topic = $('pz-topic').value; renderPuzzleGrid(); });

  function setPzFrame() {
    if (!pz.ui || !pz.ui.geo) return;
    const [, , w, h2] = pz.ui.geo.viewBox;
    $('pz-frame').style.setProperty('--pz-ar', (w / h2).toFixed(4));
  }

  async function openPuzzle(id) {
    pz.cur = null;
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
    pz.hints = 0;
    pz.attempts = 1;
    pz.revealed = false;
    pz.startedAt = Date.now();
    try { localStorage.setItem('tk-pz-last', puzzle.id); } catch { /* bỏ qua */ }
    updateCrumbs();
    if (!pz.ui) pz.ui = new window.BoardUI($('pz-board'), { theme, onClick: onPuzzleClick });
    pz.ui.theme = theme;
    pz.ui.flipped = puzzle.side === 'b';
    $('pz-title').textContent = puzzle.title;
    $('pz-meta').replaceChildren(h('span', { class: 'diff ' + puzzle.difficulty, text: DIFF_LABEL[puzzle.difficulty] }), h('span', { class: 'topic', text: TOPIC_LABEL[puzzle.topic] || 'Chiếu bí' }),
      `${puzzle.moves} nước · ${puzzle.solvedBy} người đã giải`);
    if (puzzle.solved) $('pz-meta').appendChild(h('span', { class: 'solved-tag', text: '✓ Bạn đã giải' }));
    $('pz-desc').textContent = puzzle.description || '';
    resetPuzzle();
    setPzFrame();
  }

  function pzStatus(html, cls = '') {
    $('pz-status').className = 'status-box ' + cls;
    $('pz-status').innerHTML = html;
  }
  const turnHtml = (s, text) => `<span class="turn-dot ${s}"></span>${text}`;

  function resetPuzzle() {
    const p = pz.cur;
    pz.board = p.board.map((row) => row.slice());
    pz.turn = p.side;
    pz.ply = 0;
    pz.played = [];
    pz.busy = false;
    pz.done = false;
    $('pz-summary').classList.add('hidden');
    pz.ui.set({ board: pz.board, selected: null, targets: [], lastMove: null, hint: null, flash: null });
    pzStatus(turnHtml(p.side, `Bạn cầm quân ${colorName(p.side)} — hãy tìm nước đi tốt nhất.`));
    renderPzMoves();
  }

  function renderPzMoves() {
    const list = $('pz-moves');
    list.replaceChildren();
    let b = pz.cur.board;
    const notes = pz.played.map((m) => { const n = X.notation(b, m.from, m.to); b = X.applyMove(b, m.from, m.to); return n; });
    for (let i = 0; i < notes.length; i += 2) {
      const li = h('li', {}, h('span', { class: 'no', text: i / 2 + 1 + '.' }));
      for (const k of [i, i + 1]) {
        li.appendChild(k < notes.length ? h('span', { class: (k % 2 === 0) === (pz.cur.side === 'r') ? 'r' : 'b', text: notes[k] }) : h('span'));
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
    pz.attempts++;
    pzStatus('✗ Chưa đúng — thử nước khác nhé.', 'bad');
    setTimeout(() => {
      pz.ui.set({ board: pz.board, lastMove: prev, flash: null });
      pz.busy = false;
    }, 800);
  }

  // Điểm bài giải: 100, trừ 20 mỗi gợi ý, 10 mỗi lần đi sai (tối thiểu 10); đã xem lời giải thì 0
  const pzScore = () => (pz.revealed ? 0 : Math.max(10, 100 - pz.hints * 20 - (pz.attempts - 1) * 10));
  async function puzzleSolved() {
    pz.done = true;
    const ms = Date.now() - pz.startedAt;
    pzStatus(`🎉 Chính xác! Bạn đã giải xong bài.`, 'ok');
    const cell = (k, v) => h('div', {}, h('small', { text: k }), h('b', { text: v }));
    $('pz-summary').replaceChildren(cell('Thời gian', fmtDuration(ms)), cell('Số lần thử', String(pz.attempts)), cell('Gợi ý', String(pz.hints)), cell('Điểm', String(pzScore())));
    $('pz-summary').classList.remove('hidden');
    try {
      const res = await fetchJson(`/api/puzzles/${pz.cur.id}/solve`, { method: 'POST', body: JSON.stringify({ moves: pz.played, ms, attempts: pz.attempts, hints: pz.hints }) });
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
    pz.revealed = true;
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
    const list = pzFiltered();
    const j = list.findIndex((p) => p.id === pz.cur.id);
    const next = (j >= 0 ? list.slice(j + 1).find((p) => !p.solved) : null) || pz.list.slice(i + 1).find((p) => !p.solved) || pz.list[i + 1];
    if (next) navigate('puzzle/' + next.id);
    else { toast('Bạn đã tới bài cuối cùng.'); navigate('puzzles'); }
  });

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
    sel.replaceChildren(new Option(state.review ? 'Ván đã lưu' : `Ván ${state.archive.length + 1} (đang chơi)`, 'live'));
    for (let i = state.archive.length - 1; i >= 0; i--) {
      const g = state.archive[i];
      const res = !g.result.winner ? 'hoà' : `${colorName(g.result.winner)} thắng`;
      sel.add(new Option(`Ván ${g.n}: ${g.players.r} vs ${g.players.b} — ${res}`, String(i)));
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
    list.replaceChildren();
    if (!notes.length) list.appendChild(h('li', { class: 'empty', text: 'Chưa có nước đi nào.' }));
    let current = null;
    for (let i = 0; i < notes.length; i += 2) {
      const li = h('li', {}, h('span', { class: 'no', text: i / 2 + 1 }));
      for (const k of [i, i + 1]) {
        if (k >= notes.length) { li.appendChild(h('span', { class: 'no' })); break; }
        const btn = h('button', { class: k % 2 === 0 ? 'r' : 'b', text: notes[k], onclick: () => goTo(k + 1) });
        const q = anEntry && classify(anEntry, k);
        if (q) btn.appendChild(h('span', { class: 'q q-' + q.key, title: q.label, text: q.sym }));
        if (v.ply === k + 1) { btn.classList.add('current'); current = btn; }
        btn.disabled = !reviewable;
        li.appendChild(btn);
      }
      list.appendChild(li);
    }
    if (game.result) list.appendChild(h('li', { class: 'result-line', text: resultText(game.result, game.players) }));
    if (current) {
      const lr = list.getBoundingClientRect(), cr = current.getBoundingClientRect();
      if (cr.top < lr.top) list.scrollTop -= lr.top - cr.top + 6;
      else if (cr.bottom > lr.bottom) list.scrollTop += cr.bottom - lr.bottom + 6;
    } else if (v.ply === 0) {
      list.scrollTop = 0;
    } else if (v.live) {
      list.scrollTop = list.scrollHeight;
    }
  }

  // ---------- Phân tích đánh giá từng nước ----------
  // Máy phân tích lần lượt từng thế cờ (Web Worker riêng), so nước đã đi với nước tốt nhất.
  const MATE = 30000;
  // Nhãn đánh giá theo tài liệu: Nước hay · Chính xác · Tốt · Không chính xác · Sai lầm · Bỏ lỡ chiến thuật
  const QUALITY = [
    { key: 'brilliant', sym: '!!', label: 'Nước hay' },
    { key: 'best', sym: '★', label: 'Chính xác', max: 10 },
    { key: 'good', sym: '✓', label: 'Tốt', max: 60 },
    { key: 'inacc', sym: '?!', label: 'Không chính xác', max: 150 },
    { key: 'mistake', sym: '?', label: 'Sai lầm', max: Infinity },
    { key: 'missed', sym: '✗', label: 'Bỏ lỡ chiến thuật' },
  ];
  const Q = Object.fromEntries(QUALITY.map((x) => [x.key, x]));
  const PIECE_VAL = { P: 1, A: 2, B: 2, N: 4, C: 4.5, R: 9, K: 100 };
  // Thí quân: quân (không phải Tốt/Tướng) đến ô bị đối phương ăn được và đổi lấy ít hơn giá trị của nó
  function isSacrifice(bd, m) {
    const piece = bd[m.from[0]][m.from[1]];
    if (!piece || piece[1] === 'P' || piece[1] === 'K') return false;
    const cap = bd[m.to[0]][m.to[1]];
    if (PIECE_VAL[piece[1]] <= (cap ? PIECE_VAL[cap[1]] : 0) + 1) return false;
    const after = X.applyMove(bd, m.from, m.to);
    const opp = X.other(piece[0]);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      if (after[r][c] && after[r][c][0] === opp && X.legalMovesFrom(after, r, c).some(([tr, tc]) => tr === m.to[0] && tc === m.to[1])) return true;
    }
    return false;
  }
  // Nước tốt nhất là ăn quân hoặc chiếu tướng
  function isTactical(bd, best, side) {
    return !!bd[best.to[0]][best.to[1]] || X.isInCheck(X.applyMove(bd, best.from, best.to), X.other(side));
  }
  const an = { worker: null, cache: new Map(), job: null, reqId: 0, aiSession: 0 };
  const clampScore = (v) => Math.max(-2000, Math.min(2000, v));

  function analysisKey(game) {
    const owner = state.review ? 'rv' + state.reviewId : state.ai ? 'ai' + an.aiSession : roomId;
    return `${owner}:${game.n}:${game.history.length}`;
  }

  // Kết quả phân tích của một ván; tự bắt đầu nếu chưa có
  function ensureAnalysis(game) {
    const key = analysisKey(game);
    let entry = an.cache.get(key);
    if (!entry) {
      entry = { key, results: [], total: game.history.length + 1, done: false };
      an.cache.set(key, entry);
    }
    if (!entry.done && (!an.job || an.job.key !== key)) startAnalysis(game, entry);
    return entry;
  }

  // Phân tích của ván đang xem (chỉ khi đang ở chế độ Phân tích)
  function analysisEntry() {
    if (!state || !analysisMode || !canReview()) return null;
    return ensureAnalysis(viewedGame());
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

  // Đánh giá nước thứ i (0 = nước đầu tiên của Đỏ); lưu sẵn vì được gọi lại mỗi lần vẽ
  function classify(entry, i) {
    const r = entry.results[i];
    if (!r || r.playedScore === null || r.playedScore === undefined) return null;
    const cache = entry.qc || (entry.qc = []);
    if (cache[i]) return cache[i];
    const loss = Math.max(0, clampScore(r.bestScore) - clampScore(r.playedScore));
    const m = viewedGame().history[i];
    const isBest = r.best && m && r.best.from[0] === m.from[0] && r.best.from[1] === m.from[1] && r.best.to[0] === m.to[0] && r.best.to[1] === m.to[1];
    const bd = m ? replayData(viewedGame()).boards[i] : null;
    let q;
    if (isBest || loss <= Q.best.max) q = isBest && bd && r.playedScore > -100 && isSacrifice(bd, m) ? Q.brilliant : Q.best;
    else if (loss >= 100 && r.bestScore >= 150 && r.best && bd && isTactical(bd, r.best, turnAt(i))) q = Q.missed;
    else q = [Q.good, Q.inacc, Q.mistake].find((x) => loss <= x.max);
    return (cache[i] = { ...q, loss });
  }

  // Tổng kết ván: 3 điểm làm tốt & 3 điểm cần cải thiện cho một bên
  function reviewPoints(entry, side, game) {
    const { notes, boards } = replayData(game);
    const mv = [];
    for (let i = 0; i < game.history.length; i++) {
      if (turnAt(i) !== side) continue;
      const q = classify(entry, i);
      if (q) mv.push({ i, ...q });
    }
    const good = [], bad = [];
    if (mv.length < 3) return { good, bad };
    const lbl = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${notes[i]}`;
    const accOf = (arr) => (arr.length ? Math.round(arr.reduce((t, x) => t + 100 * Math.exp(-x.loss / 350), 0) / arr.length) : null);
    const cnt = (k) => mv.filter((x) => x.key === k).length;
    const acc = accOf(mv);
    const brill = mv.filter((x) => x.key === 'brilliant');
    let run = 0, bestRun = { len: 0, end: 0 };
    for (const x of mv) {
      if (['brilliant', 'best', 'good'].includes(x.key)) { run++; if (run > bestRun.len) bestRun = { len: run, end: x.i }; } else run = 0;
    }
    const opening = mv.filter((x) => x.i < 20), middle = mv.filter((x) => x.i >= 20 && x.i < 60), ending = mv.filter((x) => x.i >= 60);
    const errors = (arr) => arr.filter((x) => x.key === 'mistake' || x.key === 'missed').length;
    const won = game.result && game.result.winner === side;

    if (brill.length) good.push(`Tìm ra ${brill.length} nước hay — tiêu biểu ${lbl(brill[0].i)}, thí quân đúng lúc.`);
    if (acc >= 80) good.push(`Độ chính xác cao: ${acc}% — phần lớn nước đi sát với đánh giá của máy.`);
    if (bestRun.len >= 5) good.push(`Chuỗi ${bestRun.len} nước tốt liên tiếp (đến ${lbl(bestRun.end)}).`);
    if (opening.length >= 5 && !errors(opening)) good.push('Khai cuộc chắc chắn — không mắc sai lầm trong 10 nước đầu.');
    if (!cnt('mistake') && !cnt('missed')) good.push('Không có sai lầm đáng kể nào trong cả ván.');
    if (cnt('best') + brill.length) good.push(`${cnt('best') + brill.length}/${mv.length} nước trùng với nước tốt nhất của máy.`);
    if (won && game.result.reason === 'checkmate') good.push('Dứt điểm gọn bằng chiếu bí.');
    else if (won) good.push('Giữ vững ưu thế đến khi giành chiến thắng.');
    const phases = [['Khai cuộc', opening], ['Trung cuộc', middle], ['Tàn cuộc', ending]].filter(([, a]) => a.length >= 3).map(([n, a]) => [n, accOf(a)]).sort((a, b) => a[1] - b[1]);
    if (phases.length >= 2) good.push(`${phases[phases.length - 1][0]} là giai đoạn chơi tốt nhất (độ chính xác ${phases[phases.length - 1][1]}%).`);
    good.push(`Hoàn thành ván ${mv.length} nước với độ chính xác ${acc}%.`);

    const worst = [...mv].sort((a, b) => b.loss - a.loss)[0];
    if (worst && worst.loss > 60) {
      const r = entry.results[worst.i];
      bad.push(`${lbl(worst.i)} là nước ${worst.label.toLowerCase()} (mất ${(Math.min(worst.loss, 2000) / 100).toFixed(1)} điểm)${r && r.best ? ` — nên đi ${X.notation(boards[worst.i], r.best.from, r.best.to)}` : ''}.`);
    }
    const missed = mv.filter((x) => x.key === 'missed');
    if (missed.length) bad.push(`Bỏ lỡ ${missed.length} cơ hội chiến thuật (ăn quân / chiếu tướng), ví dụ ${lbl(missed[0].i)} — luôn kiểm tra nước bắt quân và chiếu trước khi đi.`);
    if (phases.length >= 2 && phases[0][1] < 80) bad.push(`${phases[0][0]} là giai đoạn yếu nhất (độ chính xác ${phases[0][1]}%)${phases[0][0] === 'Tàn cuộc' ? ' — luyện thêm cờ thế tàn cuộc' : phases[0][0] === 'Khai cuộc' ? ' — ôn lại các thế khai cuộc quen thuộc' : ' — chú ý tính toán khi giao tranh'}.`);
    if (cnt('inacc') >= 3) bad.push(`${cnt('inacc')} nước không chính xác — dành thêm thời gian so sánh 2–3 phương án.`);
    if (game.result && game.result.reason === 'timeout' && !won) bad.push('Thua vì hết giờ — chia thời gian đều hơn cho mỗi nước.');
    bad.push('Giải cờ thế mỗi ngày để nhìn ra chiến thuật nhanh hơn.', 'Đấu máy ở cấp cao hơn một bậc để thử thách bản thân.');
    return { good: [...new Set(good)].slice(0, 3), bad: [...new Set(bad)].slice(0, 3) };
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
      return h('div', { class: 'an-row' },
        h('div', { class: 'who' }, h('i', { class: 'dot ' + side }), h('span', { text: (game.players && game.players[side]) || colorName(side) })),
        h('span', { class: 'acc', title: 'Độ chính xác', text: cnt ? `${Math.round(accSum / cnt)}%` : '—' }),
        h('span', { class: 'counts' }, QUALITY.filter((x) => x.key !== 'good').map((x) => h('span', { title: x.label },
          h('span', { class: 'q q-' + x.key, text: x.sym }), ' ' + counts[x.key]))));
    });
    $('an-summary').replaceChildren(...rows);

    // Tổng kết 3 điểm tốt / 3 điểm cần cải thiện (khi máy đã chấm xong)
    const rvBox = $('an-review');
    const rvSide = myColor || state.you || 'r';
    const rv = entry.done ? reviewPoints(entry, rvSide, game) : null;
    rvBox.classList.toggle('hidden', !rv || !rv.good.length);
    if (rv && rv.good.length) {
      const who = (game.players && game.players[rvSide]) || colorName(rvSide);
      rvBox.replaceChildren(h('b', { class: 'an-rv-title', text: `Tổng kết cho ${who}${rvSide === myColor ? ' (bạn)' : ''}` }),
        h('div', { class: 'an-rv good' }, h('small', { text: 'Làm tốt' }), h('ul', {}, rv.good.map((t) => h('li', { text: t })))),
        h('div', { class: 'an-rv bad' }, h('small', { text: 'Cần cải thiện' }), h('ul', {}, rv.bad.map((t) => h('li', { text: t })))));
    }

    // Biểu đồ thế trận (trên = Đỏ ưu thế, dưới = Đen ưu thế)
    const chart = $('an-chart');
    const W = 300, H = 60, N = Math.max(1, total - 1);
    const y = (val) => H / 2 - (clampScore(val) / 1200) * (H / 2 - 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const e = redEval(entry, i);
      pts.push(`${((i / N) * W).toFixed(1)},${Math.max(2, Math.min(H - 2, y(e))).toFixed(1)}`);
    }
    chart.replaceChildren();
    svgEl('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'zero' }, chart);
    if (pts.length > 1) {
      const lastX = pts[pts.length - 1].split(',')[0];
      svgEl('polygon', { points: `0,${H / 2} ${pts.join(' ')} ${lastX},${H / 2}`, class: 'area' }, chart);
      svgEl('polyline', { points: pts.join(' '), class: 'line' }, chart);
    }
    const cx = (v.ply / N) * W;
    svgEl('line', { x1: cx, y1: 0, x2: cx, y2: H, class: 'cursor' }, chart);

    // Nhận xét nước đang xem
    const detail = $('an-detail');
    detail.replaceChildren();
    const { boards, notes } = replayData(game);
    const line = (cls) => detail.appendChild(h('div', { class: cls || null }));
    const cur = entry.results[v.ply];
    if (v.ply === 0) {
      line().textContent = 'Thế cờ ban đầu.';
    } else {
      const i = v.ply - 1;
      const q = classify(entry, i);
      const head = line();
      head.appendChild(h('b', { text: `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${notes[i]}` }));
      if (q) {
        head.append(' ', h('span', { class: 'q q-' + q.key, text: q.sym }), ' ' + q.label);
        const r = entry.results[i];
        if (q.key !== 'best' && r.best) head.append(' · Nước tốt hơn: ', h('b', { text: X.notation(boards[i], r.best.from, r.best.to) }));
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
    const where = roomId ? 'Phòng ' + roomId : state.ai ? 'Đấu máy' : 'Xem lại';
    const lines = [
      `Tượng Kỳ — ${where} — Ván ${game.n}`,
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
    a.download = `tuong-ky-${roomId || (state.ai ? 'dau-may' : 'xem-lai')}-van-${game.n}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- Trò chuyện ----------
  let chatCount = 0;
  function renderChatHistory(list) {
    $('chat-log').replaceChildren();
    chatCount = 0;
    if (!list.length) $('chat-log').appendChild(h('div', { class: 'empty', text: 'Chưa có tin nhắn.' }));
    list.forEach(addChat);
  }

  function addChat(msg) {
    const log = $('chat-log');
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    if (msg.system) {
      log.appendChild(h('div', { class: 'sys', text: msg.text }));
    } else {
      chatCount++;
      log.appendChild(h('div', { class: 'msg' }, h('b', { class: msg.color || 's', text: msg.name + ': ' }), msg.text));
    }
    $('chat-count').textContent = chatCount ? `${chatCount} tin nhắn` : '';
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
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
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

  // ---------- Khởi động ----------
  renderAuth();
  if (!urlRoom) route();
  if (session) accountApi('GET', '/me').then(onMe).catch(() => {});
})();
