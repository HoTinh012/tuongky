// Lưu dữ liệu trên Supabase: bảng Postgres (tạo bằng supabase/schema.sql) + Storage cho ảnh.
// Server giữ dữ liệu trong bộ nhớ như trước; mỗi lần lưu chỉ ghi các dòng thay đổi (upsert) và xoá dòng đã bỏ.
// Dùng khoá service_role (chỉ đặt ở server, không bao giờ gửi cho trình duyệt).
const { createClient } = require('@supabase/supabase-js');

// Chấp nhận cả link có đuôi /rest/v1 (copy nhầm từ trang API)
const SB_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'tuongky';
const sb = createClient(SB_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PUBLIC_PREFIX = `${SB_URL}/storage/v1/object/public/${BUCKET}/`;

const T = {
  accounts: 'tk_accounts', sessions: 'tk_sessions', games: 'tk_games', feedback: 'tk_feedback',
  meta: 'tk_meta', puzzles: 'tk_puzzles', settings: 'tk_settings', tournaments: 'tk_tournaments',
};

// Các trường mở rộng của tài khoản lưu chung trong cột profile (jsonb)
const PROFILE_KEYS = ['friends', 'friendIn', 'friendOut', 'blocked', 'owned', 'equip', 'freshItems', 'notifications',
  'missions', 'coinStats', 'puzzleLog', 'badges', 'peakRating'];
// Các trường mở rộng của ván lưu trong cột extra (jsonb)
const GAME_EXTRA = ['kind', 'stake', 'tc', 'fee', 'tournament'];

// ---------- Chuyển đổi đối tượng trong bộ nhớ <-> dòng trong bảng ----------
const accToRow = (a) => ({
  id: a.id, username: a.username, username_lower: a.usernameLower, display_name: a.displayName,
  salt: a.salt, pass_hash: a.passHash, created_at: a.createdAt, last_seen: a.lastSeen ?? null, banned: !!a.banned,
  rating: a.rating, credit: a.credit, coins: a.coins, streak: a.streak, best_streak: a.bestStreak,
  region: a.region || '', last_bonus_day: a.lastBonusDay ?? null, avatar: a.avatar ?? null, player_no: a.playerNo ?? null,
  stats: a.stats, solved_puzzles: a.solvedPuzzles || [], games: a.games || [],
  profile: Object.fromEntries(PROFILE_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
});
const rowToAcc = (r) => ({
  id: r.id, username: r.username, usernameLower: r.username_lower, displayName: r.display_name,
  salt: r.salt, passHash: r.pass_hash, createdAt: Number(r.created_at), lastSeen: r.last_seen === null ? null : Number(r.last_seen),
  banned: r.banned, rating: r.rating, credit: r.credit, coins: r.coins, streak: r.streak, bestStreak: r.best_streak,
  region: r.region, lastBonusDay: r.last_bonus_day, avatar: r.avatar, playerNo: r.player_no,
  stats: r.stats, solvedPuzzles: r.solved_puzzles || [], games: r.games || [],
  ...(r.profile || {}),
});
const sessionToRow = ([tokenHash, s]) => ({ token_hash: tokenHash, account_id: s.accountId, expires: s.expires });
const gameToRow = (g) => ({
  id: g.id, mode: g.mode, level: g.level ?? null, started_at: g.startedAt ?? null, ended_at: g.endedAt,
  players: g.players, result: g.result, moves: g.moves, rating_change: g.ratingChange ?? null, coin_change: g.coinChange ?? null,
  extra: Object.fromEntries(GAME_EXTRA.filter((k) => g[k] !== undefined && g[k] !== null).map((k) => [k, g[k]])),
});
const rowToGame = (r) => {
  const g = {
    id: r.id, mode: r.mode, level: r.level, startedAt: r.started_at === null ? null : Number(r.started_at), endedAt: Number(r.ended_at),
    players: r.players, result: r.result, moves: r.moves,
  };
  if (r.rating_change) g.ratingChange = r.rating_change;
  if (r.coin_change) g.coinChange = r.coin_change;
  Object.assign(g, r.extra || {});
  return g;
};
const feedbackToRow = (f) => ({
  id: f.id, at: f.at, account_id: f.accountId ?? null, name: f.name, message: f.message, contact: f.contact || '',
  type: f.type || 'feedback', target: f.target || null,
});
const rowToFeedback = (r) => ({
  id: r.id, at: Number(r.at), accountId: r.account_id, name: r.name, message: r.message, contact: r.contact || '',
  type: r.type || 'feedback', target: r.target || null,
});
const puzzleToRow = (p) => ({
  id: p.id, title: p.title, description: p.description || '', difficulty: p.difficulty, topic: p.topic || 'mate', side: p.side, board: p.board,
  solution: p.solution, published: !!p.published, created_at: p.createdAt, updated_at: p.updatedAt, solved_by: p.solvedBy || 0,
});
const rowToPuzzle = (r) => ({
  id: r.id, title: r.title, description: r.description, difficulty: r.difficulty, topic: r.topic || 'mate', side: r.side, board: r.board,
  solution: r.solution, published: r.published, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), solvedBy: r.solved_by,
});

// ---------- Đọc / ghi bảng ----------
const fail = (what, error) => new Error(`Supabase (${what}): ${error.message}${error.hint ? ' — ' + error.hint : ''}`);

// Đọc hết bảng (PostgREST trả tối đa 1000 dòng mỗi lần)
async function selectAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw fail(`đọc ${table}`, error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Đồng bộ một bảng: nhớ nội dung đã ghi của từng dòng, lần sau chỉ upsert dòng đổi & xoá dòng không còn.
// immutable = dòng không bao giờ đổi sau khi tạo (ván đấu) → bỏ qua so sánh cho nhanh.
function tableSync(table, pk, { immutable = false } = {}) {
  const saved = new Map(); // khoá -> JSON đã ghi
  return {
    prime(rows) { saved.clear(); for (const r of rows) saved.set(r[pk], JSON.stringify(r)); },
    async push(rows) {
      const changed = [], seen = new Set(), next = new Map();
      for (const r of rows) {
        const k = r[pk];
        seen.add(k);
        if (immutable && saved.has(k)) continue;
        const json = JSON.stringify(r);
        if (saved.get(k) !== json) { changed.push(r); next.set(k, json); }
      }
      const removed = [...saved.keys()].filter((k) => !seen.has(k));
      for (let i = 0; i < changed.length; i += 500) {
        const chunk = changed.slice(i, i + 500);
        const { error } = await sb.from(table).upsert(chunk, { onConflict: pk });
        if (error) throw fail(`ghi ${table}`, error);
        for (const r of chunk) saved.set(r[pk], next.get(r[pk]));
      }
      for (let i = 0; i < removed.length; i += 200) {
        const chunk = removed.slice(i, i + 200);
        const { error } = await sb.from(table).delete().in(pk, chunk);
        if (error) throw fail(`xoá ${table}`, error);
        for (const k of chunk) saved.delete(k);
      }
      return changed.length + removed.length;
    },
  };
}

const sync = {
  accounts: tableSync(T.accounts, 'id'),
  sessions: tableSync(T.sessions, 'token_hash'),
  games: tableSync(T.games, 'id', { immutable: true }),
  feedback: tableSync(T.feedback, 'id'),
  meta: tableSync(T.meta, 'key'),
  puzzles: tableSync(T.puzzles, 'id'),
  settings: tableSync(T.settings, 'key'),
  tournaments: tableSync(T.tournaments, 'id'),
};

// Trạng thái đồng bộ (trang quản trị hiển thị)
const status = { lastSyncAt: null, lastError: null, lastErrorAt: null };

// Ghi tuần tự: đang ghi thì đánh dấu để ghi lại lần nữa khi xong; lỗi mạng thì thử lại sau 5 giây.
// Promise trả về không bao giờ bị reject (lỗi ghi vào status & log).
function serial(task) {
  let running = null, again = false, retry = null;
  const run = () => {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try {
          await task();
          status.lastSyncAt = Date.now();
          status.lastError = null;
        } catch (err) {
          console.error(err.message);
          status.lastError = err.message;
          status.lastErrorAt = Date.now();
          clearTimeout(retry);
          retry = setTimeout(run, 5000);
          break;
        }
      } while (again);
    })().finally(() => { running = null; });
    return running;
  };
  return run;
}

let usersDb = null, puzzleList = null, tournamentList = null;
// Mọi dòng của bảng settings ({ khoá: giá trị }): luôn ghi đủ, vì đồng bộ sẽ xoá các khoá không được gửi lên
let settingsState = null, settingsLoading = null;
const pushUsers = serial(async () => {
  const db = usersDb;
  await sync.accounts.push(Object.values(db.accounts).map(accToRow));
  await sync.sessions.push(Object.entries(db.sessions).map(sessionToRow));
  await sync.games.push(Object.values(db.games).map(gameToRow));
  await sync.feedback.push(db.feedback.map(feedbackToRow));
  await sync.meta.push([{ key: 'meta', value: db.meta }]);
});
const pushPuzzles = serial(() => sync.puzzles.push(puzzleList.map(puzzleToRow)));
const pushSettings = serial(() => sync.settings.push(Object.entries(settingsState).filter(([, v]) => v != null).map(([key, value]) => ({ key, value }))));
function loadSettings() {
  if (!settingsLoading) {
    settingsLoading = selectAll(T.settings).then((rows) => {
      sync.settings.prime(rows.map((r) => ({ key: r.key, value: r.value })));
      settingsState = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return settingsState;
    });
  }
  return settingsLoading;
}
const pushTournaments = serial(() => sync.tournaments.push(tournamentList.map((t) => ({ id: t.id, data: t, updated_at: t.updatedAt || Date.now() }))));

module.exports = {
  name: 'supabase',
  describe: () => `Supabase (${SB_URL.replace(/^https?:\/\//, '')})`,
  DIRS: null,
  PUBLIC_PREFIX,
  status: () => ({ ...status }),

  async loadUsers() {
    const [accounts, sessions, games, feedback, meta] = await Promise.all(
      [T.accounts, T.sessions, T.games, T.feedback, T.meta].map(selectAll));
    sync.accounts.prime(accounts.map((r) => accToRow(rowToAcc(r))));
    sync.sessions.prime(sessions.map((r) => sessionToRow([r.token_hash, { accountId: r.account_id, expires: Number(r.expires) }])));
    sync.games.prime(games.map((r) => gameToRow(rowToGame(r))));
    sync.feedback.prime(feedback.map((r) => feedbackToRow(rowToFeedback(r))));
    sync.meta.prime(meta.map((r) => ({ key: r.key, value: r.value })));
    const metaRow = meta.find((r) => r.key === 'meta');
    return {
      accounts: Object.fromEntries(accounts.map((r) => [r.id, rowToAcc(r)])),
      sessions: Object.fromEntries(sessions.map((r) => [r.token_hash, { accountId: r.account_id, expires: Number(r.expires) }])),
      games: Object.fromEntries(games.map((r) => [r.id, rowToGame(r)])),
      feedback: feedback.map(rowToFeedback).sort((a, b) => b.at - a.at),
      meta: metaRow ? metaRow.value : {},
    };
  },
  saveUsers(db) { usersDb = db; return pushUsers(); },

  async loadPuzzles() {
    const rows = await selectAll(T.puzzles);
    sync.puzzles.prime(rows.map((r) => puzzleToRow(rowToPuzzle(r))));
    // Bảng trống lần đầu → null để nạp bài mẫu
    return rows.length ? rows.map(rowToPuzzle) : null;
  },
  savePuzzles(list) { puzzleList = list; return pushPuzzles(); },

  async loadTheme() { return (await loadSettings()).theme || null; },
  saveTheme(state) { settingsState.theme = state; return pushSettings(); },
  // Cài đặt chế độ chơi (nhịp, xu) — trang quản trị
  async loadEconomy() { return (await loadSettings()).economy || null; },
  saveEconomy(value) { settingsState.economy = value; return pushSettings(); },

  async loadTournaments() {
    const rows = await selectAll(T.tournaments);
    sync.tournaments.prime(rows.map((r) => ({ id: r.id, data: r.data, updated_at: Number(r.updated_at) })));
    return rows.map((r) => r.data);
  },
  saveTournaments(list) { tournamentList = list; return pushTournaments(); },

  // Ảnh lưu trong bucket công khai: avatars/<tên>, uploads/<tên>
  async putFile(kind, name, buf, contentType) {
    const { error } = await sb.storage.from(BUCKET).upload(`${kind}/${name}`, buf, { contentType, upsert: true, cacheControl: '2592000' });
    if (error) throw fail(`tải ảnh lên bucket "${BUCKET}"`, error);
    return PUBLIC_PREFIX + `${kind}/${name}`;
  },
  removeFile(src) {
    src = String(src || '');
    if (!src.startsWith(PUBLIC_PREFIX)) return;
    sb.storage.from(BUCKET).remove([src.slice(PUBLIC_PREFIX.length)]).then(({ error }) => {
      if (error) console.error(`Supabase (xoá ảnh): ${error.message}`);
    });
  },
  isOwnUpload(src) {
    src = String(src || '');
    return src.startsWith(PUBLIC_PREFIX) && /^uploads\/board-[a-f0-9]{16}\.(png|jpg|webp)$/.test(src.slice(PUBLIC_PREFIX.length));
  },

  // Kiểm tra kết nối & bảng (dùng khi khởi động để báo lỗi dễ hiểu)
  async check() {
    if (!/^https?:\/\//.test(SB_URL)) throw new Error('SUPABASE_URL phải có dạng https://<mã-dự-án>.supabase.co');
    // Phải là khoá bí mật (service_role / sb_secret_...), không phải khoá công khai anon / publishable
    const wrongKey = 'SUPABASE_SERVICE_ROLE_KEY đang là khoá công khai (anon/publishable). Hãy dùng khoá service_role '
      + '(Project Settings → API Keys → Legacy API keys → service_role) hoặc Secret key (sb_secret_...).';
    if (/^sb_publishable_/.test(KEY)) throw new Error(wrongKey);
    if (/^eyJ/.test(KEY)) {
      let role = null;
      try { role = JSON.parse(Buffer.from(KEY.split('.')[1], 'base64url').toString()).role; } catch { /* không phải JWT */ }
      if (role && role !== 'service_role') throw new Error(wrongKey);
    }
    for (const t of Object.values(T)) {
      const { error, status: code } = await sb.from(t).select('*', { head: true, count: 'exact' }).limit(1);
      if (!error) continue;
      if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(error.message)) throw new Error(`Không kết nối được tới ${SB_URL} — kiểm tra SUPABASE_URL và mạng.`);
      if (code === 401 || code === 403) throw new Error('Supabase từ chối khoá — kiểm tra SUPABASE_SERVICE_ROLE_KEY (cần khoá service_role).');
      throw fail(`bảng ${t} — đã chạy supabase/schema.sql trong SQL Editor chưa?`, error);
    }
    // Cột mới thêm sau (bản cập nhật) — báo chạy lại schema.sql nếu thiếu
    for (const [t, col] of [[T.accounts, 'profile'], [T.games, 'extra'], [T.feedback, 'type'], [T.puzzles, 'topic']]) {
      const { error } = await sb.from(t).select(col).limit(1);
      if (error) throw new Error(`Bảng ${t} thiếu cột "${col}" — hãy chạy lại toàn bộ supabase/schema.sql trong SQL Editor (an toàn, không mất dữ liệu).`);
    }
  },
};
