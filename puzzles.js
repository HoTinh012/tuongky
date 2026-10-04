// Bài tập (giải thế cờ) — lưu ở data/puzzles.json. Lần chạy đầu nạp bài mẫu từ puzzles-seed.json.
// puzzle = { id, title, description, difficulty: 'easy'|'medium'|'hard', side: 'r'|'b', board, solution: [{from,to}],
//            published, createdAt, updatedAt, solvedBy: số tài khoản đã giải }
// Lời giải gồm các nước xen kẽ: nước của người giải, nước đáp trả của đối phương, ... (kết thúc bằng nước của người giải).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./public/xiangqi.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'puzzles.json');
const DIFFICULTIES = ['easy', 'medium', 'hard'];

class PuzzleError extends Error {}
fs.mkdirSync(DATA_DIR, { recursive: true });

let puzzles = [];
try {
  puzzles = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Không đọc được bài tập:', err.message);
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzles-seed.json'), 'utf8'));
    const now = Date.now();
    puzzles = seed.map((p, i) => ({ ...p, id: newId(), published: true, createdAt: now + i, updatedAt: now + i, solvedBy: 0 }));
    save();
  } catch { puzzles = []; }
}

function newId() { return crypto.randomBytes(5).toString('hex'); }

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(puzzles, null, 1));
  fs.renameSync(tmp, FILE);
}

// Kiểm tra & làm sạch dữ liệu bài tập do quản trị viên gửi lên
function clean(input) {
  const title = String(input.title || '').trim().slice(0, 80);
  if (title.length < 2) throw new PuzzleError('Tiêu đề quá ngắn.');
  const description = String(input.description || '').trim().slice(0, 500);
  const difficulty = DIFFICULTIES.includes(input.difficulty) ? input.difficulty : 'easy';
  const side = input.side === 'b' ? 'b' : 'r';
  const board = input.board;
  const err = X.validatePosition(board, side);
  if (err) throw new PuzzleError('Thế cờ không hợp lệ: ' + err);
  const solution = Array.isArray(input.solution) ? input.solution : [];
  if (!solution.length) throw new PuzzleError('Chưa ghi lời giải.');
  if (solution.length % 2 === 0) throw new PuzzleError('Lời giải phải kết thúc bằng nước đi của người giải (số nước lẻ).');
  if (solution.length > 31) throw new PuzzleError('Lời giải quá dài.');
  let b = board, turn = side;
  for (const m of solution) {
    if (!m || !X.isLegalMove(b, turn, m.from, m.to)) throw new PuzzleError('Lời giải có nước đi không hợp lệ.');
    b = X.applyMove(b, m.from, m.to);
    turn = X.other(turn);
  }
  return {
    title, description, difficulty, side,
    board: board.map((row) => row.map((p) => p || null)),
    solution: solution.map((m) => ({ from: [m.from[0], m.from[1]], to: [m.to[0], m.to[1]] })),
    published: input.published !== false,
  };
}

const sameMove = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];

// Kiểm tra các nước người chơi đã đi có giải đúng bài không:
// đúng từng nước theo lời giải, riêng nước cuối thì nước nào chiếu bí cũng được.
function checkSolution(p, moves) {
  if (!Array.isArray(moves) || moves.length !== p.solution.length) return false;
  let b = p.board, turn = p.side;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m || !X.isLegalMove(b, turn, m.from, m.to)) return false;
    const last = i === moves.length - 1;
    const nb = X.applyMove(b, m.from, m.to);
    if (!sameMove(m, p.solution[i])) {
      const mate = last && X.isInCheck(nb, X.other(turn)) && !X.hasAnyLegalMove(nb, X.other(turn));
      if (!mate) return false;
    }
    b = nb;
    turn = X.other(turn);
  }
  return true;
}

const list = ({ all = false } = {}) => puzzles.filter((p) => all || p.published).sort((a, b) => a.createdAt - b.createdAt);
const get = (id) => puzzles.find((p) => p.id === id) || null;

function create(input) {
  const now = Date.now();
  const p = { id: newId(), ...clean(input), createdAt: now, updatedAt: now, solvedBy: 0 };
  puzzles.push(p);
  save();
  return p;
}

function update(id, input) {
  const p = get(id);
  if (!p) throw new PuzzleError('Không tìm thấy bài tập.');
  Object.assign(p, clean({ ...p, ...input }), { updatedAt: Date.now() });
  save();
  return p;
}

function setPublished(id, published) {
  const p = get(id);
  if (!p) throw new PuzzleError('Không tìm thấy bài tập.');
  p.published = !!published;
  p.updatedAt = Date.now();
  save();
  return p;
}

function remove(id) {
  const i = puzzles.findIndex((p) => p.id === id);
  if (i < 0) return false;
  puzzles.splice(i, 1);
  save();
  return true;
}

function countSolve(id) {
  const p = get(id);
  if (p) { p.solvedBy++; save(); }
}

module.exports = { PuzzleError, DIFFICULTIES, list, get, create, update, setPublished, remove, checkSolution, countSolve };
