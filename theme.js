// Giao diện bàn cờ/quân cờ do quản trị viên chọn, lưu ở data/theme.json.
// Ảnh bàn cờ tải lên lưu ở data/uploads/ và được phục vụ tại /uploads/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BR = require('./public/board-render.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const THEME_FILE = path.join(DATA_DIR, 'theme.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// state = { current: { board, pieces }, boards: [ảnh bàn cờ đã tải lên] }
let state = { current: BR.DEFAULT_THEME, boards: [] };
try {
  const loaded = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
  state = { current: loaded.current || BR.DEFAULT_THEME, boards: loaded.boards || [] };
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Không đọc được giao diện bàn cờ:', err.message);
}

function save() {
  const tmp = THEME_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, THEME_FILE);
}

const isColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const increasing = (arr, n, max) => Array.isArray(arr) && arr.length === n && arr.every(isNum)
  && arr.every((v, i) => v >= 0 && v <= max && (i === 0 || v > arr[i - 1]));
const uploadPath = (src) => path.join(UPLOAD_DIR, path.basename(src));

// Kiểm tra & làm sạch cấu hình bàn cờ. Trả về null nếu không hợp lệ.
function cleanBoard(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'classic') return { type: 'classic', name: 'Cổ điển (vẽ)' };
  if (b.type !== 'image') return null;
  const builtin = BR.BUILTIN_BOARDS.find((x) => x.type === 'image' && x.src === b.src);
  const uploaded = typeof b.src === 'string' && /^\/uploads\/board-[a-f0-9]{16}\.(png|jpg|webp)$/.test(b.src) && fs.existsSync(uploadPath(b.src));
  if (!builtin && !uploaded) return null;
  const width = Math.round(b.width), height = Math.round(b.height);
  if (!(width > 50 && width <= 8000 && height > 50 && height <= 8000)) return null;
  if (!increasing(b.xs, 9, width) || !increasing(b.ys, 10, height)) return null;
  return {
    type: 'image',
    name: String(b.name || 'Bàn cờ').trim().slice(0, 40) || 'Bàn cờ',
    src: b.src, width, height,
    xs: b.xs.map((v) => Math.round(v * 10) / 10),
    ys: b.ys.map((v) => Math.round(v * 10) / 10),
    bg: isColor(b.bg) ? b.bg : '#e9c98f',
  };
}

function cleanPieces(p) {
  if (!p || typeof p !== 'object') return null;
  if (!BR.PIECE_STYLES[p.style] || !BR.FONTS[p.font] || !isColor(p.red) || !isColor(p.black)) return null;
  return { style: p.style, font: p.font, red: p.red, black: p.black };
}

function setCurrent({ board, pieces }) {
  const b = cleanBoard(board), p = cleanPieces(pieces);
  if (!b) throw new Error('Cấu hình bàn cờ không hợp lệ.');
  if (!p) throw new Error('Cấu hình quân cờ không hợp lệ.');
  state.current = { board: b, pieces: p };
  // Ảnh tải lên → lưu vào thư viện (cập nhật toạ độ nếu đã có)
  if (b.type === 'image' && b.src.startsWith('/uploads/')) {
    const i = state.boards.findIndex((x) => x.src === b.src);
    if (i >= 0) state.boards[i] = b; else state.boards.push(b);
  }
  save();
  return state.current;
}

function resetCurrent() {
  state.current = BR.DEFAULT_THEME;
  save();
  return state.current;
}

function removeBoard(src) {
  if (state.current.board.src === src) throw new Error('Không thể xoá bàn cờ đang được sử dụng.');
  const i = state.boards.findIndex((x) => x.src === src);
  if (i < 0) throw new Error('Không tìm thấy bàn cờ.');
  state.boards.splice(i, 1);
  save();
  fs.rm(uploadPath(src), () => {});
}

// Lưu ảnh tải lên (kiểm tra đúng định dạng PNG/JPEG/WebP theo chữ ký file)
function saveUpload(buf) {
  let ext = null;
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = 'webp';
  if (!ext) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
  const name = `board-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

module.exports = {
  UPLOAD_DIR,
  current: () => state.current,
  library: () => state.boards,
  setCurrent, resetCurrent, removeBoard, saveUpload,
};
