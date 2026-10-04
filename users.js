// Tài khoản người chơi, phiên đăng nhập và lịch sử ván đấu — lưu ở data/db.json.
// Khách (chưa đăng ký) vẫn chơi được nhưng không được lưu lại.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // phiên đăng nhập 30 ngày
const MAX_GAMES = 5000; // số ván lưu tối đa (ván cũ nhất bị xoá trước)

fs.mkdirSync(AVATAR_DIR, { recursive: true });

let db = { accounts: {}, sessions: {}, games: {}, feedback: [], meta: { gamesPlayed: 0 } };
try {
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // Bản cũ lưu cả khách trong "users" — giờ chỉ giữ tài khoản đã đăng ký
  db = {
    accounts: loaded.accounts || {},
    sessions: loaded.sessions || {},
    games: loaded.games || {},
    feedback: loaded.feedback || [],
    meta: { ...db.meta, ...loaded.meta },
  };
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Không đọc được dữ liệu:', err.message);
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (err) return console.error('Không lưu được dữ liệu:', err.message);
      fs.rename(tmp, DB_FILE, (e) => e && console.error('Không lưu được dữ liệu:', e.message));
    });
  }, 500);
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

const isValidUid = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
const newId = () => crypto.randomBytes(6).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const emptyStats = () => ({ games: 0, wins: 0, losses: 0, draws: 0 });

class UserError extends Error {}

// ---------- Hồ sơ người chơi ----------
const START_RATING = 1200; // điểm Elo khởi đầu
const START_CREDIT = 1000; // điểm uy tín khởi đầu
const MAX_CREDIT = 1100;
const DAILY_BONUS = 20; // xu thưởng đăng nhập mỗi ngày
const REGIONS = ['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Miền Bắc', 'Miền Trung',
  'Tây Nguyên', 'Miền Nam', 'Nước ngoài'];

// Kỳ hiệu: số 7 chữ số không trùng
function newPlayerNo() {
  const used = new Set(Object.values(db.accounts).map((a) => a.playerNo));
  let no;
  do { no = String(crypto.randomInt(1000000, 10000000)); } while (used.has(no));
  return no;
}

// Bổ sung các trường mới cho tài khoản cũ
function migrate(acc) {
  const defaults = {
    rating: START_RATING, credit: START_CREDIT, coins: 0, streak: 0, bestStreak: 0,
    region: '', lastBonusDay: null, avatar: null, solvedPuzzles: [],
  };
  for (const [k, v] of Object.entries(defaults)) if (acc[k] === undefined) acc[k] = v;
  if (!acc.playerNo) acc.playerNo = newPlayerNo();
  return acc;
}
{
  const before = JSON.stringify(db.accounts);
  Object.values(db.accounts).forEach(migrate);
  if (JSON.stringify(db.accounts) !== before) setTimeout(() => save(), 0); // lưu ngay để kỳ hiệu không đổi
}

// ---------- Mật khẩu ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(acc, password) {
  const { hash } = hashPassword(String(password), acc.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(acc.passHash, 'hex'));
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 6) throw new UserError('Mật khẩu phải có ít nhất 6 ký tự.');
  if (p.length > 100) throw new UserError('Mật khẩu quá dài.');
}

function cleanDisplayName(s) {
  const name = String(s || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (name.length < 2) throw new UserError('Tên hiển thị phải có ít nhất 2 ký tự.');
  return name;
}

// ---------- Tài khoản ----------
function findByUsername(username) {
  const lower = String(username || '').trim().toLowerCase();
  return Object.values(db.accounts).find((a) => a.usernameLower === lower) || null;
}

function register(username, displayName, password) {
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) {
    throw new UserError('Tên đăng nhập 3–20 ký tự, chỉ gồm chữ không dấu, số, dấu _ hoặc dấu chấm.');
  }
  if (findByUsername(username)) throw new UserError('Tên đăng nhập đã có người dùng.');
  const name = cleanDisplayName(displayName || username);
  validatePassword(password);
  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const acc = {
    id: newId(), username, usernameLower: username.toLowerCase(), displayName: name,
    salt, passHash: hash, createdAt: now, lastSeen: now, banned: false,
    stats: { online: emptyStats(), ai: emptyStats() }, games: [],
  };
  migrate(acc);
  db.accounts[acc.id] = acc;
  save();
  return acc;
}

function login(username, password) {
  const acc = findByUsername(username);
  if (!acc || !checkPassword(acc, password)) throw new UserError('Sai tên đăng nhập hoặc mật khẩu.');
  if (acc.banned) throw new UserError('Tài khoản đã bị quản trị viên khoá.');
  acc.lastSeen = Date.now();
  save();
  return acc;
}

const get = (id) => db.accounts[id] || null;
const list = () => Object.values(db.accounts);

function touch(id) {
  const acc = db.accounts[id];
  if (acc) { acc.lastSeen = Date.now(); save(); }
}

function update(id, patch) {
  const acc = db.accounts[id];
  if (!acc) return null;
  if (patch.displayName !== undefined) acc.displayName = cleanDisplayName(patch.displayName);
  if (patch.region !== undefined) {
    if (patch.region !== '' && !REGIONS.includes(patch.region)) throw new UserError('Khu vực không hợp lệ.');
    acc.region = patch.region;
  }
  if (typeof patch.banned === 'boolean') {
    acc.banned = patch.banned;
    if (patch.banned) destroySessionsOf(id);
  }
  // Chỉ quản trị viên: chỉnh Elo / xu / uy tín
  for (const [key, min, max] of [['rating', 0, 4000], ['coins', 0, 1e9], ['credit', 0, MAX_CREDIT]]) {
    if (patch[key] === undefined) continue;
    const v = Number(patch[key]);
    if (!Number.isInteger(v) || v < min || v > max) throw new UserError(`Giá trị ${key} phải là số nguyên từ ${min} đến ${max}.`);
    acc[key] = v;
  }
  if (patch.newPassword !== undefined) {
    validatePassword(patch.newPassword);
    const { salt, hash } = hashPassword(patch.newPassword);
    acc.salt = salt;
    acc.passHash = hash;
  }
  save();
  return acc;
}

// Ảnh đại diện: lưu file ở data/avatars/, phục vụ tại /avatars/
function setAvatar(id, buf) {
  const acc = db.accounts[id];
  if (!acc) return null;
  let ext = null;
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = 'webp';
  if (!ext) throw new UserError('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
  const name = `${id}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, name), buf);
  removeAvatarFile(acc);
  acc.avatar = '/avatars/' + name;
  save();
  return acc;
}

function clearAvatar(id) {
  const acc = db.accounts[id];
  if (!acc) return null;
  removeAvatarFile(acc);
  acc.avatar = null;
  save();
  return acc;
}

function removeAvatarFile(acc) {
  if (acc.avatar) fs.rm(path.join(AVATAR_DIR, path.basename(acc.avatar)), () => {});
}

function remove(id) {
  if (!db.accounts[id]) return false;
  removeAvatarFile(db.accounts[id]);
  delete db.accounts[id];
  destroySessionsOf(id);
  save();
  return true;
}

// Thông tin an toàn để gửi cho trình duyệt (không có mật khẩu)
function publicAccount(acc) {
  return {
    id: acc.id, username: acc.username, displayName: acc.displayName, avatar: acc.avatar || null,
    createdAt: acc.createdAt, lastSeen: acc.lastSeen, banned: acc.banned,
    stats: acc.stats, gameCount: acc.games.length,
    playerNo: acc.playerNo, rating: acc.rating, credit: acc.credit, coins: acc.coins,
    streak: acc.streak, bestStreak: acc.bestStreak, region: acc.region,
    puzzlesSolved: acc.solvedPuzzles.length,
  };
}

// Giải được bài tập: lần đầu được 5 xu. Trả về số xu được thưởng.
const PUZZLE_REWARD = 5;
function markPuzzleSolved(id, puzzleId) {
  const acc = db.accounts[id];
  if (!acc || acc.solvedPuzzles.includes(puzzleId)) return 0;
  acc.solvedPuzzles.push(puzzleId);
  acc.coins += PUZZLE_REWARD;
  save();
  return PUZZLE_REWARD;
}

// Thưởng xu đăng nhập lần đầu mỗi ngày (theo giờ Việt Nam). Trả về số xu được thưởng.
function dailyBonus(id) {
  const acc = db.accounts[id];
  if (!acc) return 0;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (acc.lastBonusDay === today) return 0;
  acc.lastBonusDay = today;
  acc.coins += DAILY_BONUS;
  save();
  return DAILY_BONUS;
}

// ---------- Góp ý ----------
function addFeedback({ accountId, name, message, contact }) {
  message = String(message || '').trim();
  if (message.length < 5) throw new UserError('Nội dung góp ý quá ngắn.');
  const item = {
    id: newId(), at: Date.now(), accountId: accountId || null,
    name: String(name || 'Khách').slice(0, 40), message: message.slice(0, 1000),
    contact: String(contact || '').trim().slice(0, 100),
  };
  db.feedback.unshift(item);
  if (db.feedback.length > 500) db.feedback.length = 500;
  save();
  return item;
}
const listFeedback = (accountId) => (accountId ? db.feedback.filter((f) => f.accountId === accountId) : db.feedback);
function removeFeedback(id) {
  const i = db.feedback.findIndex((f) => f.id === id);
  if (i < 0) return false;
  db.feedback.splice(i, 1);
  save();
  return true;
}

// ---------- Phiên đăng nhập ----------
function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha256(token)] = { accountId, expires: Date.now() + SESSION_MS };
  save();
  return token;
}

function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const key = sha256(token);
  const s = db.sessions[key];
  if (!s) return null;
  const acc = db.accounts[s.accountId];
  if (!acc || acc.banned || s.expires < Date.now()) {
    delete db.sessions[key];
    save();
    return null;
  }
  return acc;
}

function destroySession(token) {
  if (typeof token === 'string' && db.sessions[sha256(token)]) {
    delete db.sessions[sha256(token)];
    save();
  }
}

const sessionsOf = (accountId) => Object.values(db.sessions).filter((s) => s.accountId === accountId && s.expires > Date.now()).length;

function destroySessionsOf(accountId) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.accountId === accountId) delete db.sessions[k];
  save();
}

// ---------- Ván đấu ----------
// record = { mode: 'online'|'ai', level?, players: { r: {name, accountId}, b: {...} }, result, moves: [{from,to}] }
function recordGame(record) {
  const id = newId() + newId();
  const game = {
    id, mode: record.mode, level: record.level || null,
    startedAt: record.startedAt || null, endedAt: Date.now(),
    players: record.players, result: record.result,
    moves: record.moves.map((m) => [m.from[0], m.from[1], m.to[0], m.to[1]]),
  };
  db.games[id] = game;
  if (record.mode === 'online') db.meta.gamesPlayed++;

  const accs = { r: db.accounts[game.players.r.accountId], b: db.accounts[game.players.b.accountId] };
  const online = record.mode === 'online';
  const score = (c) => (!game.result.winner ? 0.5 : game.result.winner === c ? 1 : 0);

  // Elo: chỉ tính khi cả hai bên đều là tài khoản (ván online)
  if (online && accs.r && accs.b) {
    const K = 32;
    const expR = 1 / (1 + 10 ** ((accs.b.rating - accs.r.rating) / 400));
    const dR = Math.round(K * (score('r') - expR));
    game.ratingChange = { r: dR, b: -dR };
    accs.r.rating += dR;
    accs.b.rating -= dR;
  }

  for (const c of ['r', 'b']) {
    const acc = accs[c];
    if (!acc) continue;
    const st = acc.stats[online ? 'online' : 'ai'];
    const s = score(c);
    st.games++;
    if (s === 0.5) st.draws++;
    else if (s === 1) st.wins++;
    else st.losses++;
    acc.games.push(id);
    // Xu: online 10 (+10 khi thắng), với máy 2 (+3 khi thắng)
    acc.coins += online ? 10 + (s === 1 ? 10 : 0) : 2 + (s === 1 ? 3 : 0);
    if (online) {
      // Chuỗi thắng & uy tín (bỏ ván giữa chừng bị trừ 10, chơi trọn ván +1)
      if (s === 1) { acc.streak++; acc.bestStreak = Math.max(acc.bestStreak, acc.streak); } else if (s === 0) acc.streak = 0;
      if (game.result.reason === 'abandon' && s === 0) acc.credit = Math.max(0, acc.credit - 10);
      else acc.credit = Math.min(MAX_CREDIT, acc.credit + 1);
    }
  }

  // Giới hạn dung lượng: xoá ván cũ nhất
  const ids = Object.keys(db.games);
  if (ids.length > MAX_GAMES) {
    ids.sort((a, b) => db.games[a].endedAt - db.games[b].endedAt);
    for (const old of ids.slice(0, ids.length - MAX_GAMES)) delete db.games[old];
  }
  save();
  return game;
}

const getGame = (id) => db.games[id] || null;

// Tóm tắt các ván của một tài khoản (mới nhất trước)
function gamesOf(accountId, limit = 50) {
  const acc = db.accounts[accountId];
  if (!acc) return [];
  const out = [];
  for (let i = acc.games.length - 1; i >= 0 && out.length < limit; i--) {
    const g = db.games[acc.games[i]];
    if (!g) continue;
    const color = g.players.r.accountId === accountId ? 'r' : 'b';
    const opp = g.players[color === 'r' ? 'b' : 'r'];
    out.push({
      id: g.id, mode: g.mode, level: g.level, endedAt: g.endedAt, color,
      opponent: opp.name, opponentAccount: !!opp.accountId, opponentId: opp.accountId || null,
      outcome: !g.result.winner ? 'draw' : g.result.winner === color ? 'win' : 'loss',
      reason: g.result.reason, moveCount: g.moves.length,
      ratingChange: g.ratingChange ? g.ratingChange[color] : null,
    });
  }
  return out;
}

const gamesPlayed = () => db.meta.gamesPlayed;
function countGuestGame() { db.meta.gamesPlayed++; save(); }

// Mật khẩu trang quản trị (tuỳ chọn): chỉ bật khi đặt biến môi trường ADMIN_PASSWORD
const adminPassword = () => process.env.ADMIN_PASSWORD || null;

// Dọn phiên hết hạn mỗi giờ
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) { delete db.sessions[k]; changed = true; }
  if (changed) save();
}, 60 * 60 * 1000).unref();

module.exports = {
  DATA_DIR, AVATAR_DIR, UserError, isValidUid, setAvatar, clearAvatar, REGIONS, dailyBonus,
  addFeedback, listFeedback, removeFeedback, sessionsOf, MAX_CREDIT, markPuzzleSolved,
  register, login, get, list, touch, update, remove, publicAccount, checkPassword,
  createSession, resolveSession, destroySession, destroySessionsOf,
  recordGame, getGame, gamesOf, gamesPlayed, countGuestGame, adminPassword, flush,
};
