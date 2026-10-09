// Engine Pikafish chạy trên server (giao thức UCI), dùng cho cấp "Vô đối", gợi ý, phân tích ván
// và làm dự phòng khi trình duyệt không chạy được Fairy-Stockfish.
// Cài engine: npm run setup:engine  (tải về engines/pikafish/). Không có engine → API trả 503, web tự dùng engine cũ.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = process.env.PIKAFISH_DIR || path.join(__dirname, 'engines', 'pikafish');
const EXE = path.join(DIR, process.platform === 'win32' ? 'pikafish.exe' : 'pikafish');
// Số tiến trình chạy song song (mỗi tiến trình 1 luồng) và giới hạn hàng chờ
const POOL = Math.max(1, Number(process.env.PIKAFISH_POOL) || Math.min(4, Math.floor(os.cpus().length / 2)));
const HASH_MB = Number(process.env.PIKAFISH_HASH_MB) || 64;
const MAX_QUEUE = 64;
const JOB_TIMEOUT_MS = 15000;

const available = () => fs.existsSync(EXE) && fs.existsSync(path.join(DIR, 'pikafish.nnue'));

class UciProcess {
  constructor() {
    this.proc = spawn(EXE, [], { cwd: DIR, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.buf = '';
    this.listener = null;
    this.dead = false;
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (this.listener) this.listener(line);
      }
    });
    this.proc.on('exit', () => { this.dead = true; if (this.listener) this.listener(null); });
    this.proc.stdin.on('error', () => { this.dead = true; });
    this.ready = this.until(['uci', `setoption name Hash value ${HASH_MB}`, 'setoption name Threads value 1', 'isready'], (l) => l === 'readyok');
  }

  send(cmd) { if (!this.dead) this.proc.stdin.write(cmd + '\n'); }

  // Gửi lệnh rồi đọc từng dòng cho tới khi done(line) đúng; trả về mọi dòng đã đọc (onLine: nhận từng dòng ngay khi có)
  until(cmds, done, timeoutMs = JOB_TIMEOUT_MS, onLine = null) {
    return new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(() => { this.send('stop'); }, timeoutMs);
      const hard = setTimeout(() => { this.listener = null; this.kill(); reject(new Error('Engine không phản hồi')); }, timeoutMs + 3000);
      this.listener = (line) => {
        if (line === null) { clearTimeout(timer); clearTimeout(hard); this.listener = null; reject(new Error('Engine đã thoát')); return; }
        lines.push(line);
        if (onLine) onLine(line);
        if (done(line)) { clearTimeout(timer); clearTimeout(hard); this.listener = null; resolve(lines); }
      };
      for (const c of cmds) this.send(c);
    });
  }

  kill() { this.dead = true; try { this.proc.kill(); } catch { /* đã thoát */ } }
}

// ---------- Hàng chờ + nhóm tiến trình ----------
const idle = [];
let total = 0;
const queue = [];

function acquire() {
  while (idle.length) {
    const p = idle.pop();
    if (!p.dead) return Promise.resolve(p);
    total--;
  }
  if (total < POOL) { total++; const p = new UciProcess(); return p.ready.then(() => p, (e) => { total--; throw e; }); }
  if (queue.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error('Máy chủ engine đang bận'), { busy: true }));
  return new Promise((resolve, reject) => queue.push({ resolve, reject }));
}

function release(p) {
  if (p.dead) {
    total--;
    const next = queue.shift();
    if (next) acquire().then(next.resolve, next.reject); // thay tiến trình hỏng bằng tiến trình mới
    return;
  }
  const next = queue.shift();
  if (next) next.resolve(p); else idle.push(p);
}

async function withEngine(fn) {
  const p = await acquire();
  try { return await fn(p); } finally { release(p); }
}

// ---------- Phân tích một lần tìm kiếm ----------
const MATE = 30000;
function parseInfo(line) {
  const m = /^info .*\bdepth (\d+).*\bmultipv (\d+).*\bscore (cp|mate) (-?\d+)(?: (?:upper|lower)bound)?.*\bpv (.+)$/.exec(line);
  if (!m) return null;
  const v = Number(m[4]);
  const score = m[3] === 'cp' ? v : (v > 0 ? MATE - v * 2 + 1 : -MATE - v * 2); // giống thang điểm engine cũ (MATE - ply)
  const pv = m[5].trim().split(/\s+/);
  return { depth: Number(m[1]), multipv: Number(m[2]), score, move: pv[0], pv };
}

// go: { movetime?, depth?, nodes? }; trả về { best, score, depth, lines: [{move, score, depth, pv}] theo multipv }
async function search(p, fen, moves, go, { multipv = 1, searchmoves = null } = {}) {
  p.send('ucinewgame');
  p.send(`setoption name MultiPV value ${multipv}`);
  p.send(`position fen ${fen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
  const parts = ['go'];
  if (go.depth) parts.push('depth', go.depth);
  if (go.nodes) parts.push('nodes', go.nodes);
  if (go.movetime) parts.push('movetime', go.movetime);
  if (searchmoves) parts.push('searchmoves', ...searchmoves);
  const out = await p.until([parts.join(' ')], (l) => l.startsWith('bestmove'), (go.movetime || 5000) + 3000);
  const lines = [];
  let depth = 0;
  for (const l of out) {
    const info = parseInfo(l);
    if (!info) continue;
    if (info.multipv === 1) depth = info.depth;
    lines[info.multipv - 1] = { move: info.move, score: info.score, depth: info.depth, pv: info.pv.slice(0, 12) };
  }
  const best = out[out.length - 1].split(/\s+/)[1];
  if (!best || best === '(none)') return { best: null, score: -MATE, depth: 0, lines: [] }; // hết nước đi = thua
  return { best, score: lines[0] ? lines[0].score : 0, depth, lines: lines.filter(Boolean) };
}

// ---------- Kiểm tra đầu vào ----------
const FEN_RE = /^[rnbakcpRNBAKCP1-9]{1,9}(\/[rnbakcpRNBAKCP1-9]{1,9}){9} [wb]( - - \d+ \d+)?$/;
const MOVE_RE = /^[a-i]\d[a-i]\d$/;
function validPosition(fen, moves) {
  return typeof fen === 'string' && FEN_RE.test(fen) && Array.isArray(moves) && moves.length <= 600 && moves.every((m) => typeof m === 'string' && MOVE_RE.test(m));
}

// Cấp độ khi đánh bằng Pikafish (chỉ dùng khi trình duyệt không chạy được Fairy-Stockfish):
// giới hạn độ sâu + chọn ngẫu nhiên giữa vài nước tốt nhất cho giống người.
const WEAK = {
  l1: { depth: 1, noise: 320 }, l2: { depth: 2, noise: 180 }, l3: { depth: 3, noise: 110 }, l4: { depth: 4, noise: 60 },
  l5: { depth: 6, noise: 30 }, l6: { depth: 8, noise: 15 }, l7: { depth: 11, noise: 5 }, l8: { depth: 14, noise: 0 },
};

// Các phương án có thể đến từ hai lượt tính khác độ sâu → bỏ phương án trùng nước đầu (giữ cái xếp trên)
const uniqueLines = (lines) => lines.filter(Boolean).filter((l, i, a) => a.findIndex((x) => x && x.move === l.move) === i);
// Phân tích liên tục cho tab "Phân tích": gửi dần kết quả (mỗi dòng một JSON) tới khi hết giờ hoặc trình duyệt huỷ.
const STREAM_MAX_MS = 60000;
async function streamSearch(p, fen, moves, { multipv, movetime }, emit, isClosed) {
  p.send('ucinewgame');
  p.send(`setoption name MultiPV value ${multipv}`);
  p.send(`position fen ${fen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
  const snap = { depth: 0, seldepth: 0, nodes: 0, nps: 0, time: 0, lines: [] };
  let sentAt = 0, sentDepth = 0;
  const flush = (force) => {
    const now = Date.now();
    if (!force && now - sentAt < 250 && snap.depth === sentDepth) return;
    sentAt = now; sentDepth = snap.depth;
    emit({ type: 'info', ...snap, lines: uniqueLines(snap.lines) });
  };
  const closeCheck = setInterval(() => { if (isClosed()) p.send('stop'); }, 100);
  try {
    const out = await p.until([`go movetime ${movetime}`], (l) => l.startsWith('bestmove'), movetime + 2000, (line) => {
      const info = parseInfo(line);
      if (!info) return;
      const num = (k) => { const m = new RegExp(`\\b${k} (\\d+)`).exec(line); return m ? Number(m[1]) : 0; };
      if (info.multipv === 1) Object.assign(snap, { depth: info.depth, seldepth: num('seldepth'), nodes: num('nodes'), nps: num('nps'), time: num('time') });
      snap.lines[info.multipv - 1] = { move: info.move, score: info.score, depth: info.depth, pv: info.pv.slice(0, 16) };
      flush(false);
    });
    flush(true);
    const best = out[out.length - 1].split(/\s+/)[1];
    emit({ type: 'done', best: best && best !== '(none)' ? best : null });
  } finally {
    clearInterval(closeCheck);
  }
}

function setup(app, express) {
  app.get('/api/engine', (req, res) => res.json({ available: available(), pool: POOL }));

  app.post('/api/engine/stream', express.json({ limit: '20kb' }), async (req, res) => {
    if (!available()) return res.status(503).json({ error: 'Chưa cài Pikafish (npm run setup:engine)' });
    const { fen, moves = [], multipv = 3, movetime = 30000 } = req.body || {};
    if (!validPosition(fen, moves)) return res.status(400).json({ error: 'Thế cờ không hợp lệ' });
    let closed = false;
    res.on('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    try {
      await withEngine((p) => {
        if (closed) return null;
        return streamSearch(p, fen, moves, {
          multipv: Math.max(1, Math.min(128, Number(multipv) || 1)), // 128 = mọi nước hợp lệ
          movetime: Math.max(500, Math.min(STREAM_MAX_MS, Number(movetime) || 30000)),
        }, (obj) => { if (!closed) res.write(JSON.stringify(obj) + '\n'); }, () => closed);
      });
    } catch (err) {
      if (!closed) res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    }
    res.end();
  });

  app.post('/api/engine', express.json({ limit: '20kb' }), async (req, res) => {
    if (!available()) return res.status(503).json({ error: 'Chưa cài Pikafish (npm run setup:engine)' });
    const { mode, fen, moves = [], level, played } = req.body || {};
    if (!validPosition(fen, moves)) return res.status(400).json({ error: 'Thế cờ không hợp lệ' });
    try {
      const result = await withEngine(async (p) => {
        if (mode === 'analyze') {
          // Nước tốt nhất + điểm của nước đã đi, cùng độ sâu
          const r = await search(p, fen, moves, { depth: 14, movetime: 1500 });
          let playedScore = null;
          if (played && MOVE_RE.test(played)) {
            if (played === r.best) playedScore = r.score;
            else {
              const q = await search(p, fen, moves, { depth: Math.max(1, r.depth), movetime: 1500 }, { searchmoves: [played] });
              if (q.best === played) playedScore = q.score;
            }
          }
          return { best: r.best, bestScore: r.score, playedScore, depth: r.depth };
        }
        if (mode === 'hint') return search(p, fen, moves, { movetime: 1000 });
        // Các nước tốt nhất kèm điểm và diễn biến tiếp theo (mục "Máy phân tích" khi đấu máy)
        if (mode === 'lines') return search(p, fen, moves, { depth: 20, movetime: 1200 }, { multipv: 3 });
        // mode 'move'
        const weak = WEAK[level];
        if (!weak) return search(p, fen, moves, { movetime: 3000 }); // Vô đối
        const r = await search(p, fen, moves, { depth: weak.depth, movetime: 2000 }, { multipv: weak.noise ? 4 : 1 });
        if (weak.noise && r.lines.length > 1) {
          let pick = r.lines[0], top = -Infinity;
          for (const l of r.lines) {
            const v = l.score + Math.random() * weak.noise;
            if (l.score > r.lines[0].score - weak.noise * 2 && v > top) { top = v; pick = l; }
          }
          return { ...r, best: pick.move, score: pick.score };
        }
        return r;
      });
      res.json(result);
    } catch (err) {
      res.status(err.busy ? 503 : 500).json({ error: err.message });
    }
  });
}

module.exports = { setup, available, withEngine, search };
