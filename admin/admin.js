(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const BR = window.BoardRender;
  const XQ = window.Xiangqi;
  const { rankOf } = window.Ranks;
  const NS = 'http://www.w3.org/2000/svg';
  let data = null;
  let feedbackList = [];
  let refreshTimer = null;

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch('/admin/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/login') {
      showLogin();
      throw new Error(json.error || 'Chưa đăng nhập.');
    }
    // 404 không kèm lỗi = server đang chạy code cũ (chưa có API của trang mới)
    if (res.status === 404 && !json.error) throw new Error('Server đang chạy bản cũ — hãy khởi động lại server để dùng mục này.');
    if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra.');
    return json;
  }

  // ---------- Đăng nhập ----------
  function showLogin() {
    clearInterval(refreshTimer);
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('password').focus();
  }

  function showApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    route();
    load();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (!document.hidden) load(); }, 5000);
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-err').textContent = '';
    try {
      await api('POST', '/login', { password: $('password').value });
      $('password').value = '';
      showApp();
    } catch (err) {
      $('login-err').textContent = err.message;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('POST', '/logout').catch(() => {});
    showLogin();
  });

  // ---------- Tiện ích ----------
  const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('vi-VN') : '—');
  const fmtDT = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
  function ago(t) {
    if (!t) return '—';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'vừa xong';
    if (s < 3600) return Math.floor(s / 60) + ' phút trước';
    if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    if (s < 30 * 86400) return Math.floor(s / 86400) + ' ngày trước';
    return fmtDate(t);
  }
  const winrate = (u) => (u.games ? u.wins / u.games : -1);
  const initials = (name) => {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)) || '?').toUpperCase();
  };
  // Nhịp chơi như trên trang chơi: 10+0, 15+10, ∞
  const tcShort = (st) => (!st || (!st.totalMs && !st.moveMs) ? 'Không giới hạn'
    : (st.totalMs ? `${st.totalMs / 60000}+${(st.incMs || 0) / 1000}` : '') + (st.moveMs ? `${st.totalMs ? ' · ' : ''}${st.moveMs / 1000}s/nước` : ''));

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function icon(name, cls = '') {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', ('ico ' + cls).trim());
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }
  function avatarEl(u, cls = '') {
    const a = h('span', { class: ('avatar ' + cls).trim() });
    const text = initials(u.name || u.displayName);
    if (u.avatar) a.appendChild(h('img', { src: u.avatar, alt: '', onerror: () => { a.textContent = text; } }));
    else a.textContent = text;
    return a;
  }
  const rankTag = (rating) => h('span', { class: 'tag' }, `${fmt(rating)} · ${rankOf(rating).label}`);
  const watchHref = (id) => `/?room=${id}&watch=1`;
  const userHref = (id) => '#user/' + encodeURIComponent(id);
  const openUser = (id) => { location.hash = userHref(id); };

  // ---------- Dữ liệu ----------
  async function load() {
    try {
      [data, { feedback: feedbackList }] = await Promise.all([api('GET', '/overview'), api('GET', '/feedback')]);
      renderStorage();
      render();
    } catch (err) {
      if (!$('app').classList.contains('hidden')) toast(err.message);
    }
  }

  // Nơi lưu dữ liệu (thanh trên): File JSON / Supabase, báo lỗi nếu đồng bộ thất bại
  function renderStorage() {
    const st = data.storage || { name: 'file' };
    const name = st.name === 'supabase' ? 'Supabase' : 'File JSON';
    const box = $('updated');
    box.parentElement.title = st.label || '';
    box.parentElement.querySelector('.dot').classList.toggle('on', !st.lastError);
    box.parentElement.classList.toggle('error', !!st.lastError);
    box.textContent = st.lastError ? `${name}: lỗi đồng bộ — ${st.lastError}` : `${name} · cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
  }

  function render() {
    renderStats();
    renderOverview();
    renderUsers();
    renderRooms();
  }

  // ---------- Tổng quan ----------
  function renderStats() {
    const s = data.stats;
    const card = (label, value, sub, cls = '') => h('div', { class: 'stat-card ' + cls }, h('small', {}, label), h('b', {}, value), h('em', {}, sub));
    $('stats').replaceChildren(
      card('Kỳ thủ', fmt(s.users), `+${s.newToday} hôm nay · ${s.banned} bị khoá`),
      card('Đang online', fmt(s.online), 'Kể cả khách', 'ok'),
      card('Ván đang diễn ra', fmt(s.playing), `${s.rooms} phòng đang mở`),
      card('Đang tìm trận', fmt(s.searching), 'Trong hàng chờ ghép'),
      card('Ván đã chơi', fmt(s.gamesPlayed), 'Ván online từ trước đến nay'),
      card('Xu đang lưu hành', fmt(s.coins), s.users ? `TB ${fmt(Math.round(s.coins / s.users))} xu / kỳ thủ` : '—', 'gold'),
    );
    $('c-users').textContent = s.users;
    $('c-rooms').textContent = s.rooms;
    $('c-puzzles').textContent = s.puzzles;
    $('c-feedback').textContent = s.feedback;
    $('c-feedback').classList.toggle('alert', s.reports > 0);
    $('c-feedback').title = s.reports ? `${s.reports} báo cáo kỳ thủ` : '';
    $('c-tours').textContent = s.tournaments;
  }

  const ROOM_TYPE = { rated: ['Xếp hạng', 'tag'], match: ['Ghép trận', 'tag blue'], coin: ['Chơi nhanh', 'tag gold'], tournament: ['Giải đấu', 'tag dark'], private: ['Phòng riêng', 'tag soft'] };
  const STATUS = { waiting: ['Chờ đối thủ', 'tag gold'], playing: ['Đang chơi', 'tag green'], finished: ['Đã kết thúc', 'tag soft'] };
  const typeTag = (t) => h('span', { class: ROOM_TYPE[t][1] }, ROOM_TYPE[t][0]);
  const statusTag = (s) => h('span', { class: STATUS[s][1] }, STATUS[s][0]);

  function renderOverview() {
    const empty = (text) => h('div', { class: 'mini-empty' }, text);
    const seat = (p, c) => h('span', {}, h('i', { class: 'side-dot ' + c }), p ? p.name : 'Trống', p && p.rating ? h('em', {}, fmt(p.rating)) : null);

    const live = data.rooms.filter((r) => r.status === 'playing').sort((a, b) => b.spectators - a.spectators || b.moves - a.moves).slice(0, 6);
    $('ov-live').replaceChildren(...(live.length ? live.map((r) => h('div', { class: 'mini-row' },
      h('div', { class: 'vs-mini' }, seat(r.players.r, 'r'), seat(r.players.b, 'b')),
      typeTag(r.type),
      h('span', { class: 'muted small' }, `Nước ${r.moves} · ${tcShort(r.settings)}`),
      h('a', { class: 'btn sm', href: watchHref(r.id), target: '_blank', rel: 'noopener' }, icon('eye', 'sm'), r.spectators))) : [empty('Chưa có ván nào đang diễn ra.')]));

    const online = data.users.filter((u) => u.online).slice(0, 6);
    $('ov-online').replaceChildren(...(online.length ? online.map((u) => h('div', { class: 'mini-row' },
      avatarEl(u), h('a', { class: 'grow link-name', href: userHref(u.id) }, u.name, h('span', { class: 'muted' }, ' @' + u.username)),
      u.roomId ? h('a', { class: 'room-link', href: watchHref(u.roomId), target: '_blank', rel: 'noopener' }, u.roomId) : h('span', { class: 'muted small' }, 'Ở sảnh'))) : [empty('Không có tài khoản nào đang online.')]));

    const top = data.users.filter((u) => u.games > 0 && !u.banned).sort((a, b) => b.rating - a.rating).slice(0, 5);
    $('ov-top').replaceChildren(...(top.length ? top.map((u, i) => h('div', { class: 'mini-row' },
      h('span', { class: 'rank-no' }, i + 1), avatarEl(u), h('a', { class: 'grow link-name', href: userHref(u.id) }, u.name),
      h('b', {}, fmt(u.rating)))) : [empty('Chưa có ván xếp hạng nào.')]));

    const fresh = [...data.users].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    $('ov-new').replaceChildren(...(fresh.length ? fresh.map((u) => h('div', { class: 'mini-row' },
      avatarEl(u), h('a', { class: 'grow link-name', href: userHref(u.id) }, u.name, h('span', { class: 'muted' }, ' @' + u.username)),
      h('span', { class: 'muted small' }, ago(u.createdAt)))) : [empty('Chưa có tài khoản nào.')]));

    const fb = [...feedbackList].sort((a, b) => b.at - a.at).slice(0, 4);
    $('ov-feedback').replaceChildren(...(fb.length ? fb.map((f) => h('div', { class: 'mini-row' },
      h('span', { class: 'grow' }, h('b', {}, f.name), h('span', { class: 'muted' }, ' · ' + f.message)),
      h('span', { class: 'muted small' }, ago(f.at)))) : [empty('Chưa có góp ý nào.')]));
  }

  // ---------- Kỳ thủ ----------
  function renderUsers() {
    const q = $('search').value.trim().toLowerCase();
    const filter = $('filter').value;
    const sort = $('sort').value;
    const list = data.users.filter((u) =>
      (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'online' && u.online) || (filter === 'banned' && u.banned) || (filter === 'lowcredit' && u.credit < 1000)));
    const key = {
      lastSeen: (u) => u.lastSeen, createdAt: (u) => u.createdAt, games: (u) => u.games + u.aiGames,
      winrate, rating: (u) => u.rating, coins: (u) => u.coins, credit: (u) => u.credit, puzzles: (u) => u.puzzlesSolved,
    };
    list.sort((a, b) => (b.online - a.online) * (sort === 'lastSeen') || key[sort](b) - key[sort](a));

    const body = $('users-body');
    if (!list.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 9 }, h('div', { class: 'empty' },
        data.users.length ? 'Không có kỳ thủ phù hợp.' : 'Chưa có tài khoản nào. Tài khoản sẽ xuất hiện khi người chơi đăng ký.'))));
      return;
    }
    body.replaceChildren(...list.map((u) => h('tr', { class: 'row-link', tabindex: 0, onclick: () => openUser(u.id), onkeydown: (e) => { if (e.key === 'Enter') openUser(u.id); } },
      h('td', {}, h('div', { class: 'player-cell' }, avatarEl(u),
        h('span', {}, h('b', {}, u.name, ' ', u.banned && h('span', { class: 'tag' }, 'Bị khoá')), h('small', {}, '@' + u.username + (u.region ? ' · ' + u.region : ''))))),
      h('td', { 'data-label': 'Elo · hạng' }, rankTag(u.rating)),
      h('td', { 'data-label': 'Trạng thái' },
        h('span', {}, h('span', { class: 'dot' + (u.online ? ' on' : '') }), ' ', u.online ? 'Online' : 'Offline',
          u.roomId && [' · ', h('a', { class: 'room-link', href: watchHref(u.roomId), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, u.roomId)])),
      h('td', { 'data-label': 'Online T-T-H', class: 'wld' },
        h('span', {}, h('b', {}, u.wins), ' - ', h('i', {}, u.losses), ' - ', u.draws,
          h('span', { class: 'muted' }, u.games ? ` · ${Math.round((u.wins / u.games) * 100)}%` : ''))),
      h('td', { 'data-label': 'Xu', class: 'num' }, fmt(u.coins)),
      h('td', { 'data-label': 'Uy tín', class: 'num' + (u.credit < 1000 ? ' warn' : '') }, u.credit),
      h('td', { 'data-label': 'Cờ thế', class: 'num' }, u.puzzlesSolved),
      h('td', { 'data-label': 'Hoạt động' }, u.online ? 'Đang online' : ago(u.lastSeen)),
      h('td', { class: 'actions-cell' }, h('span', { class: 'chev' }, 'Chi tiết ›')),
    )));
  }
  for (const id of ['search', 'filter', 'sort']) $(id).addEventListener('input', () => data && renderUsers());

  // ---------- Phòng & trận đấu ----------
  let roomFilter = 'all';
  function renderRooms() {
    $('queue-info').textContent = `${data.stats.searching} người đang tìm trận · ${data.stats.rooms} phòng`;
    const list = data.rooms.filter((r) => roomFilter === 'all' || r.status === roomFilter || r.type === roomFilter)
      .sort((a, b) => (b.status === 'playing') - (a.status === 'playing') || b.createdAt - a.createdAt);
    const body = $('rooms-body');
    if (!list.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 9 }, h('div', { class: 'empty' }, data.rooms.length ? 'Không có phòng phù hợp.' : 'Hiện không có phòng nào.'))));
      return;
    }
    const seatCell = (p, c) => (p ? h('span', { class: 'seat-cell' }, h('i', { class: 'side-dot ' + c }), h('span', { class: 'dot' + (p.online ? ' on' : '') }),
      p.accountId ? h('a', { class: 'link-name', href: userHref(p.accountId) }, p.name) : p.name, p.rating ? h('em', {}, fmt(p.rating)) : h('em', {}, 'khách'))
      : h('span', { class: 'muted' }, 'Trống'));
    body.replaceChildren(...list.map((r) => h('tr', {},
      h('td', {}, h('a', { class: 'room-link', href: watchHref(r.id), target: '_blank', rel: 'noopener' }, r.id)),
      h('td', { 'data-label': 'Loại · nhịp' }, typeTag(r.type), ' ', h('span', { class: 'muted small' }, tcShort(r.settings)),
        r.stake ? h('div', { class: 'sub' }, `Cược ${fmt(r.stake)} xu`) : null,
        r.tournament ? h('div', { class: 'sub' }, h('a', { class: 'link-name', href: '#tournament/' + r.tournament.id }, r.tournament.name), ` · vòng ${r.tournament.round}`) : null),
      h('td', { 'data-label': 'Đỏ' }, seatCell(r.players.r, 'r')),
      h('td', { 'data-label': 'Đen' }, seatCell(r.players.b, 'b')),
      h('td', { 'data-label': 'Trạng thái' }, statusTag(r.status)),
      h('td', { 'data-label': 'Nước', class: 'num' }, r.moves, r.gamesFinished ? h('div', { class: 'sub' }, `${r.gamesFinished} ván xong`) : ''),
      h('td', { 'data-label': 'Người xem', class: 'num' }, r.spectators),
      h('td', { 'data-label': 'Tạo lúc' }, ago(r.createdAt)),
      h('td', { class: 'actions-cell' }, h('div', { class: 'row-actions' },
        h('a', { class: 'btn sm', href: watchHref(r.id), target: '_blank', rel: 'noopener' }, icon('eye', 'sm'), 'Xem'),
        h('button', { class: 'btn sm danger', onclick: () => closeRoom(r) }, 'Đóng phòng'))),
    )));
  }
  document.querySelectorAll('#room-filter button').forEach((b) => b.addEventListener('click', () => {
    roomFilter = b.dataset.f;
    document.querySelectorAll('#room-filter button').forEach((x) => x.classList.toggle('active', x === b));
    if (data) renderRooms();
  }));

  function closeRoom(r) {
    if (!confirm(`Đóng phòng ${r.id}? Mọi người trong phòng sẽ được đưa về trang chủ.`)) return;
    act(() => api('DELETE', `/rooms/${encodeURIComponent(r.id)}`), 'Đã đóng phòng.');
  }

  async function act(fn, okMsg) {
    try {
      await fn();
      toast(okMsg);
      load();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Bảng xếp hạng ----------
  let rankBy = 'rating';
  const RANK_COL = { rating: 'Elo', season: 'Điểm danh vọng', streak: 'Chuỗi thắng tốt nhất', coin: 'Ván thắng Chơi nhanh', puzzles: 'Cờ thế đã giải' };
  async function loadRanking() {
    $('rank-col').textContent = RANK_COL[rankBy];
    let board;
    try {
      board = await fetch('/api/leaderboard?by=' + rankBy).then((r) => r.json());
      if (!data) data = await api('GET', '/overview');
    } catch (err) { return toast(err.message); }
    const idOf = new Map(data.users.map((u) => [u.username, u.id]));
    const body = $('rank-body');
    if (!board.players.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, h('div', { class: 'empty' }, 'Chưa có ai trên bảng này.'))));
      return;
    }
    body.replaceChildren(...board.players.map((p) => {
      const id = idOf.get(p.username);
      return h('tr', { class: id ? 'row-link' : '', onclick: () => id && openUser(id) },
        h('td', {}, h('b', {}, '#' + p.rank)),
        h('td', {}, h('div', { class: 'player-cell' }, avatarEl(p), h('span', {}, h('b', {}, p.displayName), h('small', {}, '@' + p.username + ' · ' + rankOf(p.rating).label)))),
        h('td', { 'data-label': RANK_COL[rankBy], class: 'num' }, h('b', {}, rankBy === 'rating' ? fmt(p.rating) : fmt(p.value))),
        h('td', { 'data-label': 'Ván online', class: 'num' }, p.games),
        h('td', { 'data-label': 'Tỉ lệ thắng', class: 'num' }, p.games ? Math.round((p.wins / p.games) * 100) + '%' : '—'),
        h('td', { 'data-label': 'Khu vực' }, p.region || h('span', { class: 'muted' }, '—')));
    }));
  }
  document.querySelectorAll('#rank-tabs button').forEach((b) => b.addEventListener('click', () => {
    rankBy = b.dataset.by;
    document.querySelectorAll('#rank-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    loadRanking();
  }));

  // ---------- Giải đấu ----------
  const TOUR_STATUS = { open: ['Mở đăng ký', 'tag green'], checkin: ['Đang check-in', 'tag gold'], running: ['Đang thi đấu', 'tag'], finished: ['Đã kết thúc', 'tag soft'], cancelled: ['Đã huỷ', 'tag soft'] };
  const FORMAT = { knockout: 'Loại trực tiếp', roundrobin: 'Vòng tròn', swiss: 'Hệ Thụy Sĩ' };
  const FORMAT_MAX = { knockout: 64, roundrobin: 10, swiss: 64 };
  let tourList = [];
  let tourFilter = 'active';
  let tourCur = null;
  const tourTag = (st) => h('span', { class: TOUR_STATUS[st][1] }, TOUR_STATUS[st][0]);
  const localInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

  async function loadTournaments() {
    try { ({ tournaments: tourList } = await api('GET', '/tournaments')); } catch (err) { return toast(err.message); }
    renderTournamentList();
  }
  function renderTournamentList() {
    const list = tourList.filter((t) => tourFilter === 'all' || (tourFilter === 'active' ? ['open', 'checkin', 'running'].includes(t.status) : ['finished', 'cancelled'].includes(t.status)))
      .sort((a, b) => (tourFilter === 'done' ? (b.finishedAt || b.startAt) - (a.finishedAt || a.startAt) : a.startAt - b.startAt));
    const body = $('tour-body');
    if (!list.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 8 }, h('div', { class: 'empty' }, tourList.length ? 'Không có giải phù hợp.' : 'Chưa có giải nào. Bấm "Tạo giải" để mở giải đầu tiên.'))));
      return;
    }
    body.replaceChildren(...list.map((t) => h('tr', { class: 'row-link', onclick: () => { location.hash = '#tournament/' + t.id; } },
      h('td', {}, h('b', {}, t.name), h('div', { class: 'sub' }, FORMAT[t.format] + (t.winner ? ` · Vô địch: ${t.winner}` : ''))),
      h('td', { 'data-label': 'Trạng thái' }, tourTag(t.status)),
      h('td', { 'data-label': 'Bắt đầu' }, fmtDT(t.startAt)),
      h('td', { 'data-label': 'Kỳ thủ', class: 'num' }, `${t.players}/${t.maxPlayers}`),
      h('td', { 'data-label': 'Nhịp' }, `${t.tc.totalMin}+${t.tc.incSec}`),
      h('td', { 'data-label': 'Lệ phí · thưởng' }, t.entryFee ? `${fmt(t.entryFee)} xu` : 'Miễn phí', h('div', { class: 'sub' }, t.prizes.filter(Boolean).map(fmt).join(' / ') || 'Không thưởng xu')),
      h('td', { 'data-label': 'Vòng', class: 'num' }, t.rounds.length ? `${t.rounds.length}/${t.totalRounds || '?'}` : (t.totalRounds || '—')),
      h('td', { class: 'actions-cell' }, h('div', { class: 'row-actions' }, tourActions(t, true))))));
  }
  document.querySelectorAll('#tour-filter button').forEach((b) => b.addEventListener('click', () => {
    tourFilter = b.dataset.f;
    document.querySelectorAll('#tour-filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderTournamentList();
  }));
  $('tour-new').addEventListener('click', () => tourForm(null));

  function tourActions(t, compact) {
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const acts = [];
    if (['open', 'checkin'].includes(t.status)) {
      acts.push(h('button', { class: 'btn sm', onclick: stop(() => tourForm(t)) }, 'Sửa'));
      acts.push(h('button', { class: 'btn sm primary', onclick: stop(() => tourDo(t, 'start', `Bắt đầu "${t.name}" ngay? Mọi người đã đăng ký (${t.players}) đều được tham gia, không cần check-in.`, 'Đã bắt đầu giải.')) }, 'Bắt đầu ngay'));
    }
    if (['open', 'checkin', 'running'].includes(t.status)) acts.push(h('button', { class: 'btn sm danger', onclick: stop(() => tourDo(t, 'cancel', `Huỷ giải "${t.name}"? Lệ phí sẽ được hoàn cho ${t.players} kỳ thủ và các bàn đang chơi bị đóng.`, 'Đã huỷ giải.')) }, 'Huỷ giải'));
    else acts.push(h('button', { class: 'btn sm danger', onclick: stop(() => tourDo(t, 'delete', `Xoá vĩnh viễn giải "${t.name}" khỏi danh sách?`, 'Đã xoá giải.')) }, 'Xoá'));
    if (compact) acts.push(h('span', { class: 'chev' }, 'Chi tiết ›'));
    return acts;
  }
  async function tourDo(t, action, question, okMsg) {
    if (!confirm(question)) return;
    try {
      if (action === 'delete') { await api('DELETE', `/tournaments/${t.id}`); toast(okMsg); location.hash = '#tournaments'; loadTournaments(); return; }
      const { tournament } = await api('POST', `/tournaments/${t.id}/${action}`);
      toast(okMsg);
      if (tourCur && tourCur.id === t.id) { tourCur = tournament; renderTourDetail(); }
      loadTournaments();
      load();
    } catch (err) { toast(err.message); }
  }

  // Biểu mẫu tạo / sửa giải
  function tourForm(t) {
    const v = t || { name: '', description: '', format: 'swiss', maxPlayers: 16, totalRounds: 5, tc: { totalMin: 10, incSec: 5 }, entryFee: 0, prizes: [300, 150, 80], startAt: Date.now() + 3600e3, checkinMin: 15, noShowMin: 5 };
    const inp = (name, value, attrs = {}) => h('input', { name, value: value ?? '', autocomplete: 'off', ...attrs });
    const f = {
      name: inp('name', v.name, { maxlength: 80, required: true, placeholder: 'VD: Cúp Sĩ Tượng Kỳ mùa thu' }),
      description: h('textarea', { name: 'description', rows: 2, maxlength: 600, placeholder: 'Thể lệ, đối tượng, ghi chú…' }),
      format: h('select', { name: 'format' }, ...Object.entries(FORMAT).map(([k, label]) => { const o = h('option', { value: k }, label); o.selected = v.format === k; return o; })),
      maxPlayers: inp('maxPlayers', v.maxPlayers, { type: 'number', min: 2, max: 64 }),
      roundCount: inp('roundCount', v.totalRounds || 5, { type: 'number', min: 1, max: 9 }),
      startAt: inp('startAt', localInput(v.startAt), { type: 'datetime-local', required: true }),
      totalMin: inp('totalMin', v.tc.totalMin, { type: 'number', min: 1, max: 60 }),
      incSec: inp('incSec', v.tc.incSec, { type: 'number', min: 0, max: 10 }),
      entryFee: inp('entryFee', v.entryFee, { type: 'number', min: 0 }),
      p1: inp('p1', v.prizes[0], { type: 'number', min: 0 }), p2: inp('p2', v.prizes[1], { type: 'number', min: 0 }), p3: inp('p3', v.prizes[2], { type: 'number', min: 0 }),
      checkinMin: inp('checkinMin', v.checkinMin, { type: 'number', min: 0, max: 120 }),
      noShowMin: inp('noShowMin', v.noShowMin, { type: 'number', min: 1, max: 30 }),
    };
    f.description.value = v.description || '';
    const roundsField = h('label', { class: 'field' }, h('span', {}, 'Số vòng (Thụy Sĩ)'), f.roundCount);
    const maxHint = h('small', { class: 'muted' });
    const syncFormat = () => {
      roundsField.classList.toggle('hidden', f.format.value !== 'swiss');
      f.maxPlayers.max = FORMAT_MAX[f.format.value];
      maxHint.textContent = `Tối đa ${FORMAT_MAX[f.format.value]} kỳ thủ`;
    };
    f.format.addEventListener('change', syncFormat);
    syncFormat();
    const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint || null);
    const err = h('p', { class: 'form-err' });
    const close = () => modal.remove();
    const form = h('form', { class: 'ud-form', onsubmit: async (e) => {
      e.preventDefault();
      const n = (el) => Number(el.value);
      const body = {
        name: f.name.value, description: f.description.value, format: f.format.value, maxPlayers: n(f.maxPlayers), roundCount: n(f.roundCount),
        startAt: new Date(f.startAt.value).getTime(), tc: { totalMin: n(f.totalMin), incSec: n(f.incSec) }, entryFee: n(f.entryFee),
        prizes: [n(f.p1), n(f.p2), n(f.p3)], checkinMin: n(f.checkinMin), noShowMin: n(f.noShowMin),
      };
      try {
        const { tournament } = t ? await api('PUT', `/tournaments/${t.id}`, body) : await api('POST', '/tournaments', body);
        close();
        toast(t ? 'Đã lưu giải.' : 'Đã tạo giải — người chơi đã có thể đăng ký.');
        if (tourCur && tourCur.id === tournament.id) { tourCur = tournament; renderTourDetail(); }
        loadTournaments();
        load();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, t ? 'Sửa giải đấu' : 'Tạo giải đấu'),
      field('Tên giải', f.name), field('Mô tả', f.description),
      h('div', { class: 'tf-grid' },
        field('Thể thức', f.format), field('Số kỳ thủ tối đa', f.maxPlayers, maxHint), roundsField,
        h('label', { class: 'field span2' }, h('span', {}, 'Bắt đầu lúc'), f.startAt), field('Check-in trước (phút)', f.checkinMin),
        field('Phút mỗi bên', f.totalMin), field('Giây cộng mỗi nước', f.incSec), field('Chờ vào bàn (phút)', f.noShowMin, h('small', { class: 'muted' }, 'Quá giờ bị xử thua'))),
      h('div', { class: 'tf-grid four' }, field('Lệ phí (xu)', f.entryFee, h('small', { class: 'muted' }, 'Hoàn nếu rút lui / huỷ')), field('Thưởng hạng 1', f.p1), field('Thưởng hạng 2', f.p2), field('Thưởng hạng 3', f.p3)),
      err,
      h('div', { class: 'ud-form-acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Huỷ'), h('button', { class: 'btn primary' }, t ? 'Lưu' : 'Tạo giải')));
    const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } }, h('div', { class: 'modal-card wide' }, form));
    document.body.appendChild(modal);
    setTimeout(() => f.name.focus(), 0);
  }

  // Chi tiết giải (#tournament/<mã>)
  let tourTimer = null;
  async function openTourDetail(id) {
    showPage('tournament');
    if (!tourCur || tourCur.id !== id) $('tour-detail').replaceChildren(h('p', { class: 'muted' }, 'Đang tải…'));
    try {
      ({ tournament: tourCur } = await api('GET', `/tournaments`).then((d) => ({ tournament: d.tournaments.find((t) => t.id === id) })));
    } catch (err) { return toast(err.message); }
    if (!tourCur) { toast('Không tìm thấy giải.'); location.hash = '#tournaments'; return; }
    $('page-title').textContent = tourCur.name;
    renderTourDetail();
    clearInterval(tourTimer);
    tourTimer = setInterval(() => {
      if (!location.hash.startsWith('#tournament/') || document.hidden) { if (!location.hash.startsWith('#tournament/')) clearInterval(tourTimer); return; }
      api('GET', '/tournaments').then((d) => { const t = d.tournaments.find((x) => x.id === id); if (t) { tourCur = t; renderTourDetail(); } }).catch(() => {});
    }, 8000);
  }
  function renderTourDetail() {
    const t = tourCur;
    const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    const nameOf = (pid) => (t.standings.find((p) => p.id === pid) || {}).name || '—';
    const score = (pr) => (!pr.b ? 'Miễn đấu' : pr.status === 'playing' ? 'Đang đấu' : pr.status === 'pending' ? 'Chờ vào bàn' : { r: '1 – 0', b: '0 – 1', draw: '½ – ½', double: '0 – 0' }[pr.result] || '—');
    $('tour-detail').replaceChildren(
      h('a', { class: 'link-more back-link', href: '#tournaments' }, icon('chev', 'sm flip'), 'Danh sách giải'),
      h('section', { class: 'card ud-head' },
        h('span', { class: 'tour-ico' }, icon('trophy')),
        h('div', { class: 'ud-head-main' },
          h('h2', {}, t.name, ' ', tourTag(t.status)),
          h('div', { class: 'ud-sub' }, `${FORMAT[t.format]} · ${t.tc.totalMin}+${t.tc.incSec} · bắt đầu ${fmtDT(t.startAt)} · ${t.players}/${t.maxPlayers} kỳ thủ`),
          t.description ? h('div', { class: 'muted small' }, t.description) : null),
        h('div', { class: 'row-actions' }, tourActions(t, false))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, t.rounds.length ? 'Bảng xếp hạng giải' : 'Kỳ thủ đã đăng ký')),
          t.standings.length ? h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Kỳ thủ'), h('th', { class: 'num' }, 'Elo'), h('th', { class: 'num' }, 'Điểm'), h('th', { class: 'num' }, 'BH'), h('th', {}, 'Check-in'))),
            h('tbody', {}, t.standings.map((p, i) => h('tr', { class: 'row-link', onclick: () => openUser(p.id) },
              h('td', {}, p.place || i + 1), h('td', {}, h('b', {}, p.name), p.out ? h('span', { class: 'tag soft' }, 'Dừng') : null),
              h('td', { class: 'num' }, fmt(p.rating)), h('td', { class: 'num' }, p.score), h('td', { class: 'num' }, p.buchholz),
              h('td', {}, p.checkedIn ? h('span', { class: 'tag green' }, 'Đã') : h('span', { class: 'muted' }, 'Chưa'))))))
            : h('div', { class: 'mini-empty' }, 'Chưa có kỳ thủ nào đăng ký.')),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, 'Thông tin')),
          h('dl', { class: 'kv' }, ...kv('Lệ phí', t.entryFee ? `${fmt(t.entryFee)} xu` : 'Miễn phí'), ...kv('Thưởng', t.prizes.map(fmt).join(' / ') + ' xu'),
            ...kv('Check-in', `${t.checkinMin} phút trước giờ đấu`), ...kv('Chờ vào bàn', `${t.noShowMin} phút`),
            ...kv('Số vòng', t.totalRounds ? String(t.totalRounds) : 'Tính khi bắt đầu'), ...kv('Kết thúc', t.finishedAt ? fmtDT(t.finishedAt) : '—'),
            ...(t.winner ? kv('Vô địch', t.winner) : [])))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Các vòng đấu')),
        t.rounds.length ? h('div', { class: 'tour-rounds' }, [...t.rounds].reverse().map((r) => h('div', {},
          h('h4', { class: 'round-title' }, `Vòng ${r.n}${r.finishedAt ? ' · đã xong' : ' · đang đấu'}`),
          r.pairings.map((pr) => h('div', { class: 'pairing' },
            h('span', { class: pr.result === 'r' ? 'win' : '' }, pr.rName || nameOf(pr.r)),
            h('span', { class: 'score' }, score(pr)),
            h('span', { class: 'p2 ' + (pr.result === 'b' ? 'win' : '') }, pr.bName || '—'),
            pr.roomId ? h('a', { class: 'btn sm', href: watchHref(pr.roomId), target: '_blank', rel: 'noopener' }, icon('eye', 'sm'), pr.roomId)
              : pr.gameId ? h('button', { class: 'btn sm', onclick: () => openGameViewer(pr.gameId) }, 'Biên bản') : h('span', {}))))))
          : h('div', { class: 'mini-empty' }, t.status === 'cancelled' ? 'Giải đã huỷ.' : 'Cặp đấu vòng 1 được ghép khi giải bắt đầu.')));
  }

  // ---------- Góp ý ----------
  let fbFilter = 'all';
  async function loadFeedback() {
    try { ({ feedback: feedbackList } = await api('GET', '/feedback')); } catch (err) { return toast(err.message); }
    $('c-feedback').textContent = feedbackList.length;
    const reports = feedbackList.filter((f) => f.type === 'report').length;
    $('fb-report-count').textContent = reports;
    $('fb-report-count').classList.toggle('hidden', !reports);
    const list = feedbackList.filter((f) => fbFilter === 'all' || (f.type || 'feedback') === fbFilter).sort((a, b) => b.at - a.at);
    $('feedback-list').replaceChildren(...(list.length ? list.map((f) => h('div', { class: 'card fb-item' + (f.type === 'report' ? ' report' : '') },
      avatarEl({ name: f.name.replace(/\s*\(@[^)]*\)$/, '') }),
      h('div', { class: 'fb-body' },
        h('div', { class: 'fb-meta' }, f.type === 'report' ? h('span', { class: 'tag' }, icon('flag', 'sm'), 'Báo cáo') : null,
          h('b', {}, f.name), f.accountId ? h('a', { class: 'link-more', href: userHref(f.accountId) }, 'Xem tài khoản') : h('span', { class: 'tag soft' }, 'Khách'),
          '· ' + fmtDT(f.at), f.contact ? h('span', { class: 'tag soft' }, 'Liên hệ: ' + f.contact) : null),
        f.target ? h('div', { class: 'fb-target' }, 'Kỳ thủ bị báo cáo: ', f.target.id ? h('a', { class: 'link-name', href: userHref(f.target.id) }, f.target.name || f.target.id) : f.target.name) : null,
        h('div', { class: 'fb-msg' }, f.message)),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!confirm('Xoá góp ý này?')) return;
        try { await api('DELETE', `/feedback/${encodeURIComponent(f.id)}`); loadFeedback(); load(); } catch (err) { toast(err.message); }
      } }, f.type === 'report' ? 'Đã xử lý' : 'Xoá'))) : [h('div', { class: 'card empty-card' }, icon('chat', 'xl'), h('b', {}, fbFilter === 'report' ? 'Không có báo cáo nào' : 'Chưa có góp ý nào'), h('p', {}, 'Góp ý và báo cáo của người chơi sẽ xuất hiện ở đây.'))]));
  }
  document.querySelectorAll('#fb-filter button').forEach((b) => b.addEventListener('click', () => {
    fbFilter = b.dataset.f;
    document.querySelectorAll('#fb-filter button').forEach((x) => x.classList.toggle('active', x === b));
    loadFeedback();
  }));

  // ---------- Chi tiết kỳ thủ (#user/<mã>) ----------
  const REASON = { checkmate: 'chiếu bí', stalemate: 'hết nước', resign: 'đầu hàng', draw: 'hoà', abandon: 'rời bàn', timeout: 'hết giờ' };
  const LEVEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  for (let i = 1; i <= 8; i++) LEVEL['l' + i] = 'Cấp ' + i;
  const OUTCOME = { win: 'Thắng', loss: 'Thua', draw: 'Hoà' };
  let detail = null;
  const gameFilter = { mode: 'all', outcome: 'all' };

  async function showUserPage(id) {
    showPage('user');
    $('user-detail').replaceChildren(h('div', { class: 'card empty-card' }, 'Đang tải…'));
    try {
      detail = await api('GET', `/users/${encodeURIComponent(id)}`);
    } catch (err) {
      detail = null;
      $('user-detail').replaceChildren(h('div', { class: 'card empty-card' }, err.message, h('a', { href: '#users', class: 'link' }, '← Về danh sách')));
      return;
    }
    $('page-title').textContent = detail.account.displayName;
    document.title = `${detail.account.displayName} · Quản trị Sĩ Tượng Kỳ`;
    renderUserDetail();
  }

  async function userAction(fn, okMsg) {
    try {
      await fn();
      toast(okMsg);
      load();
      if (detail) showUserPage(detail.account.id);
    } catch (err) {
      toast(err.message);
    }
  }

  // Hộp thoại nhập liệu đơn giản: fields = [{ name, label, type, value, min, max, hint }]
  function formModal(title, fields, onSubmit, submitText = 'Lưu') {
    const inputs = fields.map((f) => h('input', { name: f.name, type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, required: true, autocomplete: 'off' }));
    const err = h('p', { class: 'form-err' });
    const close = () => modal.remove();
    const form = h('form', { class: 'ud-form', onsubmit: async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(inputs.map((i) => [i.name, i.type === 'number' ? Number(i.value) : i.value]));
      try { await onSubmit(values); close(); } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, title),
      ...fields.map((f, i) => h('label', { class: 'field' }, h('span', {}, f.label), inputs[i], f.hint && h('small', { class: 'muted' }, f.hint))),
      err,
      h('div', { class: 'ud-form-acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Huỷ'), h('button', { class: 'btn primary' }, submitText)));
    const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } }, h('div', { class: 'modal-card' }, form));
    document.body.appendChild(modal);
    setTimeout(() => inputs[0] && inputs[0].focus(), 0);
  }

  function renderUserDetail() {
    const d = detail, a = d.account, id = encodeURIComponent(a.id);
    const st = a.stats;
    const pct = (s) => (s.games ? Math.round((s.wins / s.games) * 100) + '%' : '—');
    const patch = (body, msg) => userAction(() => api('PATCH', `/users/${id}`, body), msg);
    const rank = rankOf(a.rating);

    const actions = h('div', { class: 'ud-actions' },
      h('button', { class: 'btn sm', onclick: () => formModal('Đổi tên hiển thị', [{ name: 'name', label: 'Tên hiển thị (2–20 ký tự)', value: a.displayName }],
        (v) => api('PATCH', `/users/${id}`, { name: v.name }).then(() => userAction(async () => {}, 'Đã đổi tên.'))) }, 'Đổi tên'),
      h('button', { class: 'btn sm', onclick: () => formModal('Chỉnh Elo / Xu / Uy tín', [
        { name: 'rating', label: 'Elo', type: 'number', value: a.rating, min: 0, max: 4000 },
        { name: 'coins', label: 'Xu', type: 'number', value: a.coins, min: 0, hint: 'Xu dùng cho vật phẩm & Chơi nhanh — không quy đổi tiền thật.' },
        { name: 'credit', label: 'Uy tín (tối đa 1100)', type: 'number', value: a.credit, min: 0, max: 1100 },
      ], (v) => api('PATCH', `/users/${id}`, v).then(() => userAction(async () => {}, 'Đã cập nhật điểm.'))) }, 'Chỉnh Elo / Xu / Uy tín'),
      h('button', { class: 'btn sm', onclick: () => formModal('Đặt lại mật khẩu', [{ name: 'pw', label: 'Mật khẩu mới', type: 'password', hint: 'Ít nhất 6 ký tự. Hãy báo mật khẩu mới cho người chơi.' }],
        (v) => api('PATCH', `/users/${id}`, { newPassword: v.pw }).then(() => toast('Đã đặt lại mật khẩu.')), 'Đặt mật khẩu') }, 'Đặt lại mật khẩu'),
      a.avatar && h('button', { class: 'btn sm', onclick: () => confirm('Xoá ảnh đại diện của tài khoản này?') && patch({ avatar: null }, 'Đã xoá ảnh đại diện.') }, 'Xoá ảnh đại diện'),
      a.online && h('button', { class: 'btn sm', onclick: () => confirm('Mời ra khỏi phòng hiện tại?') && userAction(() => api('POST', `/users/${id}/kick`), 'Đã mời ra khỏi phòng.') }, 'Mời ra khỏi phòng'),
      a.sessions > 0 && h('button', { class: 'btn sm', onclick: () => confirm('Đăng xuất tài khoản này khỏi mọi thiết bị?') && userAction(() => api('POST', `/users/${id}/logout`), 'Đã đăng xuất mọi thiết bị.') }, 'Đăng xuất mọi thiết bị'),
      h('button', { class: 'btn sm' + (a.banned ? '' : ' danger'), onclick: () => confirm(a.banned ? 'Mở khoá tài khoản?' : 'Khoá tài khoản? Người chơi sẽ bị đăng xuất và không đăng nhập được.') && patch({ banned: !a.banned }, a.banned ? 'Đã mở khoá.' : 'Đã khoá tài khoản.') }, a.banned ? 'Mở khoá' : 'Khoá tài khoản'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!confirm(`Xoá vĩnh viễn tài khoản @${a.username}? Không thể hoàn tác.`)) return;
        try { await api('DELETE', `/users/${id}`); toast('Đã xoá tài khoản.'); load(); location.hash = '#users'; } catch (err) { toast(err.message); }
      } }, 'Xoá tài khoản'));

    const head = h('section', { class: 'card ud-head' },
      avatarEl({ avatar: a.avatar, name: a.displayName }),
      h('div', { class: 'ud-head-main' },
        h('h2', {}, a.displayName, h('span', { class: 'tag' }, rank.label), a.banned && h('span', { class: 'tag dark' }, 'Bị khoá')),
        h('div', { class: 'ud-sub' }, `@${a.username} · ${a.region || 'Chưa đặt khu vực'} · Tham gia ${fmtDate(a.createdAt)}`),
        h('div', { class: 'ud-sub' }, h('span', { class: 'dot' + (a.online ? ' on' : '') }), a.online ? 'Đang online' : `Offline · hoạt động ${ago(a.lastSeen)}`,
          a.roomId && [' · trong phòng ', h('a', { class: 'room-link', href: watchHref(a.roomId), target: '_blank', rel: 'noopener' }, a.roomId)]),
        actions));

    const card = (label, value, sub, cls = '') => h('div', { class: 'stat-card ' + cls }, h('small', {}, label), h('b', {}, value), h('em', {}, sub));
    const stats = h('div', { class: 'stat-grid six' },
      card('Elo', fmt(a.rating), rank.label),
      card('Xu', fmt(a.coins), 'Đang sở hữu', 'gold'),
      card('Uy tín', a.credit, a.credit < 1000 ? 'Dưới mức khởi đầu' : 'Tốt', a.credit < 1000 ? 'warn' : 'ok'),
      card('Chuỗi thắng', a.streak, `Kỷ lục ${a.bestStreak}`),
      card('Online T-T-H', `${st.online.wins}-${st.online.losses}-${st.online.draws}`, `${st.online.games} ván · ${pct(st.online)} thắng`),
      card('Đấu máy T-T-H', `${st.ai.wins}-${st.ai.losses}-${st.ai.draws}`, `${st.ai.games} ván · ${pct(st.ai)} thắng`));

    const kv = (rows) => h('table', { class: 'kv' }, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
    const info = h('section', { class: 'card' }, h('h3', {}, 'Thông tin tài khoản'),
      kv([
        ['Mã nội bộ', h('code', {}, a.id)], ['Tên đăng nhập', '@' + a.username], ['Tên hiển thị', a.displayName],
        ['Khu vực', a.region || 'Chưa đặt'], ['Hạng', rank.label], ['Cờ thế đã giải', a.puzzlesSolved],
        ['Ngày tạo', fmtDT(a.createdAt)], ['Hoạt động cuối', fmtDT(a.lastSeen)], ['Phiên đăng nhập đang mở', a.sessions],
        ['Nhận thưởng ngày gần nhất', a.lastBonusDay || '—'], ['Tổng số ván đã lưu', d.totalGames],
      ]));
    const chart = h('section', { class: 'card' }, h('h3', {}, 'Biến thiên Elo'), eloChart(d.ratingHistory));

    const opponents = h('section', { class: 'card' }, h('h3', {}, 'Đối thủ thường gặp'),
      d.opponents.length ? h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ...['Đối thủ', 'Chế độ', 'Số ván', 'T-T-H'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...d.opponents.map((o) => h('tr', {},
          h('td', {}, o.accountId ? h('a', { class: 'link-name', href: userHref(o.accountId) }, o.name) : o.name),
          h('td', {}, o.mode === 'ai' ? 'Đấu máy' : o.accountId ? 'Online' : 'Online (khách)'),
          h('td', { class: 'num' }, o.games),
          h('td', { class: 'wld' }, h('b', {}, o.wins), ' - ', h('i', {}, o.losses), ' - ', o.draws)))))
        : h('div', { class: 'mini-empty' }, 'Chưa có ván nào.'));

    const feedback = h('section', { class: 'card' }, h('h3', {}, `Góp ý đã gửi (${d.feedback.length})`),
      d.feedback.length ? h('div', { class: 'mini-list' }, ...d.feedback.map((f) => h('div', { class: 'mini-row' },
        h('span', { class: 'grow' }, f.message), h('span', { class: 'muted small' }, fmtDT(f.at)))))
        : h('div', { class: 'mini-empty' }, 'Chưa gửi góp ý nào.'));

    $('user-detail').replaceChildren(
      h('a', { class: 'link-more back-link', href: '#users' }, icon('chev', 'sm flip'), 'Danh sách kỳ thủ'),
      head, stats,
      h('div', { class: 'grid-2' }, info, chart),
      gamesSection(),
      h('div', { class: 'grid-2' }, opponents, feedback));
  }

  // Bảng lịch sử ván có bộ lọc
  function gamesSection() {
    const d = detail;
    const box = h('section', { class: 'card' });
    const draw = () => {
      const list = d.games.filter((g) => (gameFilter.mode === 'all' || g.mode === gameFilter.mode) && (gameFilter.outcome === 'all' || g.outcome === gameFilter.outcome));
      const sel = (key, opts) => h('select', { onchange: (e) => { gameFilter[key] = e.target.value; draw(); } },
        ...opts.map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = gameFilter[key] === v; return o; }));
      box.replaceChildren(
        h('div', { class: 'card-head' }, h('h3', {}, `Lịch sử ván (${list.length}${d.totalGames > d.games.length ? ` / ${d.totalGames}` : ''})`),
          h('div', { class: 'filters' },
            sel('mode', [['all', 'Mọi chế độ'], ['online', 'Online'], ['ai', 'Đấu máy']]),
            sel('outcome', [['all', 'Mọi kết quả'], ['win', 'Thắng'], ['loss', 'Thua'], ['draw', 'Hoà']]))),
        list.length ? h('div', { class: 'table-card' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, ...['Kết quả', 'Đối thủ', 'Chế độ', 'Cầm quân', 'Kết thúc', 'Elo', 'Thời gian', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...list.map((g) => h('tr', {},
            h('td', {}, h('span', { class: 'res ' + g.outcome }, OUTCOME[g.outcome])),
            h('td', { 'data-label': 'Đối thủ' }, g.opponentId ? h('a', { class: 'link-name', href: userHref(g.opponentId) }, g.opponent) : g.opponent),
            h('td', { 'data-label': 'Chế độ' }, g.mode === 'ai' ? `Đấu máy · ${LEVEL[g.level] || ''}` : 'Online'),
            h('td', { 'data-label': 'Cầm quân' }, h('span', { class: 'side-dot ' + g.color }), ' ', g.color === 'r' ? 'Đỏ' : 'Đen'),
            h('td', { 'data-label': 'Kết thúc' }, `${REASON[g.reason] || ''} · ${g.moveCount} nước`),
            h('td', { 'data-label': 'Elo', class: 'num' }, typeof g.ratingChange === 'number'
              ? h('span', { class: 'elo ' + (g.ratingChange >= 0 ? 'up' : 'down') }, (g.ratingChange >= 0 ? '+' : '') + g.ratingChange) : h('span', { class: 'muted' }, '—')),
            h('td', { 'data-label': 'Thời gian' }, fmtDT(g.endedAt)),
            h('td', { class: 'actions-cell' }, h('button', { class: 'btn sm', onclick: () => openGameViewer(g.id) }, 'Biên bản')))))))
          : h('div', { class: 'mini-empty' }, 'Không có ván phù hợp.'));
    };
    draw();
    return box;
  }

  // Biểu đồ Elo (SVG)
  function eloChart(points) {
    if (!points || points.length < 2) return h('div', { class: 'mini-empty' }, 'Chưa có ván online tính điểm (cần đối thủ cũng có tài khoản).');
    const W = 600, H = 180, P = 28;
    const vals = points.map((p) => p.rating);
    const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
    const half = Math.max(50, (Math.max(...vals) - Math.min(...vals)) / 2 + 20);
    const lo = mid - half, hi = mid + half;
    const x = (i) => P + (i / (points.length - 1)) * (W - 2 * P);
    const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'elo-chart');
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    for (const v of [lo + 20, (lo + hi) / 2, hi - 20]) {
      add('line', { x1: P, x2: W - P, y1: y(v), y2: y(v), class: 'grid' });
      add('text', { x: 4, y: y(v) + 4, class: 'axis' }).textContent = Math.round(v);
    }
    const pts = points.map((p, i) => `${x(i)},${y(p.rating)}`).join(' ');
    add('polygon', { points: `${x(0)},${H - P} ${pts} ${x(points.length - 1)},${H - P}`, class: 'area' });
    add('polyline', { points: pts, class: 'line' });
    points.forEach((p, i) => {
      const c = add('circle', { cx: x(i), cy: y(p.rating), r: 3.5, class: 'pt' });
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${p.rating} · ${fmtDT(p.at)}`;
      c.appendChild(t);
    });
    return svg;
  }

  // ---------- Cờ thế ----------
  const DIFF = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const TOPIC = { mate: 'Chiếu bí', capture: 'Bắt quân', defense: 'Phòng thủ', endgame: 'Tàn cuộc' };
  const TYPES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
  let puzzleList = [];
  let themeCache = null;

  async function getTheme() {
    if (!themeCache) themeCache = await fetch('/api/theme').then((r) => r.json()).catch(() => BR.DEFAULT_THEME);
    return themeCache;
  }

  function thumbSvg(board, theme, flipped) {
    const svg = document.createElementNS(NS, 'svg');
    const g = BR.drawBoard(svg, theme, { flipped });
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      const [vr, vc] = flipped ? [9 - r, 8 - c] : [r, c];
      BR.drawPiece(svg, theme, g.unit, p, XQ.CHARS[p], g.xs[vc], g.ys[vr]);
    }
    return svg;
  }

  async function loadPuzzles() {
    let theme;
    try {
      [{ puzzles: puzzleList }, theme] = await Promise.all([api('GET', '/puzzles'), getTheme()]);
    } catch (err) { return toast(err.message); }
    $('c-puzzles').textContent = puzzleList.length;
    const solves = puzzleList.reduce((s, p) => s + p.solvedBy, 0);
    $('pz-count').textContent = `${puzzleList.length} thế cờ · ${puzzleList.filter((p) => p.published).length} đang hiển thị · ${fmt(solves)} lượt giải`;
    if (!puzzleList.length) {
      $('pz-body').replaceChildren(h('tr', {}, h('td', { colspan: 7 }, h('div', { class: 'empty' }, 'Chưa có thế cờ nào. Bấm "Thêm thế cờ" để tạo.'))));
      return;
    }
    $('pz-body').replaceChildren(...puzzleList.map((p) => h('tr', { class: 'row-link', onclick: () => { location.hash = '#puzzle/' + p.id; } },
      h('td', {}, h('div', { class: 'player-cell' }, h('div', { class: 'pz-thumb' }, thumbSvg(p.board, theme, p.side === 'b')),
        h('span', {}, h('b', {}, p.title), h('small', {}, `${p.side === 'r' ? 'Đỏ' : 'Đen'} đi trước`)))),
      h('td', { 'data-label': 'Độ khó · chủ đề' }, h('span', { class: 'diff ' + p.difficulty }, DIFF[p.difficulty]), ' ', h('span', { class: 'tag soft' }, TOPIC[p.topic] || TOPIC.mate)),
      h('td', { 'data-label': 'Số nước', class: 'num' }, (p.solution.length + 1) / 2),
      h('td', { 'data-label': 'Đã giải', class: 'num' }, p.solvedBy),
      h('td', { 'data-label': 'Trạng thái' }, h('span', { class: p.published ? 'tag green' : 'tag soft' }, p.published ? 'Đang hiển thị' : 'Đang ẩn')),
      h('td', { 'data-label': 'Cập nhật' }, ago(p.updatedAt)),
      h('td', { class: 'actions-cell' }, h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: async (e) => {
          e.stopPropagation();
          try { await api('PATCH', `/puzzles/${p.id}`, { published: !p.published }); loadPuzzles(); } catch (err) { toast(err.message); }
        } }, p.published ? 'Ẩn' : 'Hiện'),
        h('button', { class: 'btn sm danger', onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Xoá thế cờ "${p.title}"?`)) return;
          try { await api('DELETE', `/puzzles/${p.id}`); toast('Đã xoá thế cờ.'); loadPuzzles(); } catch (err) { toast(err.message); }
        } }, 'Xoá')))),
    ));
  }
  $('pz-new').addEventListener('click', () => { location.hash = '#puzzle/new'; });

  // ----- Trình soạn cờ thế -----
  const emptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));
  let ed = null;

  async function openEditor(id) {
    showPage('puzzle');
    const theme = await getTheme();
    let p = null;
    if (id !== 'new') {
      try { ({ puzzle: p } = await api('GET', `/puzzles/${encodeURIComponent(id)}`)); } catch (err) { toast(err.message); location.hash = '#puzzles'; return; }
    }
    const start = emptyBoard();
    start[0][4] = 'bK';
    start[9][3] = 'rK'; // lệch cột để 2 tướng không đối mặt
    ed = {
      id: p ? p.id : null,
      title: p ? p.title : '', description: p ? p.description : 'Đỏ đi trước. Chiếu bí trong 1 nước.',
      difficulty: p ? p.difficulty : 'easy', topic: p ? p.topic || 'mate' : 'mate', side: p ? p.side : 'r', published: p ? p.published : true,
      board: p ? p.board.map((row) => row.slice()) : start,
      solution: p ? p.solution.slice() : [],
      mode: 'setup', tool: 'rR', pick: null, theme,
    };
    $('page-title').textContent = p ? 'Sửa thế cờ' : 'Thêm thế cờ';
    buildEditor();
  }

  // Bàn cờ đang hiển thị: chế độ bày quân → thế cờ gốc; chế độ ghi lời giải → thế cờ sau các nước đã ghi
  function solutionState() {
    let b = ed.board, turn = ed.side;
    for (const m of ed.solution) { b = XQ.applyMove(b, m.from, m.to); turn = XQ.other(turn); }
    return { b, turn };
  }

  function buildEditor() {
    const field = (label, input) => h('label', { class: 'ed-field' }, label, input);
    const title = h('input', { value: ed.title, maxlength: 80, placeholder: 'VD: Chiếu bí trong 2 nước', oninput: (e) => { ed.title = e.target.value; } });
    const desc = h('textarea', { rows: 2, maxlength: 500, oninput: (e) => { ed.description = e.target.value; } });
    desc.value = ed.description;
    const diff = h('select', { onchange: (e) => { ed.difficulty = e.target.value; } },
      ...Object.entries(DIFF).map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = ed.difficulty === v; return o; }));
    const topic = h('select', { onchange: (e) => { ed.topic = e.target.value; } },
      ...Object.entries(TOPIC).map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = ed.topic === v; return o; }));
    const side = h('select', { onchange: (e) => { ed.side = e.target.value; ed.solution = []; refresh(); } },
      ...[['r', 'Đỏ đi trước'], ['b', 'Đen đi trước']].map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = ed.side === v; return o; }));
    const pub = h('input', { type: 'checkbox', onchange: (e) => { ed.published = e.target.checked; } });
    pub.checked = ed.published;

    const svg = document.createElementNS(NS, 'svg');
    ed.ui = new window.BoardUI(svg, { theme: ed.theme, onClick: onEditorClick });
    ed.panel = h('div', { class: 'card' });
    ed.msg = h('div', { class: 'status-box' });
    $('pz-editor').replaceChildren(
      h('div', { class: 'admin-page', style: 'padding:0' },
        h('a', { class: 'link-more back-link', href: '#puzzles' }, icon('chev', 'sm flip'), 'Danh sách cờ thế'),
        h('div', { class: 'ed' },
          h('div', { class: 'card' }, h('div', { class: 'ed-board' }, svg)),
          h('div', { class: 'ed-side' },
            h('section', { class: 'card' },
              field('Tiêu đề', title), field('Mô tả / yêu cầu', desc),
              h('div', { class: 'ed-row' }, field('Độ khó', diff), field('Chủ đề', topic)),
              field('Bên đi trước', side),
              h('label', { class: 'ed-check' }, pub, 'Hiển thị trong tab Cờ thế')),
            h('div', { class: 'ed-modes' },
              h('button', { class: 'mode-setup', onclick: () => setMode('setup') }, '1. Bày thế cờ'),
              h('button', { class: 'mode-solve', onclick: () => setMode('solve') }, '2. Ghi lời giải')),
            ed.panel, ed.msg,
            h('div', { class: 'ed-actions' },
              h('button', { class: 'btn primary', onclick: savePuzzle }, ed.id ? 'Lưu thay đổi' : 'Tạo thế cờ'),
              h('a', { class: 'btn', href: '#puzzles' }, 'Huỷ'))))));
    refresh();
  }

  function setMode(mode) {
    if (mode === 'solve') {
      const err = XQ.validatePosition(ed.board, ed.side);
      if (err) { toast('Thế cờ chưa hợp lệ: ' + err); return; }
    }
    ed.mode = mode;
    ed.pick = null;
    refresh();
  }

  function refresh() {
    document.querySelector('.mode-setup').classList.toggle('active', ed.mode === 'setup');
    document.querySelector('.mode-solve').classList.toggle('active', ed.mode === 'solve');
    const ui = ed.ui;
    ui.flipped = ed.side === 'b';
    if (ed.mode === 'setup') {
      ui.set({ board: ed.board, selected: ed.pick, targets: [], lastMove: null });
      renderPalette();
    } else {
      const { b } = solutionState();
      ui.set({ board: b, selected: ed.pick, targets: ed.pick ? XQ.legalMovesFrom(b, ed.pick[0], ed.pick[1]) : [], lastMove: ed.solution[ed.solution.length - 1] || null });
      renderSolutionPanel();
    }
    renderEditorMsg();
  }

  function pieceSvg(p) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-55 -55 110 116');
    const host = document.createElementNS(NS, 'svg');
    BR.drawBoard(host, ed.theme); // lấy gradient của quân cờ
    svg.dataset.brId = host.dataset.brId; // dùng chung bộ id gradient của host
    svg.appendChild(host.querySelector('defs'));
    BR.drawPiece(svg, ed.theme, 1, p, XQ.CHARS[p], 0, 0);
    return svg;
  }

  function renderPalette() {
    const tool = (id, content, title) => h('button', { class: ed.tool === id ? 'active' : '', title, onclick: () => { ed.tool = id; ed.pick = null; refresh(); } }, content);
    ed.panel.replaceChildren(
      h('h3', {}, 'Bày quân'),
      h('p', { class: 'muted small' }, 'Chọn quân rồi bấm vào giao điểm để đặt. Bấm lại cùng quân để gỡ. Dùng "Di chuyển" để kéo quân sang chỗ khác.'),
      h('div', { class: 'palette' }, ...TYPES.map((t) => tool('r' + t, pieceSvg('r' + t), 'Quân Đỏ')), ...TYPES.map((t) => tool('b' + t, pieceSvg('b' + t), 'Quân Đen'))),
      h('div', { class: 'tools' },
        h('button', { class: 'btn sm' + (ed.tool === 'move' ? ' active' : ''), onclick: () => { ed.tool = 'move'; ed.pick = null; refresh(); } }, '✥ Di chuyển'),
        h('button', { class: 'btn sm' + (ed.tool === 'erase' ? ' active' : ''), onclick: () => { ed.tool = 'erase'; ed.pick = null; refresh(); } }, '⌫ Tẩy'),
        h('button', { class: 'btn sm', onclick: () => { if (confirm('Xoá hết quân (giữ 2 tướng)?')) { const b = emptyBoard(); b[0][4] = 'bK'; b[9][3] = 'rK'; setBoard(b); } } }, 'Bàn trống'),
        h('button', { class: 'btn sm', onclick: () => setBoard(XQ.initialBoard()) }, 'Thế ban đầu')));
  }

  function setBoard(b) {
    ed.board = b;
    if (ed.solution.length) { ed.solution = []; toast('Thế cờ thay đổi — lời giải cũ đã được xoá.'); }
    ed.pick = null;
    refresh();
  }

  function onEditorClick(r, c) {
    if (ed.mode === 'setup') {
      const b = ed.board.map((row) => row.slice());
      if (ed.tool === 'erase') b[r][c] = null;
      else if (ed.tool === 'move') {
        if (!ed.pick) { if (b[r][c]) { ed.pick = [r, c]; return refresh(); } return; }
        const [pr, pc] = ed.pick;
        if (pr !== r || pc !== c) { b[r][c] = b[pr][pc]; b[pr][pc] = null; }
        ed.pick = null;
      } else b[r][c] = b[r][c] === ed.tool ? null : ed.tool;
      return setBoard(b);
    }
    // Ghi lời giải: đi quân lần lượt cho 2 bên
    const { b, turn } = solutionState();
    const p = b[r][c];
    if (ed.pick && XQ.isLegalMove(b, turn, ed.pick, [r, c])) {
      ed.solution.push({ from: ed.pick, to: [r, c] });
      ed.pick = null;
    } else if (p && p[0] === turn) {
      ed.pick = ed.pick && ed.pick[0] === r && ed.pick[1] === c ? null : [r, c];
    } else {
      ed.pick = null;
    }
    refresh();
  }

  function renderSolutionPanel() {
    const { turn } = solutionState();
    const list = h('ol', { class: 'sol-list' });
    let b = ed.board;
    const notes = ed.solution.map((m) => { const n = XQ.notation(b, m.from, m.to); b = XQ.applyMove(b, m.from, m.to); return n; });
    for (let i = 0; i < notes.length; i += 2) {
      list.appendChild(h('li', {}, h('span', { class: 'no' }, i / 2 + 1 + '.'),
        h('span', { class: (ed.side === 'r') === (i % 2 === 0) ? 'r' : 'b' }, notes[i]),
        h('span', { class: (ed.side === 'r') === (i % 2 === 1) ? 'r' : 'b' }, notes[i + 1] || '')));
    }
    ed.panel.replaceChildren(
      h('h3', {}, 'Ghi lời giải'),
      h('p', { class: 'muted small' }, `Đi quân trên bàn theo đúng lời giải: nước của người giải (${ed.side === 'r' ? 'Đỏ' : 'Đen'}), rồi nước đáp trả của đối phương, xen kẽ nhau. Kết thúc bằng nước của người giải.`),
      h('div', { class: 'muted small' }, `Đang đến lượt: ${turn === 'r' ? 'Đỏ' : 'Đen'}`),
      notes.length ? list : h('div', { class: 'mini-empty' }, 'Chưa có nước nào.'),
      h('div', { class: 'tools' },
        h('button', { class: 'btn sm', onclick: () => { ed.solution.pop(); ed.pick = null; refresh(); } }, '↶ Lùi 1 nước'),
        h('button', { class: 'btn sm', onclick: () => { ed.solution = []; ed.pick = null; refresh(); } }, 'Xoá lời giải')));
  }

  function renderEditorMsg() {
    const err = XQ.validatePosition(ed.board, ed.side);
    let text, cls;
    if (err) { text = '⚠ ' + err; cls = 'bad'; }
    else if (!ed.solution.length) { text = 'Thế cờ hợp lệ ✓. Chuyển sang "2. Ghi lời giải" để đi các nước đúng.'; cls = ''; }
    else if (ed.solution.length % 2 === 0) { text = '⚠ Lời giải đang kết thúc bằng nước của đối phương — hãy đi thêm nước của người giải.'; cls = 'bad'; }
    else {
      const { b, turn } = solutionState();
      const mate = XQ.isInCheck(b, turn) && !XQ.hasAnyLegalMove(b, turn);
      text = `Lời giải ${(ed.solution.length + 1) / 2} nước ✓ ${mate ? '— kết thúc bằng chiếu bí.' : '— (chưa chiếu bí, vẫn lưu được; người giải phải đi đúng từng nước).'}`;
      cls = 'ok';
    }
    ed.msg.className = 'status-box ' + cls;
    ed.msg.textContent = text;
  }

  async function savePuzzle() {
    const body = { title: ed.title, description: ed.description, difficulty: ed.difficulty, topic: ed.topic, side: ed.side, board: ed.board, solution: ed.solution, published: ed.published };
    try {
      const { puzzle } = ed.id ? await api('PUT', `/puzzles/${ed.id}`, body) : await api('POST', '/puzzles', body);
      toast(ed.id ? 'Đã lưu thế cờ.' : 'Đã tạo thế cờ.');
      ed.id = puzzle.id;
      location.hash = '#puzzles';
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Xem biên bản ván cờ ----------
  async function openGameViewer(gameId) {
    let game, theme;
    try {
      [{ game }, theme] = await Promise.all([api('GET', `/games/${encodeURIComponent(gameId)}`), getTheme()]);
    } catch (err) {
      return toast(err.message);
    }
    const moves = game.moves.map(([fr, fc, tr, tc]) => ({ from: [fr, fc], to: [tr, tc] }));
    const { boards, notes } = XQ.replay(moves);
    let ply = moves.length;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'gv-board');
    const label = h('span', { class: 'gv-label' });
    const list = h('ol', { class: 'gv-moves' });
    const go = (p) => { ply = Math.max(0, Math.min(moves.length, p)); draw(); };
    const draw = () => {
      const geo = BR.drawBoard(svg, theme);
      const layer = document.createElementNS(NS, 'g');
      svg.appendChild(layer);
      const m = moves[ply - 1];
      if (m) {
        for (const [r, c] of [m.from, m.to]) {
          const ring = document.createElementNS(NS, 'circle');
          for (const [k, v] of Object.entries({ cx: geo.xs[c], cy: geo.ys[r], r: 48 * geo.unit, fill: 'rgba(47,111,214,.16)', stroke: '#2f6fd6', 'stroke-width': 4 * geo.unit })) ring.setAttribute(k, v);
          layer.appendChild(ring);
        }
      }
      const b = boards[ply];
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (b[r][c]) BR.drawPiece(layer, theme, geo.unit, b[r][c], XQ.CHARS[b[r][c]], geo.xs[c], geo.ys[r]);
      label.textContent = `Nước ${ply}/${moves.length}`;
      list.querySelectorAll('button').forEach((btn) => btn.classList.toggle('current', Number(btn.dataset.ply) === ply));
      const cur = list.querySelector('button.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    };
    for (let i = 0; i < notes.length; i += 2) {
      list.appendChild(h('li', {}, h('span', { class: 'no' }, i / 2 + 1 + '.'),
        h('button', { 'data-ply': i + 1, class: 'r', onclick: () => go(i + 1) }, notes[i]),
        notes[i + 1] ? h('button', { 'data-ply': i + 2, class: 'b', onclick: () => go(i + 2) }, notes[i + 1]) : ''));
    }
    const res = game.result;
    const resultText = !res.winner ? 'Hoà' : `${res.winner === 'r' ? 'Đỏ' : 'Đen'} thắng — ${REASON[res.reason] || ''}`;
    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'ArrowRight') go(ply + 1);
      else if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } },
      h('div', { class: 'modal-card xl' },
        h('button', { class: 'modal-close', onclick: close, 'aria-label': 'Đóng' }, icon('x')),
        h('h2', {}, `${game.players.r.name} (Đỏ) vs ${game.players.b.name} (Đen)`),
        h('div', { class: 'muted' }, `${game.mode === 'ai' ? `Đấu máy · ${LEVEL[game.level] || ''}` : 'Online'} · ${resultText} · ${fmtDT(game.endedAt)}`),
        h('div', { class: 'gv-body' },
          h('div', {}, h('div', { class: 'gv-frame' }, svg),
            h('div', { class: 'gv-controls' },
              h('button', { class: 'btn sm', onclick: () => go(0) }, '⏮'), h('button', { class: 'btn sm', onclick: () => go(ply - 1) }, '◀'),
              label,
              h('button', { class: 'btn sm', onclick: () => go(ply + 1) }, '▶'), h('button', { class: 'btn sm', onclick: () => go(moves.length) }, '⏭'))),
          list)));
    document.body.appendChild(modal);
    draw();
  }

  // ---------- Cài đặt hệ thống: form dựng tự động từ danh sách mục trong /site-config.js ----------
  const CF = { saved: null, draft: null, defs: null, loading: false };
  const cfClone = (o) => JSON.parse(JSON.stringify(o));
  const cfSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function loadSiteConfig() {
    if (CF.loading) return;
    if (CF.draft && !cfSame(CF.draft, CF.saved)) return renderSiteConfig(); // đang sửa dở → giữ nguyên
    CF.loading = true;
    try {
      setSiteConfig(await api('GET', '/site-config'));
    } catch (err) {
      toast(err.message);
    } finally {
      CF.loading = false;
    }
  }
  function setSiteConfig(d) {
    CF.saved = cfClone(d.current);
    CF.draft = cfClone(d.current);
    CF.defs = d.defaults;
    renderSiteConfig();
  }

  // Ô nhập cho từng kiểu mục
  function cfInput(f) {
    const v = CF.draft[f.key];
    const set = (val) => { CF.draft[f.key] = val; cfState(); };
    if (f.type === 'int') {
      return h('div', { class: 'cf-num' }, h('input', { type: 'number', min: f.min, max: f.max, step: 1, value: v,
        oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) }), f.unit ? h('span', {}, f.unit) : null);
    }
    if (f.type === 'text') return h('input', { value: v, maxlength: f.max, oninput: (e) => set(e.target.value) });
    if (f.type === 'textarea') return h('textarea', { rows: 3, maxlength: f.max, oninput: (e) => set(e.target.value) }, v);
    if (f.type === 'list') return h('textarea', { rows: 5, oninput: (e) => set(e.target.value.split('\n')) }, v.join('\n'));
    if (f.type === 'tcs') {
      // Chip từng nhịp + ô thêm nhịp
      const box = h('div', { class: 'cf-tcs' });
      const draw = () => {
        const list = CF.draft[f.key];
        const add = h('input', { placeholder: 'vd 3|2', size: 6, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } } });
        const push = () => {
          const t = add.value.trim().replace(/[+ ]/, '|');
          if (!/^\d{1,3}\|\d{1,2}$/.test(t)) return toast('Nhập dạng phút|giây, vd 10|5');
          if (!list.includes(t)) set([...list, t]);
          draw();
        };
        box.replaceChildren(...list.map((t) => h('span', { class: 'cf-chip' }, t === '0|0' ? 'Không giới hạn' : t.replace('|', '+'),
          h('button', { type: 'button', title: 'Bỏ nhịp này', onclick: () => { set(list.filter((x) => x !== t)); draw(); } }, '×'))),
        add, h('button', { type: 'button', class: 'btn sm', onclick: push }, 'Thêm'));
      };
      draw();
      return box;
    }
    if (f.type === 'missions') {
      const rows = v.map((m, i) => {
        const upd = (k, val) => { CF.draft[f.key][i][k] = val; cfState(); };
        return h('tr', { class: m.on ? '' : 'off' },
          h('td', {}, h('input', { type: 'checkbox', checked: m.on, title: 'Bật/tắt nhiệm vụ', onchange: (e) => { upd('on', e.target.checked); e.target.closest('tr').classList.toggle('off', !e.target.checked); } })),
          h('td', {}, h('input', { value: m.name, maxlength: 60, oninput: (e) => upd('name', e.target.value) })),
          h('td', {}, h('input', { type: 'number', min: 1, max: 100, value: m.goal, oninput: (e) => upd('goal', Number(e.target.value)) })),
          h('td', {}, h('input', { type: 'number', min: 0, value: m.reward, oninput: (e) => upd('reward', Number(e.target.value)) })));
      });
      return h('table', { class: 'cf-missions' }, h('thead', {}, h('tr', {}, h('th', {}, 'Bật'), h('th', {}, 'Tên nhiệm vụ'), h('th', {}, 'Mục tiêu'), h('th', {}, 'Thưởng (xu)'))), h('tbody', {}, ...rows));
    }
    return h('span', {}, '—');
  }

  function renderSiteConfig() {
    const box = $('cf-groups');
    if (!CF.draft) { box.replaceChildren(h('div', { class: 'empty' }, 'Đang tải…')); return; }
    const S = window.SiteConfig;
    $('cf-nav').replaceChildren(...S.GROUPS.map((g) => h('a', { href: '#site-config', onclick: (e) => { e.preventDefault(); $('cf-g-' + g.id).scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, g.title)));
    box.replaceChildren(...S.GROUPS.map((g) => h('section', { class: 'card cf-card', id: 'cf-g-' + g.id },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, g.title), g.desc ? h('p', {}, g.desc) : null)),
      h('div', { class: 'cf-fields' + (g.fields.some((f) => ['missions', 'tcs'].includes(f.type)) ? ' wide' : '') },
        ...g.fields.map((f) => h('label', { class: 'field cf-field', 'data-key': f.key },
          h('span', { class: 'cf-label' }, f.label,
            h('button', { type: 'button', class: 'cf-def', title: 'Trả về giá trị mặc định', onclick: (e) => { e.preventDefault(); CF.draft[f.key] = cfClone(CF.defs[f.key]); renderSiteConfig(); } }, '↺ mặc định')),
          cfInput(f),
          f.hint ? h('small', { class: 'muted' }, f.hint) : null))))));
    cfState();
  }
  // Nút Lưu / Bỏ thay đổi, đánh dấu mục đã đổi & mục khác mặc định
  function cfState() {
    if (!CF.draft) return;
    const dirty = !cfSame(CF.draft, CF.saved);
    $('cf-save').disabled = !dirty;
    $('cf-undo').disabled = !dirty;
    if (dirty) { $('cf-status').textContent = 'Có thay đổi chưa lưu.'; $('cf-status').className = 'eco-status'; }
    document.querySelectorAll('#cf-groups .cf-field').forEach((el) => {
      const k = el.dataset.key;
      el.classList.toggle('changed', !cfSame(CF.draft[k], CF.saved[k]));
      el.classList.toggle('custom', !cfSame(CF.draft[k], CF.defs[k]));
    });
  }

  $('cf-undo').addEventListener('click', () => { CF.draft = cfClone(CF.saved); renderSiteConfig(); $('cf-status').textContent = ''; });
  $('cf-save').addEventListener('click', async () => {
    $('cf-save').disabled = true;
    try {
      setSiteConfig(await api('PUT', '/site-config', CF.draft));
      $('cf-status').textContent = '';
      toast('Đã lưu — áp dụng ngay cho mọi người.');
    } catch (err) {
      $('cf-status').textContent = err.message;
      $('cf-status').className = 'eco-status';
      $('cf-save').disabled = false;
    }
  });
  $('cf-reset').addEventListener('click', async () => {
    if (!confirm('Đưa toàn bộ Cài đặt hệ thống về mặc định?')) return;
    try {
      setSiteConfig(await api('POST', '/site-config/reset'));
      toast('Đã khôi phục cài đặt mặc định.');
    } catch (err) { toast(err.message); }
  });
  window.addEventListener('beforeunload', (e) => { if (CF.draft && !cfSame(CF.draft, CF.saved)) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Chức năng web: bật/tắt từng chức năng, lưu ngay khi gạt ----------
  let featState = null;
  async function loadFeatures() {
    try {
      featState = (await api('GET', '/features')).current;
    } catch (err) { toast(err.message); }
    renderFeatures();
  }
  function renderFeatures() {
    const box = $('ft-grid');
    const offCount = featState ? Object.values(featState).filter((v) => v === false).length : 0;
    $('c-features-off').hidden = !offCount;
    $('c-features-off').textContent = offCount + ' tắt';
    $('ft-all-on').disabled = !offCount;
    if (!featState) { box.replaceChildren(h('div', { class: 'empty' }, 'Đang tải…')); return; }
    box.replaceChildren(...window.Features.GROUPS.map((g) => h('section', { class: 'card ft-card' },
      h('h3', {}, g.title),
      ...g.items.map((f) => {
        const on = featState[f.key] !== false;
        return h('label', { class: 'ft-row' + (on ? '' : ' off') },
          h('span', { class: 'ft-text' }, h('b', {}, f.label), h('small', {}, f.desc)),
          h('span', { class: 'ft-state' }, on ? 'Đang bật' : 'Đã tắt'),
          h('input', { type: 'checkbox', class: 'ft-switch', checked: on, onchange: (e) => setFeature(f, e.target.checked, e.target) }));
      }))));
  }
  async function setFeature(f, on, input) {
    if (!on && !confirm(`Tắt "${f.label}"?\nNgười chơi sẽ không thấy và không dùng được chức năng này cho tới khi bạn bật lại.`)) { input.checked = true; return; }
    input.disabled = true;
    try {
      featState = (await api('PUT', '/features', { [f.key]: on })).current;
      toast(on ? `Đã bật "${f.label}".` : `Đã tắt "${f.label}".`);
    } catch (err) { toast(err.message); }
    renderFeatures();
  }
  $('ft-all-on').addEventListener('click', async () => {
    try {
      featState = (await api('PUT', '/features', window.Features.defaults())).current;
      toast('Đã bật lại tất cả chức năng.');
    } catch (err) { toast(err.message); }
    renderFeatures();
  });
  // Hiện số chức năng đang tắt trên menu ngay khi mở trang quản trị
  setTimeout(() => api('GET', '/features').then((d) => { featState = d.current; renderFeatures(); }).catch(() => {}), 0);

  // ---------- Bot AI: tài khoản máy tự online, ghép cặp và đánh với nhau ----------
  let botData = null;
  let botDirty = false; // admin đang sửa dở form → không ghi đè khi tự cập nhật mỗi 5 giây
  const BOT_STATE = { playing: 'Đang chơi', reserved: 'Đang ghép', idle: 'Online', offline: 'Offline' };
  async function loadBots() {
    try { botData = await api('GET', '/bots'); } catch (err) { toast(err.message); }
    renderBots();
  }
  function fillBotForm() {
    botDirty = false;
    const st = botData.settings;
    $('bot-enabled').checked = st.enabled;
    $('bot-tables').value = st.tables;
    $('bot-speed').value = String(st.speed);
    if ($('bot-speed').value !== String(st.speed)) $('bot-speed').append(h('option', { value: st.speed, selected: true }, 'Tuỳ chỉnh ×' + st.speed));
    $('bot-rematch').value = Math.round(st.rematchRate * 100);
    $('bot-kind-ranked').checked = st.kinds.includes('ranked');
    $('bot-kind-coin').checked = st.kinds.includes('coin');
    $('bot-chat').checked = st.chat;
    $('bot-fill').checked = !!st.fillHumans;
    $('bot-fill-sec').value = st.fillAfterSec || 30;
  }
  function renderBots() {
    if (!botData) return;
    const d = botData;
    $('c-bots').hidden = !d.playing;
    $('c-bots').textContent = d.playing;
    if (!botDirty) fillBotForm();
    $('bot-summary').textContent = d.settings.enabled
      ? `Đang bật · ${d.bots.length} bot · ${d.online} online · ${d.playing} ván đang diễn ra`
      : `Đang tắt · ${d.bots.length} bot${d.playing ? ` · ${d.playing} ván đang đánh nốt` : ''}`;
    $('bot-engine').textContent = d.engine === 'pikafish'
      ? 'Engine: Pikafish trên server (bot dùng 1 tiến trình mỗi lúc, không làm chậm phân tích của người chơi).'
      : 'Engine: chưa cài Pikafish — bot dùng engine JS cũ (yếu hơn). Chạy npm run setup:engine để bot đánh hay hơn.';
    const body = $('bots-body');
    if (!d.bots.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'Chưa có bot — tạo vài bot ở trên rồi bật Hoạt động.'))); return; }
    const order = { playing: 0, reserved: 1, idle: 2, offline: 3 };
    const rows = [...d.bots].sort((a, b) => order[a.state] - order[b.state] || b.rating - a.rating);
    body.replaceChildren(...rows.map((b) => h('tr', {},
      h('td', {}, h('a', { href: '#user/' + encodeURIComponent(b.id) }, h('b', {}, b.name)), h('div', { style: 'color:var(--muted);font-size:12px' }, '@' + b.username)),
      h('td', { class: 'num' }, b.rating),
      h('td', {}, h('select', { 'aria-label': 'Trình độ', onchange: (e) => setBotSkill(b, e.target.value) },
        ...Object.entries(d.skills).map(([k, elo]) => h('option', { value: k, selected: Number(k) === b.skill }, `Cấp ${k} (~${elo})`)))),
      h('td', {}, h('span', { class: 'bot-state ' + b.state }, BOT_STATE[b.state] || b.state),
        b.roomId ? h('a', { href: '/?room=' + b.roomId + '&watch=1', target: '_blank', rel: 'noopener', style: 'margin-left:8px;font-size:12px' }, 'Xem') : null),
      h('td', {}, `${b.wins}-${b.draws}-${b.losses}`),
      h('td', { class: 'num' }, b.coins),
      h('td', {}, h('button', { class: 'btn sm', onclick: () => removeBot(b) }, 'Xoá')))));
  }
  async function setBotSkill(b, skill) {
    try { botData = await api('PUT', '/bots/accounts/' + encodeURIComponent(b.id), { skill: Number(skill) }); toast(`${b.name}: cấp ${skill}.`); } catch (err) { toast(err.message); }
    renderBots();
  }
  async function removeBot(b) {
    if (!confirm(`Xoá bot "${b.name}"?\nTài khoản bị xoá hẳn${b.state === 'playing' ? ', ván đang chơi bị đóng' : ''}.`)) return;
    try { botData = await api('DELETE', '/bots/accounts/' + encodeURIComponent(b.id)); toast('Đã xoá bot.'); } catch (err) { toast(err.message); }
    renderBots();
  }
  function botForm() {
    return {
      enabled: $('bot-enabled').checked,
      tables: Number($('bot-tables').value),
      speed: Number($('bot-speed').value),
      rematchRate: Number($('bot-rematch').value) / 100,
      chat: $('bot-chat').checked,
      fillHumans: $('bot-fill').checked,
      fillAfterSec: Number($('bot-fill-sec').value),
      kinds: [$('bot-kind-ranked').checked && 'ranked', $('bot-kind-coin').checked && 'coin'].filter(Boolean),
    };
  }
  for (const id of ['bot-tables', 'bot-speed', 'bot-rematch', 'bot-kind-ranked', 'bot-kind-coin', 'bot-chat', 'bot-fill', 'bot-fill-sec']) $(id).addEventListener('input', () => { botDirty = true; });
  $('bot-save').addEventListener('click', async () => {
    try { botData = await api('PUT', '/bots', botForm()); fillBotForm(); toast('Đã lưu cài đặt bot.'); } catch (err) { toast(err.message); }
    renderBots();
  });
  $('bot-enabled').addEventListener('change', async (e) => {
    try { botData = await api('PUT', '/bots', { enabled: e.target.checked }); toast(e.target.checked ? 'Đã bật bot.' : 'Đã tắt bot — các ván đang chơi sẽ đánh nốt.'); } catch (err) { toast(err.message); }
    renderBots();
  });
  $('bot-create').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      botData = await api('POST', '/bots/accounts', { count: Number($('bot-count').value), eloMin: Number($('bot-elo-min').value), eloMax: Number($('bot-elo-max').value) });
      toast('Đã tạo bot.');
    } catch (err) { toast(err.message); }
    e.target.disabled = false;
    renderBots();
  });
  $('bot-stop').addEventListener('click', async () => {
    if (!confirm('Đóng ngay mọi ván bot đang diễn ra và tắt bot?\nVán bị đóng không tính kết quả.')) return;
    try { botData = await api('POST', '/bots/stop'); fillBotForm(); toast('Đã dừng bot.'); } catch (err) { toast(err.message); }
    renderBots();
  });
  setInterval(() => { if (!document.hidden && !$('page-bots').classList.contains('hidden')) loadBots(); }, 5000);

  // ---------- Cửa hàng vật phẩm: mọi bàn cờ, quân cờ, đồng hồ người chơi thấy trong Túi đồ & Cửa hàng ----------
  const SH = { items: null, saved: null, locked: [], library: [], cat: 'board', loading: false };
  const SH_CATS = { board: 'Bàn cờ', pieces: 'Quân cờ', clock: 'Đồng hồ' };
  const CLOCK_NAMES = { classic: 'Cổ điển', minimal: 'Tối giản', digital: 'Điện tử', wood: 'Mộc', cinnabar: 'Đỏ son', tournament: 'Thi đấu' };
  const shClone = (o) => JSON.parse(JSON.stringify(o));

  async function loadShop() {
    if (SH.loading) return;
    if (SH.items && shopDirty()) return renderShop(); // đang sửa dở → giữ nguyên
    SH.loading = true;
    try {
      await getTheme();
      setShopData(await api('GET', '/shop'));
    } catch (err) {
      toast(err.message);
    } finally {
      SH.loading = false;
    }
  }
  function setShopData(d) {
    SH.items = shClone(d.items);
    SH.saved = shClone(d.items);
    SH.locked = d.locked || [];
    SH.library = d.library || [];
    renderShop();
  }
  const shopDirty = () => JSON.stringify(SH.items) !== JSON.stringify(SH.saved);

  // Vật phẩm → cấu hình vẽ (giống trang chơi; "Theo Sĩ Tượng Kỳ" = giao diện mặc định ở trang Bàn cờ & quân cờ)
  function shopTheme(it) {
    const base = themeCache || BR.DEFAULT_THEME;
    if (it.cat === 'board') {
      const b = it.board;
      const board = b.type === 'default' ? base.board
        : b.type === 'image' ? (b.xs ? b : BR.BUILTIN_BOARDS.find((x) => x.src === b.src) || base.board)
          : { type: 'classic', name: it.name, palette: b.palette };
      return { board, pieces: base.pieces };
    }
    const style = it.pieces.style === 'default' ? base.pieces.style : it.pieces.style;
    return { board: { type: 'classic', palette: 'classic' }, pieces: { ...base.pieces, style } };
  }
  function shopThumb(it) {
    if (it.cat === 'clock') {
      return h('div', { class: 'sh-thumb sh-clock clock-' + it.clock.style }, h('div', { class: 'clock-demo running' }, h('b', {}, '05:00')));
    }
    const t = shopTheme(it);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sh-thumb');
    if (it.cat === 'board') {
      const g = BR.drawBoard(svg, t);
      const b = XQ.initialBoard();
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (b[r][c]) BR.drawPiece(svg, t, g.unit, b[r][c], XQ.CHARS[b[r][c]], g.xs[c], g.ys[r]);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    } else {
      BR.drawBoard(svg, t);
      svg.setAttribute('viewBox', '230 330 440 340');
      BR.drawPiece(svg, t, 1.1, 'rK', XQ.CHARS.rK, 350, 430);
      BR.drawPiece(svg, t, 1.1, 'bK', XQ.CHARS.bK, 550, 430);
      BR.drawPiece(svg, t, 1.1, 'rN', XQ.CHARS.rN, 350, 570);
      BR.drawPiece(svg, t, 1.1, 'bR', XQ.CHARS.bR, 550, 570);
    }
    return svg;
  }
  // Mô tả kiểu (để admin biết món này vẽ bằng gì)
  function shopKind(it) {
    if (it.cat === 'clock') return 'Kiểu: ' + (CLOCK_NAMES[it.clock.style] || it.clock.style);
    if (it.cat === 'pieces') return it.pieces.style === 'default' ? 'Theo giao diện mặc định' : 'Kiểu: ' + (BR.PIECE_STYLES[it.pieces.style] || it.pieces.style);
    const b = it.board;
    if (b.type === 'default') return 'Theo giao diện mặc định';
    if (b.type === 'classic') return 'Vẽ · bảng màu ' + ((BR.PALETTES[b.palette] || {}).name || b.palette);
    return b.xs ? 'Ảnh tải lên' : 'Ảnh có sẵn';
  }

  function renderShop() {
    const box = $('sh-grid');
    if (!SH.items) { box.replaceChildren(h('div', { class: 'empty' }, 'Đang tải…')); return; }
    document.querySelectorAll('#sh-tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === SH.cat);
      b.querySelector('em').textContent = SH.items.filter((x) => x.cat === b.dataset.cat).length;
    });
    const list = SH.items.filter((x) => x.cat === SH.cat);
    const move = (it, d) => {
      const group = SH.items.filter((x) => x.cat === it.cat);
      const j = group.indexOf(it) + d;
      if (j < 0 || j >= group.length) return;
      const a = SH.items.indexOf(it), b = SH.items.indexOf(group[j]);
      [SH.items[a], SH.items[b]] = [SH.items[b], SH.items[a]];
      renderShop();
    };
    box.replaceChildren(...list.map((it, i) => {
      const locked = SH.locked.includes(it.id);
      const upd = (k, v) => { it[k] = v; renderShopState(); };
      const price = h('input', { type: 'number', min: 0, step: 1, value: it.price, disabled: locked, oninput: (e) => upd('price', e.target.value === '' ? '' : Number(e.target.value)) });
      const sale = h('label', { class: 'sh-sale' + (it.hidden ? ' off' : ''), title: locked ? 'Món mặc định luôn có' : '' },
        h('input', { type: 'checkbox', checked: !it.hidden, disabled: locked, onchange: (e) => { it.hidden = !e.target.checked; renderShop(); } }),
        it.hidden ? 'Đã ẩn khỏi Cửa hàng' : 'Đang bán');
      return h('div', { class: 'card sh-item' + (it.hidden ? ' is-hidden' : '') },
        h('div', { class: 'sh-top' }, shopThumb(it),
          h('div', { class: 'sh-order' },
            h('button', { class: 'btn sm', title: 'Đưa lên trước', disabled: i === 0, onclick: () => move(it, -1) }, '↑'),
            h('button', { class: 'btn sm', title: 'Đưa xuống sau', disabled: i === list.length - 1, onclick: () => move(it, 1) }, '↓'),
            locked ? null : h('button', { class: 'btn sm danger', title: 'Xoá vật phẩm', onclick: () => removeShopItem(it) }, '×'))),
        h('div', { class: 'sh-kind' }, locked ? h('span', { class: 'tag' }, 'Mặc định') : null, h('small', { class: 'muted' }, shopKind(it))),
        h('label', { class: 'field' }, h('span', {}, 'Tên'), h('input', { value: it.name, maxlength: 40, oninput: (e) => upd('name', e.target.value) })),
        h('label', { class: 'field' }, h('span', {}, 'Mô tả'), h('input', { value: it.desc || '', maxlength: 80, oninput: (e) => upd('desc', e.target.value) })),
        h('div', { class: 'sh-row' }, h('label', { class: 'field' }, h('span', {}, locked ? 'Giá (luôn miễn phí)' : 'Giá (xu, 0 = miễn phí)'), price), sale));
    }), h('button', { class: 'card sh-add', onclick: () => addShopItem(SH.cat) }, h('b', {}, '+'), `Thêm ${SH_CATS[SH.cat].toLowerCase()}`));
    renderShopState();
  }
  function renderShopState() {
    const dirty = shopDirty();
    $('sh-save').disabled = !dirty;
    $('sh-undo').disabled = !dirty;
    $('sh-status').textContent = dirty ? 'Có thay đổi chưa lưu — bấm “Lưu thay đổi” để người chơi thấy.' : '';
  }

  function removeShopItem(it) {
    if (!confirm(`Xoá "${it.name}"?\nNgười chơi đã mua sẽ mất món này (đang dùng thì tự về món mặc định).\nMuốn ngừng bán nhưng giữ cho người đã mua → bỏ chọn “Đang bán”.`)) return;
    SH.items = SH.items.filter((x) => x !== it);
    renderShop();
  }

  // Thêm vật phẩm mới: chọn kiểu rồi đặt tên, giá
  function addShopItem(cat) {
    let sources;
    if (cat === 'board') {
      sources = [
        ...Object.entries(BR.PALETTES).map(([k, p]) => ({ label: 'Vẽ · ' + p.name, name: p.name, board: { type: 'classic', palette: k } })),
        ...BR.BUILTIN_BOARDS.filter((b) => b.type === 'image').map((b) => ({ label: 'Ảnh · ' + b.name, name: b.name, board: { type: 'image', src: b.src } })),
        ...SH.library.map((b) => ({ label: 'Ảnh tải lên · ' + b.name, name: b.name, board: { type: 'image', src: b.src, width: b.width, height: b.height, xs: b.xs, ys: b.ys, bg: b.bg } })),
      ];
    } else if (cat === 'pieces') {
      sources = Object.entries(BR.PIECE_STYLES).map(([k, n]) => ({ label: n, name: n, pieces: { style: k } }));
    } else {
      sources = Object.entries(CLOCK_NAMES).map(([k, n]) => ({ label: n, name: n, clock: { style: k } }));
    }
    let pick = 0;
    const err = h('p', { class: 'form-err' });
    const name = h('input', { maxlength: 40, value: sources[0].name });
    const desc = h('input', { maxlength: 80, placeholder: 'Một dòng giới thiệu ngắn' });
    const price = h('input', { type: 'number', min: 0, step: 1, value: 100 });
    const preview = h('div', { class: 'sh-add-preview' });
    const draft = () => {
      const { label, ...src } = sources[pick];
      return { cat, ...src, name: name.value.trim(), desc: desc.value.trim(), price: Number(price.value), hidden: false };
    };
    const show = () => preview.replaceChildren(shopThumb(draft()));
    const select = h('select', { onchange: (e) => {
      const prev = sources[pick].name;
      pick = +e.target.value;
      if (!name.value.trim() || name.value === prev) name.value = sources[pick].name;
      show();
    } }, ...sources.map((s, i) => h('option', { value: i }, s.label)));
    const close = () => modal.remove();
    const form = h('form', { class: 'ud-form', onsubmit: (e) => {
      e.preventDefault();
      const it = draft();
      if (!it.name) { err.textContent = 'Cần có tên.'; return; }
      if (!Number.isInteger(it.price) || it.price < 0) { err.textContent = 'Giá phải là số nguyên ≥ 0.'; return; }
      SH.items.push(it);
      close();
      renderShop();
      toast('Đã thêm — bấm “Lưu thay đổi” để đưa lên Cửa hàng.');
    } },
      h('h2', {}, `Thêm ${SH_CATS[cat].toLowerCase()}`),
      preview,
      h('label', { class: 'field' }, h('span', {}, 'Kiểu'), select,
        cat === 'board' ? h('small', { class: 'muted' }, 'Muốn dùng ảnh riêng: tải ảnh lên ở trang “Bàn cờ & quân cờ” trước, ảnh sẽ có trong danh sách này.') : null),
      h('label', { class: 'field' }, h('span', {}, 'Tên'), name),
      h('label', { class: 'field' }, h('span', {}, 'Mô tả'), desc),
      h('label', { class: 'field' }, h('span', {}, 'Giá (xu, 0 = miễn phí)'), price),
      err,
      h('div', { class: 'ud-form-acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Huỷ'), h('button', { class: 'btn primary' }, 'Thêm')));
    const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } }, h('div', { class: 'modal-card' }, form));
    document.body.appendChild(modal);
    show();
  }

  document.querySelectorAll('#sh-tabs button').forEach((b) => b.addEventListener('click', () => { SH.cat = b.dataset.cat; renderShop(); }));
  $('sh-undo').addEventListener('click', () => { SH.items = shClone(SH.saved); renderShop(); });
  $('sh-save').addEventListener('click', async () => {
    $('sh-save').disabled = true;
    try {
      setShopData(await api('PUT', '/shop', { items: SH.items }));
      toast('Đã lưu — Cửa hàng của người chơi cập nhật ngay.');
    } catch (err) {
      $('sh-status').textContent = err.message;
      $('sh-save').disabled = false;
    }
  });
  $('sh-reset').addEventListener('click', async () => {
    if (!confirm('Đưa Cửa hàng về danh sách vật phẩm gốc? Các món đã thêm sẽ bị xoá, tên & giá về như ban đầu.')) return;
    try {
      setShopData(await api('POST', '/shop/reset'));
      toast('Đã khôi phục vật phẩm gốc.');
    } catch (err) { toast(err.message); }
  });
  window.addEventListener('beforeunload', (e) => { if (SH.items && shopDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Điều hướng ----------
  // Menu trái: mỗi mục là một trang, ghi vào #hash để tải lại vẫn giữ trang
  const PAGES = {
    overview: 'Tổng quan', features: 'Chức năng web', 'site-config': 'Cài đặt hệ thống', rooms: 'Phòng & trận đấu', users: 'Kỳ thủ', user: 'Chi tiết kỳ thủ', ranking: 'Bảng xếp hạng',
    puzzles: 'Cờ thế', puzzle: 'Soạn cờ thế', feedback: 'Góp ý', theme: 'Bàn cờ & quân cờ', shop: 'Cửa hàng vật phẩm', economy: 'Chế độ chơi & xu', community: 'Cộng đồng',
    tournaments: 'Giải đấu', tournament: 'Chi tiết giải', bots: 'Bot AI',
  };
  function route() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('user/')) showUserPage(decodeURIComponent(hash.slice(5)));
    else if (hash.startsWith('puzzle/')) openEditor(decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('tournament/')) openTourDetail(decodeURIComponent(hash.slice(11)));
    else showPage(hash);
  }
  function showPage(name) {
    if (!PAGES[name]) name = 'overview';
    const navName = name === 'user' ? 'users' : name === 'puzzle' ? 'puzzles' : name === 'tournament' ? 'tournaments' : name;
    document.querySelectorAll('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === navName));
    for (const p of Object.keys(PAGES)) $('page-' + p).classList.toggle('hidden', p !== name);
    $('page-title').textContent = PAGES[name];
    document.title = `${PAGES[name]} · Quản trị Sĩ Tượng Kỳ`;
    if (!['user', 'puzzle', 'tournament'].includes(name) && location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (name === 'tournaments') loadTournaments();
    if (name === 'puzzles') loadPuzzles();
    if (name === 'ranking') loadRanking();
    if (name === 'theme') loadTheme();
    if (name === 'shop') loadShop();
    if (name === 'features') loadFeatures();
    if (name === 'bots') loadBots();
    if (name === 'site-config') loadSiteConfig();
    if (name === 'economy') loadEconomy(true);
    if (name === 'community') loadCommunityAdmin();
    if (name === 'feedback') loadFeedback();
    window.scrollTo(0, 0);
    closeMenu();
  }
  const closeMenu = () => $('sidebar').classList.remove('open');
  document.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.page; }));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.goto; }));
  $('menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('sidebar-backdrop').addEventListener('click', closeMenu);
  window.addEventListener('hashchange', route);

  let toastTimer;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
  }

  // ---------- Cộng đồng: xem & xoá tin nhắn ----------
  async function loadCommunityAdmin() {
    const box = $('cm-admin-list');
    box.replaceChildren(h('div', { class: 'empty' }, 'Đang tải…'));
    try {
      const { messages } = await api('GET', '/community');
      renderCommunityAdmin(messages);
    } catch (err) { box.replaceChildren(h('div', { class: 'empty' }, err.message)); }
  }
  function renderCommunityAdmin(messages) {
    const box = $('cm-admin-list');
    if (!messages.length) return box.replaceChildren(h('div', { class: 'empty' }, 'Chưa có tin nhắn nào.'));
    box.replaceChildren(h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Người gửi'), h('th', {}, 'Nội dung'), h('th', {}, 'Thời gian'), h('th'))),
      h('tbody', {}, messages.map((m) => h('tr', {},
        h('td', {}, h('b', {}, m.author.name), h('small', { class: 'muted sub' }, '@' + (m.author.username || ''))),
        h('td', { class: 'cm-admin-text' }, m.text || '', m.position ? h('small', { class: 'muted sub' }, `Đính kèm thế cờ: ${m.position.title} (${m.position.moves.length} nước)`) : null),
        h('td', {}, new Date(m.at).toLocaleString('vi-VN')),
        h('td', { class: 'num' }, h('button', { class: 'btn sm danger', onclick: async () => {
          if (!confirm('Xoá tin nhắn này?')) return;
          try { renderCommunityAdmin((await api('DELETE', '/community/' + encodeURIComponent(m.id))).messages); toast('Đã xoá tin.'); } catch (err) { toast(err.message); }
        } }, 'Xoá')))))));
  }
  $('cm-reload').addEventListener('click', loadCommunityAdmin);

  // ---------- Chế độ chơi & xu (nhịp, phí, thưởng) ----------
  const EC = { current: null, defaults: null, draft: null, loading: false };
  const ecoClone = (o) => JSON.parse(JSON.stringify(o));
  const ecoGet = (o, k) => k.split('.').reduce((a, p) => (a ? a[p] : undefined), o);
  const ecoSet = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((a, p) => a[p], o)[last] = v; };
  const ecoNum = (v) => (v === '' ? '' : Number(v));

  async function loadEconomy(force) {
    if ((EC.current && !force) || EC.loading) return renderEconomy();
    EC.loading = true;
    try {
      const r = await api('GET', '/economy');
      EC.current = r.current; EC.defaults = r.defaults; EC.draft = ecoClone(r.current);
      renderEconomy();
    } catch (err) {
      // Server đang chạy bản cũ (chưa có API này) → báo rõ cách khắc phục
      const old = /404|Not Found|Có lỗi xảy ra/.test(err.message);
      $('eco-status').textContent = old
        ? 'Server đang chạy bản cũ, chưa có phần cài đặt này — hãy khởi động lại server (Ctrl+C rồi npm start) và tải lại trang.'
        : err.message;
      toast(err.message);
    } finally {
      EC.loading = false;
    }
  }

  function ecoChanged() {
    const dirty = EC.current && JSON.stringify(EC.draft) !== JSON.stringify(EC.current);
    $('eco-save').disabled = !dirty;
    $('eco-undo').disabled = !dirty;
    $('eco-status').textContent = dirty ? 'Có thay đổi chưa lưu.' : '';
    const d = EC.draft;
    const tc = d.RANKED_TC;
    $('eco-ranked-preview').textContent = `Người chơi thấy: nhịp ${tc.totalMin}p + ${tc.incSec}s · phí ${d.RANKED_FEE} xu · `
      + `thắng +${Number(d.RANKED_REWARD_PLAY) + Number(d.RANKED_REWARD_WIN)} xu, thua/hoà +${d.RANKED_REWARD_PLAY} xu (chơi trọn ván).`;
  }

  function renderEconomy() {
    if (!EC.draft) return;
    const d = EC.draft;
    document.querySelectorAll('#page-economy input[data-k]').forEach((inp) => { inp.value = ecoGet(d, inp.dataset.k); });
    // Nhịp Chơi nhanh: Nhóm · Phút · Giây cộng · Xoá
    $('eco-tcs').replaceChildren(
      h('div', { class: 'eco-tc head' }, h('span', {}, 'Nhóm'), h('span', {}, 'Phút mỗi bên'), h('span', {}, 'Giây cộng'), h('span')),
      ...d.COIN_TCS.map((t, i) => {
        const [m, sec] = t.tc.split('|');
        const upd = (row) => {
          const mm = row.querySelector('.m').value, ss = row.querySelector('.s').value;
          d.COIN_TCS[i] = { group: row.querySelector('.g').value, tc: `${mm}|${ss || 0}` };
          ecoChanged();
        };
        const row = h('div', { class: 'eco-tc' },
          h('input', { class: 'g', value: t.group, maxlength: 20, placeholder: 'Cờ chớp', 'aria-label': 'Nhóm' }),
          h('input', { class: 'm', type: 'number', min: 1, max: 180, value: m, 'aria-label': 'Phút' }),
          h('input', { class: 's', type: 'number', min: 0, max: 60, value: sec, 'aria-label': 'Giây cộng' }),
          h('button', { class: 'icon-btn', title: 'Xoá nhịp', 'aria-label': 'Xoá nhịp', disabled: d.COIN_TCS.length <= 1 ? true : null,
            onclick: () => { d.COIN_TCS.splice(i, 1); renderEconomy(); } }, '✕'));
        row.addEventListener('input', () => upd(row));
        return row;
      }));
    $('eco-add-tc').disabled = d.COIN_TCS.length >= 12;
    // Mức đặt
    $('eco-stakes').replaceChildren(...d.STAKES.map((v, i) => {
      const inp = h('input', { type: 'number', min: 1, step: 1, value: v, 'aria-label': 'Mức đặt' });
      inp.addEventListener('input', () => { d.STAKES[i] = ecoNum(inp.value); ecoChanged(); });
      return h('div', { class: 'eco-stake' }, inp, h('span', {}, 'xu'),
        h('button', { class: 'icon-btn', title: 'Xoá mức', 'aria-label': 'Xoá mức', disabled: d.STAKES.length <= 1 ? true : null,
          onclick: () => { d.STAKES.splice(i, 1); renderEconomy(); } }, '✕'));
    }));
    $('eco-add-stake').disabled = d.STAKES.length >= 10;
    ecoChanged();
  }

  document.querySelectorAll('#page-economy input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
    if (!EC.draft) return;
    ecoSet(EC.draft, inp.dataset.k, ecoNum(inp.value));
    ecoChanged();
  }));
  $('eco-add-tc').addEventListener('click', () => {
    const last = EC.draft.COIN_TCS[EC.draft.COIN_TCS.length - 1];
    EC.draft.COIN_TCS.push({ group: last ? last.group : 'Cờ nhanh', tc: '15|0' });
    renderEconomy();
  });
  $('eco-add-stake').addEventListener('click', () => {
    EC.draft.STAKES.push((EC.draft.STAKES[EC.draft.STAKES.length - 1] || 50) * 2);
    renderEconomy();
  });
  $('eco-undo').addEventListener('click', () => { EC.draft = ecoClone(EC.current); renderEconomy(); });
  $('eco-save').addEventListener('click', async () => {
    $('eco-save').disabled = true;
    try {
      const r = await api('PUT', '/economy', EC.draft);
      EC.current = r.current; EC.draft = ecoClone(r.current);
      renderEconomy();
      toast('Đã lưu — trang chơi cập nhật ngay.');
    } catch (err) {
      $('eco-status').textContent = err.message;
      $('eco-save').disabled = false;
    }
  });
  $('eco-reset').addEventListener('click', async () => {
    if (!confirm('Khôi phục toàn bộ cài đặt chế độ chơi & xu về mặc định?')) return;
    try {
      const r = await api('POST', '/economy/reset');
      EC.current = r.current; EC.draft = ecoClone(r.current);
      renderEconomy();
      toast('Đã khôi phục mặc định.');
    } catch (err) { toast(err.message); }
  });

  // ---------- Bàn cờ & quân cờ mặc định ----------
  const T = { current: null, library: [], draft: null, pendingFile: null, pendingUrl: null, loading: false };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Font chữ Hán cho bản xem trước
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = BR.FONT_CSS;
  document.head.appendChild(fontLink);
  document.fonts && document.fonts.ready.then(() => T.draft && renderTheme());

  async function loadTheme() {
    loadPub();
    if (T.current || T.loading) return;
    T.loading = true;
    try {
      setThemeData(await api('GET', '/theme'));
    } catch (err) {
      toast(err.message);
    } finally {
      T.loading = false;
    }
  }

  function setThemeData({ current, library }) {
    T.current = current;
    T.library = library;
    T.draft = clone(current);
    themeCache = current; // cờ thế & biên bản dùng giao diện mới
    clearPending();
    renderTheme();
  }

  function clearPending() {
    if (T.pendingUrl) URL.revokeObjectURL(T.pendingUrl);
    T.pendingFile = null;
    T.pendingUrl = null;
  }

  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // Bàn cờ xem trước với thế cờ ban đầu
  function renderPreview() {
    const svg = $('tp-board');
    const geo = BR.drawBoard(svg, T.draft);
    const layer = svgEl('g', {}, svg);
    const b = XQ.initialBoard();
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (b[r][c]) BR.drawPiece(layer, T.draft, geo.unit, b[r][c], XQ.CHARS[b[r][c]], geo.xs[c], geo.ys[r]);
      }
    }
    if ($('tp-dots').checked) {
      for (const y of geo.ys) {
        for (const x of geo.xs) {
          svgEl('circle', { cx: x, cy: y, r: 9 * geo.unit, fill: '#e0281b', stroke: '#fff', 'stroke-width': 2.5 * geo.unit }, layer);
        }
      }
    }
  }

  function boardThumb(board) {
    if (board.type === 'image') return h('img', { class: 'thumb', src: board.src, alt: '' });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'thumb');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    BR.drawBoard(svg, { board, pieces: T.draft.pieces });
    return svg;
  }

  function renderTheme() {
    if (!T.draft) return;
    const d = T.draft;

    // Danh sách bàn cờ: có sẵn + đã tải lên + ảnh đang chờ lưu
    const palettes = Object.entries(BR.PALETTES).map(([palette, p]) => ({ type: 'classic', name: p.name, palette }));
    const boards = [...BR.BUILTIN_BOARDS.filter((b) => b.type === 'image'), ...palettes, ...T.library];
    if (T.pendingUrl && !boards.some((b) => b.src === T.pendingUrl)) boards.push(d.board);
    $('board-list').replaceChildren(...boards.map((board) => {
      const active = board.type === d.board.type && (board.type === 'classic' ? (board.palette || 'classic') === (d.board.palette || 'classic') : board.src === d.board.src);
      const opt = h('div', { class: 'opt' + (active ? ' active' : ''), title: board.name, onclick: () => selectBoard(board) }, boardThumb(board), board.name, pubBadge('board', boardKey(board)));
      if (board.type === 'image' && board.src.startsWith('/uploads/')) {
        opt.appendChild(h('button', { class: 'del', title: 'Xoá bàn cờ này', onclick: (e) => { e.stopPropagation(); deleteBoard(board); } }, '×'));
      }
      return opt;
    }));

    // Căn chỉnh lưới (chỉ cho bàn cờ dạng ảnh)
    const isImage = d.board.type === 'image';
    $('calib').classList.toggle('hidden', !isImage);
    if (isImage) {
      $('calib-name').value = d.board.name || '';
      $('c-x0').value = Math.round(d.board.xs[0]);
      $('c-x8').value = Math.round(d.board.xs[8]);
      $('c-y0').value = Math.round(d.board.ys[0]);
      $('c-y9').value = Math.round(d.board.ys[9]);
      for (const id of ['c-x0', 'c-x8']) $(id).max = d.board.width;
      for (const id of ['c-y0', 'c-y9']) $(id).max = d.board.height;
    }

    // Kiểu quân cờ: vẽ trên nền bàn cổ điển để có gradient & thấy rõ quân
    $('piece-list').replaceChildren(...Object.entries(BR.PIECE_STYLES).map(([style, name]) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'thumb');
      const t = { board: { type: 'classic' }, pieces: { ...d.pieces, style } };
      BR.drawBoard(svg, t);
      svg.setAttribute('viewBox', '230 330 440 340');
      BR.drawPiece(svg, t, 1.1, 'rK', XQ.CHARS.rK, 350, 430);
      BR.drawPiece(svg, t, 1.1, 'bK', XQ.CHARS.bK, 550, 430);
      BR.drawPiece(svg, t, 1.1, 'rN', XQ.CHARS.rN, 350, 570);
      BR.drawPiece(svg, t, 1.1, 'bR', XQ.CHARS.bR, 550, 570);
      return h('div', { class: 'opt' + (d.pieces.style === style ? ' active' : ''), onclick: () => { d.pieces.style = style; renderTheme(); } }, svg, name, pubBadge('pieces', style));
    }));

    const font = $('pc-font');
    if (!font.options.length) {
      for (const [k, f] of Object.entries(BR.FONTS)) font.appendChild(h('option', { value: k }, f.name));
    }
    font.value = d.pieces.font;
    $('pc-red').value = d.pieces.red;
    $('pc-black').value = d.pieces.black;

    const dirty = !same(d, T.current) || !!T.pendingFile;
    $('theme-dirty').textContent = dirty ? 'Có thay đổi chưa lưu' : 'Đang áp dụng cho mọi người chơi';
    $('theme-save').disabled = !dirty;
    renderPreview();
    renderPublish();
  }

  // ---------- Phát hành bàn cờ / kiểu quân cho kỳ thủ: không phát hành · miễn phí (tặng mọi kỳ thủ) · bán bằng xu ----------
  // Dùng chung danh sách vật phẩm với trang Cửa hàng vật phẩm (/admin/api/shop)
  const PUB = { items: null, ui: { board: null, pieces: null }, busy: false };
  async function loadPub() {
    try { PUB.items = (await api('GET', '/shop')).items; } catch (err) { /* chưa có quyền / server cũ */ }
    if (T.draft) renderTheme();
  }
  const boardKey = (b) => (b.type === 'classic' ? 'c:' + (b.palette || 'classic') : b.type === 'image' ? 'i:' + b.src : 'd');
  const itemKey = (it) => (it.cat === 'board' ? (it.board.type === 'default' ? 'd' : boardKey(it.board)) : it.cat === 'pieces' ? it.pieces.style : null);
  const pubItem = (cat, key) => (PUB.items || []).find((it) => it.cat === cat && itemKey(it) === key);
  const pubMode = (it) => (!it || it.hidden ? 'none' : it.price === 0 ? 'free' : 'sale');
  function pubBadge(cat, key) {
    const it = pubItem(cat, key), m = pubMode(it);
    if (m === 'none') return null;
    return h('span', { class: 'pub-badge ' + m }, m === 'free' ? 'Miễn phí' : `${fmt(it.price)} xu`);
  }
  function renderPublish() {
    if (!T.draft) return;
    const d = T.draft;
    const pendingImg = d.board.type === 'image' && T.pendingUrl && d.board.src === T.pendingUrl;
    renderPubBox('board', $('pub-board'), boardKey(d.board), d.board.name || 'Bàn cờ', pendingImg);
    renderPubBox('pieces', $('pub-pieces'), d.pieces.style, BR.PIECE_STYLES[d.pieces.style] || 'Quân cờ', false);
  }
  function renderPubBox(cat, box, key, defName, pendingImg) {
    const it = pubItem(cat, key);
    // Khởi tạo lại ô nhập khi đổi lựa chọn
    if (!PUB.ui[cat] || PUB.ui[cat].key !== key) {
      PUB.ui[cat] = { key, mode: pubMode(it), price: it && it.price ? it.price : 100, name: it ? it.name : defName, desc: it ? it.desc || '' : '' };
    }
    const u = PUB.ui[cat];
    const what = cat === 'board' ? 'bàn cờ' : 'kiểu quân';
    const status = !PUB.items ? 'Đang tải…'
      : !it ? `Chưa phát hành — kỳ thủ chưa có ${what} này.`
        : it.hidden ? 'Đã ngừng phát hành — ai đã có vẫn giữ, không bán thêm.'
          : it.price === 0 ? 'Đang tặng miễn phí — mọi kỳ thủ đều có trong Túi đồ.'
            : `Đang bán trong Cửa hàng: ${fmt(it.price)} xu.`;
    const opt = (m, label, sub) => h('label', { class: 'pub-opt' + (u.mode === m ? ' on' : '') },
      h('input', { type: 'radio', name: 'pub-' + cat, checked: u.mode === m, onchange: () => { u.mode = m; renderPublish(); } }),
      h('span', {}, h('b', {}, label), h('small', {}, sub)));
    box.replaceChildren(
      h('div', { class: 'pub-head' }, h('b', {}, `Phát hành ${what} cho kỳ thủ`), h('span', { class: 'pub-status ' + pubMode(it) }, status)),
      h('div', { class: 'pub-opts' },
        opt('none', 'Không phát hành', 'Không có trong Túi đồ / Cửa hàng'),
        opt('free', 'Miễn phí', 'Tặng cho mọi kỳ thủ'),
        opt('sale', 'Bán bằng xu', 'Đưa vào Cửa hàng')),
      u.mode === 'none' ? null : h('div', { class: 'pub-fields' },
        h('label', { class: 'field' }, h('span', {}, 'Tên trong Túi đồ'), h('input', { value: u.name, maxlength: 40, oninput: (e) => { u.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', {}, 'Mô tả ngắn'), h('input', { value: u.desc, maxlength: 80, placeholder: 'vd Gỗ sẫm màu, ấm', oninput: (e) => { u.desc = e.target.value; } })),
        u.mode === 'sale' ? h('label', { class: 'field' }, h('span', {}, 'Giá (xu)'), h('input', { type: 'number', min: 1, step: 1, value: u.price, oninput: (e) => { u.price = Number(e.target.value); } })) : null),
      pendingImg ? h('p', { class: 'muted small' }, 'Ảnh mới sẽ được tải lên khi bấm Lưu phát hành — không đổi bàn cờ mặc định.') : null,
      h('button', { class: 'btn primary sm', disabled: PUB.busy || !PUB.items, onclick: () => savePub(cat) }, PUB.busy ? 'Đang lưu…' : 'Lưu phát hành'));
  }
  async function savePub(cat) {
    const u = PUB.ui[cat];
    if (u.mode !== 'none' && !String(u.name || '').trim()) return toast('Cần đặt tên hiển thị.');
    if (u.mode === 'sale' && !(Number.isInteger(u.price) && u.price > 0)) return toast('Giá phải là số nguyên lớn hơn 0.');
    PUB.busy = true; renderPublish();
    try {
      let spec, key = u.key;
      if (cat === 'board') {
        const b = clone(T.draft.board);
        // Ảnh vừa chọn chưa tải lên: tải lên & đưa vào thư viện (không áp dụng làm mặc định)
        if (b.type === 'image' && T.pendingFile && b.src === T.pendingUrl) {
          const res = await fetch('/admin/api/uploads', { method: 'POST', headers: { 'Content-Type': T.pendingFile.type }, body: T.pendingFile, credentials: 'same-origin' });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Tải ảnh lên thất bại.');
          b.src = json.src;
          const added = await api('POST', '/boards', { board: b });
          T.library = added.library;
          T.draft.board = clone(added.board);
          clearPending();
          key = boardKey(added.board);
          PUB.ui.board.key = key;
        } else if (b.type === 'image' && !BR.BUILTIN_BOARDS.some((x) => x.src === b.src) && T.library.some((x) => x.src === b.src)) {
          await api('POST', '/boards', { board: b }); // cập nhật toạ độ lưới mới nhất cho vật phẩm
        }
        spec = { board: b.type === 'classic' ? { type: 'classic', palette: b.palette || 'classic' } : { type: 'image', src: T.draft.board.src } };
      } else {
        spec = { pieces: { style: key } };
      }
      const items = clone(PUB.items);
      const i = items.findIndex((it) => it.cat === cat && itemKey(it) === key);
      if (u.mode === 'none') {
        if (i >= 0) items[i].hidden = true;
      } else {
        const fields = { name: u.name.trim(), desc: (u.desc || '').trim(), price: u.mode === 'free' ? 0 : u.price, hidden: false };
        if (i >= 0) Object.assign(items[i], fields, spec);
        else items.push({ cat, ...spec, ...fields });
      }
      const d = await api('PUT', '/shop', { items });
      PUB.items = d.items;
      if (typeof SH !== 'undefined' && SH.items && JSON.stringify(SH.items) === JSON.stringify(SH.saved)) setShopData(d);
      toast(u.mode === 'none' ? 'Đã ngừng phát hành.' : u.mode === 'free' ? 'Đã tặng miễn phí cho mọi kỳ thủ.' : `Đã đưa vào Cửa hàng với giá ${fmt(u.price)} xu.`);
    } catch (err) {
      toast(err.message);
    } finally {
      PUB.busy = false;
      renderTheme();
    }
  }

  function selectBoard(board) {
    T.draft.board = clone(board);
    renderTheme();
  }

  async function deleteBoard(board) {
    if (!confirm(`Xoá bàn cờ "${board.name}"?`)) return;
    try {
      const res = await api('DELETE', '/boards', { src: board.src });
      const draft = T.draft;
      setThemeData(res);
      if (draft.board.src !== board.src) { T.draft = draft; renderTheme(); }
      toast('Đã xoá bàn cờ.');
    } catch (err) {
      toast(err.message);
    }
  }

  // Lưới chia đều giữa 2 đường ngoài cùng
  const spread = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

  function onCalibInput() {
    const b = T.draft.board;
    const x0 = +$('c-x0').value, x8 = +$('c-x8').value, y0 = +$('c-y0').value, y9 = +$('c-y9').value;
    if (!(x8 > x0 && y9 > y0)) return;
    b.xs = spread(x0, x8, 9);
    b.ys = spread(y0, y9, 10);
    $('calib-status').textContent = 'Đang chỉnh tay';
    $('tp-dots').checked = true;
    renderTheme();
  }
  for (const id of ['c-x0', 'c-x8', 'c-y0', 'c-y9']) $(id).addEventListener('change', onCalibInput);
  $('calib-name').addEventListener('input', () => {
    T.draft.board.name = $('calib-name').value;
    $('theme-dirty').textContent = 'Có thay đổi chưa lưu';
    $('theme-save').disabled = false;
  });
  $('tp-dots').addEventListener('change', renderPreview);
  $('pc-font').addEventListener('change', () => { T.draft.pieces.font = $('pc-font').value; renderTheme(); });
  $('pc-red').addEventListener('input', () => { T.draft.pieces.red = $('pc-red').value; renderTheme(); });
  $('pc-black').addEventListener('input', () => { T.draft.pieces.black = $('pc-black').value; renderTheme(); });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:/.test(src)) img.crossOrigin = 'anonymous'; // ảnh trên Supabase Storage: cần CORS để đọc điểm ảnh
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không đọc được ảnh.'));
      img.src = src;
    });
  }

  // Tự nhận diện 9 đường dọc & 10 đường ngang bằng cách tìm các dải pixel tối
  async function detectGrid(src) {
    const img = await loadImage(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    const k = Math.min(1, 1000 / Math.max(W, H));
    const w = Math.round(W * k), hgt = Math.round(H * k);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, hgt);
    const px = ctx.getImageData(0, 0, w, hgt).data;
    const lum = new Float32Array(w * hgt);
    let sum = 0;
    for (let i = 0; i < w * hgt; i++) {
      lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      sum += lum[i];
    }
    const thr = sum / (w * hgt) - 35;
    const dark = (x, y) => (lum[y * w + x] < thr ? 1 : 0);
    // Cột: quét các hàng ở nửa trên & nửa dưới (tránh sông); Hàng: quét 2 dải bên (tránh đường chéo cung tướng)
    const colScore = new Float32Array(w), rowScore = new Float32Array(hgt);
    for (let x = 0; x < w; x++) {
      for (let y = Math.round(hgt * 0.1); y < hgt * 0.9; y++) if (y < hgt * 0.42 || y > hgt * 0.58) colScore[x] += dark(x, y);
    }
    for (let y = 0; y < hgt; y++) {
      for (let x = Math.round(w * 0.08); x < w * 0.92; x++) if (x < w * 0.33 || x > w * 0.67) rowScore[y] += dark(x, y);
    }
    const peaks = (arr, n, minGap) => {
      const max = Math.max(...arr);
      const cand = [];
      for (let i = 1; i < arr.length - 1; i++) {
        if (arr[i] >= max * 0.35 && arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1]) cand.push(i);
      }
      // Gộp các đỉnh sát nhau, giữ đỉnh mạnh nhất
      const merged = [];
      for (const i of cand) {
        const last = merged[merged.length - 1];
        if (last !== undefined && i - last < minGap) { if (arr[i] > arr[last]) merged[merged.length - 1] = i; } else merged.push(i);
      }
      // Lấy n đỉnh mạnh nhất, kiểm tra khoảng cách gần đều
      const top = [...merged].sort((a, b) => arr[b] - arr[a]).slice(0, n).sort((a, b) => a - b);
      if (top.length !== n) return null;
      const gaps = top.slice(1).map((v, i) => v - top[i]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      return gaps.every((g) => Math.abs(g - mean) < mean * 0.3) ? top : null;
    };
    const xs = peaks(colScore, 9, w / 20);
    const ys = peaks(rowScore, 10, hgt / 22);
    const bgPx = ctx.getImageData(Math.round(w * 0.01), Math.round(hgt / 2), 1, 1).data;
    const bg = '#' + [bgPx[0], bgPx[1], bgPx[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    return {
      width: W, height: H, bg,
      xs: xs ? xs.map((v) => v / k) : spread(W * 0.06, W * 0.94, 9),
      ys: ys ? ys.map((v) => v / k) : spread(H * 0.05, H * 0.95, 10),
      ok: !!(xs && ys),
    };
  }

  async function autoCalibrate() {
    const b = T.draft.board;
    try {
      const g = await detectGrid(b.src);
      Object.assign(b, { width: g.width, height: g.height, xs: g.xs, ys: g.ys });
      if (T.pendingUrl === b.src) b.bg = g.bg;
      $('calib-status').textContent = g.ok ? '✓ Đã tự nhận diện 9 cột, 10 hàng' : 'Không nhận diện được đầy đủ — hãy chỉnh tay';
      $('tp-dots').checked = true;
      renderTheme();
    } catch (err) {
      toast(err.message);
    }
  }
  $('calib-auto').addEventListener('click', autoCalibrate);

  $('board-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
    if (file.size > 10 * 1024 * 1024) return toast('Ảnh tối đa 10MB.');
    clearPending();
    T.pendingFile = file;
    T.pendingUrl = URL.createObjectURL(file);
    T.draft.board = {
      type: 'image', name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), src: T.pendingUrl,
      width: 1000, height: 1000, xs: spread(60, 940, 9), ys: spread(50, 950, 10), bg: '#e9c98f',
    };
    await autoCalibrate();
  });

  $('theme-save').addEventListener('click', async () => {
    const btn = $('theme-save');
    btn.disabled = true;
    try {
      const draft = clone(T.draft);
      // Ảnh mới: tải lên trước rồi mới lưu cấu hình
      if (T.pendingFile && draft.board.src === T.pendingUrl) {
        const res = await fetch('/admin/api/uploads', {
          method: 'POST', headers: { 'Content-Type': T.pendingFile.type }, body: T.pendingFile, credentials: 'same-origin',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Tải ảnh lên thất bại.');
        draft.board.src = json.src;
      }
      setThemeData(await api('PUT', '/theme', { board: draft.board, pieces: draft.pieces }));
      toast('Đã lưu — người chơi thấy giao diện mới ngay.');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  $('theme-reset').addEventListener('click', async () => {
    if (!confirm('Khôi phục bàn cờ và quân cờ về mặc định?')) return;
    try {
      setThemeData(await api('POST', '/theme/reset'));
      toast('Đã khôi phục mặc định.');
    } catch (err) {
      toast(err.message);
    }
  });

  // Kiểm tra đã đăng nhập chưa
  api('GET', '/me')
    .then((me) => {
      // Không đặt mật khẩu thì ẩn nút Đăng xuất
      $('logout').classList.toggle('hidden', !me.passwordRequired);
      showApp();
    })
    .catch(() => {});
})();
