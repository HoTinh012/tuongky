// Engine mạnh cho Đấu máy / Gợi ý / Phân tích — cùng giao thức tin nhắn với engine.js:
//   vào  { id, board, side, level, boards }            → ra { id, move: { from, to, score, depth } | null }
//   vào  { type: 'analyze', id, board, side, played, boards } → ra { id, result: { best, bestScore, playedScore, depth } }
//   vào  { type: 'lines', id, board, side, boards }   → ra { id, result: { depth, engine, lines: [{ move, score, pv: [move…] }] } | null }
// Chọn engine:
//   - Cấp 1–8: Fairy-Stockfish (WebAssembly, chạy trên máy người chơi, giới hạn Elo theo cấp)
//   - Cấp "Vô đối", gợi ý, phân tích: Pikafish trên server (mạnh nhất), không có thì Fairy-Stockfish hết sức
//   - Trình duyệt không chạy được WebAssembly đa luồng → Pikafish server; không có server → engine.js cũ
// Fairy-Stockfish và Pikafish dùng giấy phép GPL-3.0:
//   https://github.com/fairy-stockfish/fairy-stockfish.wasm · https://github.com/official-pikafish/Pikafish
'use strict';

const FSF_DIR = '/vendor/fairy-stockfish/';
const MATE = 30000;
const LEVELS = {
  l1: { elo: 800, ms: 300 }, l2: { elo: 1000, ms: 400 }, l3: { elo: 1200, ms: 500 }, l4: { elo: 1400, ms: 700 },
  l5: { elo: 1600, ms: 900 }, l6: { elo: 1800, ms: 1200 }, l7: { elo: 2000, ms: 1600 }, l8: { elo: 2200, ms: 2000 },
  easy: { elo: 1000, ms: 400 }, medium: { elo: 1400, ms: 700 }, hard: { elo: 2000, ms: 1600 },
};

// ---------- Chuyển đổi bàn cờ ↔ FEN / nước đi UCI ----------
// board[r][c]: hàng 0 là hàng cuối của Đen, 'rK' = Tướng đỏ. FEN Đỏ viết hoa, cùng ký hiệu K A B N R C P.
function toFen(b, side) {
  const rows = b.map((row) => {
    let s = '', empty = 0;
    for (const p of row) {
      if (!p) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += p[0] === 'r' ? p[1] : p[1].toLowerCase();
    }
    return s + (empty || '');
  });
  return `${rows.join('/')} ${side === 'r' ? 'w' : 'b'} - - 0 1`;
}
// Pikafish đánh số hàng 0–9, Fairy-Stockfish 1–10 (tính từ phía Đỏ)
const toUci = (m, base) => `${String.fromCharCode(97 + m.from[1])}${9 - m.from[0] + base}${String.fromCharCode(97 + m.to[1])}${9 - m.to[0] + base}`;
function fromUci(s, base) {
  const m = /^([a-i])(\d+)([a-i])(\d+)/.exec(s || '');
  if (!m) return null;
  return { from: [9 - (m[2] - base), m[1].charCodeAt(0) - 97], to: [9 - (m[4] - base), m[3].charCodeAt(0) - 97] };
}
const sameBoard = (a, b) => a.every((row, r) => row.every((p, c) => p === b[r][c]));
// Nước đi giữa hai thế cờ liên tiếp: ô bị bỏ trống là ô đi, ô nhận quân đó là ô đến
function diffMove(a, b) {
  let from = null, to = null;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (a[r][c] === b[r][c]) continue;
      if (a[r][c] && !b[r][c]) from = [r, c]; else to = [r, c];
    }
  }
  return from && to ? { from, to } : null;
}
// Thế cờ gốc + chuỗi nước đi (để engine biết lịch sử, tránh lặp nước)
function position(board, side, boards, base) {
  let list = Array.isArray(boards) && boards.length && sameBoard(boards[boards.length - 1], board) ? boards : [board];
  const moves = [];
  for (let i = 1; i < list.length; i++) {
    const m = diffMove(list[i - 1], list[i]);
    if (!m) { list = [board]; moves.length = 0; break; }
    moves.push(toUci(m, base));
  }
  const startSide = (list.length - 1) % 2 === 0 ? side : (side === 'r' ? 'b' : 'r');
  return { fen: toFen(list[0], startSide), moves: moves.slice(-300) };
}

function parseInfo(line) {
  const m = /^info .*\bdepth (\d+).*\bscore (cp|mate) (-?\d+).*\bpv (.+)$/.exec(line);
  if (!m) return null;
  const v = Number(m[3]);
  const mpv = /\bmultipv (\d+)/.exec(line);
  return {
    depth: Number(m[1]), multipv: mpv ? Number(mpv[1]) : 1, pv: m[4].trim().split(/\s+/).slice(0, 12),
    score: m[2] === 'cp' ? v : (v > 0 ? MATE - v * 2 + 1 : -MATE - v * 2),
  };
}

// ---------- Fairy-Stockfish (WebAssembly) ----------
let fsfPromise = null;
function fairy() {
  if (fsfPromise) return fsfPromise;
  fsfPromise = (async () => {
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined' || typeof WebAssembly !== 'object') throw new Error('no-sab');
    importScripts(FSF_DIR + 'stockfish.js');
    const sf = await self.Stockfish({ locateFile: (f) => FSF_DIR + f, mainScriptUrlOrBlob: FSF_DIR + 'stockfish.js' });
    const eng = { sf, listener: null };
    sf.addMessageListener((line) => { if (eng.listener) eng.listener(line); });
    const threads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 2) - 1));
    await fsfRun(eng, ['uci', 'setoption name UCI_Variant value xiangqi', `setoption name Threads value ${threads}`,
      'setoption name Hash value 32', 'isready'], (l) => l === 'readyok');
    return eng;
  })();
  fsfPromise.catch(() => {});
  return fsfPromise;
}

function fsfRun(eng, cmds, done) {
  return new Promise((resolve) => {
    const lines = [];
    eng.listener = (l) => { lines.push(l); if (done(l)) { eng.listener = null; resolve(lines); } };
    for (const c of cmds) eng.sf.postMessage(c);
  });
}

async function fsfSearch(pos, { ms, depth, elo, searchmoves, multipv = 1 }) {
  const eng = await fairy();
  const go = ['go'];
  if (depth) go.push('depth', depth);
  go.push('movetime', ms);
  if (searchmoves) go.push('searchmoves', ...searchmoves);
  const out = await fsfRun(eng, [
    `setoption name UCI_LimitStrength value ${elo ? 'true' : 'false'}`,
    `setoption name MultiPV value ${multipv}`,
    ...(elo ? [`setoption name UCI_Elo value ${elo}`] : []),
    `position fen ${pos.fen}${pos.moves.length ? ' moves ' + pos.moves.join(' ') : ''}`,
    go.join(' '),
  ], (l) => l.startsWith('bestmove'));
  const lines = [];
  for (const l of out) {
    const info = parseInfo(l);
    if (info) lines[info.multipv - 1] = { move: info.pv[0], score: info.score, depth: info.depth, pv: info.pv };
  }
  const best = out[out.length - 1].split(/\s+/)[1];
  if (!best || best === '(none)') return { best: null, score: -MATE, depth: 0, lines: [] };
  const top = lines[0] || { score: 0, depth: 0 };
  return { best, score: top.score, depth: top.depth, lines: lines.filter(Boolean) };
}

// ---------- Pikafish trên server ----------
let serverOk = null;
async function serverAvailable() {
  if (serverOk === null) {
    try { serverOk = !!(await (await fetch('/api/engine')).json()).available; } catch { serverOk = false; }
  }
  return serverOk;
}
async function serverCall(body) {
  const res = await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('server-engine ' + res.status);
  return res.json();
}

// ---------- Engine cũ (dự phòng cuối) ----------
let legacy = null, legacyId = 0;
const legacyWait = new Map();
function legacyCall(msg) {
  if (!legacy) {
    legacy = new Worker('engine.js');
    legacy.onmessage = (e) => { const f = legacyWait.get(e.data.id); if (f) { legacyWait.delete(e.data.id); f(e.data); } };
  }
  const id = ++legacyId;
  return new Promise((resolve) => { legacyWait.set(id, resolve); legacy.postMessage({ ...msg, id }); });
}

// ---------- Xử lý yêu cầu ----------
const strongLevel = (level) => level === 'l9' || level === 'hint';

async function bestMove(msg) {
  const { board, side, level, boards } = msg;
  const cfg = LEVELS[level];
  // Cấp thường: Fairy-Stockfish giới hạn Elo
  if (cfg) {
    try {
      const r = await fsfSearch(position(board, side, boards, 1), { ms: cfg.ms, elo: cfg.elo });
      return r.best ? { ...fromUci(r.best, 1), score: r.score, depth: r.depth, engine: 'fairy' } : null;
    } catch { /* thử server */ }
  }
  if (await serverAvailable()) {
    try {
      const r = await serverCall({ mode: level === 'hint' ? 'hint' : 'move', level, ...position(board, side, boards, 0) });
      return r.best ? { ...fromUci(r.best, 0), score: r.score, depth: r.depth, engine: 'pikafish' } : null;
    } catch { /* thử engine khác */ }
  }
  if (strongLevel(level)) {
    try {
      const r = await fsfSearch(position(board, side, boards, 1), { ms: level === 'hint' ? 1000 : 3000 });
      return r.best ? { ...fromUci(r.best, 1), score: r.score, depth: r.depth, engine: 'fairy' } : null;
    } catch { /* dùng engine cũ */ }
  }
  const old = await legacyCall({ board, side, level: cfg ? level : (level === 'hint' ? 'l5' : 'l8'), boards });
  return old.move;
}

async function analyze(msg) {
  const { board, side, played, boards } = msg;
  if (await serverAvailable()) {
    try {
      const pos = position(board, side, boards, 0);
      const r = await serverCall({ mode: 'analyze', ...pos, played: played ? toUci(played, 0) : null });
      return { best: r.best ? fromUci(r.best, 0) : null, bestScore: r.bestScore, playedScore: r.playedScore, depth: r.depth };
    } catch { /* thử Fairy-Stockfish */ }
  }
  try {
    const pos = position(board, side, boards, 1);
    const r = await fsfSearch(pos, { ms: 500, depth: 14 });
    let playedScore = null;
    if (played && r.best) {
      const pm = toUci(played, 1);
      if (pm === r.best) playedScore = r.score;
      else {
        const q = await fsfSearch(pos, { ms: 500, depth: Math.max(1, r.depth), searchmoves: [pm] });
        if (q.best === pm) playedScore = q.score;
      }
    }
    return { best: r.best ? fromUci(r.best, 1) : null, bestScore: r.score, playedScore, depth: r.depth };
  } catch { /* dùng engine cũ */ }
  return (await legacyCall({ type: 'analyze', board, side, played, boards })).result;
}

// Ba nước tốt nhất + điểm + diễn biến (Pikafish trên server, không có thì Fairy-Stockfish hết sức)
async function lines(msg) {
  const { board, side, boards } = msg;
  const conv = (r, base, engine) => ({
    depth: r.depth, engine,
    lines: r.lines.map((l) => ({ move: fromUci(l.move, base), score: l.score, pv: l.pv.map((m) => fromUci(m, base)).filter(Boolean) })),
  });
  if (await serverAvailable()) {
    try { return conv(await serverCall({ mode: 'lines', ...position(board, side, boards, 0) }), 0, 'pikafish'); } catch { /* thử Fairy-Stockfish */ }
  }
  try { return conv(await fsfSearch(position(board, side, boards, 1), { ms: 1200, multipv: 3 }), 1, 'fairy'); } catch { return null; }
}

// Các phương án có thể đến từ hai lượt tính khác độ sâu → bỏ phương án trùng nước đầu (giữ cái xếp trên)
const uniqueLines = (lines) => lines.filter(Boolean).filter((l, i, a) => a.findIndex((x) => x && x.move === l.move) === i);
// Phân tích liên tục bằng Fairy-Stockfish (tab "Phân tích"): { type: 'stream', id, fen, moves (toạ độ Pikafish), multipv, movetime }
// → nhiều tin { id, info } rồi { id, done }. { type: 'stop' } dừng ngay.
let streamId = 0;
async function stream(msg) {
  const id = msg.id;
  streamId = id;
  try {
    const eng = await fairy();
    while (eng.listener) { eng.sf.postMessage('stop'); await new Promise((r) => setTimeout(r, 30)); } // chờ lượt cũ dừng hẳn
    if (streamId !== id) return;
    // Toạ độ Pikafish (hàng 0–9) → Fairy-Stockfish (hàng 1–10)
    const up = (m) => m.replace(/(\d)/g, (d) => String(Number(d) + 1));
    const down = (m) => m.replace(/\d+/g, (d) => String(Number(d) - 1));
    const snap = { depth: 0, seldepth: 0, nodes: 0, nps: 0, time: 0, lines: [] };
    let sentAt = 0, sentDepth = 0;
    const out = await fsfRunStream(eng, [
      'setoption name UCI_LimitStrength value false', `setoption name MultiPV value ${msg.multipv || 1}`,
      `position fen ${msg.fen}${msg.moves.length ? ' moves ' + msg.moves.map(up).join(' ') : ''}`,
      `go movetime ${msg.movetime || 30000}`,
    ], (line) => {
      const info = parseInfo(line);
      if (!info || streamId !== id) return;
      const num = (k) => { const m = new RegExp(`\\b${k} (\\d+)`).exec(line); return m ? Number(m[1]) : 0; };
      if (info.multipv === 1) Object.assign(snap, { depth: info.depth, seldepth: num('seldepth'), nodes: num('nodes'), nps: num('nps'), time: num('time') });
      snap.lines[info.multipv - 1] = { move: down(info.pv[0]), score: info.score, depth: info.depth, pv: info.pv.map(down) };
      const now = Date.now();
      if (now - sentAt > 250 || snap.depth !== sentDepth) {
        sentAt = now; sentDepth = snap.depth;
        self.postMessage({ id, info: { ...snap, lines: uniqueLines(snap.lines) } });
      }
    });
    if (streamId === id) {
      self.postMessage({ id, info: { ...snap, lines: uniqueLines(snap.lines) } });
      const best = out[out.length - 1].split(/\s+/)[1];
      self.postMessage({ id, done: { best: best && best !== '(none)' ? down(best) : null } });
    }
  } catch (err) {
    self.postMessage({ id, error: 'Trình duyệt này không chạy được Fairy-Stockfish' });
  }
}
function fsfRunStream(eng, cmds, onLine) {
  return new Promise((resolve) => {
    const lines = [];
    eng.listener = (l) => { lines.push(l); onLine(l); if (l.startsWith('bestmove')) { eng.listener = null; resolve(lines); } };
    for (const c of cmds) eng.sf.postMessage(c);
  });
}

// Mỗi lúc chỉ chạy một yêu cầu (engine dùng chung)
let chain = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'stream') { stream(msg); return; }
  if (msg.type === 'stop') { streamId = 0; fsfPromise && fsfPromise.then((eng) => eng.sf.postMessage('stop'), () => {}); return; }
  chain = chain.then(async () => {
    try {
      if (msg.type === 'analyze') self.postMessage({ id: msg.id, result: await analyze(msg) });
      else if (msg.type === 'lines') self.postMessage({ id: msg.id, result: await lines(msg) });
      else self.postMessage({ id: msg.id, move: await bestMove(msg) });
    } catch (err) {
      if (msg.type === 'lines') self.postMessage({ id: msg.id, result: null });
      else self.postMessage(msg.type === 'analyze' ? { id: msg.id, result: { best: null, bestScore: 0, playedScore: null, depth: 0 } } : { id: msg.id, move: null });
    }
  });
};
