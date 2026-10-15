const path = require('path');
// Biến môi trường từ file .env (Node ≥ 20.12) — vd SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* không có file .env */ }
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const X = require('./public/xiangqi.js');
const users = require('./users.js');
const setupAdmin = require('./admin.js');
const setupAccount = require('./account.js');
const theme = require('./theme.js');
const puzzles = require('./puzzles.js');
const storage = require('./storage');
const tournaments = require('./tournaments.js');
const engineServer = require('./engine-server.js');
const Catalog = require('./public/catalog.js');
const economy = require('./economy.js');
const shop = require('./shop.js');
const features = require('./features-store.js');
const config = require('./config-store.js');
const CFG = config.values; // cài đặt hệ thống (admin chỉnh) — luôn đọc CFG.X lúc dùng
const F = (key) => features.on(key); // chức năng đang bật? (admin → Chức năng web)
const community = require('./community.js');
const E = Catalog.ECONOMY; // cài đặt chế độ chơi (admin chỉnh được) — luôn đọc E.X để thấy giá trị mới nhất

const PORT = process.env.PORT || 3000;
// Lựa chọn thời gian khi tạo phòng (0 = không giới hạn)
const TIME_MOVE_SEC = [30, 60, 120, 180, 300]; // thời gian mỗi nước (giây) — bắt buộc khi ván có tính giờ
const DEFAULT_MOVE_SEC = 60;
// Người chơi mất kết nối quá 90 giây (mặc định) → coi như rời bàn
// Thời gian giữ chỗ khi mất kết nối & xác nhận ghép trận (admin chỉnh; biến môi trường ABANDON_SECONDS được ưu tiên)
const abandonMs = () => (Number(process.env.ABANDON_SECONDS) || CFG.ABANDON_SEC) * 1000;
const acceptMs = () => CFG.ACCEPT_SEC * 1000;

const app = express();
// Fairy-Stockfish (WebAssembly đa luồng) cần trang được "cách ly" để dùng SharedArrayBuffer.
// 'credentialless' vẫn cho tải ảnh/font từ nơi khác (Google Fonts, Supabase Storage). Tắt bằng ENGINE_BROWSER=0.
if (process.env.ENGINE_BROWSER !== '0') {
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
}
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/fairy-stockfish', express.static(path.join(__dirname, 'node_modules', 'fairy-stockfish-nnue.wasm'), { maxAge: '7d' }));
engineServer.setup(app, express);
// Ảnh lưu trên máy (khi dùng Supabase, ảnh nằm trong Storage và có link công khai riêng)
if (storage.DIRS) {
  app.use('/uploads', express.static(storage.DIRS.uploads, { maxAge: '30d', immutable: true }));
  app.use('/avatars', express.static(storage.DIRS.avatars, { maxAge: '30d', immutable: true }));
}
// ---------- Bài tập (người chơi) ----------
const sessionAccount = (req) => users.resolveSession((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
const puzzleSummary = (p, solved) => ({
  id: p.id, title: p.title, description: p.description, difficulty: p.difficulty, topic: p.topic || 'mate', side: p.side,
  board: p.board, moves: (p.solution.length + 1) / 2, solvedBy: p.solvedBy, solved: solved.has(p.id),
});
app.get('/api/puzzles', (req, res) => {
  const acc = sessionAccount(req);
  const solved = new Set(acc ? acc.solvedPuzzles : []);
  res.set('Cache-Control', 'no-store');
  res.json({ puzzles: puzzles.list().map((p) => puzzleSummary(p, solved)) });
});
app.get('/api/puzzles/:id', (req, res) => {
  const p = puzzles.get(req.params.id);
  if (!p || !p.published) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
  const acc = sessionAccount(req);
  res.set('Cache-Control', 'no-store');
  res.json({ puzzle: { ...puzzleSummary(p, new Set(acc ? acc.solvedPuzzles : [])), solution: p.solution } });
});
app.post('/api/puzzles/:id/solve', express.json({ limit: '20kb' }), (req, res) => {
  if (!F('puzzles')) return res.status(403).json({ error: features.offMessage('puzzles') });
  const p = puzzles.get(req.params.id);
  if (!p || !p.published) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
  if (!puzzles.checkSolution(p, req.body && req.body.moves)) return res.status(400).json({ error: 'Lời giải chưa đúng.' });
  const acc = sessionAccount(req);
  let coins = 0;
  if (acc) {
    const { ms, attempts, hints } = req.body || {};
    coins = users.markPuzzleSolved(acc.id, p.id, { ms, attempts, hints });
    if (coins) puzzles.countSolve(p.id);
  }
  res.json({ ok: true, coins, account: acc ? users.publicAccount(acc) : null });
});

app.get('/api/theme', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(theme.current());
});

// ---------- Trận đấu hot: các ván đang diễn ra (khán giả vào xem bằng ?room=MÃ&watch=1) ----------
app.get('/api/live', (req, res) => {
  const seat = (s) => ({ name: s.name, rating: s.rating || null, avatar: s.avatar || null, online: s.online });
  const live = [];
  for (const room of rooms.values()) {
    const { r, b } = room.players;
    const g = room.game;
    if (!r || !b || g.result || !room.rules.spectators) continue;
    const spectators = [...room.members.values()].filter((t) => !colorOf(room, t)).length;
    live.push({
      roomId: room.id, players: { r: seat(r), b: seat(b) }, turn: g.turn, moveCount: g.moveCount,
      spectators, settings: room.settings, board: g.board, lastMove: g.lastMove, rated: !!(r.accountId && b.accountId),
      startedAt: g.startedAt || null, kind: room.kind, stake: room.stake || null,
      tournament: room.tournament ? { id: room.tournament.id, name: room.tournament.name, round: room.tournament.round } : null,
    });
  }
  // Ưu tiên ván nhiều người xem, Elo cao, nhiều nước đi
  const score = (m) => m.spectators * 400 + ((m.players.r.rating || 1000) + (m.players.b.rating || 1000)) / 2 + m.moveCount * 2;
  live.sort((a, b) => score(b) - score(a));
  res.set('Cache-Control', 'no-store');
  const waiting = waitingCoinTables().sort((a, b) => a.createdAt - b.createdAt).slice(0, 30).map((room) => {
    const host = room.players.r || room.players.b;
    return { roomId: room.id, stake: room.stake, settings: room.settings, since: room.createdAt, host: { name: host.name, rating: host.rating || null, avatar: host.avatar || null } };
  });
  // Tất cả bàn (trang Chơi → Bàn đấu): bàn 1 người đang chờ, bàn đủ 2 người chờ sẵn sàng, bàn đang chơi
  const tables = [];
  for (const room of rooms.values()) {
    const { r, b } = room.players;
    const g = room.game;
    if ((!r && !b) || g.result) continue;
    const status = r && b ? (g.startedAt ? 'playing' : 'ready') : 'waiting';
    tables.push({
      roomId: room.id, status, players: { r: r ? seat(r) : null, b: b ? seat(b) : null },
      spectators: [...room.members.values()].filter((t) => !colorOf(room, t)).length,
      canWatch: !!room.rules.spectators && F('spectate'), kind: room.kind, stake: room.stake || null, settings: room.settings,
      board: g.board, lastMove: g.lastMove, moveCount: g.moveCount, since: room.createdAt,
      tournament: room.tournament ? { id: room.tournament.id, name: room.tournament.name } : null,
    });
  }
  const order = { playing: 0, ready: 1, waiting: 2 };
  tables.sort((a, b) => order[a.status] - order[b.status] || b.spectators - a.spectators || a.since - b.since);
  res.json({ online: onlineInfo().total, playing: live.length, searching: queue.size, matches: F('spectate') ? live.slice(0, 12) : [], waiting: F('coin') ? waiting : [],
    tables: F('tables') ? tables.slice(0, 60) : [] });
});

// ---------- Bảng xếp hạng ----------
const BOARDS = {
  rating: { value: (a) => a.rating, include: (a) => a.stats.online.games > 0 },
  friends: { value: (a) => a.rating, include: () => true },
  season: { value: (a, ctx) => ctx.points.get(a.id) || 0, include: (a, ctx) => ctx.points.has(a.id) },
  streak: { value: (a) => a.bestStreak, include: (a) => a.bestStreak > 0 },
  coin: { value: (a) => a.coinStats.wins, include: (a) => a.coinStats.games > 0 },
  puzzles: { value: (a) => a.solvedPuzzles.length, include: (a) => a.solvedPuzzles.length > 0 },
};
app.get('/api/leaderboard', (req, res) => {
  const by = BOARDS[req.query.by] ? req.query.by : 'rating';
  const viewer = sessionAccount(req);
  const ctx = { points: by === 'season' ? users.seasonPoints() : null };
  const value = (a) => BOARDS[by].value(a, ctx);
  const include = (a) => BOARDS[by].include(a, ctx)
    && (by !== 'friends' || (viewer && (a.id === viewer.id || viewer.friends.includes(a.id))));
  const ranked = users.list().filter((a) => !a.banned && include(a))
    .sort((a, b) => value(b) - value(a) || b.rating - a.rating || a.createdAt - b.createdAt);
  const row = (a, i) => {
    const st = a.stats.online;
    return {
      rank: i + 1, displayName: a.displayName, username: a.username, avatar: a.avatar || null,
      region: a.region || null, rating: a.rating, games: st.games, wins: st.wins, draws: st.draws, losses: st.losses,
      bestStreak: a.bestStreak, puzzlesSolved: a.solvedPuzzles.length, value: value(a),
    };
  };
  const myIndex = viewer ? ranked.findIndex((a) => a.id === viewer.id) : -1;
  res.set('Cache-Control', 'no-store');
  res.json({
    by, total: ranked.length, players: ranked.slice(0, 50).map(row), me: myIndex >= 0 ? row(ranked[myIndex], myIndex) : null,
    season: users.seasonInfo(),
  });
});

// Xem lại ván qua link (công khai)
app.get('/api/replay/:id', (req, res) => {
  const game = users.publicGame(String(req.params.id));
  if (!game) return res.status(404).json({ error: 'Không tìm thấy ván đấu.' });
  res.set('Cache-Control', 'no-store');
  res.json({ game });
});

// Cấu hình kinh tế & vật phẩm cho trình duyệt
app.get('/api/config', (req, res) => {
  res.json({ economy: economy.current(), abandonMs: abandonMs(), acceptMs: acceptMs() });
});
// Cài đặt chế độ chơi cho trình duyệt (nạp ngay sau catalog.js để không phải chờ tải dữ liệu)
// Cài đặt hệ thống (nội dung trang chủ, bậc rank, nhịp phòng riêng...) — trình duyệt nạp trước app.js
app.get('/api/site-config.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(config.browserScript());
});

// Chức năng đang bật/tắt — trình duyệt nạp trước app.js
app.get('/api/features.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(features.browserScript());
});

// Danh sách vật phẩm do admin quản lý — nạp ngay sau catalog.js
app.get('/api/shop.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(shop.browserScript());
});

app.get('/api/economy.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(economy.browserScript());
});

// ---------- Giải đấu (người chơi) ----------
const tourFail = (res, err) => {
  if (err instanceof tournaments.TournamentError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Có lỗi xảy ra.' });
};
app.get('/api/tournaments', (req, res) => {
  const acc = sessionAccount(req);
  res.set('Cache-Control', 'no-store');
  res.json({ tournaments: tournaments.publicList(acc && acc.id) });
});
app.get('/api/tournaments/:id', (req, res) => {
  const acc = sessionAccount(req);
  const t = tournaments.detail(String(req.params.id), acc && acc.id);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy giải.' });
  res.set('Cache-Control', 'no-store');
  res.json({ tournament: t });
});
for (const action of ['register', 'unregister', 'checkin']) {
  app.post(`/api/tournaments/:id/${action}`, (req, res) => {
    if (!F('tournaments')) return res.status(403).json({ error: features.offMessage('tournaments') });
    const acc = sessionAccount(req);
    if (!acc) return res.status(401).json({ error: 'Hãy đăng nhập để tham gia giải.' });
    try {
      const fn = { register: tournaments.register, unregister: tournaments.unregister, checkin: tournaments.checkIn }[action];
      fn(String(req.params.id), acc.id);
      res.json({ tournament: tournaments.detail(String(req.params.id), acc.id), account: users.publicAccount(acc) });
    } catch (err) { tourFail(res, err); }
  });
}
const server = http.createServer(app);
const io = new Server(server);

/**
 * room = {
 *   id, createdAt, game, players: { r: Seat|null, b: Seat|null },
 *   settings: { totalMs, moveMs, incMs } (null = không giới hạn / không cộng giờ), clockTimer,
 *   members: Map<socketId, token>, chat: [], drawOffer: 'r'|'b'|null,
 *   rematch: Set<'r'|'b'>, emptySince: number|null,
 *   abandonTimers: Map<token, Timeout>,  // đếm ngược khi người chơi mất kết nối
 *   emptyTimer: Timeout|null,             // đếm ngược huỷ phòng khi không còn ai
 *   archive: [{ n, players: { r, b }, result, history, endedAt }]  // các ván đã xong
 *   kind: 'room' (Chơi với bạn) | 'ranked' | 'match' (ghép trận có khách) | 'coin' (Chơi nhanh) | 'tournament',
 *   rules: { spectators, takeback }, ownerToken, ready: Set<'r'|'b'>, takebackOffer, stake, fee,
 *   reserved: { r: accountId, b: accountId } (phòng giải đấu), tournament: { id, name, round, pairingId }
 * }
 * Seat = { token, uid, accountId, name, avatar, username, online, offlineSince }
 *   uid = danh tính ('a:<mã tài khoản>' nếu đã đăng nhập, 'g:<mã trình duyệt>' nếu là khách)
 */
const rooms = new Map();

function newGame(settings = {}) {
  return {
    board: X.initialBoard(), turn: 'r', lastMove: null, moveCount: 0, result: null, history: [], names: { r: null, b: null },
    // Thời gian còn lại của mỗi bên; turnStartedAt = lúc bắt đầu lượt hiện tại (null = đồng hồ chưa chạy)
    clock: { r: settings.totalMs || 0, b: settings.totalMs || 0, turnStartedAt: null },
  };
}

// ---------- Đồng hồ ----------
const hasClock = (room) => !!(room.settings.totalMs || room.settings.moveMs);

// Thời gian đã dùng trong lượt hiện tại; trả về true nếu bên đang đi đã hết giờ
function isTimeUp(room, now = Date.now()) {
  const g = room.game, st = room.settings;
  if (!hasClock(room) || !g.clock.turnStartedAt) return false;
  const elapsed = now - g.clock.turnStartedAt;
  return (st.totalMs && g.clock[g.turn] - elapsed <= 0) || (st.moveMs && elapsed >= st.moveMs);
}

function startClock(room) {
  if (!hasClock(room) || room.game.result) return;
  room.game.clock.turnStartedAt = Date.now();
  scheduleTimeout(room);
}

// Hẹn giờ xử thua khi bên đang đi hết thời gian
function scheduleTimeout(room) {
  clearTimeout(room.clockTimer);
  const g = room.game, st = room.settings;
  if (!hasClock(room) || g.result || !g.clock.turnStartedAt) return;
  const elapsed = Date.now() - g.clock.turnStartedAt;
  let left = Infinity;
  if (st.totalMs) left = Math.min(left, g.clock[g.turn] - elapsed);
  if (st.moveMs) left = Math.min(left, st.moveMs - elapsed);
  const ply = g.history.length;
  room.clockTimer = setTimeout(() => {
    if (rooms.get(room.id) !== room || room.game !== g || g.result || g.history.length !== ply) return;
    timeOut(room);
  }, Math.max(0, left) + 30);
}

function timeOut(room) {
  const g = room.game;
  const loser = g.turn;
  finish(room, X.other(loser), 'timeout');
  systemMsg(room, `${room.players[loser] ? room.players[loser].name : 'Người chơi'} đã hết thời gian.`);
  broadcast(room);
}

// Dừng đồng hồ, trừ thời gian đã dùng của lượt hiện tại
function stopClock(room) {
  clearTimeout(room.clockTimer);
  const g = room.game;
  if (g.clock.turnStartedAt && room.settings.totalMs) {
    g.clock[g.turn] = Math.max(0, g.clock[g.turn] - (Date.now() - g.clock.turnStartedAt));
  }
  g.clock.turnStartedAt = null;
}

function newRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from(crypto.randomBytes(6), (n) => alphabet[n % alphabet.length]).join('');
  } while (rooms.has(id));
  return id;
}

const cleanName = (s) => String(s || '').trim().slice(0, 20) || 'Người chơi';
const cleanToken = (s) => String(s || '').slice(0, 64);

function colorOf(room, token) {
  if (room.players.r && room.players.r.token === token) return 'r';
  if (room.players.b && room.players.b.token === token) return 'b';
  return null;
}

function publicState(room) {
  const seat = (s) => (s ? {
    name: s.name, online: s.online, avatar: s.avatar || null, username: s.username || null, rating: s.rating || null,
    offlineSince: s.online ? null : s.offlineSince || null, accountId: s.accountId || null,
  } : null);
  const g = room.game;
  return {
    roomId: room.id,
    board: g.board,
    turn: g.turn,
    lastMove: g.lastMove,
    moveCount: g.moveCount,
    history: g.history,
    gameNames: g.names,
    archive: room.archive,
    result: g.result,
    inCheck: !g.result && X.isInCheck(g.board, g.turn),
    players: { r: seat(room.players.r), b: seat(room.players.b) },
    spectators: [...room.members.values()].filter((t) => !colorOf(room, t)).length,
    drawOffer: room.drawOffer,
    settings: room.settings,
    clock: { ...g.clock, now: Date.now() },
    rematch: [...room.rematch],
    started: !!(room.players.r && room.players.b && g.startedAt),
    startedAt: g.startedAt || null,
    matchmaking: !!room.matchmaking,
    rated: room.kind === 'ranked' || (room.kind === 'tournament' && !!(room.players.r && room.players.b && room.players.r.accountId && room.players.b.accountId)),
    kind: room.kind, rules: room.rules, stake: room.stake || null, fee: room.fee || null,
    ready: [...room.ready], takebackOffer: room.takebackOffer || null, graceMs: abandonMs(),
    tournament: room.tournament ? { id: room.tournament.id, name: room.tournament.name, round: room.tournament.round, deadline: room.tournament.deadline || null } : null,
    ownerColor: colorOf(room, room.ownerToken),
    reservedNames: room.reservedNames || null,
  };
}

function broadcast(room) {
  const base = publicState(room);
  for (const [sid, token] of room.members) {
    io.to(sid).emit('state', { ...base, you: colorOf(room, token) });
  }
}

function systemMsg(room, text) {
  const msg = { system: true, text, at: Date.now() };
  room.chat.push(msg);
  if (room.chat.length > 100) room.chat.shift();
  io.to(room.id).emit('chat', msg);
}

function finish(room, winner, reason) {
  const g = room.game;
  stopClock(room);
  g.result = { winner, reason };
  room.drawOffer = null;
  // Lưu lịch sử nếu có người chơi đã đăng nhập
  room.takebackOffer = null;
  const { r, b } = room.players;
  let gameId = null;
  if (r.accountId || b.accountId) {
    const rec = users.recordGame({
      mode: 'online', kind: room.kind, stake: room.stake || null, fee: room.fee || null, tc: room.settings, startedAt: g.startedAt,
      tournament: room.tournament ? { id: room.tournament.id, name: room.tournament.name, round: room.tournament.round } : null,
      players: { r: { name: r.name, accountId: r.accountId || null }, b: { name: b.name, accountId: b.accountId || null } },
      result: g.result, moves: g.history,
    });
    gameId = rec.id;
    // Để màn kết thúc ván hiện Elo / xu thay đổi (object mới: không ghi thêm vào bản lưu ván)
    g.result = { ...g.result, ratingChange: rec.ratingChange || null, coinChange: rec.coinChange, gameId };
  } else {
    users.countGuestGame();
  }
  if (room.tournament) tournaments.reportResult(room.tournament.id, room.tournament.pairingId, winner, reason, gameId);
}

// Lưu ván đã xong vào danh sách xem lại
function archiveGame(room) {
  const g = room.game;
  if (!g.result || !g.history.length) return;
  room.archive.push({
    n: room.archive.length + 1,
    players: { ...g.names },
    result: g.result,
    history: g.history,
    endedAt: Date.now(),
  });
  if (room.archive.length > 20) room.archive.shift();
}

function joinRoom(socket, room, name, token, { spectate = false, note = null } = {}) {
  // Rời phòng cũ (nếu có)
  if (socket.data.roomId && socket.data.roomId !== room.id) leaveRoom(socket, { explicit: true });

  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.token = token;
  const uid = socket.data.identity;
  const accountId = socket.data.accountId || null;
  room.members.set(socket.id, token);
  room.emptySince = null;
  clearTimeout(room.emptyTimer);

  const acc = accountId ? users.get(accountId) : null;
  const profile = { avatar: (acc && acc.avatar) || null, username: (acc && acc.username) || null, rating: acc ? acc.rating : null };
  let color = colorOf(room, token);
  // Phòng giải đấu: kỳ thủ đã đăng nhập vào đúng ghế của mình (kể cả từ tab/thiết bị khác)
  if (!color && room.reserved && accountId && !spectate) {
    const c = ['r', 'b'].find((x) => room.reserved[x] === accountId);
    if (c && room.players[c] && room.players[c].accountId === accountId) {
      room.players[c].token = token;
      color = c;
    }
  }
  if (color) {
    clearTimeout(room.abandonTimers.get(token));
    room.abandonTimers.delete(token);
    room.players[color].online = true;
    room.players[color].offlineSince = null;
    room.players[color].name = name;
    Object.assign(room.players[color], profile);
  } else if (!spectate) {
    // Phòng giải: chỉ kỳ thủ được xếp cặp mới ngồi được, đúng màu quân
    const free = room.reserved
      ? ['r', 'b'].filter((c) => !room.players[c] && accountId && room.reserved[c] === accountId)
      : ['r', 'b'].filter((c) => !room.players[c]);
    if (free.length) {
      color = free[0];
      // Ghế trống sau khi có người rời → bắt đầu ván mới cho người vừa vào
      if (room.game.result || room.game.history.length) {
        archiveGame(room);
        room.game = newGame(room.settings);
        room.rematch.clear();
        room.drawOffer = null;
      }
      room.players[color] = { token, uid, accountId, name, online: true, ...profile };
      systemMsg(room, `${name} đã vào cầm quân ${color === 'r' ? 'Đỏ' : 'Đen'}.`);
    }
  }
  if (room.players.r && room.players.b && !room.game.history.length) {
    room.game.names = { r: room.players.r.name, b: room.players.b.name };
    // Phòng riêng & Chơi nhanh: chờ cả hai bấm "Sẵn sàng" (xác nhận cược) mới bắt đầu; các loại khác bắt đầu ngay khi đủ 2 người
    if (!NEEDS_READY.includes(room.kind)) beginGame(room);
  }

  socket.emit('joined', { roomId: room.id, color, chat: room.chat, note });
  broadcast(room);
}

const NEEDS_READY = ['room', 'coin']; // loại bàn phải cả hai xác nhận mới bắt đầu

// Bắt đầu ván: ghi giờ bắt đầu & chạy đồng hồ
function beginGame(room) {
  if (room.game.startedAt) return;
  room.game.startedAt = Date.now();
  room.ready.clear();
  if (!room.game.clock.turnStartedAt) startClock(room);
}

// Người chơi rời ghế: ván đã có nước đi thì bị xử thua, ghế được giải phóng cho người khác.
function vacateSeat(room, color) {
  const seat = room.players[color];
  if (!seat) return;
  // Chưa ai đi nước nào → đặt lại đồng hồ, chờ người mới vào mới tính giờ
  if (!room.game.result && !room.game.history.length) {
    clearTimeout(room.clockTimer);
    room.game.clock = newGame(room.settings).clock;
  }
  clearTimeout(room.abandonTimers.get(seat.token));
  room.abandonTimers.delete(seat.token);
  const g = room.game;
  if (room.players.r && room.players.b && !g.result && g.history.length) {
    finish(room, X.other(color), 'abandon');
  }
  room.players[color] = null;
  room.rematch.clear();
  room.ready.clear();
  room.drawOffer = null;
  room.takebackOffer = null;
  // Chưa đi nước nào: ván mới cần sẵn sàng lại
  if (!room.game.history.length && !room.game.result) room.game.startedAt = null;
  systemMsg(room, `${seat.name} đã rời bàn.`);
}

// Phòng chỉ bị huỷ khi không còn ai trong phòng.
// Người cuối cùng chủ động rời → huỷ ngay; mất kết nối → chờ thời gian giữ chỗ (abandonMs) để còn kịp tải lại trang.
function checkEmpty(room, immediate) {
  if (room.members.size > 0) return;
  room.emptySince = Date.now();
  clearTimeout(room.emptyTimer);
  if (immediate) destroyRoom(room);
  else room.emptyTimer = setTimeout(() => room.members.size === 0 && destroyRoom(room), abandonMs());
}

// explicit = người dùng chủ động rời (bấm Rời bàn, sang phòng khác, bị mời ra);
// ngược lại là mất kết nối — cho phép quay lại trong abandonMs().
function leaveRoom(socket, { explicit = false } = {}) {
  const room = rooms.get(socket.data.roomId);
  socket.data.roomId = null;
  if (!room) return;
  room.members.delete(socket.id);
  socket.leave(room.id);
  const token = socket.data.token;
  const color = colorOf(room, token);
  const stillHere = [...room.members.values()].includes(token);
  if (color && !stillHere) {
    if (explicit && room.kind === 'room' && token === room.ownerToken && !room.game.history.length && room.members.size) {
      // Chủ phòng rời khi chưa vào ván → đóng phòng
      destroyRoom(room, 'Chủ phòng đã rời — phòng đã đóng.');
      return;
    }
    if (explicit) {
      vacateSeat(room, color);
    } else {
      room.players[color].online = false;
      room.players[color].offlineSince = Date.now();
      clearTimeout(room.abandonTimers.get(token));
      room.abandonTimers.set(token, setTimeout(() => {
        const c = colorOf(room, token);
        if (!c || !rooms.has(room.id)) return;
        vacateSeat(room, c);
        broadcast(room);
        checkEmpty(room, true);
      }, abandonMs()));
    }
  }
  broadcast(room);
  checkEmpty(room, explicit);
}

// Huỷ phòng. Có adminReason khi quản trị viên đóng phòng (thông báo cho người đang trong phòng).
function destroyRoom(room, adminReason) {
  if (rooms.get(room.id) !== room) return;
  rooms.delete(room.id);
  for (const t of room.abandonTimers.values()) clearTimeout(t);
  clearTimeout(room.emptyTimer);
  clearTimeout(room.clockTimer);
  for (const sid of room.members.keys()) {
    const s = io.of('/').sockets.get(sid);
    if (!s) continue;
    s.leave(room.id);
    s.data.roomId = null;
    s.emit('room-closed', adminReason || 'Phòng đã được huỷ.');
  }
}

function seatOf(uid) {
  for (const room of rooms.values()) {
    for (const c of ['r', 'b']) {
      if (room.players[c] && room.players[c].uid === uid) return { room, color: c };
    }
  }
  return null;
}

// Mỗi người chỉ được ngồi ở 1 phòng. Ghế cũ không còn tab nào mở thì giải phóng luôn.
function ensureOneRoom(socket, uid) {
  const found = seatOf(uid);
  if (!found) return true;
  const { room, color } = found;
  const active = [...room.members.values()].includes(room.players[color].token);
  if (active) {
    socket.emit('error-msg', `Bạn đang ở phòng ${room.id}. Mỗi người chỉ được mở 1 phòng — hãy rời phòng đó trước.`);
    return false;
  }
  vacateSeat(room, color);
  broadcast(room);
  checkEmpty(room, true);
  return true;
}

function currentRoom(socket) {
  return rooms.get(socket.data.roomId) || null;
}

// Xác định người chơi: tài khoản (nếu phiên đăng nhập hợp lệ) hoặc khách.
function setIdentity(socket, uid, session) {
  socket.data.uid = uid;
  const acc = session ? users.resolveSession(session) : null;
  if (session && !acc) socket.emit('auth-invalid'); // phiên hết hạn / tài khoản bị khoá
  socket.data.accountId = acc ? acc.id : null;
  socket.data.identity = acc ? 'a:' + acc.id : 'g:' + uid;
  if (acc) users.touch(acc.id);
  return acc;
}

// Kiểm tra danh tính trước khi tạo/vào phòng. Trả về tên hiển thị, hoặc null nếu bị chặn.
// Khách (chưa đăng nhập) chỉ dùng được Phân tích & Đấu máy — mọi thao tác chơi online cần tài khoản
const GUEST_MSG = 'Hãy đăng nhập để chơi online — khách chỉ dùng được Phân tích và Đấu máy.';
function needAccount(socket) {
  if (socket.data.accountId) return true;
  socket.emit('error-msg', GUEST_MSG);
  socket.emit('need-login');
  return false;
}

function identify(socket, uid, name, session) {
  if (!users.isValidUid(uid)) {
    socket.emit('error-msg', 'Thiếu mã định danh, hãy tải lại trang.');
    return null;
  }
  const acc = setIdentity(socket, uid, session);
  return acc ? acc.displayName : cleanName(name);
}

// ---------- Hàm cho trang quản trị ----------
function socketsOf(accountId) {
  return [...io.of('/').sockets.values()].filter((s) => s.data.accountId === accountId);
}

// accounts: Map<mã tài khoản, { sockets, roomId }>; total: số người (kể cả khách) đang online
function onlineInfo() {
  const accounts = new Map();
  const identities = new Set();
  for (const s of io.of('/').sockets.values()) {
    if (s.data.identity) identities.add(s.data.identity);
    if (!s.data.accountId) continue;
    const o = accounts.get(s.data.accountId) || { sockets: 0, roomId: null };
    o.sockets++;
    o.roomId = o.roomId || s.data.roomId || null;
    accounts.set(s.data.accountId, o);
  }
  return { accounts, total: identities.size };
}

// Mời tài khoản ra khỏi phòng; logout = true khi tài khoản bị khoá/xoá (đăng xuất luôn)
function kickUser(accountId, reason, { logout = false } = {}) {
  const list = socketsOf(accountId);
  for (const s of list) {
    leaveRoom(s, { explicit: true });
    s.emit('kicked', reason);
    if (logout) {
      s.emit('auth-invalid');
      s.data.accountId = null;
      s.data.identity = 'g:' + s.data.uid;
    }
  }
  return list.length;
}

function renameUser(accountId, name, avatar) {
  for (const room of rooms.values()) {
    let changed = false;
    for (const c of ['r', 'b']) {
      if (room.players[c] && room.players[c].accountId === accountId) {
        room.players[c].name = name;
        if (avatar !== undefined) room.players[c].avatar = avatar;
        changed = true;
      }
    }
    if (changed) broadcast(room);
  }
}

function closeRoom(id, reason) {
  const room = rooms.get(id);
  if (!room) return false;
  destroyRoom(room, reason);
  return true;
}

// Kỳ thủ đang online? Đang ở phòng nào (đang chơi / xem)?
function presenceOf(accountId) {
  const s = socketsOf(accountId);
  if (!s.length) return { online: false, roomId: null, playing: false };
  const roomId = (s.find((x) => x.data.roomId) || {}).data?.roomId || null;
  const room = roomId ? rooms.get(roomId) : null;
  const playing = !!(room && ['r', 'b'].some((c) => room.players[c] && room.players[c].accountId === accountId) && room.game.startedAt && !room.game.result);
  return { online: true, roomId: room && room.rules.spectators ? roomId : null, playing };
}
setupAccount(app, { users, presenceOf, features, onAccountChange: (acc) => renameUser(acc.id, acc.displayName, acc.avatar || null) });
setupAdmin(app, {
  rooms, users, theme, puzzles, tournaments, onlineInfo, kickUser, renameUser, closeRoom,
  queueSize: () => queue.size,
  onThemeChange: (current) => io.emit('theme', current), // cập nhật ngay cho mọi người đang chơi
  economy, onEconomyChange: (current) => io.emit('economy', current),
  shop, onShopChange: (items) => io.emit('shop', items),
  features, onFeaturesChange: (state) => io.emit('features', state),
  config, onConfigChange: (values) => io.emit('site-config', values),
  community, onCommunityDelete: (id) => io.emit('community-delete', id),
});

// Bàn chơi nhanh đang chờ: đúng nhịp & mức đặt, mới có 1 người (không phải mình), chưa bắt đầu
function waitingCoinTables() {
  return [...rooms.values()].filter((room) => {
    if (!room.coinTable || room.game.startedAt || room.game.history.length) return false;
    const seated = ['r', 'b'].filter((c) => room.players[c]);
    return seated.length === 1 && room.players[seated[0]].online;
  });
}
function findCoinTable(settings, stake, accountId) {
  return waitingCoinTables()
    .filter((room) => room.stake === stake && room.settings.totalMs === settings.totalMs && (room.settings.incMs || 0) === (settings.incMs || 0)
      && !['r', 'b'].some((c) => room.players[c] && room.players[c].accountId === accountId))
    .sort((a, b) => a.createdAt - b.createdAt)[0] || null;
}

// Nhịp do admin cài (Xếp hạng / Chơi nhanh) — đã kiểm tra ở economy.js nên không giới hạn theo danh sách phòng riêng
const tcSettings = (totalMin, incSec, moveSec) => ({ totalMs: totalMin * 60000, moveMs: (moveSec || DEFAULT_MOVE_SEC) * 1000, incMs: incSec ? incSec * 1000 : null });

function parseSettings(totalMin, moveSec, incSec) {
  // Phòng riêng chỉ nhận nhịp trong danh sách admin cài (kiểm tra ở 'create'); giải đấu dùng nhịp riêng của giải
  const totalMs = Number.isInteger(totalMin) && totalMin > 0 && totalMin <= 180 ? totalMin * 60 * 1000 : null;
  return {
    totalMs,
    // Có tổng thời gian thì bắt buộc giới hạn mỗi nước (không chọn / chọn sai → 60 giây)
    moveMs: totalMs ? (TIME_MOVE_SEC.includes(moveSec) ? moveSec : DEFAULT_MOVE_SEC) * 1000 : null,
    // Chỉ cộng giờ khi có giới hạn tổng thời gian
    incMs: totalMs && Number.isInteger(incSec) && incSec > 0 && incSec <= 60 ? incSec * 1000 : null,
  };
}

function createRoom(settings, opts = {}) {
  const room = {
    id: newRoomId(),
    createdAt: Date.now(),
    settings,
    kind: opts.kind || 'room',
    rules: { spectators: opts.rules ? opts.rules.spectators !== false : true, takeback: !!(opts.rules && opts.rules.takeback) },
    ownerToken: opts.ownerToken || null,
    ready: new Set(),
    takebackOffer: null,
    stake: opts.stake || null,
    fee: opts.fee || null,
    reserved: opts.reserved || null,
    tournament: opts.tournament || null,
    matchmaking: !!opts.matchmaking,
    coinTable: !!opts.coinTable, // bàn chơi nhanh kiểu "bàn chờ"
    clockTimer: null,
    game: newGame(settings),
    players: { r: null, b: null },
    members: new Map(),
    chat: [],
    drawOffer: null,
    rematch: new Set(),
    emptySince: null,
    abandonTimers: new Map(),
    emptyTimer: null,
    archive: [],
  };
  rooms.set(room.id, room);
  return room;
}

// ---------- Ghép trận: ưu tiên người đang online có Elo gần nhau ----------
// Khoảng Elo chấp nhận: ±100, nới thêm ±50 mỗi 5 giây chờ; chờ quá 60 giây thì ghép với bất kỳ ai.
// Khác thể thức thời gian bị tính thêm 150 điểm chênh lệch (vẫn ghép được khi đã chờ lâu).
// mode 'ranked' (Xếp hạng, phí xu nếu cả hai có tài khoản) | 'coin' (Chơi nhanh, cùng mức đặt, chỉ tài khoản).
// Tìm thấy đối thủ → cả hai bấm "Chấp nhận" trong 12 giây; ai từ chối / không phản hồi bị loại khỏi hàng chờ.
const MM_OTHER_SETTINGS = 150, MM_MIXED = 200; // khoảng chênh Elo khi tìm trận: admin chỉnh (CFG.MM_*)
const queue = new Map(); // socketId -> { socket, token, name, identity, accountId, rating, settings, since, mode, stake }
const pendingMatches = new Map(); // matchId -> { id, a, b, accepted: Set<socketId>, timer }

const mmWindow = (e, now) => (now - e.since >= CFG.MM_ANY_SEC * 1000 ? Infinity : CFG.MM_BASE + Math.floor((now - e.since) / (CFG.MM_STEP_SEC * 1000)) * CFG.MM_STEP);
const sameSettings = (a, b) => a.settings.totalMs === b.settings.totalMs && a.settings.moveMs === b.settings.moveMs
  && a.settings.incMs === b.settings.incMs;

function mmLeave(socket) {
  if (queue.delete(socket.id)) socket.emit('mm-status', { queued: false });
  for (const m of pendingMatches.values()) if (m.a.socket === socket || m.b.socket === socket) declineMatch(m, socket.id, 'cancel');
}

function runMatchmaker() {
  const now = Date.now();
  for (const [sid, e] of queue) if (!e.socket.connected) queue.delete(sid);
  const list = [...queue.values()].sort((a, b) => a.since - b.since); // người chờ lâu được ưu tiên
  const used = new Set();
  for (const a of list) {
    if (used.has(a)) continue;
    let best = null, bestScore = Infinity;
    for (const b of list) {
      if (b === a || used.has(b) || b.identity === a.identity || a.mode !== b.mode) continue;
      if (a.mode === 'coin' && a.stake !== b.stake) continue;
      if (a.accountId && b.accountId && users.isBlocked(a.accountId, b.accountId)) continue;
      const score = Math.abs(a.rating - b.rating) + (sameSettings(a, b) ? 0 : MM_OTHER_SETTINGS)
        + (!!a.accountId === !!b.accountId ? 0 : MM_MIXED);
      if (score <= Math.max(mmWindow(a, now), mmWindow(b, now)) && score < bestScore) { best = b; bestScore = score; }
    }
    if (best) {
      used.add(a).add(best);
      proposeMatch(a, best);
    }
  }
  for (const e of queue.values()) {
    const w = mmWindow(e, now);
    e.socket.emit('mm-status', { queued: true, since: e.since, now, range: w === Infinity ? null : w, searching: queue.size, rating: e.rating, mode: e.mode, stake: e.stake || null });
  }
}

// Đề nghị ghép: cả hai cần chấp nhận
function proposeMatch(a, b) {
  queue.delete(a.socket.id);
  queue.delete(b.socket.id);
  const id = crypto.randomBytes(6).toString('hex');
  const m = { id, a, b, accepted: new Set(), deadline: Date.now() + acceptMs() };
  m.timer = setTimeout(() => {
    if (!pendingMatches.has(id)) return;
    for (const e of [a, b]) if (!m.accepted.has(e.socket.id)) declineMatch(m, e.socket.id, 'timeout');
  }, acceptMs() + 300);
  pendingMatches.set(id, m);
  const rated = a.mode === 'ranked' && !!(a.accountId && b.accountId);
  for (const [me, opp] of [[a, b], [b, a]]) {
    me.socket.emit('mm-found', {
      matchId: id, opponent: opp.name, rating: opp.rating, rated, mode: a.mode, stake: a.stake || null,
      fee: rated ? E.RANKED_FEE : 0, deadline: m.deadline, now: Date.now(),
    });
  }
}

function acceptMatch(socket, matchId) {
  const m = pendingMatches.get(matchId);
  if (!m || (m.a.socket !== socket && m.b.socket !== socket)) return;
  m.accepted.add(socket.id);
  const other = m.a.socket === socket ? m.b : m.a;
  other.socket.emit('mm-opponent-accepted', { matchId });
  if (m.accepted.size === 2) {
    clearTimeout(m.timer);
    pendingMatches.delete(m.id);
    startMatch(m.a, m.b);
  }
}

// Một bên từ chối / hết giờ / huỷ: bên kia quay lại hàng chờ (giữ thời gian chờ)
function declineMatch(m, socketId, why) {
  if (!pendingMatches.has(m.id)) return;
  clearTimeout(m.timer);
  pendingMatches.delete(m.id);
  for (const e of [m.a, m.b]) {
    if (e.socket.id === socketId) {
      e.socket.emit('mm-status', { queued: false, reason: why === 'timeout' ? 'Bạn chưa xác nhận kịp — đã rời hàng chờ.' : null });
    } else if (e.socket.connected) {
      queue.set(e.socket.id, e);
      e.socket.emit('mm-requeue', { reason: why === 'timeout' ? 'Đối thủ không phản hồi — đang tìm người khác.' : 'Đối thủ đã từ chối — đang tìm người khác.' });
    }
  }
  runMatchmaker();
}

// Tạo phòng cho 2 người đã chấp nhận (dùng thể thức của người chờ lâu hơn), màu quân ngẫu nhiên
function startMatch(a, b) {
  if (!a.socket.connected || !b.socket.connected) {
    for (const e of [a, b]) if (e.socket.connected) { queue.set(e.socket.id, e); e.socket.emit('mm-requeue', { reason: 'Đối thủ đã thoát — đang tìm người khác.' }); }
    return;
  }
  const accA = a.accountId ? users.get(a.accountId) : null, accB = b.accountId ? users.get(b.accountId) : null;
  let kind = a.mode === 'coin' ? 'coin' : accA && accB ? 'ranked' : 'match';
  // Kiểm tra lại xu ngay trước khi vào ván
  const need = kind === 'coin' ? a.stake : kind === 'ranked' ? E.RANKED_FEE : 0;
  for (const [e, acc] of [[a, accA], [b, accB]]) {
    if (need && (!acc || acc.coins < need)) {
      const other = e === a ? b : a;
      e.socket.emit('mm-status', { queued: false, reason: `Không đủ xu (cần ${need} xu).` });
      queue.set(other.socket.id, other);
      other.socket.emit('mm-requeue', { reason: 'Đối thủ không đủ xu — đang tìm người khác.' });
      return;
    }
  }
  let fee = null;
  if (kind === 'ranked') {
    users.spendCoins(accA.id, E.RANKED_FEE);
    users.spendCoins(accB.id, E.RANKED_FEE);
    fee = E.RANKED_FEE;
  }
  const room = createRoom(a.settings, { kind, matchmaking: true, stake: kind === 'coin' ? a.stake : null, fee, rules: { spectators: true, takeback: false } });
  const colorA = Math.random() < 0.5 ? 'r' : 'b';
  room.players[colorA] = { token: a.token, uid: a.identity, accountId: a.accountId, name: a.name, online: true };
  joinRoom(a.socket, room, a.name, a.token);
  joinRoom(b.socket, room, b.name, b.token);
  systemMsg(room, kind === 'ranked' ? `Ván xếp hạng — có tính Elo, đã trừ ${E.RANKED_FEE} xu phí mỗi bên.`
    : kind === 'coin' ? `Chơi nhanh ${a.stake} xu — thắng nhận ${a.stake} xu của đối thủ, hoà hoàn nguyên. Không tính Elo.`
      : 'Ván được ghép tự động — không tính Elo (có khách tham gia).');
  broadcast(room);
}
setInterval(runMatchmaker, 1000).unref();

// ---------- Phòng giải đấu ----------
tournaments.hooks.createRoom = (t, round, pr) => {
  const room = createRoom(parseSettings(t.tc.totalMin, 0, t.tc.incSec), {
    kind: 'tournament', rules: { spectators: true, takeback: false },
    reserved: { r: pr.r, b: pr.b },
    tournament: { id: t.id, name: t.name, round: round.n, pairingId: pr.id, deadline: pr.createdAt + t.noShowMin * 60000 },
  });
  // Giữ ghế cho đúng kỳ thủ (vào bàn bằng tài khoản)
  for (const c of ['r', 'b']) {
    const acc = users.get(room.reserved[c]);
    room.players[c] = null;
    if (acc) room.reservedNames = { ...(room.reservedNames || {}), [c]: acc.displayName };
  }
  room.emptySince = Date.now(); // chưa ai vào → phòng tự huỷ nếu bỏ trống quá lâu
  systemMsg(room, `${t.name} · Vòng ${round.n}. Ván bắt đầu khi cả hai kỳ thủ vào bàn.`);
  return room.id;
};
tournaments.hooks.roomState = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return null;
  return { seated: { r: !!room.players.r, b: !!room.players.b }, started: !!room.game.startedAt, finished: !!room.game.result };
};
tournaments.hooks.closeRoom = (roomId, reason) => closeRoom(roomId, reason);

// Thông báo mới → đẩy ngay tới các tab đang mở của tài khoản
users.hooks.onNotify = (accountId, n, unread) => {
  for (const s of socketsOf(accountId)) s.emit('notify', { notification: n, unread });
};

io.on('connection', (socket) => {
  // Trình duyệt báo mã người chơi ngay khi kết nối (để biết ai đang online)
  socket.on('hello', ({ uid, session } = {}) => {
    if (!users.isValidUid(uid)) return;
    setIdentity(socket, uid, session);
  });

  // ---------- Cộng đồng (trang chủ): trò chuyện chung & chia sẻ thế cờ ----------
  socket.on('community-history', () => socket.emit('community-history', community.history()));
  socket.on('community-post', ({ uid, session, text, position } = {}) => {
    if (!F('community')) return socket.emit('community-error', features.offMessage('community'));
    if (users.isValidUid(uid)) setIdentity(socket, uid, session);
    const acc = socket.data.accountId ? users.get(socket.data.accountId) : null;
    try {
      io.emit('community-msg', community.post(acc, { text, position }));
    } catch (err) {
      if (!(err instanceof community.CommunityError)) console.error(err);
      socket.emit('community-error', err instanceof community.CommunityError ? err.message : 'Không gửi được tin.');
    }
  });
  socket.on('community-delete', ({ id } = {}) => {
    try {
      if (!socket.data.accountId) throw new community.CommunityError('Đăng nhập để xoá tin.');
      if (community.remove(String(id || ''), socket.data.accountId)) io.emit('community-delete', String(id));
    } catch (err) {
      socket.emit('community-error', err.message);
    }
  });

  // Tạo phòng riêng (Chơi với bạn). rules: { spectators, takeback }
  function createPrivateRoom({ name, token, color, uid, session, totalMin, moveSec, incSec, rules } = {}) {
    token = cleanToken(token);
    if (!token) { socket.emit('error-msg', 'Thiếu mã định danh.'); return null; }
    name = identify(socket, uid, name, session);
    if (!name) return null;
    if (!needAccount(socket)) return null;
    mmLeave(socket);
    if (socket.data.roomId) leaveRoom(socket, { explicit: true });
    if (!ensureOneRoom(socket, socket.data.identity)) return null;
    const room = createRoom(parseSettings(totalMin, moveSec, incSec), { kind: 'room', rules: rules || {}, ownerToken: token });
    const side = color === 'b' ? 'b' : color === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : 'r';
    room.players[side] = { token, uid: socket.data.identity, accountId: socket.data.accountId, name, online: true };
    joinRoom(socket, room, name, token);
    return room;
  }
  // Phòng riêng: chọn riêng phút mỗi bên (theo danh sách nhịp của Admin) và giây cộng (theo danh sách cố định + giây cộng của các nhịp)
  const ROOM_INC_OPTS = [0, 2, 3, 5, 10, 15, 30];
  function roomTcOk(opts) {
    const total = Number(opts.totalMin) || 0, inc = Number(opts.incSec) || 0;
    const tcs = CFG.ROOM_TCS.map((t) => t.split('|').map(Number));
    if (!tcs.some(([m]) => m === total)) return false;
    if (total === 0) return inc === 0;
    return ROOM_INC_OPTS.includes(inc) || tcs.some(([, i]) => i === inc);
  }
  socket.on('create', (opts) => {
    if (!F('room')) return socket.emit('error-msg', features.offMessage('room'));
    if (opts && !roomTcOk(opts)) return socket.emit('error-msg', 'Nhịp chơi không hợp lệ.');
    createPrivateRoom(opts);
  });

  // Mời một kỳ hữu: tạo phòng riêng rồi gửi thông báo kèm mã phòng
  socket.on('invite-friend', (opts = {}) => {
    if (!F('room') || !F('friends')) return socket.emit('error-msg', features.offMessage(F('room') ? 'friends' : 'room'));
    const to = String(opts.to || '');
    const acc = opts.session ? users.resolveSession(opts.session) : null;
    if (!acc) return socket.emit('error-msg', 'Hãy đăng nhập để mời kỳ hữu.');
    if (!users.areFriends(acc.id, to)) return socket.emit('error-msg', 'Chỉ mời được kỳ hữu trong danh sách bạn bè.');
    if (!roomTcOk(opts)) return socket.emit('error-msg', 'Nhịp chơi không hợp lệ.');
    const room = createPrivateRoom(opts);
    if (!room) return;
    users.notify(to, 'invite', { from: users.miniAccount(acc), roomId: room.id, tc: room.settings });
    systemMsg(room, `Đã gửi lời mời tới ${(users.get(to) || {}).displayName || 'kỳ hữu'} — chờ bạn ấy vào phòng.`);
  });

  socket.on('join', ({ roomId, name, token, uid, spectate, session } = {}) => {
    mmLeave(socket);
    token = cleanToken(token);
    const room = rooms.get(String(roomId || '').toUpperCase().trim());
    if (!room) return socket.emit('error-msg', 'Không tìm thấy phòng. Kiểm tra lại mã phòng.');
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    if (!needAccount(socket)) return;
    spectate = !!spectate;
    let note = null;
    const accId = socket.data.accountId;
    const reservedSeat = room.reserved && accId && ['r', 'b'].some((c) => room.reserved[c] === accId);
    const wouldSit = !spectate && !colorOf(room, token) && (room.reserved ? reservedSeat : (!room.players.r || !room.players.b));
    if (!wouldSit && !colorOf(room, token) && !reservedSeat && !F('spectate')) {
      return socket.emit('error-msg', features.offMessage('spectate'));
    }
    if (!wouldSit && !colorOf(room, token) && !reservedSeat && !room.rules.spectators) {
      return socket.emit('error-msg', 'Phòng này không cho người xem.');
    }
    if (wouldSit && room.kind === 'coin') {
      const acc = accId ? users.get(accId) : null;
      if (!acc || acc.coins < room.stake) {
        spectate = true;
        note = `Bàn chơi nhanh ${room.stake} xu cần tài khoản có đủ xu — bạn đang xem.`;
      }
    }
    if (wouldSit && !spectate) {
      const found = seatOf(socket.data.identity);
      if (found && found.room === room) {
        spectate = true; // đã ngồi ở phòng này ở tab khác → chỉ xem
        note = 'Bạn đang chơi ở phòng này trong một tab khác — tab này chỉ để xem.';
      } else if (found && found.room.id !== socket.data.roomId && !ensureOneRoom(socket, socket.data.identity)) {
        return;
      }
    }
    joinRoom(socket, room, name, token, { spectate, note });
  });

  // Chơi nhanh theo kiểu bàn chờ: có bàn cùng nhịp & mức đặt đang chờ thì vào ngồi (ván bắt đầu ngay),
  // không có thì tự tạo bàn mới và chờ đối thủ.
  socket.on('coin-seat', ({ name, token, uid, session, totalMin, incSec, stake } = {}) => {
    if (!F('coin')) return socket.emit('error-msg', features.offMessage('coin'));
    mmLeave(socket);
    token = cleanToken(token);
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    if (!needAccount(socket)) return;
    const acc = socket.data.accountId ? users.get(socket.data.accountId) : null;
    stake = Number(stake);
    const tc = `${Number(totalMin)}|${Number(incSec) || 0}`;
    if (!acc) return socket.emit('error-msg', 'Chơi nhanh cần đăng nhập tài khoản.');
    if (!E.STAKES.includes(stake)) return socket.emit('error-msg', 'Mức đặt xu này hiện không mở — tải lại trang để xem mức mới.');
    if (!E.COIN_TCS.some((x) => x.tc === tc)) return socket.emit('error-msg', 'Nhịp Chơi nhanh này hiện không mở — tải lại trang để xem nhịp mới.');
    if (acc.coins < stake) return socket.emit('error-msg', `Không đủ xu — cần ${stake} xu, bạn có ${acc.coins} xu.`);
    if (socket.data.roomId) leaveRoom(socket, { explicit: true });
    if (!ensureOneRoom(socket, socket.data.identity)) return;
    const settings = tcSettings(Number(totalMin), Number(incSec) || 0, E.COIN_MOVE_SEC);
    const room = findCoinTable(settings, stake, acc.id);
    if (room) {
      joinRoom(socket, room, name, token);
      systemMsg(room, `Chơi nhanh ${stake} xu — thắng nhận ${stake} xu của đối thủ, hoà hoàn nguyên. Không tính Elo.`);
      return broadcast(room);
    }
    const table = createRoom(settings, { kind: 'coin', matchmaking: true, coinTable: true, stake, rules: { spectators: true, takeback: false } });
    const color = Math.random() < 0.5 ? 'r' : 'b';
    table.players[color] = { token, uid: socket.data.identity, accountId: acc.id, name, online: true };
    joinRoom(socket, table, name, token);
    systemMsg(table, `Bàn chơi nhanh ${stake} xu · ${tc.replace('|', '+')} — đang chờ đối thủ vào bàn.`);
    broadcast(table);
  });

  socket.on('leave', () => leaveRoom(socket, { explicit: true }));

  socket.on('move', ({ from, to } = {}) => {
    const room = currentRoom(socket);
    if (!room) return;
    const g = room.game;
    const color = colorOf(room, socket.data.token);
    if (!color || g.result || !room.players.r || !room.players.b) return;
    if (!g.startedAt) return socket.emit('error-msg', 'Ván chưa bắt đầu — chờ cả hai bấm Sẵn sàng.');
    if (color !== g.turn) return socket.emit('error-msg', 'Chưa đến lượt bạn.');
    if (!X.isLegalMove(g.board, color, from, to)) return socket.emit('error-msg', 'Nước đi không hợp lệ.');
    const now = Date.now();
    if (isTimeUp(room, now)) return timeOut(room);
    if (hasClock(room) && g.clock.turnStartedAt && room.settings.totalMs) {
      g.clock[color] -= now - g.clock.turnStartedAt;
      g.clock[color] += room.settings.incMs || 0; // cộng giờ sau mỗi nước (nhịp x+y)
    }

    const captured = g.board[to[0]][to[1]];
    g.board = X.applyMove(g.board, from, to);
    g.lastMove = { from, to, captured };
    g.history.push(g.lastMove);
    g.moveCount++;
    g.turn = X.other(color);
    room.drawOffer = null;
    room.takebackOffer = null;

    if (!X.hasAnyLegalMove(g.board, g.turn)) {
      finish(room, color, X.isInCheck(g.board, g.turn) ? 'checkmate' : 'stalemate');
    } else if (hasClock(room)) {
      g.clock.turnStartedAt = now;
      scheduleTimeout(room);
    }
    broadcast(room);
  });

  socket.on('resign', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    if (!color || room.game.result || !room.players.r || !room.players.b) return;
    finish(room, X.other(color), 'resign');
    systemMsg(room, `${room.players[color].name} đã đầu hàng.`);
    broadcast(room);
  });

  socket.on('offer-draw', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    if (!color || room.game.result || !room.players.r || !room.players.b) return;
    if (room.drawOffer && room.drawOffer !== color) {
      finish(room, null, 'draw');
      systemMsg(room, 'Hai bên đồng ý hoà.');
    } else {
      room.drawOffer = color;
      systemMsg(room, `${room.players[color].name} xin hoà.`);
    }
    broadcast(room);
  });

  socket.on('decline-draw', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    if (!color || !room.drawOffer || room.drawOffer === color) return;
    room.drawOffer = null;
    systemMsg(room, `${room.players[color].name} từ chối hoà.`);
    broadcast(room);
  });

  socket.on('rematch', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    // Phòng riêng & ván ghép trận (xếp hạng / chơi nhanh / ghép thường) được đấu lại; ván giải đấu thì không
    if (!color || !room.game.result || !room.players.r || !room.players.b || !['room', 'ranked', 'coin', 'match'].includes(room.kind)) return;
    room.rematch.add(color);
    if (room.rematch.size === 2) {
      // Ván xếp hạng / chơi nhanh: kiểm tra lại xu của cả hai, xếp hạng thì trừ phí như ván mới
      const need = room.kind === 'coin' ? room.stake : room.kind === 'ranked' ? E.RANKED_FEE : 0;
      if (need) {
        const accs = ['r', 'b'].map((c) => (room.players[c].accountId ? users.get(room.players[c].accountId) : null));
        if (accs.some((a) => !a || a.coins < need)) {
          room.rematch.clear();
          systemMsg(room, `Không thể đấu lại — mỗi bên cần ít nhất ${need} xu.`);
          return broadcast(room);
        }
        if (room.kind === 'ranked') { for (const a of accs) users.spendCoins(a.id, need); room.fee = need; }
      }
      archiveGame(room);
      // Đổi màu cho ván mới
      [room.players.r, room.players.b] = [room.players.b, room.players.r];
      room.game = newGame(room.settings);
      room.game.names = { r: room.players.r.name, b: room.players.b.name };
      room.game.startedAt = Date.now();
      startClock(room);
      room.rematch.clear();
      room.drawOffer = null;
      systemMsg(room, 'Ván mới bắt đầu — hai bên đã đổi màu quân.');
    }
    broadcast(room);
  });

  // Phòng riêng & Chơi nhanh: cả hai bấm Sẵn sàng (xác nhận) thì ván bắt đầu
  socket.on('ready', (on = true) => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    if (!color || !NEEDS_READY.includes(room.kind) || room.game.startedAt || room.game.result) return;
    // Chơi nhanh: kiểm tra lại xu trước khi xác nhận cược
    if (on && room.kind === 'coin') {
      const acc = room.players[color].accountId ? users.get(room.players[color].accountId) : null;
      if (!acc || acc.coins < room.stake) return socket.emit('error-msg', `Không đủ xu — bàn này cược ${room.stake} xu.`);
    }
    if (on) room.ready.add(color); else room.ready.delete(color);
    systemMsg(room, room.kind === 'coin'
      ? `${room.players[color].name} ${on ? `đã xác nhận cược ${room.stake} xu` : 'huỷ xác nhận'}.`
      : `${room.players[color].name} ${on ? 'đã sẵn sàng' : 'huỷ sẵn sàng'}.`);
    if (room.players.r && room.players.b && room.ready.size === 2) {
      beginGame(room);
      systemMsg(room, 'Cả hai đã sẵn sàng — ván đấu bắt đầu!');
    }
    broadcast(room);
  });

  // Xin đi lại (chỉ phòng riêng có bật luật đi lại). Đối thủ đồng ý → lùi về trước nước đi gần nhất của người xin.
  socket.on('takeback', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    const g = room && room.game;
    if (!color || !room.rules.takeback || g.result || !g.startedAt || !room.players.r || !room.players.b) return;
    const myPlies = g.history.filter((_, i) => (i % 2 === 0 ? 'r' : 'b') === color).length;
    if (!myPlies) return socket.emit('error-msg', 'Bạn chưa đi nước nào.');
    if (room.takebackOffer && room.takebackOffer !== color) {
      // Đồng ý lời xin của đối thủ
      const asker = room.takebackOffer;
      const undo = g.turn === asker ? 2 : 1; // đối thủ đã đáp trả → lùi 2 nước
      stopClock(room);
      g.history = g.history.slice(0, Math.max(0, g.history.length - undo));
      const replay = X.replay(g.history);
      g.board = replay.boards[g.history.length];
      g.lastMove = g.history[g.history.length - 1] || null;
      g.moveCount = g.history.length;
      g.turn = g.history.length % 2 === 0 ? 'r' : 'b';
      room.takebackOffer = null;
      room.drawOffer = null;
      startClock(room);
      systemMsg(room, `${room.players[color].name} đồng ý cho đi lại ${undo} nước.`);
    } else {
      room.takebackOffer = color;
      systemMsg(room, `${room.players[color].name} xin đi lại.`);
    }
    broadcast(room);
  });
  socket.on('decline-takeback', () => {
    const room = currentRoom(socket);
    const color = room && colorOf(room, socket.data.token);
    if (!color || !room.takebackOffer || room.takebackOffer === color) return;
    room.takebackOffer = null;
    systemMsg(room, `${room.players[color].name} không đồng ý cho đi lại.`);
    broadcast(room);
  });

  socket.on('chat', (text) => {
    const room = currentRoom(socket);
    if (!room) return;
    if (!F('chat')) return socket.emit('error-msg', features.offMessage('chat'));
    text = String(text || '').trim().slice(0, CFG.CHAT_MAX_TEXT);
    if (!text) return;
    const color = colorOf(room, socket.data.token);
    const name = color ? room.players[color].name : 'Khán giả';
    const msg = { name, color, text, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    io.to(room.id).emit('chat', msg);
  });

  // ---------- Ghép trận ----------
  socket.on('mm-join', ({ name, token, uid, session, totalMin, moveSec, incSec, mode, stake } = {}) => {
    token = cleanToken(token);
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    if (!needAccount(socket)) return;
    mode = mode === 'coin' ? 'coin' : 'ranked';
    if (!F(mode)) return socket.emit('error-msg', features.offMessage(mode));
    const accNow = socket.data.accountId ? users.get(socket.data.accountId) : null;
    if (mode === 'coin') {
      stake = Number(stake);
      if (!E.STAKES.includes(stake)) return socket.emit('error-msg', 'Mức đặt xu không hợp lệ.');
      if (!accNow) return socket.emit('error-msg', 'Chơi nhanh cần đăng nhập tài khoản.');
      if (accNow.coins < stake) return socket.emit('error-msg', `Không đủ xu — cần ${stake} xu, bạn có ${accNow.coins} xu.`);
    } else if (accNow && accNow.coins < E.RANKED_FEE) {
      return socket.emit('error-msg', `Không đủ xu — ván xếp hạng cần ${E.RANKED_FEE} xu phí. Làm nhiệm vụ hoặc giải cờ thế để nhận xu.`);
    }
    // Nhịp: Xếp hạng luôn theo cài đặt (không theo trình duyệt gửi lên); Chơi nhanh phải là một nhịp admin đã mở
    let mmSettings;
    if (mode === 'ranked') mmSettings = tcSettings(E.RANKED_TC.totalMin, E.RANKED_TC.incSec, E.RANKED_TC.moveSec);
    else {
      const tc = `${Number(totalMin)}|${Number(incSec) || 0}`;
      if (!E.COIN_TCS.some((x) => x.tc === tc)) return socket.emit('error-msg', 'Nhịp Chơi nhanh này hiện không mở — tải lại trang để xem nhịp mới.');
      mmSettings = tcSettings(Number(totalMin), Number(incSec) || 0, E.COIN_MOVE_SEC);
    }
    if (socket.data.roomId) leaveRoom(socket, { explicit: true });
    if (!ensureOneRoom(socket, socket.data.identity)) return;
    // Mỗi người chỉ một lượt tìm (tab khác đang tìm thì huỷ ở tab đó)
    for (const [sid, e] of queue) {
      if (e.identity === socket.data.identity && sid !== socket.id) { queue.delete(sid); e.socket.emit('mm-status', { queued: false }); }
    }
    const acc = socket.data.accountId ? users.get(socket.data.accountId) : null;
    queue.set(socket.id, {
      socket, token, name, identity: socket.data.identity, accountId: socket.data.accountId || null,
      rating: acc ? acc.rating : 1200, since: Date.now(),
      settings: mmSettings,
      mode, stake: mode === 'coin' ? stake : null,
    });
    runMatchmaker();
  });

  socket.on('mm-leave', () => mmLeave(socket));
  socket.on('mm-accept', ({ matchId } = {}) => acceptMatch(socket, String(matchId || '')));
  socket.on('mm-decline', ({ matchId } = {}) => {
    const m = pendingMatches.get(String(matchId || ''));
    if (m && (m.a.socket === socket || m.b.socket === socket)) declineMatch(m, socket.id, 'decline');
  });

  socket.on('disconnect', () => {
    queue.delete(socket.id);
    for (const m of pendingMatches.values()) if (m.a.socket === socket || m.b.socket === socket) declineMatch(m, socket.id, 'cancel');
    leaveRoom(socket);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.emptySince && now - room.emptySince > CFG.ROOM_TTL_MIN * 60 * 1000) destroyRoom(room);
  }
}, 5 * 60 * 1000).unref();

// Nạp dữ liệu (file hoặc Supabase) rồi mới mở cổng
(async () => {
  try {
    if (storage.check) await storage.check();
    await Promise.all([users.init(), puzzles.init(), theme.init(), tournaments.init(), economy.init(), community.init(), features.init(), config.init()]);
    await shop.init(); // sau theme.init(): vật phẩm bàn cờ ảnh tải lên cần thư viện ảnh
  } catch (err) {
    console.error('Không nạp được dữ liệu:', err.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`Tượng Kỳ đang chạy tại http://localhost:${PORT}`);
    console.log(`Dữ liệu: ${storage.describe()}`);
    console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
    console.log(process.env.ADMIN_PASSWORD
      ? 'Trang quản trị yêu cầu mật khẩu (ADMIN_PASSWORD).'
      : 'Trang quản trị không đặt mật khẩu — đặt ADMIN_PASSWORD trước khi đưa lên mạng.');
  });
})();

// Lưu dữ liệu trước khi tắt server
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    const timer = setTimeout(() => process.exit(0), 8000); // không chờ quá lâu nếu mạng lỗi
    try { await users.flush(); } catch (err) { console.error(err.message); }
    clearTimeout(timer);
    process.exit(0);
  });
}
