// Cộng đồng (trang chủ): tường trò chuyện chung, có thể đính kèm thế cờ để mọi người mở ra phân tích.
// Ai cũng đọc được; gửi tin cần tài khoản. Lưu qua storage/ (data/community.json hoặc khoá 'community' trong settings).
const crypto = require('crypto');
const storage = require('./storage');

// Giới hạn do admin chỉnh (Cài đặt hệ thống → Cộng đồng & trò chuyện)
const CFG = require('./config-store.js').values;
const HISTORY = 60; // số tin gửi cho người mới mở trang
const FEN_RE = /^[rnbakcpRNBAKCP1-9]{1,9}(\/[rnbakcpRNBAKCP1-9]{1,9}){9} [wb]( - - \d+ \d+)?$/;
const MOVE_RE = /^[a-i]\d[a-i]\d$/;

class CommunityError extends Error {}

let messages = []; // cũ → mới
const lastPost = new Map(); // accountId -> thời điểm gửi gần nhất

async function init() {
  const saved = await storage.loadCommunity();
  if (Array.isArray(saved)) messages = saved.slice(-CFG.COMMUNITY_KEEP);
}

let saveTimer = null;
function save() {
  // Gom nhiều tin liên tiếp thành một lần ghi
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Promise.resolve(storage.saveCommunity(messages)).catch((err) => console.error('Không lưu được tin cộng đồng:', err.message));
  }, 1500);
}

// Thế cờ đính kèm: { fen, moves: ['h2e2', …], ply, title } — kiểm tra định dạng, không tin dữ liệu trình duyệt gửi lên
function cleanPosition(p) {
  if (!p) return null;
  const fen = String(p.fen || '');
  const moves = Array.isArray(p.moves) ? p.moves : [];
  if (!FEN_RE.test(fen) || moves.length > 300 || !moves.every((m) => typeof m === 'string' && MOVE_RE.test(m))) {
    throw new CommunityError('Thế cờ đính kèm không hợp lệ.');
  }
  const ply = Math.max(0, Math.min(moves.length, Number.isInteger(p.ply) ? p.ply : moves.length));
  return { fen, moves, ply, title: String(p.title || 'Thế cờ').trim().slice(0, 80) || 'Thế cờ' };
}

// acc = tài khoản người gửi (bắt buộc)
function post(acc, { text, position } = {}) {
  if (!acc) throw new CommunityError('Đăng nhập để gửi tin vào Cộng đồng.');
  if (acc.banned) throw new CommunityError('Tài khoản đang bị khoá.');
  const now = Date.now();
  if (now - (lastPost.get(acc.id) || 0) < CFG.COMMUNITY_GAP_SEC * 1000) throw new CommunityError('Bạn gửi nhanh quá — chờ vài giây nhé.');
  const body = String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, CFG.COMMUNITY_MAX_TEXT);
  const pos = cleanPosition(position);
  if (!body && !pos) throw new CommunityError('Tin nhắn trống.');
  lastPost.set(acc.id, now);
  const msg = {
    id: crypto.randomBytes(6).toString('hex'), at: now, text: body, position: pos,
    author: { id: acc.id, name: acc.displayName, username: acc.username, avatar: acc.avatar || null, rating: acc.rating },
  };
  messages.push(msg);
  if (messages.length > CFG.COMMUNITY_KEEP) messages = messages.slice(-CFG.COMMUNITY_KEEP);
  save();
  return msg;
}

// Người viết tự xoá tin của mình; admin xoá được mọi tin (accountId = null)
function remove(id, accountId = null) {
  const m = messages.find((x) => x.id === id);
  if (!m) return false;
  if (accountId && m.author.id !== accountId) throw new CommunityError('Bạn chỉ xoá được tin của mình.');
  messages = messages.filter((x) => x.id !== id);
  save();
  return true;
}

const history = (n = HISTORY) => messages.slice(-n);

module.exports = { init, post, remove, history, all: () => messages.slice().reverse(), CommunityError };
