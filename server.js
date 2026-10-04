const path = require('path');
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

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 30 * 60 * 1000; // xoá phòng trống sau 30 phút
// Lựa chọn thời gian khi tạo phòng (0 = không giới hạn)
const TIME_TOTAL_MIN = [0, 5, 10, 15, 20, 30, 60]; // thời gian mỗi bên (phút)
const TIME_MOVE_SEC = [0, 30, 60, 120, 180, 300]; // thời gian mỗi nước (giây)
// Người chơi mất kết nối quá 90 giây (mặc định) → coi như rời bàn
const ABANDON_MS = (Number(process.env.ABANDON_SECONDS) || 90) * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(theme.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use('/avatars', express.static(users.AVATAR_DIR, { maxAge: '30d', immutable: true }));
// ---------- Bài tập (người chơi) ----------
const sessionAccount = (req) => users.resolveSession((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
const puzzleSummary = (p, solved) => ({
  id: p.id, title: p.title, description: p.description, difficulty: p.difficulty, side: p.side,
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
  const p = puzzles.get(req.params.id);
  if (!p || !p.published) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
  if (!puzzles.checkSolution(p, req.body && req.body.moves)) return res.status(400).json({ error: 'Lời giải chưa đúng.' });
  const acc = sessionAccount(req);
  let coins = 0;
  if (acc) {
    coins = users.markPuzzleSolved(acc.id, p.id);
    if (coins) puzzles.countSolve(p.id);
  }
  res.json({ ok: true, coins, account: acc ? users.publicAccount(acc) : null });
});

app.get('/api/theme', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(theme.current());
});
const server = http.createServer(app);
const io = new Server(server);

/**
 * room = {
 *   id, createdAt, game, players: { r: Seat|null, b: Seat|null },
 *   settings: { totalMs, moveMs } (null = không giới hạn), clockTimer,
 *   members: Map<socketId, token>, chat: [], drawOffer: 'r'|'b'|null,
 *   rematch: Set<'r'|'b'>, emptySince: number|null,
 *   abandonTimers: Map<token, Timeout>,  // đếm ngược khi người chơi mất kết nối
 *   emptyTimer: Timeout|null,             // đếm ngược huỷ phòng khi không còn ai
 *   archive: [{ n, players: { r, b }, result, history, endedAt }]  // các ván đã xong
 * }
 * Seat = { token, uid, accountId, name, avatar, username, online }
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
    id = Array.from(crypto.randomBytes(5), (n) => alphabet[n % alphabet.length]).join('');
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
  const seat = (s) => (s ? { name: s.name, online: s.online, avatar: s.avatar || null, username: s.username || null, rating: s.rating || null } : null);
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
    started: !!(room.players.r && room.players.b),
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
  const { r, b } = room.players;
  if (r.accountId || b.accountId) {
    users.recordGame({
      mode: 'online', startedAt: g.startedAt,
      players: { r: { name: r.name, accountId: r.accountId || null }, b: { name: b.name, accountId: b.accountId || null } },
      result: g.result, moves: g.history,
    });
  } else {
    users.countGuestGame();
  }
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
  if (color) {
    clearTimeout(room.abandonTimers.get(token));
    room.abandonTimers.delete(token);
    room.players[color].online = true;
    room.players[color].name = name;
    Object.assign(room.players[color], profile);
  } else if (!spectate) {
    const free = ['r', 'b'].filter((c) => !room.players[c]);
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
    room.game.startedAt = room.game.startedAt || Date.now();
    if (!room.game.clock.turnStartedAt) startClock(room); // đủ 2 người → bắt đầu tính giờ
  }

  socket.emit('joined', { roomId: room.id, color, chat: room.chat, note });
  broadcast(room);
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
  room.drawOffer = null;
  systemMsg(room, `${seat.name} đã rời bàn.`);
}

// Phòng chỉ bị huỷ khi không còn ai trong phòng.
// Người cuối cùng chủ động rời → huỷ ngay; mất kết nối → chờ ABANDON_MS để còn kịp tải lại trang.
function checkEmpty(room, immediate) {
  if (room.members.size > 0) return;
  room.emptySince = Date.now();
  clearTimeout(room.emptyTimer);
  if (immediate) destroyRoom(room);
  else room.emptyTimer = setTimeout(() => room.members.size === 0 && destroyRoom(room), ABANDON_MS);
}

// explicit = người dùng chủ động rời (bấm Rời bàn, sang phòng khác, bị mời ra);
// ngược lại là mất kết nối — cho phép quay lại trong ABANDON_MS.
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
    if (explicit) {
      vacateSeat(room, color);
    } else {
      room.players[color].online = false;
      clearTimeout(room.abandonTimers.get(token));
      room.abandonTimers.set(token, setTimeout(() => {
        const c = colorOf(room, token);
        if (!c || !rooms.has(room.id)) return;
        vacateSeat(room, c);
        broadcast(room);
        checkEmpty(room, true);
      }, ABANDON_MS));
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

setupAccount(app, { users, onAccountChange: (acc) => renameUser(acc.id, acc.displayName, acc.avatar || null) });
setupAdmin(app, {
  rooms, users, theme, puzzles, onlineInfo, kickUser, renameUser, closeRoom,
  queueSize: () => queue.size,
  onThemeChange: (current) => io.emit('theme', current), // cập nhật ngay cho mọi người đang chơi
});

function parseSettings(totalMin, moveSec) {
  return {
    totalMs: TIME_TOTAL_MIN.includes(totalMin) && totalMin ? totalMin * 60 * 1000 : null,
    moveMs: TIME_MOVE_SEC.includes(moveSec) && moveSec ? moveSec * 1000 : null,
  };
}

function createRoom(settings) {
  const room = {
    id: newRoomId(),
    createdAt: Date.now(),
    settings,
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
const MM_BASE = 100, MM_STEP = 50, MM_STEP_MS = 5000, MM_ANY_MS = 60000, MM_OTHER_SETTINGS = 150;
const queue = new Map(); // socketId -> { socket, token, name, identity, accountId, rating, settings, since }

const mmWindow = (e, now) => (now - e.since >= MM_ANY_MS ? Infinity : MM_BASE + Math.floor((now - e.since) / MM_STEP_MS) * MM_STEP);
const sameSettings = (a, b) => a.settings.totalMs === b.settings.totalMs && a.settings.moveMs === b.settings.moveMs;

function mmLeave(socket) {
  if (queue.delete(socket.id)) socket.emit('mm-status', { queued: false });
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
      if (b === a || used.has(b) || b.identity === a.identity) continue;
      const score = Math.abs(a.rating - b.rating) + (sameSettings(a, b) ? 0 : MM_OTHER_SETTINGS);
      if (score <= Math.max(mmWindow(a, now), mmWindow(b, now)) && score < bestScore) { best = b; bestScore = score; }
    }
    if (best) {
      used.add(a).add(best);
      startMatch(a, best);
    }
  }
  for (const e of queue.values()) {
    const w = mmWindow(e, now);
    e.socket.emit('mm-status', { queued: true, since: e.since, now, range: w === Infinity ? null : w, searching: queue.size, rating: e.rating });
  }
}

// Tạo phòng cho 2 người vừa ghép (dùng thể thức của người chờ lâu hơn), màu quân ngẫu nhiên
function startMatch(a, b) {
  queue.delete(a.socket.id);
  queue.delete(b.socket.id);
  const room = createRoom(a.settings);
  room.matchmaking = true;
  const rated = !!(a.accountId && b.accountId);
  a.socket.emit('mm-found', { opponent: b.name, rating: b.rating, rated });
  b.socket.emit('mm-found', { opponent: a.name, rating: a.rating, rated });
  const colorA = Math.random() < 0.5 ? 'r' : 'b';
  room.players[colorA] = { token: a.token, uid: a.identity, accountId: a.accountId, name: a.name, online: true };
  joinRoom(a.socket, room, a.name, a.token);
  joinRoom(b.socket, room, b.name, b.token);
  systemMsg(room, `Ván được ghép tự động${rated ? ' — có tính Elo' : ' — không tính Elo (có khách tham gia)'}.`);
  broadcast(room);
}
setInterval(runMatchmaker, 1000).unref();

io.on('connection', (socket) => {
  // Trình duyệt báo mã người chơi ngay khi kết nối (để biết ai đang online)
  socket.on('hello', ({ uid, session } = {}) => {
    if (!users.isValidUid(uid)) return;
    setIdentity(socket, uid, session);
  });

  socket.on('create', ({ name, token, color, uid, session, totalMin, moveSec } = {}) => {
    token = cleanToken(token);
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    mmLeave(socket);
    if (socket.data.roomId) leaveRoom(socket, { explicit: true });
    if (!ensureOneRoom(socket, socket.data.identity)) return;
    const room = createRoom(parseSettings(totalMin, moveSec));
    let side = color === 'b' ? 'b' : color === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : 'r';
    room.players[side] = { token, uid: socket.data.identity, accountId: socket.data.accountId, name, online: true };
    joinRoom(socket, room, name, token);
  });

  socket.on('join', ({ roomId, name, token, uid, spectate, session } = {}) => {
    mmLeave(socket);
    token = cleanToken(token);
    const room = rooms.get(String(roomId || '').toUpperCase().trim());
    if (!room) return socket.emit('error-msg', 'Không tìm thấy phòng. Kiểm tra lại mã phòng.');
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    spectate = !!spectate;
    let note = null;
    const wouldSit = !spectate && !colorOf(room, token) && (!room.players.r || !room.players.b);
    if (wouldSit) {
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

  socket.on('leave', () => leaveRoom(socket, { explicit: true }));

  socket.on('move', ({ from, to } = {}) => {
    const room = currentRoom(socket);
    if (!room) return;
    const g = room.game;
    const color = colorOf(room, socket.data.token);
    if (!color || g.result || !room.players.r || !room.players.b) return;
    if (color !== g.turn) return socket.emit('error-msg', 'Chưa đến lượt bạn.');
    if (!X.isLegalMove(g.board, color, from, to)) return socket.emit('error-msg', 'Nước đi không hợp lệ.');
    const now = Date.now();
    if (isTimeUp(room, now)) return timeOut(room);
    if (hasClock(room) && g.clock.turnStartedAt && room.settings.totalMs) {
      g.clock[color] -= now - g.clock.turnStartedAt;
    }

    const captured = g.board[to[0]][to[1]];
    g.board = X.applyMove(g.board, from, to);
    g.lastMove = { from, to, captured };
    g.history.push(g.lastMove);
    g.moveCount++;
    g.turn = X.other(color);
    room.drawOffer = null;

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
    if (!color || !room.game.result || !room.players.r || !room.players.b) return;
    room.rematch.add(color);
    if (room.rematch.size === 2) {
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

  socket.on('chat', (text) => {
    const room = currentRoom(socket);
    if (!room) return;
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    const color = colorOf(room, socket.data.token);
    const name = color ? room.players[color].name : 'Khán giả';
    const msg = { name, color, text, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    io.to(room.id).emit('chat', msg);
  });

  // ---------- Ghép trận ----------
  socket.on('mm-join', ({ name, token, uid, session, totalMin, moveSec } = {}) => {
    token = cleanToken(token);
    if (!token) return socket.emit('error-msg', 'Thiếu mã định danh.');
    name = identify(socket, uid, name, session);
    if (!name) return;
    if (socket.data.roomId) leaveRoom(socket, { explicit: true });
    if (!ensureOneRoom(socket, socket.data.identity)) return;
    // Mỗi người chỉ một lượt tìm (tab khác đang tìm thì huỷ ở tab đó)
    for (const [sid, e] of queue) {
      if (e.identity === socket.data.identity && sid !== socket.id) { queue.delete(sid); e.socket.emit('mm-status', { queued: false }); }
    }
    const acc = socket.data.accountId ? users.get(socket.data.accountId) : null;
    queue.set(socket.id, {
      socket, token, name, identity: socket.data.identity, accountId: socket.data.accountId || null,
      rating: acc ? acc.rating : 1200, settings: parseSettings(totalMin, moveSec), since: Date.now(),
    });
    runMatchmaker();
  });

  socket.on('mm-leave', () => mmLeave(socket));

  socket.on('disconnect', () => {
    queue.delete(socket.id);
    leaveRoom(socket);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) destroyRoom(room);
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Cờ tướng online đang chạy tại http://localhost:${PORT}`);
  console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
  console.log(process.env.ADMIN_PASSWORD
    ? 'Trang quản trị yêu cầu mật khẩu (ADMIN_PASSWORD).'
    : 'Trang quản trị không đặt mật khẩu — đặt ADMIN_PASSWORD trước khi đưa lên mạng.');
});

// Lưu dữ liệu trước khi tắt server
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    users.flush();
    process.exit(0);
  });
}
