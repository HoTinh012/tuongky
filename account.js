// API tài khoản cho người chơi: /api/account/*
const express = require('express');
const X = require('./public/xiangqi.js');

module.exports = function setupAccount(app, { users, onAccountChange }) {
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
  api.post('/avatar', auth, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }), (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new users.UserError('Không nhận được ảnh.');
      const acc = users.setAvatar(req.account.id, req.body);
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
      if (!['easy', 'medium', 'hard'].includes(level)) throw new users.UserError('Ván đấu không hợp lệ.');
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

      const levelName = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' }[level];
      const players = {
        [humanColor]: { name: req.account.displayName, accountId: req.account.id },
        [X.other(humanColor)]: { name: `Máy (${levelName})`, accountId: null },
      };
      const game = users.recordGame({ mode: 'ai', level, players, result, moves });
      res.json({ id: game.id, account: users.publicAccount(req.account) });
    } catch (err) { fail(res, err); }
  });

  // Góp ý (khách cũng gửi được; nếu đăng nhập thì ghi kèm tài khoản)
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
