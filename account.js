// API tài khoản cho người chơi: /api/account/*
const express = require('express');
const X = require('./public/xiangqi.js');

// Mức máy: 3 mức cũ (ván đã lưu trước đây) + 8 cấp độ của trang Đấu máy
const LEVEL_NAMES = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
for (let i = 1; i <= 9; i++) LEVEL_NAMES['l' + i] = 'Cấp ' + i;

module.exports = function setupAccount(app, { users, presenceOf, onAccountChange }) {
  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Giới hạn số lần đăng nhập/đăng ký theo IP
  const attempts = new Map();
  function limited(req, res, next) {
    const now = Date.now();
    const a = attempts.get(req.ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (a.resetAt < now) Object.assign(a, { count: 0, resetAt: now + 10 * 60 * 1000 });
    a.count++;
    attempts.set(req.ip, a);
    if (a.count > 20) return res.status(429).json({ error: 'Thử quá nhiều lần, vui lòng đợi 10 phút.' });
    next();
  }

  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  function auth(req, res, next) {
    const acc = users.resolveSession(bearer(req));
    if (!acc) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' });
    req.account = acc;
    next();
  }

  const fail = (res, err) => {
    if (err instanceof users.UserError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Có lỗi xảy ra.' });
  };

  api.post('/register', limited, (req, res) => {
    try {
      const { username, displayName, password } = req.body || {};
      const acc = users.register(username, displayName, password);
      res.json({ token: users.createSession(acc.id), account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });

  api.post('/login', limited, (req, res) => {
    try {
      const { username, password } = req.body || {};
      const acc = users.login(username, password);
      res.json({ token: users.createSession(acc.id), account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });

  api.post('/logout', (req, res) => {
    users.destroySession(bearer(req));
    res.json({ ok: true });
  });

  api.get('/me', auth, (req, res) => {
    users.touch(req.account.id);
    const dailyBonus = users.dailyBonus(req.account.id);
    res.json({ account: users.publicAccount(req.account), dailyBonus, regions: users.REGIONS });
  });

  api.patch('/me', auth, (req, res) => {
    try {
      const { displayName, currentPassword, newPassword, region } = req.body || {};
      const patch = {};
      if (displayName !== undefined) patch.displayName = displayName;
      if (region !== undefined) patch.region = String(region);
      if (newPassword !== undefined) {
        if (!users.checkPassword(req.account, currentPassword || '')) throw new users.UserError('Mật khẩu hiện tại không đúng.');
        patch.newPassword = newPassword;
      }
      const acc = users.update(req.account.id, patch);
      if (patch.displayName !== undefined) onAccountChange(acc);
      res.json({ account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });

  // Ảnh đại diện (trình duyệt đã cắt vuông & thu nhỏ trước khi gửi)
  api.post('/avatar', auth, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new users.UserError('Không nhận được ảnh.');
      const acc = await users.setAvatar(req.account.id, req.body);
      onAccountChange(acc);
      res.json({ account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });

  api.delete('/avatar', auth, (req, res) => {
    const acc = users.clearAvatar(req.account.id);
    onAccountChange(acc);
    res.json({ account: users.publicAccount(acc) });
  });

  api.get('/games', auth, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ games: users.gamesOf(req.account.id, limit) });
  });

  api.get('/games/:id', auth, (req, res) => {
    const g = users.getGame(req.params.id);
    if (!g || (g.players.r.accountId !== req.account.id && g.players.b.accountId !== req.account.id)) {
      return res.status(404).json({ error: 'Không tìm thấy ván đấu.' });
    }
    res.json({ game: g });
  });

  // Lưu ván đánh với máy. Server đi lại toàn bộ nước để kiểm tra hợp lệ & xác định kết quả.
  api.post('/ai-games', auth, (req, res) => {
    try {
      const { moves, humanColor, level, resigned } = req.body || {};
      if (!Array.isArray(moves) || !moves.length || moves.length > 1000) throw new users.UserError('Ván đấu không hợp lệ.');
      if (humanColor !== 'r' && humanColor !== 'b') throw new users.UserError('Ván đấu không hợp lệ.');
      if (!LEVEL_NAMES[level]) throw new users.UserError('Ván đấu không hợp lệ.');
      let board = X.initialBoard(), turn = 'r';
      for (const m of moves) {
        if (!m || !X.isLegalMove(board, turn, m.from, m.to)) throw new users.UserError('Ván đấu có nước đi không hợp lệ.');
        board = X.applyMove(board, m.from, m.to);
        turn = X.other(turn);
      }
      let result;
      if (!X.hasAnyLegalMove(board, turn)) result = { winner: X.other(turn), reason: X.isInCheck(board, turn) ? 'checkmate' : 'stalemate' };
      else if (resigned) result = { winner: X.other(humanColor), reason: 'resign' };
      else throw new users.UserError('Ván đấu chưa kết thúc.');

      const players = {
        [humanColor]: { name: req.account.displayName, accountId: req.account.id },
        [X.other(humanColor)]: { name: `Máy (${LEVEL_NAMES[level]})`, accountId: null },
      };
      // Đánh với máy: không lưu vào lịch sử đấu, chỉ cộng xu thưởng / thống kê / nhiệm vụ
      users.recordGame({ mode: 'ai', kind: 'ai', level, players, result, moves, store: false });
      res.json({ id: null, account: users.publicAccount(req.account) });
    } catch (err) { fail(res, err); }
  });

  // Góp ý (khách cũng gửi được; nếu đăng nhập thì ghi kèm tài khoản)
  // ---------- Tổng hợp hồ sơ ----------
  api.get('/summary', auth, (req, res) => res.json({ summary: users.summaryOf(req.account.id) }));

  // ---------- Cửa hàng & Túi đồ ----------
  api.get('/inventory', auth, (req, res) => res.json({ inventory: users.inventoryOf(req.account) }));
  api.post('/shop/buy', auth, (req, res) => {
    try {
      const acc = users.buyItem(req.account.id, String((req.body || {}).itemId || ''));
      res.json({ inventory: users.inventoryOf(acc), account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });
  api.post('/inventory/equip', auth, (req, res) => {
    try {
      const acc = users.equipItems(req.account.id, (req.body || {}).equip || {});
      res.json({ inventory: users.inventoryOf(acc), account: users.publicAccount(acc) });
    } catch (err) { fail(res, err); }
  });
  api.post('/inventory/seen', auth, (req, res) => {
    const acc = users.markItemsSeen(req.account.id);
    res.json({ inventory: users.inventoryOf(acc), account: users.publicAccount(acc) });
  });

  // ---------- Nhiệm vụ hằng ngày ----------
  api.get('/missions', auth, (req, res) => res.json({ missions: users.missionsOf(req.account.id) }));
  api.post('/missions/:id/claim', auth, (req, res) => {
    try {
      const coins = users.claimMission(req.account.id, String(req.params.id));
      res.json({ coins, missions: users.missionsOf(req.account.id), account: users.publicAccount(req.account) });
    } catch (err) { fail(res, err); }
  });

  // ---------- Thông báo ----------
  api.get('/notifications', auth, (req, res) => res.json({ notifications: users.notificationsOf(req.account.id) }));
  api.post('/notifications/read', auth, (req, res) => {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : null;
    users.markNotificationsRead(req.account.id, ids);
    res.json({ ok: true, account: users.publicAccount(req.account) });
  });

  // ---------- Bạn bè ----------
  const withPresence = (list) => list.map((a) => ({ ...a, ...(presenceOf ? presenceOf(a.id) : {}) }));
  function socialPayload(id) {
    const s = users.socialOf(id);
    // Hoạt động: kết quả gần đây của kỳ hữu
    const activity = [];
    for (const f of s.friends) {
      for (const g of users.gamesOf(f.id, 3)) activity.push({ friend: { id: f.id, displayName: f.displayName, avatar: f.avatar }, ...g });
    }
    activity.sort((a, b) => b.endedAt - a.endedAt);
    return { ...s, friends: withPresence(s.friends), activity: activity.slice(0, 15) };
  }
  api.get('/social', auth, (req, res) => res.json(socialPayload(req.account.id)));
  api.get('/social/search', auth, (req, res) => res.json({ results: withPresence(users.searchUsers(req.query.q, req.account.id)) }));
  const socialAction = (fn) => (req, res) => {
    try {
      fn(req.account.id, String((req.body || {}).userId || ''));
      res.json({ ...socialPayload(req.account.id), account: users.publicAccount(req.account) });
    } catch (err) { fail(res, err); }
  };
  api.post('/social/request', auth, socialAction(users.sendFriendRequest));
  api.post('/social/accept', auth, socialAction(users.acceptFriend));
  api.post('/social/decline', auth, socialAction(users.declineFriend));
  api.post('/social/remove', auth, socialAction(users.removeFriend));
  api.post('/social/block', auth, socialAction(users.blockUser));
  api.post('/social/unblock', auth, socialAction(users.unblockUser));
  // Báo cáo kỳ thủ (gửi về mục Góp ý của trang quản trị)
  api.post('/social/report', auth, (req, res) => {
    try {
      const { userId, reason } = req.body || {};
      const target = users.get(String(userId || ''));
      if (!target) throw new users.UserError('Không tìm thấy kỳ thủ.');
      users.addFeedback({
        accountId: req.account.id, name: `${req.account.displayName} (@${req.account.username})`, message: reason,
        type: 'report', target: { id: target.id, name: `${target.displayName} (@${target.username})` },
      });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });
  // Hồ sơ công khai ngắn của một kỳ thủ (bấm từ danh sách bạn bè / tìm kiếm)
  api.get('/players/:id', auth, (req, res) => {
    const acc = users.get(String(req.params.id));
    if (!acc || acc.banned) return res.status(404).json({ error: 'Không tìm thấy kỳ thủ.' });
    const mine = users.gamesOf(req.account.id, 1000).filter((g) => g.opponentId === acc.id);
    res.json({
      player: {
        ...users.miniAccount(acc), stats: acc.stats, bestStreak: acc.bestStreak, badges: acc.badges.slice(0, 6),
        ...(presenceOf ? presenceOf(acc.id) : {}),
        relation: req.account.friends.includes(acc.id) ? 'friend' : req.account.friendOut.includes(acc.id) ? 'sent'
          : req.account.friendIn.includes(acc.id) ? 'incoming' : req.account.blocked.includes(acc.id) ? 'blocked' : 'none',
      },
      headToHead: {
        games: mine.length, wins: mine.filter((g) => g.outcome === 'win').length,
        draws: mine.filter((g) => g.outcome === 'draw').length, losses: mine.filter((g) => g.outcome === 'loss').length,
        recent: mine.slice(0, 5),
      },
    });
  });

  api.post('/feedback', limited, (req, res) => {
    try {
      const acc = users.resolveSession(bearer(req));
      const { message, contact, name } = req.body || {};
      users.addFeedback({ accountId: acc && acc.id, name: acc ? `${acc.displayName} (@${acc.username})` : name, message, contact });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  app.use('/api/account', api);
};
