// Trang quản trị: quản lý người chơi và phòng.
// Mặc định không cần mật khẩu; đặt biến môi trường ADMIN_PASSWORD để bắt buộc đăng nhập.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const storage = require('./storage');

const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'xq_admin';

/**
 * game = {
 *   rooms, users, theme, onThemeChange(currentTheme),
 *   onlineInfo(): Map<uid, { sockets, roomId }>,
 *   kickUser(uid, reason), renameUser(uid, name), closeRoom(id, reason)
 * }
 */
module.exports = function setupAdmin(app, game) {
  const { rooms, users } = game;
  const password = users.adminPassword();
  const sessions = new Map(); // token -> hết hạn lúc
  const attempts = new Map(); // ip -> { count, resetAt }

  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const passwordHash = password ? hash(password) : null;

  function readCookie(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function isAdmin(req) {
    if (!password) return true;
    const token = readCookie(req);
    const exp = token && sessions.get(token);
    if (!exp) return false;
    if (exp < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  const api = express.Router();
  api.use(express.json({ limit: '10kb' }));
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.post('/login', (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    const a = attempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (a.resetAt < now) Object.assign(a, { count: 0, resetAt: now + 10 * 60 * 1000 });
    if (a.count >= 10) return res.status(429).json({ error: 'Sai mật khẩu quá nhiều lần, thử lại sau 10 phút.' });

    if (!password) return res.json({ ok: true });
    const ok = crypto.timingSafeEqual(hash((req.body && req.body.password) || ''), passwordHash);
    if (!ok) {
      a.count++;
      attempts.set(ip, a);
      return res.status(401).json({ error: 'Sai mật khẩu.' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_MS);
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_MS / 1000}${secure}`);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    sessions.delete(readCookie(req));
    res.set('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
    res.json({ ok: true });
  });

  // Các API bên dưới cần đăng nhập
  api.use((req, res, next) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    next();
  });

  api.get('/me', (req, res) => res.json({ ok: true, passwordRequired: !!password, storage: { name: storage.name, label: storage.describe(), ...storage.status() } }));

  function roomStatus(room) {
    if (!room.players.r || !room.players.b) return 'waiting';
    return room.game.result ? 'finished' : 'playing';
  }

  api.get('/overview', (req, res) => {
    const online = game.onlineInfo();
    const userList = users.list().map((u) => {
      const o = online.accounts.get(u.id);
      const st = u.stats.online;
      return {
        id: u.id, username: u.username, name: u.displayName, avatar: u.avatar || null, createdAt: u.createdAt, lastSeen: u.lastSeen,
        games: st.games, wins: st.wins, losses: st.losses, draws: st.draws, aiGames: u.stats.ai.games,
        rating: u.rating, credit: u.credit, coins: u.coins, playerNo: u.playerNo,
        streak: u.streak, bestStreak: u.bestStreak, puzzlesSolved: u.solvedPuzzles.length, region: u.region || null,
        banned: u.banned, online: !!o, roomId: (o && o.roomId) || null,
      };
    });
    const seat = (s) => (s ? { name: s.name, accountId: s.accountId || null, online: s.online, rating: s.rating || null } : null);
    const roomList = [...rooms.values()].map((r) => {
      const { r: red, b: black } = r.players;
      // Loại phòng như trên trang chơi: Xếp hạng (ghép trận, 2 tài khoản) / Ghép trận (có khách) / Phòng riêng
      const type = { room: 'private', ranked: 'rated', match: 'match', coin: 'coin', tournament: 'tournament' }[r.kind] || 'private';
      return {
        id: r.id,
        createdAt: r.createdAt,
        status: roomStatus(r),
        type,
        stake: r.stake || null,
        tournament: r.tournament ? { id: r.tournament.id, name: r.tournament.name, round: r.tournament.round } : null,
        settings: r.settings,
        players: { r: seat(red), b: seat(black) },
        members: r.members.size,
        spectators: [...r.members.values()].filter((t) => !(red && red.token === t) && !(black && black.token === t)).length,
        moves: r.game.history.length,
        gamesFinished: r.archive.length + (r.game.result ? 1 : 0),
      };
    });
    res.json({
      stats: {
        users: userList.length,
        online: online.total,
        banned: userList.filter((u) => u.banned).length,
        rooms: roomList.length,
        playing: roomList.filter((r) => r.status === 'playing').length,
        searching: game.queueSize(),
        gamesPlayed: users.gamesPlayed(),
        coins: userList.reduce((sum, u) => sum + u.coins, 0),
        newToday: userList.filter((u) => u.createdAt >= new Date().setHours(0, 0, 0, 0)).length,
        puzzles: game.puzzles.list({ all: true }).length,
        feedback: users.listFeedback().length,
        reports: users.listFeedback().filter((f) => f.type === 'report').length,
        tournaments: game.tournaments.publicList().filter((t) => ['open', 'checkin', 'running'].includes(t.status)).length,
      },
      storage: { name: storage.name, label: storage.describe(), ...storage.status() },
      users: userList,
      rooms: roomList,
    });
  });

  // Chi tiết đầy đủ một tài khoản (trang riêng trong admin)
  api.get('/users/:id', (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const games = users.gamesOf(u.id, 1000);
    const o = game.onlineInfo().accounts.get(u.id);

    // Đối thủ thường gặp
    const opp = new Map();
    for (const g of games) {
      const key = g.mode === 'ai' ? 'ai:' + g.opponent : g.opponentId || 'guest:' + g.opponent;
      const x = opp.get(key) || { name: g.opponent, accountId: g.opponentId, mode: g.mode, games: 0, wins: 0, losses: 0, draws: 0 };
      x.games++;
      x[g.outcome === 'win' ? 'wins' : g.outcome === 'loss' ? 'losses' : 'draws']++;
      opp.set(key, x);
    }
    // Lịch sử Elo: đi ngược từ điểm hiện tại qua các ván có tính điểm
    const rated = games.filter((g) => typeof g.ratingChange === 'number');
    let r = u.rating;
    const ratingHistory = [{ at: Date.now(), rating: r }];
    for (const g of rated) { r -= g.ratingChange; ratingHistory.push({ at: g.endedAt, rating: r }); }
    ratingHistory.reverse();

    res.json({
      account: {
        ...users.publicAccount(u), lastBonusDay: u.lastBonusDay || null,
        sessions: users.sessionsOf(u.id), online: !!o, roomId: (o && o.roomId) || null,
      },
      games: games.slice(0, 300),
      totalGames: games.length,
      opponents: [...opp.values()].sort((a, b) => b.games - a.games).slice(0, 10),
      ratingHistory,
      feedback: users.listFeedback(u.id),
    });
  });

  // Toàn bộ một ván (để xem biên bản trong admin)
  api.get('/games/:id', (req, res) => {
    const g = users.getGame(req.params.id);
    if (!g) return res.status(404).json({ error: 'Không tìm thấy ván.' });
    res.json({ game: g });
  });

  api.patch('/users/:id', (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const body = req.body || {};
    try {
      if (body.name !== undefined) {
        const acc = users.update(u.id, { displayName: body.name });
        game.renameUser(u.id, acc.displayName);
      }
      const numbers = {};
      for (const k of ['rating', 'coins', 'credit']) if (body[k] !== undefined) numbers[k] = body[k];
      if (Object.keys(numbers).length) users.update(u.id, numbers);
      if (body.region !== undefined) users.update(u.id, { region: String(body.region) });
      if (typeof body.banned === 'boolean') {
        users.update(u.id, { banned: body.banned });
        if (body.banned) game.kickUser(u.id, 'Tài khoản của bạn đã bị quản trị viên khoá.', { logout: true });
      }
      if (body.newPassword !== undefined) users.update(u.id, { newPassword: String(body.newPassword) });
      if (body.avatar === null) {
        const acc = users.clearAvatar(u.id);
        game.renameUser(u.id, acc.displayName, null);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Đăng xuất tài khoản khỏi mọi thiết bị
  api.post('/users/:id/logout', (req, res) => {
    if (!users.get(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    users.destroySessionsOf(req.params.id);
    game.kickUser(req.params.id, 'Bạn đã bị đăng xuất bởi quản trị viên.', { logout: true });
    res.json({ ok: true });
  });

  api.post('/users/:id/kick', (req, res) => {
    const n = game.kickUser(req.params.id, 'Bạn đã bị quản trị viên mời ra khỏi phòng.');
    res.json({ ok: true, kicked: n });
  });

  api.delete('/users/:id', (req, res) => {
    game.kickUser(req.params.id, 'Tài khoản của bạn đã bị quản trị viên xoá.', { logout: true });
    if (!users.remove(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    res.json({ ok: true });
  });

  // ---------- Cài đặt chế độ chơi: nhịp & xu (Xếp hạng, Tranh xu, thưởng) ----------
  const economy = game.economy;
  api.get('/economy', (req, res) => res.json({ current: economy.current(), defaults: economy.defaults() }));
  api.put('/economy', (req, res) => {
    try {
      const current = economy.update(req.body || {});
      game.onEconomyChange(current);
      res.json({ current, defaults: economy.defaults() });
    } catch (err) {
      if (!(err instanceof economy.EconomyError)) console.error(err);
      res.status(400).json({ error: err instanceof economy.EconomyError ? err.message : 'Không lưu được cài đặt.' });
    }
  });
  api.post('/economy/reset', (req, res) => {
    const current = economy.reset();
    game.onEconomyChange(current);
    res.json({ current, defaults: economy.defaults() });
  });

  // ---------- Cài đặt hệ thống: Elo, rank, ghép trận, nhiệm vụ, nội dung trang chủ... ----------
  const config = game.config;
  api.get('/site-config', (req, res) => res.json({ current: config.values, defaults: config.defaults() }));
  api.put('/site-config', (req, res) => {
    try {
      const current = config.update(req.body || {});
      game.onConfigChange(current);
      res.json({ current, defaults: config.defaults() });
    } catch (err) {
      if (!(err instanceof config.ConfigError)) console.error(err);
      res.status(400).json({ error: err instanceof config.ConfigError ? err.message : 'Không lưu được cài đặt.' });
    }
  });
  api.post('/site-config/reset', (req, res) => {
    const current = config.reset();
    game.onConfigChange(current);
    res.json({ current, defaults: config.defaults() });
  });

  // ---------- Bật/tắt chức năng của web ----------
  const features = game.features;
  api.get('/features', (req, res) => res.json({ current: features.current() }));
  api.put('/features', (req, res) => {
    const current = features.update(req.body || {});
    game.onFeaturesChange(current);
    res.json({ current });
  });

  // ---------- Cửa hàng vật phẩm: bàn cờ, quân cờ, đồng hồ (Túi đồ & Cửa hàng của người chơi) ----------
  const shop = game.shop;
  const shopData = () => ({ items: shop.current(), locked: shop.LOCKED, library: game.theme.library() });
  api.get('/shop', (req, res) => res.json(shopData()));
  api.put('/shop', (req, res) => {
    try {
      const items = shop.update((req.body || {}).items);
      game.onShopChange(items);
      res.json(shopData());
    } catch (err) {
      if (!(err instanceof shop.ShopError)) console.error(err);
      res.status(400).json({ error: err instanceof shop.ShopError ? err.message : 'Không lưu được vật phẩm.' });
    }
  });
  api.post('/shop/reset', (req, res) => {
    const items = shop.reset();
    game.onShopChange(items);
    res.json(shopData());
  });

  // ---------- Góp ý giao diện (chế độ ?gopy=1 trên trang chơi): ghi chú gắn vào từng phần tử ----------
  let uiNotes = null;
  const loadNotes = async () => uiNotes || (uiNotes = (await storage.loadUiNotes()) || []);
  const saveNotes = () => Promise.resolve(storage.saveUiNotes(uiNotes)).catch((err) => console.error('Không lưu được góp ý giao diện:', err.message));
  const clip = (v, n) => String(v ?? '').slice(0, n);
  api.get('/ui-notes', async (req, res) => res.json({ notes: await loadNotes() }));
  api.post('/ui-notes', async (req, res) => {
    const x = req.body || {};
    const text = clip(x.text, 1000).trim();
    if (!text) return res.status(400).json({ error: 'Ghi chú trống.' });
    await loadNotes();
    const note = {
      id: crypto.randomBytes(5).toString('hex'), at: Date.now(), status: 'open', text,
      page: clip(x.page, 120), screen: clip(x.screen, 40), selector: clip(x.selector, 400), label: clip(x.label, 160),
      rect: x.rect && typeof x.rect === 'object' ? { x: Math.round(+x.rect.x || 0), y: Math.round(+x.rect.y || 0), w: Math.round(+x.rect.w || 0), h: Math.round(+x.rect.h || 0) } : null,
      viewport: clip(x.viewport, 20),
    };
    uiNotes.push(note);
    saveNotes();
    res.json({ note, notes: uiNotes });
  });
  api.put('/ui-notes/:id', async (req, res) => {
    await loadNotes();
    const n = uiNotes.find((x) => x.id === req.params.id);
    if (!n) return res.status(404).json({ error: 'Không tìm thấy ghi chú.' });
    if (typeof req.body.text === 'string' && req.body.text.trim()) n.text = clip(req.body.text, 1000).trim();
    if (['open', 'done'].includes(req.body.status)) n.status = req.body.status;
    saveNotes();
    res.json({ notes: uiNotes });
  });
  api.delete('/ui-notes/:id', async (req, res) => {
    await loadNotes();
    uiNotes = uiNotes.filter((x) => x.id !== req.params.id);
    saveNotes();
    res.json({ notes: uiNotes });
  });

  // ---------- Cộng đồng: xem & xoá tin nhắn ----------
  api.get('/community', (req, res) => res.json({ messages: game.community.all() }));
  api.delete('/community/:id', (req, res) => {
    const id = String(req.params.id);
    if (game.community.remove(id)) game.onCommunityDelete(id);
    res.json({ messages: game.community.all() });
  });

  // ---------- Giao diện bàn cờ & quân cờ ----------
  const theme = game.theme;

  api.get('/theme', (req, res) => {
    res.json({ current: theme.current(), library: theme.library() });
  });

  api.put('/theme', (req, res) => {
    try {
      const current = theme.setCurrent(req.body || {});
      game.onThemeChange(current);
      res.json({ current, library: theme.library() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.post('/theme/reset', (req, res) => {
    const current = theme.resetCurrent();
    game.onThemeChange(current);
    res.json({ current, library: theme.library() });
  });

  // Tải ảnh bàn cờ lên (gửi thẳng nội dung file trong body)
  api.post('/uploads', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '10mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Không nhận được ảnh.');
      res.json({ src: await theme.saveUpload(req.body) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Đưa ảnh bàn cờ vào thư viện (không áp dụng làm mặc định) — dùng khi phát hành bàn cờ mới vào Cửa hàng
  api.post('/boards', (req, res) => {
    try {
      const board = theme.addBoard((req.body || {}).board);
      res.json({ board, current: theme.current(), library: theme.library() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.delete('/boards', (req, res) => {
    try {
      const src = String((req.body && req.body.src) || '');
      const used = game.shop.itemUsingImage(src);
      if (used) throw new Error(`Ảnh này đang là vật phẩm "${used.name}" trong Cửa hàng — xoá vật phẩm đó trước.`);
      theme.removeBoard(src);
      res.json({ current: theme.current(), library: theme.library() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- Bài tập ----------
  const puzzles = game.puzzles;
  const puzzleFail = (res, err) => res.status(err instanceof puzzles.PuzzleError ? 400 : 500).json({ error: err.message });
  api.get('/puzzles', (req, res) => res.json({ puzzles: puzzles.list({ all: true }) }));
  api.get('/puzzles/:id', (req, res) => {
    const p = puzzles.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
    res.json({ puzzle: p });
  });
  api.post('/puzzles', express.json({ limit: '50kb' }), (req, res) => {
    try { res.json({ puzzle: puzzles.create(req.body || {}) }); } catch (err) { puzzleFail(res, err); }
  });
  api.put('/puzzles/:id', express.json({ limit: '50kb' }), (req, res) => {
    try { res.json({ puzzle: puzzles.update(req.params.id, req.body || {}) }); } catch (err) { puzzleFail(res, err); }
  });
  api.patch('/puzzles/:id', (req, res) => {
    try { res.json({ puzzle: puzzles.setPublished(req.params.id, !!(req.body && req.body.published)) }); } catch (err) { puzzleFail(res, err); }
  });
  api.delete('/puzzles/:id', (req, res) => {
    if (!puzzles.remove(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
    res.json({ ok: true });
  });

  // ---------- Giải đấu ----------
  const T = game.tournaments;
  const tourFail = (res, err) => res.status(err instanceof T.TournamentError ? 400 : 500).json({ error: err.message });
  api.get('/tournaments', (req, res) => res.json({ tournaments: T.publicList().map((t) => T.detail(t.id)) }));
  api.post('/tournaments', express.json({ limit: '20kb' }), (req, res) => {
    try { res.json({ tournament: T.detail(T.create(req.body || {}).id) }); } catch (err) { tourFail(res, err); }
  });
  api.put('/tournaments/:id', express.json({ limit: '20kb' }), (req, res) => {
    try { res.json({ tournament: T.detail(T.update(req.params.id, req.body || {}).id) }); } catch (err) { tourFail(res, err); }
  });
  api.post('/tournaments/:id/start', (req, res) => {
    try { T.startNow(req.params.id); res.json({ tournament: T.detail(req.params.id) }); } catch (err) { tourFail(res, err); }
  });
  api.post('/tournaments/:id/cancel', (req, res) => {
    try { T.cancel(req.params.id); res.json({ tournament: T.detail(req.params.id) }); } catch (err) { tourFail(res, err); }
  });
  api.delete('/tournaments/:id', (req, res) => {
    try { T.remove(req.params.id); res.json({ ok: true }); } catch (err) { tourFail(res, err); }
  });

  // Góp ý của người chơi
  api.get('/feedback', (req, res) => res.json({ feedback: users.listFeedback() }));
  api.delete('/feedback/:id', (req, res) => {
    if (!users.removeFeedback(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy góp ý.' });
    res.json({ ok: true });
  });

  api.delete('/rooms/:id', (req, res) => {
    if (!game.closeRoom(req.params.id, 'Phòng đã bị quản trị viên đóng.')) {
      return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    }
    res.json({ ok: true });
  });

  app.use('/admin/api', api);
  app.use('/admin', express.static(path.join(__dirname, 'admin')));

  return { password };
};
