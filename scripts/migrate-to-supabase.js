// Chuyển dữ liệu đang lưu file (data/db.json, puzzles.json, theme.json + ảnh trong data/) lên Supabase.
// Cách dùng:  1) chạy supabase/schema.sql   2) điền .env   3) npm run migrate:supabase
// Mặc định dừng lại nếu Supabase đã có tài khoản; thêm --force để ghi đè/gộp.
const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* không có .env */ }

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (đặt trong file .env).');
  process.exit(1);
}
const file = require('../storage/file');
const sb = require('../storage/supabase');
const force = process.argv.includes('--force');

// Tải ảnh trên máy (/avatars/x, /uploads/x) lên bucket, trả về link mới
async function moveImage(src) {
  const m = /^\/(avatars|uploads)\/([\w.-]+)$/.exec(String(src || ''));
  if (!m) return src;
  const local = path.join(file.DIRS[m[1]], m[2]);
  if (!fs.existsSync(local)) { console.warn('  ! Không tìm thấy ảnh', local); return null; }
  const ext = path.extname(m[2]).slice(1);
  return sb.putFile(m[1], m[2], fs.readFileSync(local), ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
}

(async () => {
  await sb.check();
  const remote = await sb.loadUsers();
  await sb.loadPuzzles();
  await sb.loadTheme();
  if (Object.keys(remote.accounts).length && !force) {
    console.error(`Supabase đã có ${Object.keys(remote.accounts).length} tài khoản — thêm --force nếu vẫn muốn gộp dữ liệu từ file.`);
    process.exit(1);
  }

  const db = await file.loadUsers();
  if (db) {
    const accounts = Object.values(db.accounts || {});
    console.log(`Tài khoản: ${accounts.length}, ván: ${Object.keys(db.games || {}).length}, góp ý: ${(db.feedback || []).length}`);
    for (const acc of accounts) if (acc.avatar) acc.avatar = await moveImage(acc.avatar);
    const merged = {
      accounts: { ...remote.accounts, ...db.accounts }, sessions: { ...remote.sessions, ...db.sessions },
      games: { ...remote.games, ...db.games }, feedback: [...(db.feedback || []), ...remote.feedback],
      meta: { ...remote.meta, ...db.meta },
    };
    await sb.saveUsers(merged);
  } else console.log('Không có data/db.json — bỏ qua tài khoản.');

  const puzzles = await file.loadPuzzles();
  if (puzzles) { console.log(`Cờ thế: ${puzzles.length}`); await sb.savePuzzles(puzzles); }

  const theme = await file.loadTheme();
  if (theme) {
    for (const b of theme.boards || []) b.src = await moveImage(b.src);
    theme.boards = (theme.boards || []).filter((b) => b.src);
    if (theme.current && theme.current.board && theme.current.board.type === 'image') {
      theme.current.board.src = await moveImage(theme.current.board.src);
    }
    console.log(`Giao diện bàn cờ: ${theme.boards.length} ảnh tải lên`);
    await sb.saveTheme(theme);
  }

  const economy = await file.loadEconomy();
  if (economy) { console.log('Cài đặt chế độ chơi & xu'); await sb.saveEconomy(economy); }

  const st = sb.status();
  if (st.lastError) { console.error('Có lỗi khi ghi:', st.lastError); process.exit(1); }
  console.log('Xong! Dữ liệu đã nằm trên Supabase. Đặt .env rồi chạy npm start.');
  process.exit(0);
})().catch((err) => { console.error(err.message); process.exit(1); });
