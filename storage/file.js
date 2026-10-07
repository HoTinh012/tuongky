// Lưu dữ liệu bằng file JSON trong thư mục data/ (mặc định, khi chưa cấu hình Supabase).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIRS = { avatars: path.join(DATA_DIR, 'avatars'), uploads: path.join(DATA_DIR, 'uploads') };
for (const d of [DATA_DIR, ...Object.values(DIRS)]) fs.mkdirSync(d, { recursive: true });

const FILES = { users: 'db.json', puzzles: 'puzzles.json', theme: 'theme.json', tournaments: 'tournaments.json' };
const file = (name) => path.join(DATA_DIR, FILES[name]);

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Không đọc được ${FILES[name]}:`, err.message);
    return null;
  }
}

// Ghi đè an toàn: ghi file tạm rồi đổi tên
function writeJson(name, value, pretty) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0));
  fs.renameSync(tmp, file(name));
}

module.exports = {
  name: 'file',
  describe: () => `file JSON trong ${DATA_DIR}`,
  DIRS,
  status: () => ({ lastSyncAt: null, lastError: null }),

  async loadUsers() { return readJson('users'); },
  async saveUsers(db) {
    try { writeJson('users', db); } catch (err) { console.error('Không lưu được dữ liệu:', err.message); }
  },
  async loadPuzzles() { return readJson('puzzles'); },
  async savePuzzles(list) { writeJson('puzzles', list, true); },
  async loadTheme() { return readJson('theme'); },
  async saveTheme(state) { writeJson('theme', state, true); },
  async loadTournaments() { return readJson('tournaments') || []; },
  async saveTournaments(list) { writeJson('tournaments', list); },

  // Ảnh đại diện / ảnh bàn cờ: kind = 'avatars' | 'uploads'. Trả về đường dẫn công khai.
  async putFile(kind, name, buf) {
    fs.writeFileSync(path.join(DIRS[kind], name), buf);
    return `/${kind}/${name}`;
  },
  removeFile(src) {
    const m = /^\/(avatars|uploads)\/([\w.-]+)$/.exec(String(src || ''));
    if (m) fs.rm(path.join(DIRS[m[1]], m[2]), () => {});
  },
  // Ảnh bàn cờ do quản trị viên tải lên (đúng định dạng tên & còn tồn tại)
  isOwnUpload(src) {
    const m = /^\/uploads\/(board-[a-f0-9]{16}\.(png|jpg|webp))$/.exec(String(src || ''));
    return !!m && fs.existsSync(path.join(DIRS.uploads, m[1]));
  },
};
