// Tài khoản người chơi, phiên đăng nhập và lịch sử ván đấu.
// Dữ liệu giữ trong bộ nhớ, lưu qua storage/ (file data/db.json hoặc Supabase).
// Khách (chưa đăng ký) vẫn chơi được nhưng không được lưu lại.
const crypto = require('crypto');
const storage = require('./storage');
const Catalog = require('./public/catalog.js');

// Gọi khi có thông báo mới cho một tài khoản (server.js gắn vào để đẩy qua socket)
const hooks = { onNotify: null };

const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // phiên đăng nhập 30 ngày
const MAX_GAMES = 5000; // số ván lưu tối đa (ván cũ nhất bị xoá trước)

let db = { accounts: {}, sessions: {}, games: {}, feedback: [], meta: { gamesPlayed: 0 } };

// Nạp dữ liệu khi khởi động server
async function init() {
  const loaded = await storage.loadUsers();
  if (loaded) {
    // Bản cũ lưu cả khách trong "users" — giờ chỉ giữ tài khoản đã đăng ký
    db = {
      accounts: loaded.accounts || {},
      sessions: loaded.sessions || {},
      games: loaded.games || {},
      feedback: loaded.feedback || [],
      meta: { ...db.meta, ...loaded.meta },
    };
  }
  const before = JSON.stringify(db.accounts);
  Object.values(db.accounts).forEach(migrate);
  if (JSON.stringify(db.accounts) !== before) save(); // lưu ngay để kỳ hiệu không đổi
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    storage.saveUsers(db);
  }, 500);
}

// Lưu ngay (khi tắt server)
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  return storage.saveUsers(db);
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
    rating: START_RATING, credit: START_CREDIT, coins: Catalog.ECONOMY.START_COINS, streak: 0, bestStreak: 0, // xu tặng: admin chỉnh được
    region: '', lastBonusDay: null, avatar: null, solvedPuzzles: [],
    // Bạn bè: danh sách bạn, lời mời đến / đã gửi, người đã chặn (mã tài khoản)
    friends: [], friendIn: [], friendOut: [], blocked: [],
    // Túi đồ: vật phẩm đã mua, bộ đang trang bị, vật phẩm mới nhận (chưa xem)
    owned: [], equip: { ...Catalog.DEFAULT_EQUIP }, freshItems: [],
    notifications: [], missions: null,
    coinStats: { games: 0, wins: 0, losses: 0, draws: 0, net: 0 }, // Tranh xu
    puzzleLog: [], badges: [], peakRating: null,
  };
  for (const [k, v] of Object.entries(defaults)) if (acc[k] === undefined) acc[k] = JSON.parse(JSON.stringify(v));
  if (acc.peakRating === null || acc.peakRating < acc.rating) acc.peakRating = acc.rating;
  if (!acc.playerNo) acc.playerNo = newPlayerNo();
  return acc;
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

// Ảnh đại diện: lưu qua storage/ (data/avatars/ phục vụ tại /avatars/, hoặc bucket Supabase)
async function setAvatar(id, buf) {
  const acc = db.accounts[id];
  if (!acc) return null;
  let ext = null;
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = 'webp';
  if (!ext) throw new UserError('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
  const name = `${id}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const src = await storage.putFile('avatars', name, buf, ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
  removeAvatarFile(acc);
  acc.avatar = src;
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
  if (acc.avatar) storage.removeFile(acc.avatar);
}

function remove(id) {
  if (!db.accounts[id]) return false;
  removeAvatarFile(db.accounts[id]);
  delete db.accounts[id];
  // Gỡ khỏi danh sách bạn bè / lời mời / chặn của người khác
  for (const a of Object.values(db.accounts)) {
    for (const k of ['friends', 'friendIn', 'friendOut', 'blocked']) a[k] = a[k].filter((x) => x !== id);
  }
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
    puzzlesSolved: acc.solvedPuzzles.length, peakRating: acc.peakRating,
    equip: acc.equip, coinStats: acc.coinStats, badges: acc.badges,
    unread: acc.notifications.filter((n) => !n.read).length,
    friendsCount: acc.friends.length, friendRequests: acc.friendIn.length, freshItems: acc.freshItems.length,
  };
}

// Thông tin ngắn để hiện trong danh sách (bạn bè, tìm người...)
const miniAccount = (acc) => ({
  id: acc.id, displayName: acc.displayName, username: acc.username, avatar: acc.avatar || null,
  rating: acc.rating, region: acc.region || null, lastSeen: acc.lastSeen,
});

// Giải được cờ thế: lần đầu được 5 xu. Ghi nhật ký luyện tập (thời gian, số lần thử, gợi ý). Trả về số xu được thưởng.
function markPuzzleSolved(id, puzzleId, info = {}) {
  const acc = db.accounts[id];
  if (!acc) return 0;
  const num = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : 0);
  acc.puzzleLog.unshift({ id: puzzleId, at: Date.now(), ms: num(info.ms, 36e5), attempts: num(info.attempts, 999), hints: num(info.hints, 99) });
  if (acc.puzzleLog.length > 50) acc.puzzleLog.length = 50;
  progressMission(acc, 'solve_puzzle');
  let coins = 0;
  if (!acc.solvedPuzzles.includes(puzzleId)) {
    acc.solvedPuzzles.push(puzzleId);
    acc.coins += Catalog.ECONOMY.PUZZLE_REWARD;
    coins = Catalog.ECONOMY.PUZZLE_REWARD;
  }
  save();
  return coins;
}

// Thưởng xu đăng nhập lần đầu mỗi ngày (theo giờ Việt Nam). Trả về số xu được thưởng.
function dailyBonus(id) {
  const acc = db.accounts[id];
  if (!acc) return 0;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (acc.lastBonusDay === today) return 0;
  acc.lastBonusDay = today;
  acc.coins += Catalog.ECONOMY.DAILY_BONUS;
  save();
  return Catalog.ECONOMY.DAILY_BONUS;
}

// ---------- Góp ý ----------
// type: 'feedback' (góp ý) | 'report' (báo cáo kỳ thủ — target = { id, name })
function addFeedback({ accountId, name, message, contact, type = 'feedback', target = null }) {
  message = String(message || '').trim();
  if (message.length < 5) throw new UserError(type === 'report' ? 'Hãy mô tả lý do báo cáo (ít nhất 5 ký tự).' : 'Nội dung góp ý quá ngắn.');
  const item = {
    id: newId(), at: Date.now(), accountId: accountId || null,
    name: String(name || 'Khách').slice(0, 40), message: message.slice(0, 1000),
    contact: String(contact || '').trim().slice(0, 100),
    type: type === 'report' ? 'report' : 'feedback',
    target: target ? { id: String(target.id || ''), name: String(target.name || '').slice(0, 40) } : null,
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
// record = { mode: 'online'|'ai', kind?: 'ranked'|'match'|'coin'|'room'|'tournament'|'ai', stake?, tc?, fee?, tournament?,
//            level?, players: { r: {name, accountId}, b: {...} }, result, moves: [{from,to}], startedAt }
// Elo chỉ tính ở ván Xếp hạng & Giải đấu giữa 2 tài khoản; Tranh xu chuyển xu theo mức đặt; Phòng riêng không thưởng xu.
const RATED_KINDS = ['ranked', 'tournament'];
function recordGame(record) {
  const id = newId() + newId();
  const online = record.mode === 'online';
  const kind = record.kind || (online ? 'room' : 'ai');
  const game = {
    id, mode: record.mode, level: record.level || null,
    startedAt: record.startedAt || null, endedAt: Date.now(),
    players: record.players, result: record.result,
    moves: record.moves.map((m) => [m.from[0], m.from[1], m.to[0], m.to[1]]),
    kind, stake: record.stake || null, tc: record.tc || null, fee: record.fee || null,
    tournament: record.tournament || null,
  };
  // store: false → chỉ cộng thưởng / thống kê / nhiệm vụ, không ghi vào lịch sử ván (vd đánh với máy)
  const store = record.store !== false;
  if (store) db.games[id] = game;
  if (online) db.meta.gamesPlayed++;

  const accs = { r: db.accounts[game.players.r.accountId], b: db.accounts[game.players.b.accountId] };
  const score = (c) => (!game.result.winner ? 0.5 : game.result.winner === c ? 1 : 0);

  if (online && accs.r && accs.b && RATED_KINDS.includes(kind)) {
    const K = 32;
    const expR = 1 / (1 + 10 ** ((accs.b.rating - accs.r.rating) / 400));
    const dR = Math.round(K * (score('r') - expR));
    game.ratingChange = { r: dR, b: -dR };
    accs.r.rating += dR;
    accs.b.rating -= dR;
  }

  game.coinChange = { r: null, b: null };
  for (const c of ['r', 'b']) {
    const acc = accs[c];
    if (!acc) continue;
    const st = acc.stats[online ? 'online' : 'ai'];
    const s = score(c);
    st.games++;
    if (s === 0.5) st.draws++;
    else if (s === 1) st.wins++;
    else st.losses++;
    if (store) acc.games.push(id);
    acc.peakRating = Math.max(acc.peakRating || 0, acc.rating);
    let coins = 0;
    if (kind === 'coin') {
      // Tranh xu: thắng nhận mức đặt của đối thủ, thua mất mức đặt, hoà hoàn nguyên
      coins = s === 1 ? game.stake : s === 0 ? -Math.min(game.stake, acc.coins) : 0;
      const cs = acc.coinStats;
      cs.games++;
      if (s === 1) cs.wins++; else if (s === 0) cs.losses++; else cs.draws++;
      cs.net += coins;
    } else if (kind === 'ranked' || kind === 'match') coins = Catalog.ECONOMY.RANKED_REWARD_PLAY + (s === 1 ? Catalog.ECONOMY.RANKED_REWARD_WIN : 0);
    else if (kind === 'ai') coins = Catalog.ECONOMY.AI_REWARD_PLAY + (s === 1 ? Catalog.ECONOMY.AI_REWARD_WIN : 0);
    game.coinChange[c] = coins;
    acc.coins += coins;
    if (online) {
      // Chuỗi thắng & uy tín (bỏ ván giữa chừng bị trừ 10, chơi trọn ván +1)
      if (s === 1) { acc.streak++; acc.bestStreak = Math.max(acc.bestStreak, acc.streak); } else if (s === 0) acc.streak = 0;
      if (game.result.reason === 'abandon' && s === 0) acc.credit = Math.max(0, acc.credit - 10);
      else acc.credit = Math.min(MAX_CREDIT, acc.credit + 1);
      progressMission(acc, 'play_online');
      if (kind === 'ranked' && s === 1) progressMission(acc, 'win_ranked');
      if (kind === 'coin') progressMission(acc, 'play_coin');
    } else {
      progressMission(acc, 'play_ai');
      const lvl = /^l(\d)$/.exec(game.level || '');
      if (s === 1 && lvl && Number(lvl[1]) >= 3) progressMission(acc, 'win_ai3');
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
    if (!g || g.mode === 'ai') continue; // lịch sử đấu chỉ gồm ván với người
    const color = g.players.r.accountId === accountId ? 'r' : 'b';
    const opp = g.players[color === 'r' ? 'b' : 'r'];
    out.push({
      id: g.id, mode: g.mode, kind: g.kind || (g.mode === 'ai' ? 'ai' : 'room'), level: g.level, endedAt: g.endedAt, color,
      opponent: opp.name, opponentAccount: !!opp.accountId, opponentId: opp.accountId || null,
      outcome: !g.result.winner ? 'draw' : g.result.winner === color ? 'win' : 'loss',
      reason: g.result.reason, moveCount: g.moves.length,
      ratingChange: g.ratingChange ? g.ratingChange[color] : null,
      coinChange: g.coinChange ? g.coinChange[color] : null,
      stake: g.stake || null, tc: g.tc || null, fee: g.fee || null,
      durationMs: g.startedAt ? g.endedAt - g.startedAt : null,
      tournament: g.tournament || null,
    });
  }
  return out;
}

// Ván công khai để xem lại qua link (không có thông tin riêng tư)
function publicGame(id) {
  const g = db.games[id];
  if (!g) return null;
  const pl = (p) => {
    const acc = p.accountId ? db.accounts[p.accountId] : null;
    return { name: p.name, username: acc ? acc.username : null, avatar: acc ? acc.avatar || null : null, ai: g.mode === 'ai' && !p.accountId };
  };
  return {
    id: g.id, mode: g.mode, kind: g.kind || (g.mode === 'ai' ? 'ai' : 'room'), level: g.level, startedAt: g.startedAt, endedAt: g.endedAt,
    players: { r: pl(g.players.r), b: pl(g.players.b) }, result: g.result, moves: g.moves,
    ratingChange: g.ratingChange || null, tc: g.tc || null, stake: g.stake || null, tournament: g.tournament || null,
  };
}

// ---------- Xu ----------
// Trừ xu (phí xếp hạng, mua vật phẩm, lệ phí giải). Trả về false nếu không đủ.
function spendCoins(id, amount) {
  const acc = db.accounts[id];
  if (!acc || acc.coins < amount) return false;
  acc.coins -= amount;
  save();
  return true;
}
function addCoins(id, amount) {
  const acc = db.accounts[id];
  if (!acc) return false;
  acc.coins += amount;
  save();
  return true;
}

// ---------- Túi đồ & Cửa hàng ----------
const ownsItem = (acc, itemId) => {
  const it = Catalog.byId[itemId];
  return !!it && (it.price === 0 || acc.owned.includes(itemId));
};
function inventoryOf(acc) {
  return {
    owned: Catalog.ITEMS.filter((it) => ownsItem(acc, it.id)).map((it) => it.id),
    equip: acc.equip, fresh: acc.freshItems, coins: acc.coins,
  };
}
function buyItem(id, itemId) {
  const acc = db.accounts[id];
  const it = Catalog.byId[itemId];
  if (!acc || !it) throw new UserError('Không tìm thấy vật phẩm.');
  if (ownsItem(acc, itemId)) throw new UserError('Bạn đã sở hữu vật phẩm này.');
  if (acc.coins < it.price) throw new UserError(`Không đủ xu — cần ${it.price} xu, bạn có ${acc.coins} xu.`);
  acc.coins -= it.price;
  acc.owned.push(itemId);
  acc.freshItems.push(itemId);
  save();
  return acc;
}
function equipItems(id, equip = {}) {
  const acc = db.accounts[id];
  if (!acc) return null;
  for (const cat of Object.keys(Catalog.CATS)) {
    const itemId = equip[cat];
    if (itemId === undefined) continue;
    const it = Catalog.byId[itemId];
    if (!it || it.cat !== cat) throw new UserError('Vật phẩm không hợp lệ.');
    if (!ownsItem(acc, itemId)) throw new UserError(`Bạn chưa sở hữu "${it.name}".`);
    acc.equip[cat] = itemId;
    acc.freshItems = acc.freshItems.filter((x) => x !== itemId);
  }
  save();
  return acc;
}
function markItemsSeen(id) {
  const acc = db.accounts[id];
  if (acc && acc.freshItems.length) { acc.freshItems = []; save(); }
  return acc;
}

// ---------- Thông báo ----------
// type: 'friend_request' | 'friend_accept' | 'invite' | 'tournament' | 'system'
function notify(accountId, type, data = {}) {
  const acc = db.accounts[accountId];
  if (!acc) return null;
  const n = { id: newId(), type, at: Date.now(), read: false, data };
  acc.notifications.unshift(n);
  if (acc.notifications.length > 50) acc.notifications.length = 50;
  save();
  if (hooks.onNotify) hooks.onNotify(accountId, n, acc.notifications.filter((x) => !x.read).length);
  return n;
}
const notificationsOf = (id) => (db.accounts[id] ? db.accounts[id].notifications : []);
function markNotificationsRead(id, ids) {
  const acc = db.accounts[id];
  if (!acc) return;
  for (const n of acc.notifications) if (!ids || ids.includes(n.id)) n.read = true;
  save();
}

// ---------- Bạn bè ----------
const isBlocked = (a, b) => !!(a && b && (a.blocked.includes(b.id) || b.blocked.includes(a.id)));
const areFriends = (aId, bId) => !!(db.accounts[aId] && db.accounts[aId].friends.includes(bId));
function pair(fromId, toId) {
  const a = db.accounts[fromId], b = db.accounts[toId];
  if (!a || !b || b.banned) throw new UserError('Không tìm thấy kỳ thủ.');
  if (a.id === b.id) throw new UserError('Không thể tự kết bạn với chính mình.');
  return [a, b];
}
const drop = (arr, x) => arr.filter((v) => v !== x);
function sendFriendRequest(fromId, toId) {
  const [a, b] = pair(fromId, toId);
  if (isBlocked(a, b)) throw new UserError('Không thể gửi lời mời cho kỳ thủ này.');
  if (a.friends.includes(b.id)) throw new UserError('Hai bạn đã là kỳ hữu.');
  if (a.friendIn.includes(b.id)) return acceptFriend(a.id, b.id); // người kia đã mời trước → đồng ý luôn
  if (!a.friendOut.includes(b.id)) {
    a.friendOut.push(b.id);
    b.friendIn.push(a.id);
    notify(b.id, 'friend_request', { from: miniAccount(a) });
  }
  save();
  return 'sent';
}
function acceptFriend(id, otherId) {
  const [a, b] = pair(id, otherId);
  if (!a.friendIn.includes(b.id)) throw new UserError('Không có lời mời kết bạn này.');
  a.friendIn = drop(a.friendIn, b.id); b.friendOut = drop(b.friendOut, a.id);
  a.friendOut = drop(a.friendOut, b.id); b.friendIn = drop(b.friendIn, a.id);
  if (!a.friends.includes(b.id)) a.friends.push(b.id);
  if (!b.friends.includes(a.id)) b.friends.push(a.id);
  notify(b.id, 'friend_accept', { from: miniAccount(a) });
  save();
  return 'friends';
}
function declineFriend(id, otherId) {
  const [a, b] = pair(id, otherId);
  a.friendIn = drop(a.friendIn, b.id); b.friendOut = drop(b.friendOut, a.id);
  a.friendOut = drop(a.friendOut, b.id); b.friendIn = drop(b.friendIn, a.id); // huỷ lời mời đã gửi
  save();
}
function removeFriend(id, otherId) {
  const [a, b] = pair(id, otherId);
  a.friends = drop(a.friends, b.id); b.friends = drop(b.friends, a.id);
  save();
}
function blockUser(id, otherId) {
  const [a, b] = pair(id, otherId);
  removeFriend(id, otherId);
  declineFriend(id, otherId);
  if (!a.blocked.includes(b.id)) a.blocked.push(b.id);
  save();
}
function unblockUser(id, otherId) {
  const acc = db.accounts[id];
  if (acc) { acc.blocked = drop(acc.blocked, otherId); save(); }
}
function socialOf(id) {
  const acc = db.accounts[id];
  if (!acc) return null;
  const mini = (ids) => ids.map((x) => db.accounts[x]).filter(Boolean).map(miniAccount);
  return { friends: mini(acc.friends), incoming: mini(acc.friendIn), outgoing: mini(acc.friendOut), blocked: mini(acc.blocked) };
}
function searchUsers(q, selfId) {
  q = String(q || '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return [];
  const self = db.accounts[selfId];
  return Object.values(db.accounts)
    .filter((a) => !a.banned && a.id !== selfId && (a.usernameLower.includes(q) || a.displayName.toLowerCase().includes(q) || a.playerNo === q))
    .filter((a) => !isBlocked(self, a))
    .sort((a, b) => (a.usernameLower === q ? -1 : 0) - (b.usernameLower === q ? -1 : 0) || b.lastSeen - a.lastSeen)
    .slice(0, 12)
    .map((a) => ({
      ...miniAccount(a),
      relation: !self ? 'none' : self.friends.includes(a.id) ? 'friend' : self.friendOut.includes(a.id) ? 'sent' : self.friendIn.includes(a.id) ? 'incoming' : 'none',
    }));
}

// ---------- Nhiệm vụ hằng ngày ----------
const MISSIONS = [
  { id: 'play2', name: 'Chơi 2 ván online', goal: 2, reward: 20, event: 'play_online' },
  { id: 'winRanked', name: 'Thắng 1 ván xếp hạng', goal: 1, reward: 30, event: 'win_ranked' },
  { id: 'puzzle1', name: 'Giải 1 thế cờ', goal: 1, reward: 15, event: 'solve_puzzle' },
  { id: 'aiWin', name: 'Thắng máy từ cấp 3 trở lên', goal: 1, reward: 15, event: 'win_ai3' },
  { id: 'coin1', name: 'Chơi 1 ván Tranh xu', goal: 1, reward: 10, event: 'play_coin' },
  { id: 'ai2', name: 'Luyện 2 ván đấu máy', goal: 2, reward: 10, event: 'play_ai' },
  { id: 'puzzle3', name: 'Giải 3 thế cờ', goal: 3, reward: 25, event: 'solve_puzzle' },
];
const vnDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
// 3 nhiệm vụ mỗi ngày (cố định theo ngày & tài khoản), luôn có 1 nhiệm vụ cờ thế/đấu máy để ai cũng làm được
function missionsOf(acc) {
  const day = vnDay();
  if (!acc.missions || acc.missions.day !== day) {
    const seed = parseInt(sha256(day + acc.id).slice(0, 8), 16);
    const solo = MISSIONS.filter((m) => /puzzle|ai/i.test(m.id)), rest = MISSIONS.filter((m) => !solo.includes(m));
    const pick = [solo[seed % solo.length], rest[seed % rest.length], rest[Math.floor(seed / 16) % rest.length]];
    const ids = [...new Set(pick.map((m) => m.id))];
    for (const m of MISSIONS) if (ids.length < 3 && !ids.includes(m.id)) ids.push(m.id);
    acc.missions = { day, list: ids.map((mid) => ({ id: mid, progress: 0, claimed: false })) };
  }
  return acc.missions.list.map((x) => {
    const m = MISSIONS.find((mm) => mm.id === x.id);
    return { ...m, progress: Math.min(x.progress, m.goal), done: x.progress >= m.goal, claimed: x.claimed };
  });
}
function progressMission(acc, event, n = 1) {
  missionsOf(acc);
  for (const x of acc.missions.list) {
    const m = MISSIONS.find((mm) => mm.id === x.id);
    if (m && m.event === event && !x.claimed) x.progress = Math.min(m.goal, x.progress + n);
  }
}
function claimMission(id, missionId) {
  const acc = db.accounts[id];
  if (!acc) throw new UserError('Không tìm thấy tài khoản.');
  missionsOf(acc);
  const x = acc.missions.list.find((m) => m.id === missionId);
  const m = MISSIONS.find((mm) => mm.id === missionId);
  if (!x || !m) throw new UserError('Không có nhiệm vụ này hôm nay.');
  if (x.claimed) throw new UserError('Bạn đã nhận thưởng nhiệm vụ này.');
  if (x.progress < m.goal) throw new UserError('Nhiệm vụ chưa hoàn thành.');
  x.claimed = true;
  acc.coins += m.reward;
  save();
  return m.reward;
}

// ---------- Huy hiệu (giải đấu...) ----------
function addBadge(id, badge) {
  const acc = db.accounts[id];
  if (!acc) return;
  acc.badges.unshift({ ...badge, at: Date.now() });
  if (acc.badges.length > 100) acc.badges.length = 100;
  save();
}

// ---------- Mùa giải: mỗi quý một mùa; Danh vọng = thắng 3, hoà 1 ở ván Xếp hạng / Tranh xu / Giải đấu ----------
function seasonInfo(t = Date.now()) {
  const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1).getTime();
  const end = new Date(d.getFullYear(), q * 3 + 3, 1).getTime();
  return { id: `${d.getFullYear()}-Q${q + 1}`, name: `Mùa ${q + 1}/${d.getFullYear()}`, start, end };
}
function seasonPoints() {
  const { start } = seasonInfo();
  const pts = new Map();
  for (const g of Object.values(db.games)) {
    if (g.endedAt < start - 7 * 3600 * 1000 || g.mode !== 'online' || !['ranked', 'coin', 'tournament'].includes(g.kind)) continue;
    for (const c of ['r', 'b']) {
      const accId = g.players[c].accountId;
      if (!accId) continue;
      const p = !g.result.winner ? 1 : g.result.winner === c ? 3 : 0;
      pts.set(accId, (pts.get(accId) || 0) + p);
    }
  }
  for (const acc of Object.values(db.accounts)) {
    for (const b of acc.badges) if (b.points && b.at >= start) pts.set(acc.id, (pts.get(acc.id) || 0) + b.points);
  }
  return pts;
}

// ---------- Tổng hợp hồ sơ: tỉ lệ thắng theo chế độ, nhịp hay chơi ----------
const KIND_LABEL = { ranked: 'Xếp hạng', match: 'Ghép trận', coin: 'Tranh xu', room: 'Phòng riêng', tournament: 'Giải đấu', ai: 'Đấu máy' };
function summaryOf(id) {
  const acc = db.accounts[id];
  if (!acc) return null;
  const byKind = {};
  const tcCount = new Map();
  for (const gid of acc.games) {
    const g = db.games[gid];
    if (!g) continue;
    const kind = g.kind || (g.mode === 'ai' ? 'ai' : 'room');
    const color = g.players.r.accountId === id ? 'r' : 'b';
    const k = byKind[kind] || (byKind[kind] = { kind, label: KIND_LABEL[kind] || kind, games: 0, wins: 0, draws: 0, losses: 0 });
    k.games++;
    if (!g.result.winner) k.draws++; else if (g.result.winner === color) k.wins++; else k.losses++;
    if (g.mode === 'online' && g.tc) {
      const key = g.tc.totalMs ? `${g.tc.totalMs / 60000}+${(g.tc.incMs || 0) / 1000}` : g.tc.moveMs ? `${g.tc.moveMs / 1000}s/nước` : 'Không giới hạn';
      tcCount.set(key, (tcCount.get(key) || 0) + 1);
    }
  }
  const fav = [...tcCount.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    byKind: Object.values(byKind).sort((a, b) => b.games - a.games),
    favoriteTc: fav ? { tc: fav[0], games: fav[1] } : null,
    peakRating: acc.peakRating, badges: acc.badges, equip: acc.equip, coinStats: acc.coinStats,
    puzzleLog: acc.puzzleLog.slice(0, 20), season: seasonInfo(), seasonPoints: seasonPoints().get(id) || 0,
  };
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
  init, hooks, UserError, isValidUid, setAvatar, clearAvatar, REGIONS, dailyBonus,
  addFeedback, listFeedback, removeFeedback, sessionsOf, MAX_CREDIT, markPuzzleSolved,
  register, login, get, list, touch, update, remove, publicAccount, miniAccount, checkPassword,
  createSession, resolveSession, destroySession, destroySessionsOf,
  recordGame, getGame, publicGame, gamesOf, gamesPlayed, countGuestGame, adminPassword, flush, save,
  spendCoins, addCoins, inventoryOf, buyItem, equipItems, markItemsSeen,
  notify, notificationsOf, markNotificationsRead,
  sendFriendRequest, acceptFriend, declineFriend, removeFriend, blockUser, unblockUser, socialOf, searchUsers, areFriends,
  isBlocked: (aId, bId) => isBlocked(db.accounts[aId], db.accounts[bId]),
  missionsOf: (id) => (db.accounts[id] ? missionsOf(db.accounts[id]) : []), claimMission,
  addBadge, seasonInfo, seasonPoints, summaryOf, KIND_LABEL,
};
