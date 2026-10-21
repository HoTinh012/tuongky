// Bot AI: các tài khoản do máy điều khiển, tự ghép cặp và đánh với nhau như kỳ thủ thật để sân chơi đông vui.
// Ván của bot là phòng thật trên server (Xếp hạng / Chơi nhanh): hiện ở Trận đấu hot, Bàn đấu, ai cũng vào xem được,
// tính Elo / xu / lịch sử như người. Bot chỉ đánh với bot — không vào hàng chờ ghép trận của người chơi.
// Trang quản trị → Bot AI: bật/tắt, số bàn, loại ván, tốc độ, trò chuyện, tạo / xoá tài khoản bot.
// Cấu hình lưu qua storage/ (data/bots.json hoặc khoá `bots` trong bảng settings của Supabase).
'use strict';
const crypto = require('crypto');
const X = require('./public/xiangqi.js');
const storage = require('./storage');

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const MATE = 30000;
const KINDS = ['ranked', 'coin'];
const MAX_TABLES = 30;
const MAX_BOTS = 200;

// Trình độ 1–8: độ sâu Pikafish, độ "nhiễu" khi chọn giữa các nước tốt (điểm cp), tỉ lệ đi hớ.
// Elo khởi đầu ≈ 800 + 170 × trình độ; Elo sau đó tự lên xuống theo kết quả như người.
const SKILL = {
  1: { depth: 1, noise: 300, blunder: 0.08 },
  2: { depth: 2, noise: 180, blunder: 0.06 },
  3: { depth: 3, noise: 110, blunder: 0.045 },
  4: { depth: 4, noise: 70, blunder: 0.03 },
  5: { depth: 6, noise: 40, blunder: 0.02 },
  6: { depth: 8, noise: 20, blunder: 0.012 },
  7: { depth: 10, noise: 10, blunder: 0.006 },
  8: { depth: 13, noise: 4, blunder: 0.003 },
};
const skillOfRating = (r) => Math.max(1, Math.min(8, Math.round((r - 800) / 170)));
const ratingOfSkill = (s) => 800 + s * 170;

const DEFAULTS = {
  enabled: false,
  tables: 3,             // số ván bot diễn ra cùng lúc
  kinds: ['ranked', 'coin'],
  speed: 1,              // 1 = nhịp như người thật; 0.25 = nhanh gấp 4
  chat: true,            // chào hỏi / "gg" trong ván
  rematchRate: 0.3,      // tỉ lệ hai bot đấu lại sau ván
  bots: [],              // [{ id, skill }]
};

let cfg = { ...DEFAULTS };
let api = null;          // các hàm của server.js (xem setup)
const runtime = new Map(); // accountId -> { state: 'offline'|'idle'|'playing', until, readyAt, roomId, lastOpp }
const games = new Map();   // roomId -> { game, ply, busy, evals: { r: [], b: [] }, ended, greeted }

// ---------- Tiện ích ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
// Phân phối lệch phải (đa số nước đi nhanh, thỉnh thoảng nghĩ lâu) — giống thời gian nghĩ của người
const lognormal = (sigma) => Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()));

const sq = (r, c) => `${String.fromCharCode(97 + c)}${9 - r}`;
const toUci = (m) => sq(...m.from) + sq(...m.to);
function fromUci(s) {
  const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s || '');
  return m ? { from: [9 - Number(m[2]), m[1].charCodeAt(0) - 97], to: [9 - Number(m[4]), m[3].charCodeAt(0) - 97] } : null;
}
const posKey = (board, turn) => turn + board.map((row) => row.map((p) => p || '.').join('')).join('/');

function allLegalMoves(board, side) {
  const out = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = board[r][c];
    if (!p || p[0] !== side) continue;
    for (const to of X.legalMovesFrom(board, r, c)) out.push({ from: [r, c], to });
  }
  return out;
}

// ---------- Tên kỳ thủ ----------
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trịnh', 'Đinh', 'Lâm', 'Mai'];
const TEN = ['Anh', 'Bảo', 'Bình', 'Cường', 'Dũng', 'Duy', 'Đạt', 'Đức', 'Giang', 'Hải', 'Hiếu', 'Hoà', 'Hùng', 'Huy', 'Khang', 'Khánh', 'Khoa',
  'Kiên', 'Lâm', 'Long', 'Luân', 'Minh', 'Nam', 'Nghĩa', 'Nhân', 'Phát', 'Phong', 'Phúc', 'Quang', 'Quân', 'Sơn', 'Tài', 'Tâm', 'Thắng', 'Thành',
  'Thịnh', 'Tiến', 'Toàn', 'Trung', 'Tuấn', 'Tùng', 'Việt', 'Vinh', 'Vũ', 'Hạnh', 'Lan', 'Linh', 'Ngọc', 'Trang', 'Thảo', 'Hương', 'Yến'];
const DEM = ['Văn', 'Minh', 'Quốc', 'Hữu', 'Đức', 'Thanh', 'Gia', 'Hoàng', 'Công', 'Ngọc', 'Xuân', 'Thế'];
const NICK = ['Pháo Đầu', 'Xe Lăn', 'Mã Hồi', 'Tốt Đen', 'Bình Phong', 'Thuận Pháo', 'Tướng Già', 'Cờ Phố', 'Kỳ Hữu', 'Lão Kỳ', 'Sĩ Tượng',
  'Đơn Đề Mã', 'Phi Tượng', 'Quá Hà', 'Liên Hoàn', 'Tiên Nhân'];
const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

function makeIdentity() {
  const ho = pick(HO), ten = pick(TEN), dem = pick(DEM);
  const yy = randInt(70, 99) % 100, n = randInt(1, 999);
  const styles = [
    () => `${ten} ${ho}`,
    () => `${dem} ${ten}`,
    () => `${ho} ${dem} ${ten}`,
    () => `${ascii(dem + ten).toLowerCase()}${yy}`,
    () => `${ten}${pick(['Xe', 'Pháo', 'Mã', 'Tốt', 'Cờ'])}`,
    () => `${pick(NICK)} ${n % 100}`,
    () => `${ascii(ten)}_${ascii(ho).toLowerCase()}`,
    () => `${pick(['Anh', 'Chú', 'Bác'])} ${ten}`,
  ];
  const displayName = pick(styles)().slice(0, 20);
  let username;
  do {
    username = (ascii(ten + pick(['', '.', '_']) + ho).toLowerCase().replace(/[^a-z0-9_.]/g, '') + pick([yy, n, '', randInt(1, 99)])).slice(0, 20);
  } while (api.users.list().some((a) => a.usernameLower === username.toLowerCase()) || username.length < 3);
  return { username, displayName };
}

// ---------- Cấu hình ----------
function clean(next) {
  const out = { ...cfg };
  if (typeof next.enabled === 'boolean') out.enabled = next.enabled;
  if (next.tables !== undefined) out.tables = Math.max(0, Math.min(MAX_TABLES, Math.round(Number(next.tables)) || 0));
  if (Array.isArray(next.kinds)) out.kinds = next.kinds.filter((k) => KINDS.includes(k));
  if (!out.kinds.length) out.kinds = ['ranked'];
  if (next.speed !== undefined) out.speed = Math.max(0.1, Math.min(3, Number(next.speed) || 1));
  if (typeof next.chat === 'boolean') out.chat = next.chat;
  if (next.rematchRate !== undefined) out.rematchRate = Math.max(0, Math.min(1, Number(next.rematchRate) || 0));
  return out;
}
function save() {
  Promise.resolve(storage.saveBots(cfg)).catch((err) => console.error('Không lưu được cấu hình bot:', err.message));
}
async function init() {
  const loaded = await storage.loadBots();
  if (loaded) cfg = { ...DEFAULTS, ...loaded, bots: Array.isArray(loaded.bots) ? loaded.bots : [] };
}

// ---------- Engine ----------
// Bot dùng chung Pikafish với người chơi nhưng chỉ chiếm 1 tiến trình mỗi lúc (xếp hàng nội bộ) để không làm chậm phân tích.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
let legacy = null;
function legacyMove(board, side, skill) {
  // Không có Pikafish: engine JS cũ (chạy đồng bộ nên giới hạn thời gian rất ngắn)
  if (!legacy) legacy = require('./public/engine.js');
  const key = 'bot' + skill;
  if (!legacy.LEVELS[key]) legacy.LEVELS[key] = { maxDepth: Math.min(6, 1 + skill), timeMs: 60 + skill * 25, noise: SKILL[skill].noise };
  const r = legacy.bestMove(board, side === 'r' ? 1 : -1, key);
  return r ? { move: { from: r.from, to: r.to }, score: r.score } : null;
}

async function chooseMove(room, color, skill) {
  const g = room.game;
  const lvl = SKILL[skill] || SKILL[4];
  const legal = allLegalMoves(g.board, color);
  if (!legal.length) return null;
  if (legal.length === 1) return { move: legal[0], score: 0, forced: true };
  if (api.engine.available()) {
    try {
      const moves = g.history.map(toUci);
      const r = await Promise.race([
        serial(() => api.engine.withEngine((p) => api.engine.search(p, START_FEN, moves, { depth: lvl.depth, movetime: 250 + skill * 60 }, { multipv: 4 }))),
        sleep(6000).then(() => null),
      ]);
      if (r && r.lines && r.lines.length) {
        let chosen = r.lines[0];
        if (r.lines.length > 1 && chance(lvl.blunder)) {
          chosen = r.lines[r.lines.length - 1]; // nước hớ: chọn phương án kém nhất trong mấy nước ứng viên
        } else if (lvl.noise) {
          let top = -Infinity;
          for (const l of r.lines) {
            const v = l.score + Math.random() * lvl.noise;
            if (l.score > r.lines[0].score - lvl.noise * 2 && v > top) { top = v; chosen = l; }
          }
        }
        const move = fromUci(chosen.move);
        if (move && X.isLegalMove(g.board, color, move.from, move.to)) return { move, score: chosen.score, best: r.lines[0].score };
      }
    } catch { /* engine bận / lỗi → engine cũ */ }
  }
  return legacyMove(g.board, color, skill) || { move: pick(legal), score: 0 };
}

// Thời gian "suy nghĩ" của một nước, theo đồng hồ còn lại — giống người: khai cuộc đi nhanh, trung cuộc nghĩ lâu,
// thỉnh thoảng ngồi nghĩ rất lâu, sắp hết giờ thì đi vội.
function thinkMs(room, color, forced) {
  const g = room.game, st = room.settings;
  const now = Date.now();
  const used = g.clock.turnStartedAt ? now - g.clock.turnStartedAt : 0;
  const remaining = st.totalMs ? g.clock[color] - used : 10 * 60000;
  const perMoveCap = st.moveMs ? st.moveMs - 4000 - used : Infinity;
  const ply = g.history.length;
  let ms;
  if (forced) ms = rand(700, 2000);
  else if (ply < 8) ms = rand(900, 4000);
  else {
    const movesLeft = Math.max(18, 45 - ply / 4);
    const budget = remaining / movesLeft + (st.incMs || 0) * 0.8;
    ms = budget * lognormal(0.55);
    if (chance(0.07)) ms *= 2.2; // ngồi nghĩ lâu ở thế cờ khó
    ms = Math.max(1200, ms);
  }
  if (remaining < 40000) ms = Math.min(ms, rand(600, 2500));
  ms *= cfg.speed;
  return Math.max(400, Math.min(ms, perMoveCap, remaining * 0.3, 90000));
}

// ---------- Trong ván ----------
function botColorOf(room, accountId) {
  return ['r', 'b'].find((c) => room.players[c] && room.players[c].accountId === accountId) || null;
}
const isBot = (accountId) => cfg.bots.some((b) => b.id === accountId);
const skillOf = (accountId) => (cfg.bots.find((b) => b.id === accountId) || {}).skill || 4;

function say(room, color, lines) {
  if (!cfg.chat || !api.F('chat') || !room.players[color]) return;
  api.chat(room, color, pick(lines));
}

// Gọi mỗi khi trạng thái phòng của bot thay đổi (broadcast). Chỉ hẹn giờ, không đi nước ngay trong lúc broadcast.
function onState(room) {
  const st = games.get(room.id);
  if (!st) return;
  const g = room.game;
  if (st.game !== g) { // ván mới (đấu lại)
    st.game = g; st.ply = -1; st.evals = { r: [], b: [] }; st.ended = false; st.positions = new Map(); st.greeted = true;
  }
  if (g.result) { if (!st.ended) { st.ended = true; setTimeout(() => afterGame(room), 50); } return; }
  if (!g.startedAt || st.ply === g.history.length || st.busy) return;
  const color = g.turn;
  const seat = room.players[color];
  if (!seat || !isBot(seat.accountId)) return;
  st.ply = g.history.length;
  const key = posKey(g.board, g.turn);
  st.positions.set(key, (st.positions.get(key) || 0) + 1);
  st.busy = true;
  playTurn(room, color, seat.accountId, st).catch((err) => console.error('Bot lỗi:', err.message)).finally(() => {
    st.busy = false;
    if (api.rooms.get(room.id) === room) onState(room); // trạng thái đổi trong lúc bot nghĩ (vd đối thủ xin hoà)
  });
}

async function playTurn(room, color, accountId, st) {
  const g = room.game, ply = g.history.length;
  const skill = skillOf(accountId);
  const still = () => api.rooms.get(room.id) === room && room.game === g && !g.result && g.history.length === ply;
  const t0 = Date.now();
  if (ply < 2 && !st.greeted && chance(0.3)) {
    st.greeted = true;
    setTimeout(() => { if (room.game === g && !g.result) say(room, color, ['chào bạn', 'hi', 'chúc ván hay', 'xin chỉ giáo', 'chào', 'đánh vui nhé']); }, rand(800, 3000));
  }
  const choice = await chooseMove(room, color, skill);
  if (!still() || !choice) return;
  await sleep(thinkMs(room, color, choice.forced) - (Date.now() - t0));
  if (!still()) return;

  const evals = st.evals[color];
  if (!choice.forced) evals.push(choice.best ?? choice.score);
  const last = evals.slice(-4);
  const myScore = last.length ? last[last.length - 1] : 0;
  // Đối thủ xin hoà: đồng ý khi thế cờ không hơn (hoặc ván đã quá dài)
  if (room.drawOffer && room.drawOffer !== color) {
    if (myScore < 60 || ply > 240) return api.playOfferDraw(room, color);
    api.playDeclineDraw(room, color);
  }
  // Đầu hàng khi thua rõ — không phải lúc nào cũng đầu hàng ngay, có người cố đánh tiếp
  if (ply > 20 && (myScore < -MATE + 300 ? chance(0.5) : last.length >= 3 && last.every((v) => v < -800) && chance(0.3))) {
    if (chance(0.4)) say(room, color, ['thua rồi', 'gg', 'hay quá', 'chịu', 'non tay quá']);
    return api.playResign(room, color);
  }
  const err = api.playMove(room, color, choice.move.from, choice.move.to);
  if (err) return;
  if (room.game !== g || g.result) return;
  // Xin hoà khi thế cờ cân bằng sau ván dài, hoặc lặp lại thế cờ nhiều lần
  const key = posKey(g.board, g.turn);
  const repeated = (st.positions.get(key) || 0) >= 2;
  const level = last.length >= 4 && last.every((v) => Math.abs(v) < 80);
  if (!room.drawOffer && (repeated || ply > 300 || (ply > 100 && level && chance(0.12)))) api.playOfferDraw(room, color);
}

function afterGame(room) {
  const st = games.get(room.id);
  if (!st || api.rooms.get(room.id) !== room) return;
  const g = room.game, res = g.result;
  const ids = ['r', 'b'].map((c) => room.players[c] && room.players[c].accountId).filter(Boolean);
  // Lời chào cuối ván
  if (res && res.winner && chance(0.45)) {
    const loser = res.winner === 'r' ? 'b' : 'r';
    setTimeout(() => say(room, loser, ['gg', 'gg bạn', 'hay', 'thua tâm phục', 'ván sau gỡ', 'gg wp']), rand(1200, 3500));
    if (chance(0.5)) setTimeout(() => say(room, res.winner, ['gg', 'cảm ơn bạn', 'may thôi', 'gg wp', 'ván hay']), rand(2500, 6000));
  } else if (res && !res.winner && chance(0.3)) setTimeout(() => say(room, pick(['r', 'b']), ['hoà vui', 'gg', 'cân quá']), rand(1500, 4000));

  const sessionOk = ids.every((id) => { const rt = runtime.get(id); return rt && rt.until > Date.now() + 60000; });
  if (cfg.enabled && sessionOk && ids.length === 2 && chance(cfg.rematchRate)) {
    // Đấu lại (đổi màu). Xếp hạng / Chơi nhanh cần đủ xu → nạp thêm cho bot nếu thiếu
    for (const id of ids) topUp(id, room.stake || api.E.RANKED_FEE);
    const [a, b] = ['r', 'b'];
    setTimeout(() => api.playRematch(room, a), rand(3000, 8000));
    setTimeout(() => { if (api.rooms.get(room.id) === room && room.game === g) api.playRematch(room, b); }, rand(9000, 14000));
    // Không đấu lại được (vd thiếu xu) → rời bàn sau đó
    setTimeout(() => { if (api.rooms.get(room.id) === room && room.game === g) leave(room); }, 20000);
  } else {
    setTimeout(() => leave(room), rand(5000, 15000));
  }
}

function leave(room) {
  if (api.rooms.get(room.id) !== room) { games.delete(room.id); return; }
  if (!room.game.result) return; // ván mới đã bắt đầu (đấu lại)
  for (const c of ['r', 'b']) {
    const seat = room.players[c];
    if (!seat) continue;
    const rt = runtime.get(seat.accountId);
    if (rt) { rt.state = 'idle'; rt.roomId = null; rt.readyAt = Date.now() + rand(20000, 120000) * Math.max(0.3, cfg.speed); }
    api.vacateSeat(room, c);
  }
  games.delete(room.id);
  api.broadcast(room);
  if (room.members.size === 0) api.destroyRoom(room);
}

// ---------- Ghép cặp & lịch online ----------
function topUp(id, need) {
  const acc = api.users.get(id);
  if (acc && acc.coins < Math.max(need, 200)) api.users.addCoins(id, randInt(800, 1500) - acc.coins);
}

function startGame(a, b) {
  const E = api.E;
  const kinds = cfg.kinds.filter((k) => api.F(k));
  if (!kinds.length) return false;
  const kind = pick(kinds);
  let settings, stake = null, fee = null;
  if (kind === 'ranked') {
    settings = api.tcSettings(E.RANKED_TC.totalMin, E.RANKED_TC.incSec, E.RANKED_TC.moveSec);
    fee = E.RANKED_FEE;
  } else {
    const tc = pick(E.COIN_TCS).tc.split('|').map(Number);
    settings = api.tcSettings(tc[0], tc[1] || 0, E.COIN_MOVE_SEC);
    stake = pick(E.STAKES.slice(0, 3).concat(E.STAKES.slice(0, 2))); // mức đặt nhỏ hay gặp hơn
  }
  const accs = [api.users.get(a), api.users.get(b)];
  if (accs.some((x) => !x || x.banned)) return false;
  for (const acc of accs) topUp(acc.id, stake || fee);

  // Bot chủ bàn mở bàn chờ (hiện "đang chờ" ở Bàn đấu), lát sau bot kia vào ngồi, xác nhận rồi mới đánh — như người
  const [host, guest] = accs;
  const room = api.createRoom(settings, { kind, matchmaking: true, stake, fee: null, rules: { spectators: true, takeback: false } });
  room.bot = true;
  const hostColor = chance(0.5) ? 'r' : 'b', guestColor = hostColor === 'r' ? 'b' : 'r';
  const seatOf = (acc) => ({
    token: 'bot:' + acc.id, uid: 'a:' + acc.id, accountId: acc.id, name: acc.displayName, online: true,
    avatar: acc.avatar || null, username: acc.username, rating: acc.rating,
  });
  room.players[hostColor] = seatOf(host);
  for (const acc of accs) {
    api.users.touch(acc.id);
    const rt = runtime.get(acc.id);
    rt.state = 'playing'; rt.roomId = room.id;
  }
  runtime.get(a).lastOpp = b; runtime.get(b).lastOpp = a;
  games.set(room.id, { game: room.game, ply: -1, busy: false, evals: { r: [], b: [] }, ended: false, positions: new Map() });
  const tcText = `${settings.totalMs / 60000}+${(settings.incMs || 0) / 1000}`;
  api.systemMsg(room, kind === 'ranked' ? `${host.displayName} mở bàn xếp hạng ${tcText} — đang chờ đối thủ vào bàn.`
    : `Bàn chơi nhanh ${stake} xu · ${tcText} — đang chờ đối thủ vào bàn.`);
  api.broadcast(room);

  const alive = () => api.rooms.get(room.id) === room && !room.game.result;
  const wait = Math.max(3000, rand(10000, 60000) * cfg.speed);
  setTimeout(() => {
    if (!alive()) return;
    const g = api.users.get(guest.id);
    if (!g) { api.destroyRoom(room); games.delete(room.id); return; }
    room.players[guestColor] = seatOf(g);
    room.game.names = { r: room.players.r.name, b: room.players.b.name };
    api.systemMsg(room, `${g.displayName} đã vào cầm quân ${guestColor === 'r' ? 'Đỏ' : 'Đen'}.`);
    if (kind === 'ranked') {
      for (const acc of accs) api.users.spendCoins(acc.id, fee);
      room.fee = fee;
      api.systemMsg(room, `Ván xếp hạng — có tính Elo, đã trừ ${fee} xu phí mỗi bên.`);
      api.broadcast(room);
      setTimeout(() => { if (alive()) { api.beginGame(room); api.broadcast(room); } }, Math.max(800, rand(1500, 4000) * cfg.speed));
    } else {
      api.systemMsg(room, `Chơi nhanh ${stake} xu — thắng nhận ${stake} xu của đối thủ, hoà hoàn nguyên. Không tính Elo.`);
      api.broadcast(room);
      // Mỗi bên bấm xác nhận cược sau vài giây (người vào sau thường xác nhận trước)
      setTimeout(() => { if (alive()) api.playReady(room, guestColor, true); }, Math.max(600, rand(1500, 5000) * cfg.speed));
      setTimeout(() => { if (alive()) api.playReady(room, hostColor, true); }, Math.max(1200, rand(3000, 9000) * cfg.speed));
    }
  }, wait);
  return true;
}

function tick() {
  if (!api) return;
  const now = Date.now();
  // Bỏ bot có tài khoản đã bị xoá
  const before = cfg.bots.length;
  cfg.bots = cfg.bots.filter((b) => api.users.get(b.id));
  if (cfg.bots.length !== before) save();
  for (const b of cfg.bots) if (!runtime.has(b.id)) runtime.set(b.id, { state: 'offline', until: 0, readyAt: 0, roomId: null, lastOpp: null });
  for (const id of runtime.keys()) if (!isBot(id)) runtime.delete(id);

  // Dọn bot "đang chơi" ở phòng đã bị đóng (vd admin đóng phòng)
  for (const [id, rt] of runtime) {
    if (rt.state === 'playing' && !api.rooms.has(rt.roomId)) { rt.state = 'idle'; rt.roomId = null; rt.readyAt = now + 30000; }
  }
  for (const id of games.keys()) if (!api.rooms.has(id)) games.delete(id);

  const all = [...runtime.entries()];
  if (!cfg.enabled) {
    for (const [, rt] of all) if (rt.state === 'idle') rt.state = 'offline';
    return;
  }
  // Lịch online: mỗi bot online một phiên 20–120 phút rồi nghỉ 5–60 phút. Số online ≈ 2 × số bàn + vài người rảnh.
  const target = Math.min(all.length, cfg.tables * 2 + Math.ceil(cfg.tables * 0.6) + 1);
  for (const [, rt] of all) {
    if (rt.state === 'idle' && now > rt.until) { rt.state = 'offline'; rt.until = now + rand(5, 60) * 60000; }
  }
  let online = all.filter(([, rt]) => rt.state !== 'offline').length;
  const offline = all.filter(([, rt]) => rt.state === 'offline').sort(() => Math.random() - 0.5)
    .sort((x, y) => (x[1].until > now) - (y[1].until > now)); // ưu tiên bot đã nghỉ đủ
  for (const [, rt] of offline) {
    if (online >= target) break;
    rt.state = 'idle'; rt.until = now + rand(20, 120) * 60000; rt.readyAt = now + rand(2000, 30000);
    online++;
  }

  // Ghép cặp: mỗi lần tick mở tối đa 1 bàn cho tự nhiên
  const playing = games.size;
  if (playing >= cfg.tables) return;
  const ready = all.filter(([, rt]) => rt.state === 'idle' && rt.readyAt <= now).map(([id]) => id);
  if (ready.length < 2) return;
  const a = pick(ready);
  const ra = (api.users.get(a) || {}).rating || 1200;
  const opps = ready.filter((id) => id !== a)
    .map((id) => ({ id, d: Math.abs(((api.users.get(id) || {}).rating || 1200) - ra) + (runtime.get(a).lastOpp === id ? 150 : 0) + Math.random() * 120 }))
    .sort((x, y) => x.d - y.d);
  startGame(a, opps[0].id);
}

// ---------- Tài khoản bot ----------
function createAccounts(count, eloMin = 1000, eloMax = 1900) {
  count = Math.max(1, Math.min(50, Math.round(Number(count)) || 1));
  if (cfg.bots.length + count > MAX_BOTS) throw new Error(`Tối đa ${MAX_BOTS} bot.`);
  eloMin = Math.max(800, Math.min(2400, Number(eloMin) || 1000));
  eloMax = Math.max(eloMin, Math.min(2400, Number(eloMax) || 1900));
  const regions = api.regions();
  const made = [];
  for (let i = 0; i < count; i++) {
    const rating = Math.round(rand(eloMin, eloMax));
    const { username, displayName } = makeIdentity();
    const acc = api.users.register(username, displayName, crypto.randomBytes(24).toString('base64url'));
    acc.bot = true; // chỉ trang quản trị biết
    acc.rating = rating; acc.peakRating = rating;
    acc.region = chance(0.7) && regions.length ? pick(regions) : '';
    acc.createdAt = Date.now() - randInt(1, 120) * 86400000; // trông như đã tham gia từ trước
    acc.coins = randInt(600, 2500);
    cfg.bots.push({ id: acc.id, skill: skillOfRating(rating) });
    made.push(acc.id);
  }
  api.users.save();
  save();
  tick();
  return made;
}

function removeAccount(id) {
  const rt = runtime.get(id);
  if (rt && rt.state === 'playing') {
    const room = api.rooms.get(rt.roomId);
    if (room) api.destroyRoom(room, 'Phòng đã đóng.');
  }
  cfg.bots = cfg.bots.filter((b) => b.id !== id);
  runtime.delete(id);
  api.users.remove(id);
  save();
}

function setSkill(id, skill) {
  const b = cfg.bots.find((x) => x.id === id);
  if (!b) throw new Error('Không phải bot.');
  b.skill = Math.max(1, Math.min(8, Math.round(Number(skill)) || 4));
  save();
}

function stopAll() {
  for (const id of [...games.keys()]) {
    const room = api.rooms.get(id);
    if (room) api.destroyRoom(room, 'Phòng đã đóng.');
    games.delete(id);
  }
  for (const rt of runtime.values()) { rt.state = 'offline'; rt.roomId = null; }
}

// ---------- Cho server & trang quản trị ----------
function update(next) {
  const wasOn = cfg.enabled;
  cfg = clean(next || {});
  save();
  if (wasOn !== cfg.enabled) tick();
  return adminState();
}

function adminState() {
  const list = cfg.bots.map((b) => {
    const acc = api.users.get(b.id);
    const rt = runtime.get(b.id) || { state: 'offline' };
    if (!acc) return null;
    const s = acc.stats.online;
    return {
      id: b.id, skill: b.skill, name: acc.displayName, username: acc.username, rating: acc.rating, coins: acc.coins,
      games: s.games, wins: s.wins, draws: s.draws, losses: s.losses, state: rt.state, roomId: rt.roomId || null,
    };
  }).filter(Boolean);
  const { bots, ...settings } = cfg;
  return {
    settings, bots: list, engine: api.engine.available() ? 'pikafish' : 'js',
    playing: games.size, online: list.filter((b) => b.state !== 'offline').length,
    skills: Object.fromEntries(Object.keys(SKILL).map((k) => [k, ratingOfSkill(Number(k))])),
  };
}

// Bot đang "online" (để hiện trong số người online / trạng thái kỳ hữu)
function onlineIds() { return [...runtime.entries()].filter(([, rt]) => rt.state !== 'offline').map(([id]) => id); }
function presence(id) {
  const rt = runtime.get(id);
  if (!rt || rt.state === 'offline') return null;
  return { online: true, roomId: rt.roomId || null, playing: rt.state === 'playing' };
}

/**
 * server = {
 *   users, rooms, engine, E, F, tcSettings, regions(), createRoom, beginGame, broadcast, systemMsg, chat(room, color, text),
 *   vacateSeat, destroyRoom, playMove, playReady, playResign, playOfferDraw, playDeclineDraw, playRematch
 * }
 */
function setup(server) {
  api = server;
  setInterval(tick, 4000).unref();
}

module.exports = {
  init, setup, onState, update, adminState, createAccounts, removeAccount, setSkill, stopAll,
  isBot, onlineIds, presence, SKILL,
};
