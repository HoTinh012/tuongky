(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let data = null;
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

  // ---------- Dữ liệu ----------
  async function load() {
    try {
      data = await api('GET', '/overview');
      render();
    } catch (err) {
      if (!$('app').classList.contains('hidden')) toast(err.message);
    }
  }

  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('vi-VN') : '—');
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

  function render() {
    renderStats();
    renderUsers();
    renderRooms();
  }

  function renderStats() {
    const s = data.stats;
    const items = [
      [s.users, 'Tài khoản'],
      [s.online, 'Đang online', 'ok'],
      [s.rooms, 'Phòng đang mở'],
      [s.playing, 'Ván đang diễn ra'],
      [s.searching, 'Đang tìm trận'],
      [s.gamesPlayed, 'Ván đã chơi'],
      [s.banned, 'Bị khoá'],
    ];
    $('stats').replaceChildren(...items.map(([v, l, cls]) =>
      h('div', { class: 'stat ' + (cls || '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l))));
    $('c-users').textContent = s.users;
    $('c-rooms').textContent = s.rooms;

    const empty = (text) => h('div', { class: 'mini-empty' }, text);
    const online = data.users.filter((u) => u.online).slice(0, 8);
    $('ov-online').replaceChildren(...(online.length ? online.map((u) => h('div', { class: 'mini-row' },
      h('span', { class: 'dot on' }),
      h('a', { class: 'grow link-name', href: '#user/' + encodeURIComponent(u.id) }, u.name, h('span', { class: 'muted' }, ' @' + u.username)),
      u.roomId ? h('a', { class: 'room-link', href: `/?room=${u.roomId}&watch=1`, target: '_blank', rel: 'noopener' }, u.roomId) : h('span', { class: 'muted' }, 'Ở sảnh'))) : [empty('Không có tài khoản nào đang online.')]));
    const rooms = [...data.rooms].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    $('ov-rooms').replaceChildren(...(rooms.length ? rooms.map((r) => h('div', { class: 'mini-row' },
      h('a', { class: 'room-link', href: `/?room=${r.id}&watch=1`, target: '_blank', rel: 'noopener' }, r.id),
      h('span', { class: 'grow' }, `${r.players.r ? r.players.r.name : 'Trống'} vs ${r.players.b ? r.players.b.name : 'Trống'}`),
      h('span', { class: 'pill ' + r.status }, statusText[r.status]))) : [empty('Hiện không có phòng nào.')]));
  }

  const { cardTier } = window.Ranks;
  const userHref = (id) => '#user/' + encodeURIComponent(id);
  const openUser = (id) => { location.hash = userHref(id); };

  function avatarEl(u, cls = 'acc-av') {
    return u.avatar ? h('img', { class: cls, src: u.avatar, alt: '' }) : h('span', { class: cls }, (u.name || u.displayName || '?').charAt(0).toUpperCase());
  }
  const eloEl = (rating) => h('span', { class: 'rank-pill' }, h('i', { class: 'gem' }), 'Elo ' + rating);

  function renderUsers() {
    const q = $('search').value.trim().toLowerCase();
    const filter = $('filter').value;
    const sort = $('sort').value;
    let list = data.users.filter((u) =>
      (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'online' && u.online) || (filter === 'banned' && u.banned)));
    const key = {
      lastSeen: (u) => u.lastSeen, createdAt: (u) => u.createdAt, games: (u) => u.games + u.aiGames,
      winrate, rating: (u) => u.rating, coins: (u) => u.coins, credit: (u) => u.credit,
    };
    list.sort((a, b) => (b.online - a.online) * (sort === 'lastSeen') || key[sort](b) - key[sort](a));

    const body = $('users-body');
    if (!list.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 8, class: 'empty' },
        data.users.length ? 'Không có tài khoản phù hợp.' : 'Chưa có tài khoản nào. Tài khoản sẽ xuất hiện khi người chơi đăng ký.')));
      return;
    }
    body.replaceChildren(...list.map((u) => h('tr', { class: 'row-link', tabindex: 0, onclick: () => openUser(u.id), onkeydown: (e) => { if (e.key === 'Enter') openUser(u.id); } },
      h('td', {}, h('div', { class: 'acc-cell' }, avatarEl(u),
        h('div', {},
          h('div', { class: 'name' }, u.name, ' ', u.banned && h('span', { class: 'pill banned' }, 'Bị khoá')),
          h('div', { class: 'sub' }, '@' + u.username)))),
      h('td', { 'data-label': 'Elo', class: 'num' }, h('b', {}, u.rating)),
      h('td', { 'data-label': 'Trạng thái' },
        h('span', {}, h('span', { class: 'dot' + (u.online ? ' on' : '') }), u.online ? 'Online' : 'Offline',
          u.roomId && [' · ', h('a', { class: 'room-link', href: `/?room=${u.roomId}&watch=1`, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, u.roomId)])),
      h('td', { 'data-label': 'Online T-T-H', class: 'num wld' },
        h('span', {}, h('b', {}, u.wins), ' - ', h('i', {}, u.losses), ' - ', u.draws,
          h('span', { class: 'muted' }, u.games ? ` · ${Math.round((u.wins / u.games) * 100)}%` : ''))),
      h('td', { 'data-label': 'Xu', class: 'num' }, u.coins.toLocaleString('vi-VN')),
      h('td', { 'data-label': 'Uy tín', class: 'num' + (u.credit < 1000 ? ' warn' : '') }, u.credit),
      h('td', { 'data-label': 'Hoạt động' }, u.online ? 'Đang online' : ago(u.lastSeen)),
      h('td', { class: 'actions-cell' }, h('span', { class: 'chev' }, 'Chi tiết ›')),
    )));
  }

  const statusText = { waiting: 'Chờ đối thủ', playing: 'Đang chơi', finished: 'Đã kết thúc' };

  function seatCell(p, cls) {
    if (!p) return h('span', { class: 'muted' }, 'Trống');
    return h('span', { class: cls }, h('span', { class: 'dot' + (p.online ? ' on' : '') }), p.name);
  }

  function renderRooms() {
    const list = [...data.rooms].sort((a, b) => b.createdAt - a.createdAt);
    const body = $('rooms-body');
    if (!list.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'Hiện không có phòng nào.')));
      return;
    }
    body.replaceChildren(...list.map((r) => h('tr', {},
      h('td', {}, h('a', { class: 'room-link', href: `/?room=${r.id}&watch=1`, target: '_blank', rel: 'noopener' }, r.id)),
      h('td', { 'data-label': 'Đỏ' }, seatCell(r.players.r, 'seat-r')),
      h('td', { 'data-label': 'Đen' }, seatCell(r.players.b, 'seat-b')),
      h('td', { 'data-label': 'Trạng thái' }, h('span', { class: 'pill ' + r.status }, statusText[r.status])),
      h('td', { 'data-label': 'Nước đi', class: 'num' }, r.moves, r.gamesFinished ? h('span', { class: 'muted' }, ` · ${r.gamesFinished} ván xong`) : ''),
      h('td', { 'data-label': 'Đang trong phòng', class: 'num' }, r.members),
      h('td', { 'data-label': 'Tạo lúc' }, ago(r.createdAt)),
      h('td', { class: 'actions-cell' }, h('div', { class: 'actions' },
        h('a', { class: 'btn sm', href: `/?room=${r.id}&watch=1`, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Xem'),
        h('button', { class: 'btn sm danger', onclick: () => closeRoom(r) }, 'Đóng phòng'))),
    )));
  }

  // ---------- Thao tác ----------
  async function act(fn, okMsg) {
    try {
      await fn();
      toast(okMsg);
      load();
    } catch (err) {
      toast(err.message);
    }
  }

  // Góp ý của người chơi
  async function loadFeedback() {
    let list;
    try { ({ feedback: list } = await api('GET', '/feedback')); } catch (err) { return toast(err.message); }
    $('c-feedback').textContent = list.length;
    $('feedback-list').replaceChildren(...(list.length ? list.map((f) => h('div', { class: 'fb-item' },
      h('div', { class: 'fb-body' },
        h('div', { class: 'fb-meta' }, `${f.name} · ${new Date(f.at).toLocaleString('vi-VN')}`, f.contact ? ` · Liên hệ: ${f.contact}` : ''),
        h('div', { class: 'fb-msg' }, f.message)),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!confirm('Xoá góp ý này?')) return;
        try { await api('DELETE', `/feedback/${encodeURIComponent(f.id)}`); loadFeedback(); } catch (err) { toast(err.message); }
      } }, 'Xoá'))) : [h('div', { class: 'empty panel-box' }, 'Chưa có góp ý nào.')]));
  }

  // ---------- Trang chi tiết tài khoản (#user/<mã>) ----------
  const REASON = { checkmate: 'chiếu bí', stalemate: 'hết nước', resign: 'đầu hàng', draw: 'hoà', abandon: 'rời bàn', timeout: 'hết giờ' };
  const LEVEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const OUTCOME = { win: 'Thắng', loss: 'Thua', draw: 'Hoà' };
  const fmtDT = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
  let detail = null; // dữ liệu tài khoản đang xem
  const gameFilter = { mode: 'all', outcome: 'all' };

  async function showUserPage(id) {
    showPage('user');
    $('user-detail').replaceChildren(h('div', { class: 'empty panel-box' }, 'Đang tải…'));
    try {
      detail = await api('GET', `/users/${encodeURIComponent(id)}`);
    } catch (err) {
      detail = null;
      $('user-detail').replaceChildren(h('div', { class: 'empty panel-box' }, err.message, ' ', h('a', { href: '#users', class: 'link' }, '← Về danh sách')));
      return;
    }
    $('page-title').textContent = detail.account.displayName;
    document.title = `${detail.account.displayName} · Quản trị Cờ Tướng`;
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

  // Hộp thoại nhập liệu đơn giản: fields = [{ name, label, type, value, min, max }]
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
      ...fields.map((f, i) => h('label', { class: 'ud-field' }, f.label, inputs[i], f.hint && h('small', { class: 'muted' }, f.hint))),
      err,
      h('div', { class: 'ud-form-acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Huỷ'), h('button', { class: 'btn primary' }, submitText)));
    const modal = h('div', { class: 'ud-modal', onclick: (e) => { if (e.target === modal) close(); } }, h('div', { class: 'ud-card ud-small' }, form));
    document.body.appendChild(modal);
    setTimeout(() => inputs[0] && inputs[0].focus(), 0);
  }

  function renderUserDetail() {
    const d = detail, a = d.account, id = encodeURIComponent(a.id);
    const st = a.stats;
    const pct = (s) => (s.games ? Math.round((s.wins / s.games) * 100) + '%' : '—');
    const patch = (body, msg) => userAction(() => api('PATCH', `/users/${id}`, body), msg);

    const actions = h('div', { class: 'ud-actions' },
      h('button', { class: 'btn sm', onclick: () => formModal('Đổi tên hiển thị', [{ name: 'name', label: 'Tên hiển thị (2–20 ký tự)', value: a.displayName }],
        (v) => api('PATCH', `/users/${id}`, { name: v.name }).then(() => userAction(async () => {}, 'Đã đổi tên.'))) }, 'Đổi tên'),
      h('button', { class: 'btn sm', onclick: () => formModal('Đặt lại mật khẩu', [{ name: 'pw', label: 'Mật khẩu mới', type: 'password', hint: 'Ít nhất 6 ký tự. Hãy báo mật khẩu mới cho người chơi.' }],
        (v) => api('PATCH', `/users/${id}`, { newPassword: v.pw }).then(() => toast('Đã đặt lại mật khẩu.')), 'Đặt mật khẩu') }, 'Đặt lại mật khẩu'),
      h('button', { class: 'btn sm', onclick: () => formModal('Chỉnh điểm', [
        { name: 'rating', label: 'Elo', type: 'number', value: a.rating, min: 0, max: 4000 },
        { name: 'coins', label: 'Xu', type: 'number', value: a.coins, min: 0 },
        { name: 'credit', label: 'Uy tín (tối đa 1100)', type: 'number', value: a.credit, min: 0, max: 1100 },
      ], (v) => api('PATCH', `/users/${id}`, v).then(() => userAction(async () => {}, 'Đã cập nhật điểm.'))) }, 'Chỉnh Elo / Xu / Uy tín'),
      a.avatar && h('button', { class: 'btn sm', onclick: () => confirm('Xoá ảnh đại diện của tài khoản này?') && patch({ avatar: null }, 'Đã xoá ảnh đại diện.') }, 'Xoá ảnh đại diện'),
      a.online && h('button', { class: 'btn sm', onclick: () => confirm('Mời ra khỏi phòng hiện tại?') && userAction(() => api('POST', `/users/${id}/kick`), 'Đã mời ra khỏi phòng.') }, 'Mời ra khỏi phòng'),
      a.sessions > 0 && h('button', { class: 'btn sm', onclick: () => confirm('Đăng xuất tài khoản này khỏi mọi thiết bị?') && userAction(() => api('POST', `/users/${id}/logout`), 'Đã đăng xuất mọi thiết bị.') }, 'Đăng xuất mọi thiết bị'),
      h('button', { class: 'btn sm' + (a.banned ? '' : ' danger'), onclick: () => confirm(a.banned ? 'Mở khoá tài khoản?' : 'Khoá tài khoản? Người chơi sẽ bị đăng xuất và không đăng nhập được.') && patch({ banned: !a.banned }, a.banned ? 'Đã mở khoá.' : 'Đã khoá tài khoản.') }, a.banned ? 'Mở khoá' : 'Khoá tài khoản'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!confirm(`Xoá vĩnh viễn tài khoản @${a.username}? Không thể hoàn tác.`)) return;
        try { await api('DELETE', `/users/${id}`); toast('Đã xoá tài khoản.'); load(); location.hash = '#users'; } catch (err) { toast(err.message); }
      } }, 'Xoá tài khoản'));

    const head = h('section', { class: 'panel-box ud-head' },
      avatarEl({ avatar: a.avatar, name: a.displayName }, 'ud-av'),
      h('div', { class: 'ud-head-main' },
        h('h2', {}, a.displayName, ' ', a.banned && h('span', { class: 'pill banned' }, 'Bị khoá')),
        h('div', { class: 'ud-sub' }, `@${a.username}`, h('span', { class: 'sep' }, '·'), eloEl(a.rating)),
        h('div', { class: 'ud-sub' }, h('span', { class: 'dot' + (a.online ? ' on' : '') }), a.online ? 'Đang online' : `Offline · hoạt động ${ago(a.lastSeen)}`,
          a.roomId && [' · trong phòng ', h('a', { class: 'room-link', href: `/?room=${a.roomId}&watch=1`, target: '_blank', rel: 'noopener' }, a.roomId)]),
        actions));

    const statCard = (label, value, sub, cls) => h('div', { class: 'stat ' + (cls || '') }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label), sub && h('div', { class: 'l2' }, sub));
    const stats = h('div', { class: 'stats' },
      statCard('Elo', a.rating),
      statCard('Uy tín', a.credit, a.credit < 1000 ? 'Dưới mức khởi đầu' : 'Tốt', a.credit < 1000 ? 'warn' : ''),
      statCard('Xu', a.coins.toLocaleString('vi-VN')),
      statCard('Chuỗi thắng', a.streak, `Kỷ lục ${a.bestStreak}`),
      statCard('Online', `${st.online.wins}-${st.online.losses}-${st.online.draws}`, `${st.online.games} ván · ${pct(st.online)} thắng`),
      statCard('Với máy', `${st.ai.wins}-${st.ai.losses}-${st.ai.draws}`, `${st.ai.games} ván · ${pct(st.ai)} thắng`));

    const kv = (rows) => h('table', { class: 'kv' }, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
    const info = h('section', { class: 'panel-box' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Thông tin tài khoản')),
      kv([
        ['Mã nội bộ', h('code', {}, a.id)], ['Tên đăng nhập', '@' + a.username], ['Tên hiển thị', a.displayName],
        ['Khu vực', a.region || 'Chưa đặt'], ['Elo', a.rating],
        ['Thẻ kỳ hữu', cardTier(st.online.games + st.ai.games)], ['Ngày tạo', fmtDT(a.createdAt)],
        ['Hoạt động cuối', fmtDT(a.lastSeen)], ['Phiên đăng nhập đang mở', a.sessions],
        ['Nhận thưởng ngày gần nhất', a.lastBonusDay || '—'], ['Tổng số ván đã lưu', d.totalGames],
      ]));
    const chart = h('section', { class: 'panel-box' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Diễn biến Elo')), eloChart(d.ratingHistory));

    const opponents = h('section', { class: 'panel-box' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Đối thủ thường gặp')),
      d.opponents.length ? h('table', { class: 'mini-table' },
        h('thead', {}, h('tr', {}, ...['Đối thủ', 'Chế độ', 'Số ván', 'T-T-H'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...d.opponents.map((o) => h('tr', {},
          h('td', {}, o.accountId ? h('a', { class: 'link-name', href: userHref(o.accountId) }, o.name) : o.name),
          h('td', {}, o.mode === 'ai' ? 'Với máy' : o.accountId ? 'Online' : 'Online (khách)'),
          h('td', { class: 'num' }, o.games),
          h('td', { class: 'num wld' }, h('b', {}, o.wins), ' - ', h('i', {}, o.losses), ' - ', o.draws)))))
        : h('div', { class: 'mini-empty' }, 'Chưa có ván nào.'));

    const feedback = h('section', { class: 'panel-box' }, h('div', { class: 'panel-head' }, h('h3', {}, `Góp ý đã gửi (${d.feedback.length})`)),
      d.feedback.length ? h('div', { class: 'fb-list' }, ...d.feedback.map((f) => h('div', { class: 'fb-item' },
        h('div', { class: 'fb-body' }, h('div', { class: 'fb-meta' }, fmtDT(f.at), f.contact ? ` · Liên hệ: ${f.contact}` : ''), h('div', { class: 'fb-msg' }, f.message)))))
        : h('div', { class: 'mini-empty' }, 'Chưa gửi góp ý nào.'));

    $('user-detail').replaceChildren(
      h('a', { class: 'link back-link', href: '#users' }, '← Danh sách tài khoản'),
      head, stats,
      h('div', { class: 'ud-grid' }, info, chart),
      gamesSection(),
      h('div', { class: 'ud-grid' }, opponents, feedback));
  }

  // Bảng lịch sử ván có bộ lọc
  function gamesSection() {
    const d = detail;
    const box = h('section', { class: 'panel-box' });
    const draw = () => {
      const list = d.games.filter((g) => (gameFilter.mode === 'all' || g.mode === gameFilter.mode) && (gameFilter.outcome === 'all' || g.outcome === gameFilter.outcome));
      const sel = (key, opts) => h('select', { onchange: (e) => { gameFilter[key] = e.target.value; draw(); } },
        ...opts.map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = gameFilter[key] === v; return o; }));
      box.replaceChildren(
        h('div', { class: 'panel-head' }, h('h3', {}, `Lịch sử ván (${list.length}${d.totalGames > d.games.length ? ` / ${d.totalGames}` : ''})`),
          h('div', { class: 'filters' },
            sel('mode', [['all', 'Mọi chế độ'], ['online', 'Online'], ['ai', 'Với máy']]),
            sel('outcome', [['all', 'Mọi kết quả'], ['win', 'Thắng'], ['loss', 'Thua'], ['draw', 'Hoà']]))),
        list.length ? h('div', { class: 'table-wrap flat' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['Kết quả', 'Đối thủ', 'Chế độ', 'Cầm quân', 'Kết thúc', 'Elo', 'Thời gian', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...list.map((g) => h('tr', {},
            h('td', {}, h('span', { class: 'res ' + g.outcome }, OUTCOME[g.outcome])),
            h('td', { 'data-label': 'Đối thủ' }, g.opponentId ? h('a', { class: 'link-name', href: userHref(g.opponentId) }, g.opponent) : g.opponent),
            h('td', { 'data-label': 'Chế độ' }, g.mode === 'ai' ? `Với máy (${LEVEL[g.level] || ''})` : 'Online'),
            h('td', { 'data-label': 'Cầm quân' }, h('span', { class: 'side-dot ' + g.color }), g.color === 'r' ? 'Đỏ' : 'Đen'),
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
    const NS = 'http://www.w3.org/2000/svg';
    const W = 600, H = 180, P = 28;
    const vals = points.map((p) => p.rating);
    const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
    const half = Math.max(50, (Math.max(...vals) - Math.min(...vals)) / 2 + 20); // khoảng tối thiểu ±50 để nhãn không dính nhau
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

  // ---------- Bài tập ----------
  const DIFF = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
  const TYPES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
  let puzzleList = [];

  async function getTheme() {
    if (!themeCache) themeCache = await fetch('/api/theme').then((r) => r.json()).catch(() => BR.DEFAULT_THEME);
    return themeCache;
  }

  function thumbSvg(board, theme, flipped) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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
    $('pz-count').textContent = `${puzzleList.length} bài · ${puzzleList.filter((p) => p.published).length} đang hiển thị`;
    if (!puzzleList.length) {
      $('pz-body').replaceChildren(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'Chưa có bài tập nào. Bấm "+ Thêm bài tập" để tạo.')));
      return;
    }
    $('pz-body').replaceChildren(...puzzleList.map((p) => h('tr', { class: 'row-link', onclick: () => { location.hash = '#puzzle/' + p.id; } },
      h('td', {}, h('div', { class: 'acc-cell' }, h('div', { class: 'pz-thumb' }, thumbSvg(p.board, theme, p.side === 'b')),
        h('div', {}, h('div', { class: 'name' }, p.title), h('div', { class: 'sub' }, `${p.side === 'r' ? 'Đỏ' : 'Đen'} đi trước`)))),
      h('td', { 'data-label': 'Độ khó' }, h('span', { class: 'diff ' + p.difficulty }, DIFF[p.difficulty])),
      h('td', { 'data-label': 'Số nước', class: 'num' }, (p.solution.length + 1) / 2),
      h('td', { 'data-label': 'Đã giải', class: 'num' }, p.solvedBy),
      h('td', { 'data-label': 'Trạng thái' }, h('span', { class: 'pill ' + (p.published ? 'shown-pz' : 'hidden-pz') }, p.published ? 'Đang hiển thị' : 'Đang ẩn')),
      h('td', { 'data-label': 'Cập nhật' }, ago(p.updatedAt)),
      h('td', { class: 'actions-cell' }, h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onclick: async (e) => {
          e.stopPropagation();
          try { await api('PATCH', `/puzzles/${p.id}`, { published: !p.published }); loadPuzzles(); } catch (err) { toast(err.message); }
        } }, p.published ? 'Ẩn' : 'Hiện'),
        h('button', { class: 'btn sm danger', onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Xoá bài "${p.title}"?`)) return;
          try { await api('DELETE', `/puzzles/${p.id}`); toast('Đã xoá bài tập.'); loadPuzzles(); } catch (err) { toast(err.message); }
        } }, 'Xoá')))),
    ));
  }
  $('pz-new').addEventListener('click', () => { location.hash = '#puzzle/new'; });

  // ----- Trình soạn bài tập -----
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
      difficulty: p ? p.difficulty : 'easy', side: p ? p.side : 'r', published: p ? p.published : true,
      board: p ? p.board.map((row) => row.slice()) : start,
      solution: p ? p.solution.slice() : [],
      mode: 'setup', tool: 'rR', pick: null, theme,
    };
    $('page-title').textContent = p ? 'Sửa bài tập' : 'Thêm bài tập';
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
    const side = h('select', { onchange: (e) => { ed.side = e.target.value; ed.solution = []; refresh(); } },
      ...[['r', 'Đỏ đi trước'], ['b', 'Đen đi trước']].map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = ed.side === v; return o; }));
    const pub = h('input', { type: 'checkbox', onchange: (e) => { ed.published = e.target.checked; } });
    pub.checked = ed.published;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ed.ui = new window.BoardUI(svg, { theme: ed.theme, onClick: onEditorClick });
    ed.panel = h('div', { class: 'panel-box' });
    ed.msg = h('div', { class: 'ed-msg' });
    $('pz-editor').replaceChildren(
      h('a', { class: 'link back-link', href: '#puzzles' }, '← Danh sách bài tập'),
      h('div', { class: 'ed' },
        h('div', {}, h('div', { class: 'ed-board' }, svg)),
        h('div', { class: 'ed-side' },
          h('section', { class: 'panel-box' },
            field('Tiêu đề', title), field('Mô tả / yêu cầu', desc),
            h('div', { class: 'ed-row' }, field('Độ khó', diff), field('Bên đi trước', side)),
            h('label', { class: 'ed-check' }, pub, 'Hiển thị cho người chơi')),
          h('div', { class: 'ed-modes' },
            h('button', { class: 'mode-setup', onclick: () => setMode('setup') }, '1. Bày thế cờ'),
            h('button', { class: 'mode-solve', onclick: () => setMode('solve') }, '2. Ghi lời giải')),
          ed.panel, ed.msg,
          h('div', { class: 'ed-actions' },
            h('button', { class: 'btn primary', onclick: savePuzzle }, ed.id ? 'Lưu thay đổi' : 'Tạo bài tập'),
            h('a', { class: 'btn', href: '#puzzles', style: 'text-decoration:none' }, 'Huỷ')))));
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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-55 -55 110 116');
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    BR.drawBoard(host, ed.theme); // lấy gradient của quân cờ
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
    ed.msg.className = 'ed-msg ' + cls;
    ed.msg.textContent = text;
  }

  async function savePuzzle() {
    const body = { title: ed.title, description: ed.description, difficulty: ed.difficulty, side: ed.side, board: ed.board, solution: ed.solution, published: ed.published };
    try {
      const { puzzle } = ed.id ? await api('PUT', `/puzzles/${ed.id}`, body) : await api('POST', '/puzzles', body);
      toast(ed.id ? 'Đã lưu bài tập.' : 'Đã tạo bài tập.');
      ed.id = puzzle.id;
      location.hash = '#puzzles';
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Xem biên bản ván cờ ----------
  let themeCache = null;
  async function openGameViewer(gameId) {
    let game;
    try {
      ({ game } = await api('GET', `/games/${encodeURIComponent(gameId)}`));
      if (!themeCache) themeCache = await fetch('/api/theme').then((r) => r.json()).catch(() => BR.DEFAULT_THEME);
    } catch (err) {
      return toast(err.message);
    }
    const XQ = window.Xiangqi;
    const moves = game.moves.map(([fr, fc, tr, tc]) => ({ from: [fr, fc], to: [tr, tc] }));
    const { boards, notes } = XQ.replay(moves);
    let ply = moves.length;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gv-board');
    const label = h('span', { class: 'gv-label' });
    const list = h('ol', { class: 'gv-moves' });
    const go = (p) => { ply = Math.max(0, Math.min(moves.length, p)); draw(); };
    const draw = () => {
      const geo = BR.drawBoard(svg, themeCache);
      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(layer);
      const m = moves[ply - 1];
      if (m) {
        for (const [r, c] of [m.from, m.to]) {
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          for (const [k, v] of Object.entries({ cx: geo.xs[c], cy: geo.ys[r], r: 48 * geo.unit, fill: 'rgba(29,111,224,.18)', stroke: '#1d6fe0', 'stroke-width': 4 * geo.unit })) ring.setAttribute(k, v);
          layer.appendChild(ring);
        }
      }
      const b = boards[ply];
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (b[r][c]) BR.drawPiece(layer, themeCache, geo.unit, b[r][c], XQ.CHARS[b[r][c]], geo.xs[c], geo.ys[r]);
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
    const modal = h('div', { class: 'ud-modal', onclick: (e) => { if (e.target === modal) close(); } },
      h('div', { class: 'ud-card gv-card' },
        h('button', { class: 'ud-close', onclick: close, 'aria-label': 'Đóng' }, '×'),
        h('h2', {}, `${game.players.r.name} (Đỏ) vs ${game.players.b.name} (Đen)`),
        h('div', { class: 'muted' }, `${game.mode === 'ai' ? `Với máy (${LEVEL[game.level] || ''})` : 'Online'} · ${resultText} · ${fmtDT(game.endedAt)}`),
        h('div', { class: 'gv-body' },
          h('div', { class: 'gv-left' }, h('div', { class: 'gv-frame' }, svg),
            h('div', { class: 'gv-controls' },
              h('button', { class: 'btn sm', onclick: () => go(0) }, '⏮'), h('button', { class: 'btn sm', onclick: () => go(ply - 1) }, '◀'),
              label,
              h('button', { class: 'btn sm', onclick: () => go(ply + 1) }, '▶'), h('button', { class: 'btn sm', onclick: () => go(moves.length) }, '⏭'))),
          list)));
    document.body.appendChild(modal);
    draw();
  }

  function closeRoom(r) {
    if (!confirm(`Đóng phòng ${r.id}? Mọi người trong phòng sẽ bị đưa về trang chủ.`)) return;
    act(() => api('DELETE', `/rooms/${encodeURIComponent(r.id)}`), 'Đã đóng phòng.');
  }

  // ---------- Giao diện ----------
  // Menu trái: mỗi mục là một trang, ghi vào #hash để tải lại vẫn giữ trang
  const PAGES = {
    overview: 'Tổng quan', users: 'Tài khoản', user: 'Chi tiết tài khoản', rooms: 'Phòng chơi',
    puzzles: 'Bài tập', puzzle: 'Soạn bài tập', feedback: 'Góp ý', theme: 'Giao diện bàn cờ',
  };
  function route() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('user/')) showUserPage(decodeURIComponent(hash.slice(5)));
    else if (hash.startsWith('puzzle/')) openEditor(decodeURIComponent(hash.slice(7)));
    else showPage(hash);
  }
  function showPage(name) {
    if (!PAGES[name]) name = 'overview';
    const navName = name === 'user' ? 'users' : name === 'puzzle' ? 'puzzles' : name;
    document.querySelectorAll('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === navName));
    for (const p of Object.keys(PAGES)) $('page-' + p).classList.toggle('hidden', p !== name);
    $('page-title').textContent = PAGES[name];
    document.title = `${PAGES[name]} · Quản trị Cờ Tướng`;
    if (name !== 'user' && name !== 'puzzle' && location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (name === 'puzzles') loadPuzzles();
    window.scrollTo(0, 0);
    if (name === 'theme') loadTheme();
    if (name === 'feedback') loadFeedback();
    closeMenu();
  }
  const closeMenu = () => $('sidebar').classList.remove('open');
  document.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.page; }));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.goto; }));
  $('menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('sidebar-backdrop').addEventListener('click', closeMenu);
  window.addEventListener('hashchange', route);
  for (const id of ['search', 'filter', 'sort']) {
    $(id).addEventListener('input', () => data && renderUsers());
  }

  let toastTimer;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
  }

  // ---------- Giao diện bàn cờ & quân cờ ----------
  const BR = window.BoardRender;
  const XQ = window.Xiangqi;
  const NS = 'http://www.w3.org/2000/svg';
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
    if (T.current || T.loading) return;
    T.loading = true;
    try {
      const data = await api('GET', '/theme');
      setThemeData(data);
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
    if (board.type === 'image') {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = board.src;
      img.alt = '';
      return img;
    }
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
    const boards = [...BR.BUILTIN_BOARDS, ...T.library];
    if (T.pendingUrl && !boards.some((b) => b.src === T.pendingUrl)) boards.push(d.board);
    $('board-list').replaceChildren(...boards.map((board) => {
      const active = board.type === d.board.type && (board.type === 'classic' || board.src === d.board.src);
      const opt = h('div', { class: 'opt' + (active ? ' active' : ''), title: board.name, onclick: () => selectBoard(board) },
        boardThumb(board), board.name);
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

    // Kiểu quân cờ
    $('piece-list').replaceChildren(...Object.entries(BR.PIECE_STYLES).map(([style, name]) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'thumb');
      svg.setAttribute('viewBox', '0 0 220 220');
      const t = { board: d.board, pieces: { ...d.pieces, style } };
      // Nền để thấy rõ quân
      const defsHost = document.createElementNS(NS, 'svg');
      BR.drawBoard(defsHost, { ...t, board: { type: 'classic' } });
      svg.appendChild(defsHost.querySelector('defs'));
      svgEl('rect', { width: 220, height: 220, fill: '#e9c98f' }, svg);
      BR.drawPiece(svg, t, 0.9, 'rK', XQ.CHARS.rK, 60, 70);
      BR.drawPiece(svg, t, 0.9, 'bK', XQ.CHARS.bK, 160, 70);
      BR.drawPiece(svg, t, 0.9, 'rN', XQ.CHARS.rN, 60, 160);
      BR.drawPiece(svg, t, 0.9, 'bR', XQ.CHARS.bR, 160, 160);
      return h('div', { class: 'opt' + (d.pieces.style === style ? ' active' : ''), onclick: () => { d.pieces.style = style; renderTheme(); } }, svg, name);
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
  }

  function selectBoard(board) {
    T.draft.board = clone(board);
    renderTheme();
  }

  async function deleteBoard(board) {
    if (!confirm(`Xoá bàn cờ "${board.name}"?`)) return;
    try {
      const data = await api('DELETE', '/boards', { src: board.src });
      const draft = T.draft;
      setThemeData(data);
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
    const data = ctx.getImageData(0, 0, w, hgt).data;
    const lum = new Float32Array(w * hgt);
    let sum = 0;
    for (let i = 0; i < w * hgt; i++) {
      lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
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
    const px = ctx.getImageData(Math.round(w * 0.01), Math.round(hgt / 2), 1, 1).data;
    const bg = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
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
