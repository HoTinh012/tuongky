// Engine cờ tướng: alpha-beta (PVS) + quiescence + bảng chuyển vị + null move.
// Chạy trong Web Worker trên trình duyệt; cũng require() được trong Node để kiểm thử.
'use strict';

const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
const CODE = { K, A, B, N, R, C, P };
const VAL = [0, 0, 200, 200, 400, 1000, 450, 100];
const MATE = 30000;
const INF = 32000;
const MAXPLY = 64;

const ROW = new Int8Array(90), COL = new Int8Array(90);
for (let i = 0; i < 90; i++) { ROW[i] = (i / 9) | 0; COL[i] = i % 9; }

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
// Vị trí mã có thể chiếu tướng: [dr, dc, chân mã dr, chân mã dc] tính từ tướng
const KNIGHT_ATT = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]
  .map(([dr, dc]) => (Math.abs(dr) === 2 ? [dr, dc, Math.sign(dr), dc] : [dr, dc, dr, Math.sign(dc)]));

// ---------- Bảng điểm vị trí (adv = số hàng đã tiến, 0 = hàng cuối nhà mình) ----------
function pstValue(t, adv, c) {
  const center = c >= 3 && c <= 5;
  switch (t) {
    case P:
      if (adv <= 4) return adv === 4 ? 10 : 0;
      if (adv === 9) return 40;
      return 70 + (center ? 25 : 0) + (adv >= 6 && adv <= 8 ? 20 : 0);
    case N:
      return -Math.abs(c - 4) * 6 - (c === 0 || c === 8 ? 12 : 0) + (adv >= 5 ? 20 : adv >= 2 ? 8 : 0) + (adv >= 6 && adv <= 8 && center ? 15 : 0);
    case R:
      return (adv >= 5 ? 25 : 0) + (adv === 0 && (c === 0 || c === 8) ? -15 : 0) + (c === 3 || c === 5 ? 8 : 0);
    case C:
      return (c === 4 ? 18 : 0) + (adv >= 5 && adv <= 7 ? 6 : 0);
    case K:
      return adv > 0 ? -8 * adv : 0;
    default:
      return 0;
  }
}
const PST_R = [], PST_B = [];
for (let t = 0; t <= 7; t++) {
  PST_R[t] = new Int16Array(90);
  PST_B[t] = new Int16Array(90);
  for (let s = 0; s < 90; s++) {
    PST_R[t][s] = t ? pstValue(t, 9 - ROW[s], COL[s]) : 0;
    PST_B[t][s] = t ? pstValue(t, ROW[s], COL[s]) : 0;
  }
}
const pieceScore = (p, s) => (p > 0 ? VAL[p] + PST_R[p][s] : -(VAL[-p] + PST_B[-p][s]));

// ---------- Zobrist hash (2 x 32 bit) ----------
let seed = 0x9e3779b9;
function rand32() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed | 0;
}
const Z1 = [], Z2 = [];
for (let p = 0; p < 15; p++) {
  Z1[p] = new Int32Array(90); Z2[p] = new Int32Array(90);
  for (let s = 0; s < 90; s++) { Z1[p][s] = rand32(); Z2[p][s] = rand32(); }
}
const ZSIDE1 = rand32(), ZSIDE2 = rand32();

// ---------- Trạng thái bàn cờ ----------
const board = new Int8Array(90);
let side = 1; // 1 = Đỏ, -1 = Đen
let hash1 = 0, hash2 = 0, score = 0;
const kingPos = [0, 0]; // [Đỏ, Đen]
const path = new Int32Array(MAXPLY + 512); // hash các thế cờ đã qua (để phát hiện lặp)
let pathLen = 0;

function load(strBoard, toMove, historyHashes = []) {
  hash1 = hash2 = score = 0;
  for (let s = 0; s < 90; s++) {
    const str = strBoard[ROW[s]][COL[s]];
    const p = str ? (str[0] === 'r' ? 1 : -1) * CODE[str[1]] : 0;
    board[s] = p;
    if (p) {
      hash1 ^= Z1[p + 7][s]; hash2 ^= Z2[p + 7][s];
      score += pieceScore(p, s);
      if (p === K) kingPos[0] = s;
      if (p === -K) kingPos[1] = s;
    }
  }
  side = toMove;
  if (side < 0) { hash1 ^= ZSIDE1; hash2 ^= ZSIDE2; }
  pathLen = 0;
  for (const h of historyHashes.slice(-200)) path[pathLen++] = h;
}

function make(m) {
  const from = m >> 7, to = m & 127;
  const p = board[from], cap = board[to];
  hash1 ^= Z1[p + 7][from] ^ Z1[p + 7][to]; hash2 ^= Z2[p + 7][from] ^ Z2[p + 7][to];
  score += pieceScore(p, to) - pieceScore(p, from);
  if (cap) {
    hash1 ^= Z1[cap + 7][to]; hash2 ^= Z2[cap + 7][to];
    score -= pieceScore(cap, to);
  }
  board[to] = p; board[from] = 0;
  if (p === K) kingPos[0] = to; else if (p === -K) kingPos[1] = to;
  side = -side; hash1 ^= ZSIDE1; hash2 ^= ZSIDE2;
  path[pathLen++] = hash1;
  return cap;
}

function unmake(m, cap) {
  const from = m >> 7, to = m & 127;
  pathLen--;
  side = -side; hash1 ^= ZSIDE1; hash2 ^= ZSIDE2;
  const p = board[to];
  board[from] = p; board[to] = cap;
  if (p === K) kingPos[0] = from; else if (p === -K) kingPos[1] = from;
  hash1 ^= Z1[p + 7][from] ^ Z1[p + 7][to]; hash2 ^= Z2[p + 7][from] ^ Z2[p + 7][to];
  score -= pieceScore(p, to) - pieceScore(p, from);
  if (cap) {
    hash1 ^= Z1[cap + 7][to]; hash2 ^= Z2[cap + 7][to];
    score += pieceScore(cap, to);
  }
}

// ---------- Sinh nước đi ----------
const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (sd, r, c) => c >= 3 && c <= 5 && (sd > 0 ? r >= 7 : r <= 2);

function genMoves(sd, out, capsOnly) {
  for (let s = 0; s < 90; s++) {
    const p = board[s];
    if (p * sd <= 0) continue;
    const r = ROW[s], c = COL[s];
    const add = (tr, tc) => {
      const t = tr * 9 + tc, q = board[t];
      if (q === 0) { if (!capsOnly) out.push((s << 7) | t); } else if (q * sd < 0) out.push((s << 7) | t);
    };
    switch (p * sd) {
      case K:
        for (const [dr, dc] of ORTH) if (inPalace(sd, r + dr, c + dc)) add(r + dr, c + dc);
        break;
      case A:
        for (const [dr, dc] of DIAG) if (inPalace(sd, r + dr, c + dc)) add(r + dr, c + dc);
        break;
      case B:
        for (const [dr, dc] of DIAG) {
          const tr = r + 2 * dr, tc = c + 2 * dc;
          if (inBoard(tr, tc) && (sd > 0 ? tr >= 5 : tr <= 4) && !board[(r + dr) * 9 + c + dc]) add(tr, tc);
        }
        break;
      case N:
        for (const [dr, dc] of ORTH) {
          const lr = r + dr, lc = c + dc;
          if (!inBoard(lr, lc) || board[lr * 9 + lc]) continue;
          if (dr) {
            if (inBoard(r + 2 * dr, c - 1)) add(r + 2 * dr, c - 1);
            if (inBoard(r + 2 * dr, c + 1)) add(r + 2 * dr, c + 1);
          } else {
            if (inBoard(r - 1, c + 2 * dc)) add(r - 1, c + 2 * dc);
            if (inBoard(r + 1, c + 2 * dc)) add(r + 1, c + 2 * dc);
          }
        }
        break;
      case R:
        for (const [dr, dc] of ORTH) {
          let tr = r + dr, tc = c + dc;
          while (inBoard(tr, tc)) {
            const q = board[tr * 9 + tc];
            if (q) { if (q * sd < 0) out.push((s << 7) | (tr * 9 + tc)); break; }
            if (!capsOnly) out.push((s << 7) | (tr * 9 + tc));
            tr += dr; tc += dc;
          }
        }
        break;
      case C:
        for (const [dr, dc] of ORTH) {
          let tr = r + dr, tc = c + dc;
          while (inBoard(tr, tc) && !board[tr * 9 + tc]) {
            if (!capsOnly) out.push((s << 7) | (tr * 9 + tc));
            tr += dr; tc += dc;
          }
          tr += dr; tc += dc;
          while (inBoard(tr, tc)) {
            const q = board[tr * 9 + tc];
            if (q) { if (q * sd < 0) out.push((s << 7) | (tr * 9 + tc)); break; }
            tr += dr; tc += dc;
          }
        }
        break;
      case P: {
        const f = sd > 0 ? -1 : 1;
        if (inBoard(r + f, c)) add(r + f, c);
        if (sd > 0 ? r <= 4 : r >= 5) {
          if (c > 0) add(r, c - 1);
          if (c < 8) add(r, c + 1);
        }
        break;
      }
    }
  }
  return out;
}

// Ô ks có bị bên `by` tấn công không (dùng để kiểm tra chiếu tướng)
function attacked(ks, by) {
  const kr = ROW[ks], kc = COL[ks];
  for (const [dr, dc] of ORTH) {
    let r = kr + dr, c = kc + dc, screen = false;
    while (inBoard(r, c)) {
      const q = board[r * 9 + c];
      if (q) {
        if (!screen) {
          if (q === by * R || (q === by * K && dc === 0)) return true;
          screen = true;
        } else {
          if (q === by * C) return true;
          break;
        }
      }
      r += dr; c += dc;
    }
  }
  for (const [dr, dc, lr, lc] of KNIGHT_ATT) {
    const r = kr + dr, c = kc + dc;
    if (inBoard(r, c) && board[r * 9 + c] === by * N && board[(kr + lr) * 9 + kc + lc] === 0) return true;
  }
  const f = by > 0 ? 1 : -1; // tốt Đỏ đứng dưới tướng Đen thì chiếu được
  if (inBoard(kr + f, kc) && board[(kr + f) * 9 + kc] === by * P) return true;
  if (kc > 0 && board[kr * 9 + kc - 1] === by * P) return true;
  if (kc < 8 && board[kr * 9 + kc + 1] === by * P) return true;
  return false;
}

const inCheck = (sd) => attacked(kingPos[sd > 0 ? 0 : 1], -sd);

// Các nước hợp lệ của bên đang đi
function legalMoves() {
  const out = [];
  const mover = side;
  for (const m of genMoves(side, [], false)) {
    const cap = make(m);
    if (!inCheck(mover)) out.push(m);
    unmake(m, cap);
  }
  return out;
}

// ---------- Tìm kiếm ----------
const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const ttH1 = new Int32Array(TT_SIZE), ttH2 = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE); // 1 exact, 2 lower, 3 upper
const killers = Array.from({ length: MAXPLY + 8 }, () => [0, 0]);
const historyTable = new Int32Array(90 * 128);

const STOP = {};
let nodes = 0, deadline = 0;

const toTT = (v, ply) => (v > MATE - 500 ? v + ply : v < -MATE + 500 ? v - ply : v);
const fromTT = (v, ply) => (v > MATE - 500 ? v - ply : v < -MATE + 500 ? v + ply : v);

function orderMoves(moves, best, ply) {
  const scores = new Int32Array(moves.length);
  const k = killers[ply];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i], cap = board[m & 127];
    if (m === best) scores[i] = 2e6;
    else if (cap) scores[i] = 1e6 + VAL[Math.abs(cap)] * 8 - VAL[Math.abs(board[m >> 7])] / 8;
    else if (m === k[0]) scores[i] = 9e5;
    else if (m === k[1]) scores[i] = 8e5;
    else scores[i] = historyTable[(m >> 7) * 128 + (m & 127)];
  }
  // Sắp xếp giảm dần theo điểm
  const idx = Array.from(moves.keys()).sort((a, b) => scores[b] - scores[a]);
  return idx.map((i) => moves[i]);
}

function isRepetition() {
  const h = path[pathLen - 1];
  for (let i = pathLen - 3; i >= 0 && i >= pathLen - 100; i -= 2) if (path[i] === h) return true;
  return false;
}

function hasPieces(sd) {
  for (let s = 0; s < 90; s++) {
    const t = board[s] * sd;
    if (t === R || t === C || t === N) return true;
  }
  return false;
}

function quiesce(alpha, beta, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw STOP;
  const stand = side * score;
  if (stand >= beta || ply >= MAXPLY) return stand;
  if (stand > alpha) alpha = stand;
  const mover = side;
  for (const m of orderMoves(genMoves(side, [], true), 0, ply)) {
    const cap = make(m);
    if (inCheck(mover)) { unmake(m, cap); continue; }
    const v = -quiesce(-beta, -alpha, ply + 1);
    unmake(m, cap);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function search(depth, alpha, beta, ply, allowNull) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw STOP;
  if (ply >= MAXPLY) return side * score;
  if (ply > 0 && isRepetition()) return 0;

  const mover = side;
  const checked = inCheck(mover);
  if (checked) depth++; // kéo dài khi bị chiếu
  if (depth <= 0) return quiesce(alpha, beta, ply);

  const ti = hash1 & TT_MASK;
  let best = 0;
  if (ttH1[ti] === hash1 && ttH2[ti] === hash2) {
    best = ttMove[ti];
    if (ttDepth[ti] >= depth && ply > 0) {
      const v = fromTT(ttScore[ti], ply), f = ttFlag[ti];
      if (f === 1) return v;
      if (f === 2 && v > alpha) alpha = v;
      else if (f === 3 && v < beta) beta = v;
      if (alpha >= beta) return v;
    }
  }

  // Null move: bỏ một lượt, nếu vẫn tốt hơn beta thì cắt tỉa
  if (allowNull && !checked && depth >= 3 && ply > 0 && beta < MATE - 500 && hasPieces(mover)) {
    side = -side; hash1 ^= ZSIDE1; hash2 ^= ZSIDE2; path[pathLen++] = hash1;
    let v;
    try { v = -search(depth - 3, -beta, -beta + 1, ply + 1, false); }
    finally { pathLen--; side = -side; hash1 ^= ZSIDE1; hash2 ^= ZSIDE2; }
    if (v >= beta) return beta;
  }

  const alpha0 = alpha;
  let bestScore = -INF, bestMove = 0, legal = 0;
  for (const m of orderMoves(genMoves(side, [], false), best, ply)) {
    const cap = make(m);
    if (inCheck(mover)) { unmake(m, cap); continue; }
    legal++;
    let v;
    try {
      if (legal === 1) v = -search(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        v = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (v > alpha && v < beta) v = -search(depth - 1, -beta, -alpha, ply + 1, true);
      }
    } finally {
      unmake(m, cap);
    }
    if (v > bestScore) {
      bestScore = v;
      bestMove = m;
      if (v > alpha) {
        alpha = v;
        if (alpha >= beta) {
          if (!cap) {
            const k = killers[ply];
            if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
            historyTable[(m >> 7) * 128 + (m & 127)] += depth * depth;
          }
          break;
        }
      }
    }
  }
  if (!legal) return -MATE + ply; // hết nước đi = thua

  ttH1[ti] = hash1; ttH2[ti] = hash2; ttMove[ti] = bestMove; ttDepth[ti] = depth;
  ttScore[ti] = toTT(bestScore, ply);
  ttFlag[ti] = bestScore <= alpha0 ? 3 : bestScore >= beta ? 2 : 1;
  return bestScore;
}

const LEVELS = {
  easy: { maxDepth: 2, timeMs: 400, noise: 150 },
  medium: { maxDepth: 4, timeMs: 1200, noise: 25 },
  hard: { maxDepth: 30, timeMs: 3000, noise: 0 },
  // 8 cấp độ của trang Đấu máy (cấp 2 ≈ Dễ, cấp 4 ≈ Vừa, cấp 7 ≈ Khó)
  l1: { maxDepth: 1, timeMs: 250, noise: 320 },
  l2: { maxDepth: 2, timeMs: 400, noise: 150 },
  l3: { maxDepth: 3, timeMs: 700, noise: 70 },
  l4: { maxDepth: 4, timeMs: 1200, noise: 25 },
  l5: { maxDepth: 6, timeMs: 1600, noise: 10 },
  l6: { maxDepth: 8, timeMs: 2200, noise: 0 },
  l7: { maxDepth: 30, timeMs: 3000, noise: 0 },
  l8: { maxDepth: 30, timeMs: 5000, noise: 0 },
};

function prepare() {
  nodes = 0;
  historyTable.fill(0);
  for (const k of killers) { k[0] = k[1] = 0; }
}

// Tìm kiếm sâu dần ở gốc. Trả về { best, bestScore, depth } hoặc null nếu hết nước đi.
function rootSearch(cfg, start) {
  let rootMoves = legalMoves();
  if (!rootMoves.length) return null;
  const noise = new Map(rootMoves.map((m) => [m, cfg.noise ? Math.round((Math.random() * 2 - 1) * cfg.noise) : 0]));
  let best = rootMoves[0], bestScore = -INF, doneDepth = 0;

  for (let d = 1; d <= cfg.maxDepth; d++) {
    let alpha = -INF, iterBest = 0, iterScore = -INF;
    try {
      for (const m of rootMoves) {
        const cap = make(m);
        let v;
        try {
          if (cfg.noise || iterBest === 0) v = -search(d - 1, -INF, INF, 1, true);
          else {
            v = -search(d - 1, -alpha - 1, -alpha, 1, true);
            if (v > alpha) v = -search(d - 1, -INF, -alpha, 1, true);
          }
        } finally {
          unmake(m, cap);
        }
        v += noise.get(m);
        if (v > iterScore) { iterScore = v; iterBest = m; }
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== STOP) throw e;
      break; // hết giờ: dùng kết quả của độ sâu trước
    }
    best = iterBest; bestScore = iterScore; doneDepth = d;
    rootMoves = [best, ...rootMoves.filter((m) => m !== best)];
    if (Math.abs(bestScore) > MATE - 500) break; // đã tìm thấy chiếu bí
    if (Date.now() - start > cfg.timeMs * 0.45) break; // không đủ thời gian cho độ sâu tiếp theo
  }
  return { best, bestScore, depth: doneDepth };
}

const decode = (m) => ({ from: [ROW[m >> 7], COL[m >> 7]], to: [ROW[m & 127], COL[m & 127]] });
const encode = (mv) => ((mv.from[0] * 9 + mv.from[1]) << 7) | (mv.to[0] * 9 + mv.to[1]);

// Trả về nước đi tốt nhất { from: [r, c], to: [r, c], score, depth, nodes }
function bestMove(strBoard, toMove, level = 'medium', historyHashes = []) {
  const cfg = LEVELS[level] || LEVELS.medium;
  load(strBoard, toMove, historyHashes);
  prepare();
  const start = Date.now();
  deadline = start + cfg.timeMs;
  const r = rootSearch(cfg, start);
  if (!r) return null;
  return { ...decode(r.best), score: r.bestScore, depth: r.depth, nodes };
}

// Phân tích một thế cờ: nước tốt nhất và điểm của nước đã đi (theo góc nhìn bên đang đi).
const ANALYZE_CFG = { maxDepth: 6, timeMs: 350, noise: 0 };
function analyze(strBoard, toMove, played, historyHashes = [], cfg = ANALYZE_CFG) {
  load(strBoard, toMove, historyHashes);
  prepare();
  const start = Date.now();
  deadline = start + cfg.timeMs;
  const r = rootSearch(cfg, start);
  if (!r) return { best: null, bestScore: -MATE, playedScore: null, depth: 0 }; // hết nước đi = thua
  let playedScore = null;
  if (played) {
    const pm = encode(played);
    if (pm === r.best) playedScore = r.bestScore;
    // Tính riêng nước đã đi ở cùng độ sâu (giảm dần nếu hết giờ)
    for (let d = r.depth; d >= 1 && playedScore === null; d--) {
      deadline = Date.now() + cfg.timeMs;
      const cap = make(pm);
      try { playedScore = -search(d - 1, -INF, INF, 1, true); } catch (e) { if (e !== STOP) throw e; } finally { unmake(pm, cap); }
    }
  }
  return { best: decode(r.best), bestScore: r.bestScore, playedScore, depth: r.depth };
}

// Hash các thế cờ đã qua của ván (để máy tránh đi lặp lại)
function historyHashes(strBoards) {
  return strBoards.map((b, i) => { load(b, i % 2 === 0 ? 1 : -1); return hash1; });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { bestMove, analyze, historyHashes, load, legalMoves, make, unmake, LEVELS, MATE };
} else if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.onmessage = (e) => {
    const { type, id, board: b, side: sd, level, boards, played } = e.data;
    const hashes = historyHashes(boards || []);
    if (type === 'analyze') {
      self.postMessage({ id, result: analyze(b, sd === 'r' ? 1 : -1, played, hashes) });
    } else {
      self.postMessage({ id, move: bestMove(b, sd === 'r' ? 1 : -1, level, hashes) });
    }
  };
}
