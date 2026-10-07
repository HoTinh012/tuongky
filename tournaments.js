// Giải đấu: đăng ký (lệ phí xu) → check-in → các vòng đấu (tự xếp cặp, tự tạo bàn) → xếp hạng, giải thưởng, huy hiệu.
// Thể thức: loại trực tiếp (knockout), vòng tròn (roundrobin), hệ Thụy Sĩ (swiss).
// Dữ liệu lưu qua storage/ (data/tournaments.json hoặc bảng tk_tournaments trên Supabase).
const crypto = require('crypto');
const storage = require('./storage');
const users = require('./users');

const FORMATS = { knockout: 'Loại trực tiếp', roundrobin: 'Vòng tròn', swiss: 'Hệ Thụy Sĩ' };
const STATUS = { open: 'Đang mở đăng ký', checkin: 'Đang check-in', running: 'Đang thi đấu', finished: 'Đã kết thúc', cancelled: 'Đã huỷ' };
const LIMITS = { knockout: [2, 64], roundrobin: [2, 10], swiss: [2, 64] };
const BADGE_POINTS = [10, 6, 3]; // điểm Danh vọng mùa cho hạng 1-2-3

class TournamentError extends Error {}

// Server gắn các hàm thao tác phòng chơi:
//   createRoom(t, round, pairing) → mã phòng; roomState(roomId) → null | { seated: {r, b}, started, finished }
const hooks = { createRoom: null, roomState: null, closeRoom: null, onChange: null };

let list = [];
const newId = () => crypto.randomBytes(5).toString('hex');
const get = (id) => list.find((t) => t.id === id) || null;

async function init() {
  list = (await storage.loadTournaments()) || [];
}

function save(t) {
  if (t) t.updatedAt = Date.now();
  Promise.resolve(storage.saveTournaments(list)).catch((err) => console.error('Không lưu được giải đấu:', err.message));
  if (hooks.onChange) hooks.onChange(t);
}

// ---------- Tạo / sửa (quản trị viên) ----------
function clean(input, old = {}) {
  const name = String(input.name ?? old.name ?? '').trim().slice(0, 80);
  if (name.length < 3) throw new TournamentError('Tên giải phải có ít nhất 3 ký tự.');
  const format = FORMATS[input.format] ? input.format : old.format || 'swiss';
  const [minP, maxP] = LIMITS[format];
  const int = (v, d, lo, hi, label) => {
    const n = Math.round(Number(v ?? d));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new TournamentError(`${label} phải từ ${lo} đến ${hi}.`);
    return n;
  };
  const maxPlayers = int(input.maxPlayers, old.maxPlayers ?? Math.min(16, maxP), minP, maxP, `Số kỳ thủ tối đa (${FORMATS[format]})`);
  const startAt = Number(input.startAt ?? old.startAt);
  if (!Number.isFinite(startAt)) throw new TournamentError('Chưa chọn thời gian bắt đầu.');
  const prizes = (Array.isArray(input.prizes) ? input.prizes : old.prizes || [0, 0, 0]).slice(0, 3).map((p) => int(p, 0, 0, 1e6, 'Giải thưởng'));
  while (prizes.length < 3) prizes.push(0);
  return {
    name, format,
    description: String(input.description ?? old.description ?? '').trim().slice(0, 600),
    tc: { totalMin: int(input.tc?.totalMin, old.tc?.totalMin ?? 10, 1, 60, 'Thời gian mỗi bên (phút)'), incSec: int(input.tc?.incSec, old.tc?.incSec ?? 5, 0, 10, 'Giây cộng mỗi nước') },
    maxPlayers,
    roundCount: format === 'swiss' ? int(input.roundCount, old.roundCount ?? 5, 1, 9, 'Số vòng') : null, // số vòng hệ Thụy Sĩ
    entryFee: int(input.entryFee, old.entryFee ?? 0, 0, 1e5, 'Lệ phí'),
    prizes,
    startAt,
    checkinMin: int(input.checkinMin, old.checkinMin ?? 15, 0, 120, 'Thời gian check-in (phút)'),
    noShowMin: int(input.noShowMin, old.noShowMin ?? 5, 1, 30, 'Thời gian chờ vào bàn (phút)'),
  };
}

function create(input) {
  const now = Date.now();
  const t = { id: newId(), ...clean(input), status: 'open', createdAt: now, updatedAt: now, players: [], rounds: [] };
  list.push(t);
  save(t);
  return t;
}

function update(id, input) {
  const t = get(id);
  if (!t) throw new TournamentError('Không tìm thấy giải.');
  if (!['open', 'checkin'].includes(t.status)) throw new TournamentError('Chỉ sửa được giải chưa bắt đầu.');
  Object.assign(t, clean(input, t));
  if (t.players.length > t.maxPlayers) throw new TournamentError(`Đã có ${t.players.length} kỳ thủ đăng ký — không thể giảm dưới số này.`);
  save(t);
  return t;
}

function cancel(id, reason = 'Ban tổ chức đã huỷ giải.') {
  const t = get(id);
  if (!t) throw new TournamentError('Không tìm thấy giải.');
  if (['finished', 'cancelled'].includes(t.status)) throw new TournamentError('Giải đã kết thúc.');
  for (const p of t.players) {
    if (p.paid) users.addCoins(p.id, p.paid);
    users.notify(p.id, 'tournament', { tid: t.id, name: t.name, text: `${reason}${p.paid ? ` Đã hoàn ${p.paid} xu lệ phí.` : ''}` });
  }
  for (const r of t.rounds) for (const pr of r.pairings) if (pr.roomId && hooks.closeRoom) hooks.closeRoom(pr.roomId, 'Giải đấu đã bị huỷ.');
  t.status = 'cancelled';
  t.finishedAt = Date.now();
  save(t);
  return t;
}

function remove(id) {
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return false;
  if (!['finished', 'cancelled'].includes(list[i].status)) throw new TournamentError('Hãy huỷ giải trước khi xoá.');
  list.splice(i, 1);
  save(null);
  return true;
}

// Bắt đầu ngay (quản trị viên): bỏ qua check-in, mọi người đã đăng ký đều tham gia
function startNow(id) {
  const t = get(id);
  if (!t) throw new TournamentError('Không tìm thấy giải.');
  if (!['open', 'checkin'].includes(t.status)) throw new TournamentError('Giải đã bắt đầu hoặc đã kết thúc.');
  for (const p of t.players) p.checkedIn = true;
  t.startAt = Date.now();
  start(t);
  return t;
}

// ---------- Kỳ thủ: đăng ký, rút lui, check-in ----------
function register(id, accountId) {
  const t = get(id);
  const acc = users.get(accountId);
  if (!t || !acc) throw new TournamentError('Không tìm thấy giải.');
  if (!['open', 'checkin'].includes(t.status)) throw new TournamentError('Giải đã đóng đăng ký.');
  if (t.players.some((p) => p.id === accountId)) throw new TournamentError('Bạn đã đăng ký giải này.');
  if (t.players.length >= t.maxPlayers) throw new TournamentError('Giải đã đủ người.');
  if (t.entryFee && !users.spendCoins(accountId, t.entryFee)) throw new TournamentError(`Không đủ xu — lệ phí ${t.entryFee} xu.`);
  t.players.push({
    id: acc.id, name: acc.displayName, rating: acc.rating, paid: t.entryFee, joinedAt: Date.now(),
    checkedIn: false, score: 0, buchholz: 0, place: null, out: false, byes: 0, reds: 0,
  });
  save(t);
  return t;
}

function unregister(id, accountId) {
  const t = get(id);
  if (!t) throw new TournamentError('Không tìm thấy giải.');
  if (!['open', 'checkin'].includes(t.status)) throw new TournamentError('Giải đã bắt đầu — không thể rút lui.');
  const i = t.players.findIndex((p) => p.id === accountId);
  if (i < 0) throw new TournamentError('Bạn chưa đăng ký giải này.');
  const [p] = t.players.splice(i, 1);
  if (p.paid) users.addCoins(accountId, p.paid);
  save(t);
  return t;
}

function checkIn(id, accountId) {
  const t = get(id);
  if (!t) throw new TournamentError('Không tìm thấy giải.');
  if (t.status !== 'checkin') throw new TournamentError(t.status === 'open' ? `Check-in mở trước giờ đấu ${t.checkinMin} phút.` : 'Đã hết thời gian check-in.');
  const p = t.players.find((x) => x.id === accountId);
  if (!p) throw new TournamentError('Bạn chưa đăng ký giải này.');
  p.checkedIn = true;
  save(t);
  return t;
}

// ---------- Diễn biến giải ----------
function start(t) {
  // Ai không check-in thì bị loại khỏi danh sách (hoàn lệ phí)
  const absent = t.players.filter((p) => !p.checkedIn);
  for (const p of absent) {
    if (p.paid) users.addCoins(p.id, p.paid);
    users.notify(p.id, 'tournament', { tid: t.id, name: t.name, text: `Bạn không check-in nên không tham gia giải${p.paid ? ` — đã hoàn ${p.paid} xu` : ''}.` });
  }
  t.players = t.players.filter((p) => p.checkedIn);
  if (t.players.length < 2) return cancel(t.id, 'Giải không đủ kỳ thủ check-in nên đã huỷ.');
  // Xếp hạt giống theo Elo lúc bắt đầu
  t.players.forEach((p) => { const acc = users.get(p.id); if (acc) { p.rating = acc.rating; p.name = acc.displayName; } });
  t.players.sort((a, b) => b.rating - a.rating);
  t.players.forEach((p, i) => { p.seed = i + 1; });
  t.status = 'running';
  t.startedAt = Date.now();
  if (t.format === 'roundrobin') t.schedule = roundRobinSchedule(t.players.map((p) => p.id));
  if (t.format === 'knockout') t.bracketSize = 2 ** Math.ceil(Math.log2(t.players.length));
  for (const p of t.players) users.notify(p.id, 'tournament', { tid: t.id, name: t.name, text: `Giải "${t.name}" đã bắt đầu!` });
  startRound(t);
  return t;
}

const totalRounds = (t) => (t.format === 'swiss' ? Math.min(t.roundCount, t.players.length - 1 || 1)
  : t.format === 'roundrobin' ? t.schedule.length : Math.log2(t.bracketSize));
const player = (t, id) => t.players.find((p) => p.id === id);

function startRound(t) {
  const n = t.rounds.length + 1;
  const pairs = t.format === 'knockout' ? knockoutPairs(t, n) : t.format === 'roundrobin' ? t.schedule[n - 1] : swissPairs(t);
  const round = { n, startedAt: Date.now(), finishedAt: null, pairings: [] };
  t.rounds.push(round);
  for (const [a, b] of pairs) {
    const pr = { id: newId(), r: a, b, roomId: null, result: null, reason: null, status: 'pending', createdAt: Date.now() };
    if (!a || !b) {
      // Đặc cách (bye): người còn lại thắng
      pr.r = a || b;
      pr.b = null;
      pr.result = 'r';
      pr.reason = 'bye';
      pr.status = 'done';
      const p = player(t, pr.r);
      if (p) p.byes++;
    } else {
      // Ai cầm Đỏ ít hơn thì cầm Đỏ
      const pa = player(t, a), pb = player(t, b);
      if (pb.reds < pa.reds || (pb.reds === pa.reds && n % 2 === 0)) { pr.r = b; pr.b = a; }
      player(t, pr.r).reds++;
    }
    round.pairings.push(pr);
  }
  save(t);
  for (const pr of round.pairings) {
    if (pr.status === 'done') {
      users.notify(pr.r, 'tournament', { tid: t.id, name: t.name, text: `Vòng ${n}: bạn được đặc cách (thắng không cần đấu).` });
      continue;
    }
    openPairingRoom(t, round, pr);
  }
  maybeFinishRound(t);
}

function openPairingRoom(t, round, pr) {
  if (!hooks.createRoom) return;
  pr.roomId = hooks.createRoom(t, round, pr);
  pr.createdAt = Date.now();
  const nameOf = (id) => (player(t, id) || {}).name || 'Kỳ thủ';
  for (const [me, opp, color] of [[pr.r, pr.b, 'Đỏ'], [pr.b, pr.r, 'Đen']]) {
    users.notify(me, 'tournament', {
      tid: t.id, name: t.name, roomId: pr.roomId,
      text: `Vòng ${round.n}: bạn cầm quân ${color} gặp ${nameOf(opp)} — vào bàn trong ${t.noShowMin} phút.`,
    });
  }
  save(t);
}

// Kết quả một cặp đấu (server gọi khi ván trong phòng giải kết thúc). winner: 'r' | 'b' | null (hoà)
function reportResult(tid, pairingId, winner, reason, gameId) {
  const t = get(tid);
  if (!t || t.status !== 'running') return;
  const round = t.rounds[t.rounds.length - 1];
  const pr = round && round.pairings.find((p) => p.id === pairingId);
  if (!pr || pr.status === 'done') return;
  pr.result = winner || 'draw';
  pr.reason = reason;
  pr.gameId = gameId || null;
  pr.status = 'done';
  save(t);
  maybeFinishRound(t);
}

function scoreOf(pr, id) {
  if (pr.result === 'double') return 0;
  if (pr.result === 'draw') return 0.5;
  return (pr.result === 'r' ? pr.r : pr.b) === id ? 1 : 0;
}

// Ai đi tiếp ở cặp loại trực tiếp (hoà → hạt giống cao hơn đi tiếp)
function advancer(t, pr) {
  if (!pr.b) return pr.r;
  if (pr.result === 'r') return pr.r;
  if (pr.result === 'b') return pr.b;
  return player(t, pr.r).seed < player(t, pr.b).seed ? pr.r : pr.b;
}

function maybeFinishRound(t) {
  const round = t.rounds[t.rounds.length - 1];
  if (!round || round.pairings.some((p) => p.status !== 'done')) return;
  round.finishedAt = Date.now();
  // Cập nhật điểm
  for (const p of t.players) {
    p.score = 0;
    for (const r of t.rounds) for (const pr of r.pairings) if (pr.r === p.id || pr.b === p.id) p.score += scoreOf(pr, p.id);
  }
  if (t.format === 'knockout') {
    for (const pr of round.pairings) if (pr.b) player(t, advancer(t, pr) === pr.r ? pr.b : pr.r).out = round.n;
  }
  const done = t.format === 'knockout' ? round.pairings.length === 1 : t.rounds.length >= totalRounds(t);
  if (done) finish(t);
  else {
    save(t);
    startRound(t);
  }
}

function finish(t) {
  // Bảng xếp hạng: điểm → Buchholz (tổng điểm đối thủ) → hạt giống
  for (const p of t.players) {
    p.buchholz = 0;
    for (const r of t.rounds) for (const pr of r.pairings) {
      if (!pr.b) continue;
      const opp = pr.r === p.id ? pr.b : pr.b === p.id ? pr.r : null;
      if (opp) p.buchholz += player(t, opp).score;
    }
  }
  let standings;
  if (t.format === 'knockout') {
    const final = t.rounds[t.rounds.length - 1].pairings[0];
    const champ = advancer(t, final);
    // Hạng theo vòng bị loại: chung kết → 2, bán kết → 3, tứ kết → 5, ...
    const R = t.rounds.length;
    for (const p of t.players) p.place = p.id === champ ? 1 : 2 ** (R - (p.out || R)) + 1;
    standings = [...t.players].sort((a, b) => a.place - b.place || a.seed - b.seed);
  } else {
    standings = [...t.players].sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || a.seed - b.seed);
    standings.forEach((p, i) => { p.place = i + 1; });
  }
  t.standings = standings.map((p) => p.id);
  t.status = 'finished';
  t.finishedAt = Date.now();
  const placeName = ['Vô địch', 'Á quân', 'Hạng 3'];
  for (const p of t.players) {
    const prize = p.place <= 3 ? t.prizes[p.place - 1] || 0 : 0;
    if (prize) users.addCoins(p.id, prize);
    if (p.place <= 3) users.addBadge(p.id, { type: 'tournament', tid: t.id, name: `${placeName[p.place - 1]} · ${t.name}`, place: p.place, points: BADGE_POINTS[p.place - 1] });
    users.notify(p.id, 'tournament', {
      tid: t.id, name: t.name,
      text: `Giải "${t.name}" kết thúc — bạn xếp hạng ${p.place}/${t.players.length}${prize ? `, nhận ${prize} xu` : ''}.`,
    });
  }
  save(t);
}

// Mỗi 10 giây: mở check-in, bắt đầu giải, xử kỳ thủ không vào bàn, tạo lại bàn bị mất (khởi động lại server)
function tick() {
  const now = Date.now();
  for (const t of list) {
    if (t.status === 'open' && now >= t.startAt - t.checkinMin * 60000) {
      t.status = 'checkin';
      if (!t.checkinMin) for (const p of t.players) p.checkedIn = true;
      for (const p of t.players) users.notify(p.id, 'tournament', { tid: t.id, name: t.name, text: `Đã mở check-in giải "${t.name}" — hãy check-in trước giờ đấu.` });
      save(t);
    }
    if (t.status === 'checkin' && now >= t.startAt) start(t);
    if (t.status !== 'running') continue;
    const round = t.rounds[t.rounds.length - 1];
    if (!round) continue;
    for (const pr of round.pairings) {
      if (pr.status === 'done') continue;
      const st = pr.roomId && hooks.roomState ? hooks.roomState(pr.roomId) : null;
      if (!st) { openPairingRoom(t, round, pr); continue; } // phòng mất (server khởi động lại) → tạo lại
      if (st.started) { if (pr.status !== 'playing') { pr.status = 'playing'; save(t); } continue; }
      if (now - pr.createdAt < t.noShowMin * 60000) continue;
      // Hết giờ chờ: ai đã vào bàn thắng; không ai vào → cả hai thua (loại trực tiếp: hạt giống cao hơn đi tiếp)
      const winner = st.seated.r && !st.seated.b ? 'r' : st.seated.b && !st.seated.r ? 'b' : null;
      if (winner) reportResult(t.id, pr.id, winner, 'noshow');
      else {
        pr.result = t.format === 'knockout' ? (player(t, pr.r).seed < player(t, pr.b).seed ? 'r' : 'b') : 'double';
        pr.reason = 'noshow';
        pr.status = 'done';
        save(t);
        maybeFinishRound(t);
      }
      if (hooks.closeRoom) hooks.closeRoom(pr.roomId, 'Hết thời gian chờ vào bàn — kết quả đã được xử theo luật giải.');
    }
  }
}
setInterval(tick, 10000).unref();

// ---------- Xếp cặp ----------
// Vòng tròn: thuật toán xoay vòng (circle method); null = nghỉ
function roundRobinSchedule(ids) {
  const arr = ids.length % 2 ? [...ids, null] : [...ids];
  const n = arr.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // giữ người đầu cố định, xoay phần còn lại
  }
  return rounds;
}

// Loại trực tiếp: vòng 1 theo thứ tự hạt giống chuẩn (1-8, 4-5, 2-7, 3-6...), hạt giống cao được đặc cách khi thiếu người
function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order;
}
function knockoutPairs(t, n) {
  if (n === 1) {
    const bySeed = (s) => (t.players.find((p) => p.seed === s) || {}).id || null;
    const order = bracketOrder(t.bracketSize);
    const pairs = [];
    for (let i = 0; i < order.length; i += 2) pairs.push([bySeed(order[i]), bySeed(order[i + 1])]);
    return pairs;
  }
  const prev = t.rounds[n - 2].pairings;
  const pairs = [];
  for (let i = 0; i < prev.length; i += 2) pairs.push([advancer(t, prev[i]), prev[i + 1] ? advancer(t, prev[i + 1]) : null]);
  return pairs;
}

// Hệ Thụy Sĩ: xếp theo điểm, tránh gặp lại; lẻ người → người điểm thấp nhất chưa được đặc cách sẽ nghỉ (1 điểm)
function swissPairs(t) {
  const played = new Set();
  for (const r of t.rounds) for (const pr of r.pairings) if (pr.b) played.add([pr.r, pr.b].sort().join('|'));
  const pool = [...t.players].sort((a, b) => b.score - a.score || a.seed - b.seed).map((p) => p.id);
  let bye = null;
  if (pool.length % 2) {
    for (let i = pool.length - 1; i >= 0; i--) if (!player(t, pool[i]).byes) { bye = pool[i]; break; }
    if (!bye) bye = pool[pool.length - 1];
    pool.splice(pool.indexOf(bye), 1);
  }
  let steps = 0;
  const solve = (rest) => {
    if (!rest.length) return [];
    if (++steps > 20000) return null;
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      if (played.has([a, others[i]].sort().join('|'))) continue;
      const sub = solve(others.filter((_, j) => j !== i));
      if (sub) return [[a, others[i]], ...sub];
    }
    return null;
  };
  let pairs = solve(pool);
  if (!pairs) { pairs = []; for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]); } // buộc gặp lại
  if (bye) pairs.push([bye, null]);
  return pairs;
}

// ---------- Dữ liệu gửi cho trình duyệt ----------
function summary(t, viewerId) {
  const me = viewerId ? t.players.find((p) => p.id === viewerId) : null;
  return {
    id: t.id, name: t.name, description: t.description, format: t.format, formatName: FORMATS[t.format],
    status: t.status, statusName: STATUS[t.status], tc: t.tc, maxPlayers: t.maxPlayers, rounds: t.rounds.length,
    totalRounds: t.status === 'running' || t.status === 'finished' ? totalRounds(t) : t.format === 'swiss' ? t.roundCount : null,
    entryFee: t.entryFee, prizes: t.prizes, startAt: t.startAt, checkinMin: t.checkinMin, noShowMin: t.noShowMin,
    players: t.players.length, finishedAt: t.finishedAt || null,
    winner: t.status === 'finished' && t.standings ? (player(t, t.standings[0]) || {}).name : null,
    registered: !!me, checkedIn: !!(me && me.checkedIn),
  };
}

function detail(id, viewerId) {
  const t = get(id);
  if (!t) return null;
  const nameOf = (pid) => (pid ? (player(t, pid) || {}).name || '?' : null);
  const rounds = t.rounds.map((r) => ({
    n: r.n, startedAt: r.startedAt, finishedAt: r.finishedAt,
    pairings: r.pairings.map((pr) => ({
      id: pr.id, r: pr.r, b: pr.b, rName: nameOf(pr.r), bName: nameOf(pr.b),
      roomId: pr.status === 'done' ? null : pr.roomId, result: pr.result, reason: pr.reason, status: pr.status, gameId: pr.gameId || null,
      deadline: pr.status === 'pending' ? pr.createdAt + t.noShowMin * 60000 : null,
    })),
  }));
  const standings = [...t.players]
    .sort((a, b) => (a.place || 999) - (b.place || 999) || b.score - a.score || b.buchholz - a.buchholz || (a.seed || 999) - (b.seed || 999))
    .map((p) => {
      const acc = users.get(p.id);
      return {
        id: p.id, name: p.name, username: acc ? acc.username : null, avatar: acc ? acc.avatar || null : null, rating: p.rating,
        seed: p.seed || null, score: p.score, buchholz: p.buchholz, place: p.place, out: p.out || false, checkedIn: p.checkedIn,
      };
    });
  let myGame = null;
  if (viewerId && t.status === 'running') {
    const cur = rounds[rounds.length - 1];
    const pr = cur && cur.pairings.find((x) => (x.r === viewerId || x.b === viewerId) && x.status !== 'done');
    if (pr) myGame = { ...pr, round: cur.n, color: pr.r === viewerId ? 'r' : 'b', opponent: pr.r === viewerId ? pr.bName : pr.rName };
  }
  return { ...summary(t, viewerId), rounds, standings, myGame, bracketSize: t.bracketSize || null };
}

const publicList = (viewerId) => [...list].sort((a, b) => a.startAt - b.startAt).map((t) => summary(t, viewerId));

// Phòng của giải: ai được ngồi ghế nào
function seatFor(tid, pairingId, accountId) {
  const t = get(tid);
  const round = t && t.rounds[t.rounds.length - 1];
  const pr = round && round.pairings.find((p) => p.id === pairingId);
  if (!pr) return null;
  return pr.r === accountId ? 'r' : pr.b === accountId ? 'b' : null;
}

module.exports = {
  FORMATS, STATUS, TournamentError, hooks, init, get, create, update, cancel, remove, startNow,
  register, unregister, checkIn, reportResult, publicList, detail, seatFor, tick,
  _test: { roundRobinSchedule, bracketOrder, swissPairs },
};
