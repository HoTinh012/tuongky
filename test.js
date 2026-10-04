// Kiểm tra bộ sinh nước đi bằng perft (số nước đi hợp lệ đã biết của thế cờ ban đầu).
const X = require('./public/xiangqi.js');

function perft(b, side, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = b[r][c];
    if (!p || p[0] !== side) continue;
    for (const to of X.legalMovesFrom(b, r, c)) n += perft(X.applyMove(b, [r, c], to), X.other(side), depth - 1);
  }
  return n;
}

const expected = [44, 1920, 79666];
let ok = true;
expected.forEach((want, i) => {
  const got = perft(X.initialBoard(), 'r', i + 1);
  console.log(`perft(${i + 1}) = ${got} ${got === want ? '✓' : `✗ (mong đợi ${want})`}`);
  if (got !== want) ok = false;
});
// Chiếu bí bằng hai xe (có kết hợp luật lộ mặt tướng)
const b = Array.from({ length: 10 }, () => Array(9).fill(null));
b[0][4] = 'bK'; b[0][0] = 'rR'; b[1][8] = 'rR'; b[9][3] = 'rK';
const mate = X.isInCheck(b, 'b') && !X.hasAnyLegalMove(b, 'b');
console.log(`chiếu bí hai xe: ${mate ? '✓' : '✗'}`);
if (!mate) ok = false;

// Không được đi nước làm lộ mặt tướng
const f = Array.from({ length: 10 }, () => Array(9).fill(null));
f[0][4] = 'bK'; f[5][4] = 'bP'; f[9][4] = 'rK';
const flying = !X.isLegalMove(f, 'b', [5, 4], [5, 3]) && X.isLegalMove(f, 'b', [5, 4], [6, 4]);
console.log(`luật lộ mặt tướng: ${flying ? '✓' : '✗'}`);
if (!flying) ok = false;

// Ký hiệu nước đi
const { notes } = X.replay([
  { from: [7, 7], to: [7, 4] }, // Đỏ: pháo 2 bình 5
  { from: [0, 7], to: [2, 6] }, // Đen: mã 8 tiến 7
  { from: [9, 7], to: [7, 6] }, // Đỏ: mã 2 tiến 3
  { from: [0, 8], to: [1, 8] }, // Đen: xe 9 tiến 1
  { from: [9, 0], to: [8, 0] }, // Đỏ: xe 9 tiến 1
]);
const want = ['P2-5', 'M8.7', 'M2.3', 'X9.1', 'X9.1'];
const notesOk = JSON.stringify(notes) === JSON.stringify(want);
console.log(`ký hiệu nước đi: ${notesOk ? '✓' : '✗ ' + notes.join(' ')}`);
if (!notesOk) ok = false;

// Engine chơi với máy: sinh nước đi phải khớp bộ luật, và tìm được nước chiếu bí
const E = require('./public/engine.js');
function perftE(d) { if (!d) return 1; let n = 0; for (const m of E.legalMoves()) { const c = E.make(m); n += perftE(d - 1); E.unmake(m, c); } return n; }
E.load(X.initialBoard(), 1);
const ep = perftE(3);
console.log(`engine perft(3) = ${ep} ${ep === 79666 ? '✓' : '✗'}`);
if (ep !== 79666) ok = false;
const m1 = Array.from({ length: 10 }, () => Array(9).fill(null));
m1[0][4] = 'bK'; m1[9][3] = 'rK'; m1[1][0] = 'rR'; m1[5][8] = 'rR';
const mv = E.bestMove(m1, 1, 'medium');
const after = X.applyMove(m1, mv.from, mv.to);
const found = X.isInCheck(after, 'b') && !X.hasAnyLegalMove(after, 'b');
console.log(`engine tìm nước chiếu bí: ${found ? '✓' : '✗'}`);
if (!found) ok = false;

// Kiểm tra thế cờ bày (bài tập)
const vp = [
  ['thế ban đầu', X.validatePosition(X.initialBoard(), 'r') === null],
  ['thiếu tướng', (() => { const b = X.initialBoard(); b[0][4] = null; return /tướng/.test(X.validatePosition(b, 'r')); })()],
  ['sĩ sai chỗ', (() => { const b = X.initialBoard(); b[9][3] = null; b[8][3] = 'rA'; return /Sĩ/.test(X.validatePosition(b, 'r')); })()],
  ['tượng sai chỗ', (() => { const b = X.initialBoard(); b[9][2] = null; b[8][2] = 'rB'; return /Tượng/.test(X.validatePosition(b, 'r')); })()],
  ['tốt lùi sai', (() => { const b = X.initialBoard(); b[6][0] = null; b[8][0] = 'rP'; return /Tốt/.test(X.validatePosition(b, 'r')); })()],
  ['bên không đi bị chiếu', (() => { const b = Array.from({ length: 10 }, () => Array(9).fill(null)); b[0][4] = 'bK'; b[9][3] = 'rK'; b[5][4] = 'rR'; return /bị chiếu/.test(X.validatePosition(b, 'r')) && X.validatePosition(b, 'b') === null; })()],
];
for (const [name, pass] of vp) { console.log(`validatePosition – ${name}: ${pass ? '✓' : '✗'}`); if (!pass) ok = false; }

process.exit(ok ? 0 : 1);
