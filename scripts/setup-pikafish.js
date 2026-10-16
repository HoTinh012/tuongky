// Tải engine Pikafish (bản phát hành chính thức trên GitHub) về engines/pikafish/.
// Chạy: npm run setup:engine   (đặt PIKAFISH_TAG để chọn bản cụ thể, vd Pikafish-2026-09-06)
// Thử bản mới nhất trước; nếu file chạy không hợp máy (vd Linux cũ thiếu thư viện glibc mới — máy chủ Render
// chạy Ubuntu 22.04 nên bản 2026-09-06 cần glibc 2.38 không chạy được) thì lùi về các bản cũ hơn.
// Pikafish dùng giấy phép GPL-3.0: https://github.com/official-pikafish/Pikafish
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { path7za } = require('7zip-bin');

const REPO = 'official-pikafish/Pikafish';
const DEST = process.env.PIKAFISH_DIR || path.join(__dirname, '..', 'engines', 'pikafish');
// Các bản dự phòng (mới → cũ), dùng khi không gọi được GitHub API hoặc bản mới không chạy được trên máy này
const FALLBACKS = [
  { tag: 'Pikafish-2026-09-06', file: 'Pikafish.2026-09-06.7z', size: 53603424 }, // Linux cần glibc ≥ 2.38
  { tag: 'Pikafish-2026-01-02', file: 'Pikafish.2026-01-02.7z', size: 55332846 }, // Linux cần glibc ≥ 2.34
  { tag: 'Pikafish-2025-06-23', file: 'Pikafish.2025-06-23.7z', size: 47381120 },
];
const urlOf = (f) => `https://github.com/${REPO}/releases/download/${f.tag}/${f.file}`;

// Danh sách bản cần thử theo thứ tự
async function candidates() {
  const tag = process.env.PIKAFISH_TAG;
  const list = [];
  const headers = { 'User-Agent': 'tuongky-setup' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/${tag ? `tags/${tag}` : 'latest'}`, { headers })).json();
    const asset = (rel.assets || []).find((a) => a.name.endsWith('.7z'));
    if (asset) list.push({ tag: rel.tag_name, file: asset.name, size: asset.size, url: asset.browser_download_url });
    else console.log(`GitHub API không trả bản phát hành (${rel.message || 'không có file .7z'}) — dùng danh sách dự phòng`);
  } catch (err) {
    console.log(`Không gọi được GitHub API (${err.message}) — dùng danh sách dự phòng`);
  }
  if (tag) { const f = FALLBACKS.find((x) => x.tag === tag); if (f && !list.length) list.push({ ...f, url: urlOf(f) }); return list; }
  for (const f of FALLBACKS) if (!list.some((x) => x.tag === f.tag)) list.push({ ...f, url: urlOf(f) });
  return list;
}

// Tải + giải nén một bản; trả về true nếu cài được file chạy hợp máy
async function install(c) {
  fs.mkdirSync(DEST, { recursive: true });
  const archive = path.join(DEST, c.file);
  if (!fs.existsSync(archive)) {
    console.log(`Đang tải ${c.file} (${(c.size / 1048576).toFixed(1)} MB)...`);
    const res = await fetch(c.url);
    if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  if (process.platform !== 'win32') fs.chmodSync(path7za, 0o755);
  const raw = path.join(DEST, 'release');
  fs.rmSync(raw, { recursive: true, force: true });
  try {
    execFileSync(path7za, ['x', archive, `-o${raw}`, '-y'], { stdio: 'ignore' });
    const files = walk(raw);
    const nnue = files.find((f) => path.basename(f) === 'pikafish.nnue');
    if (!nnue) { console.log(`${c.tag}: không thấy pikafish.nnue trong gói`); return false; }
    const binary = pickBinary(files);
    if (!binary) { console.log(`${c.tag}: không có file chạy hợp ${process.platform}/${process.arch} trên máy này`); return false; }
    const exe = path.join(DEST, process.platform === 'win32' ? 'pikafish.exe' : 'pikafish');
    fs.copyFileSync(binary, exe);
    fs.copyFileSync(nnue, path.join(DEST, 'pikafish.nnue'));
    for (const lic of ['Copying.txt', 'NNUE-License.md', 'AUTHORS']) {
      const f = files.find((x) => path.basename(x) === lic);
      if (f) fs.copyFileSync(f, path.join(DEST, lic));
    }
    if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
    fs.writeFileSync(path.join(DEST, 'VERSION'), `${c.tag}\n${path.relative(raw, binary)}\n`);
    console.log(`Đã cài ${c.tag}: ${path.relative(raw, binary)} → ${path.relative(process.cwd(), exe)}`);
    return true;
  } finally {
    fs.rmSync(raw, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

async function main() {
  const list = await candidates();
  for (const c of list) {
    try { if (await install(c)) return; } catch (err) { console.log(`${c.tag}: ${err.message}`); }
  }
  throw new Error('Không cài được Pikafish từ bản phát hành nào.');
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

// Tìm file chạy theo hệ điều hành (vd Pikafish-Windows-x86-64-universal.exe, hoặc thư mục Linux/pikafish-avx2),
// ưu tiên bản "universal" rồi các bản phổ biến (avx2, bmi2…), chạy thử một lượt tính thật để loại bản CPU / thư viện
// hệ thống không hỗ trợ.
function pickBinary(files) {
  const os = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
  const arch = process.arch === 'arm64' ? /arm64|apple|universal/ : /x86-64|universal/;
  const cands = files.filter((f) => {
    const rel = f.replace(/\\/g, '/').toLowerCase();
    const name = path.basename(rel);
    return name.startsWith('pikafish') && !name.endsWith('.nnue') && (rel.includes(`/${os}/`) || name.includes(os))
      && (os === 'macos' || arch.test(name) || rel.includes(`/${os}/`))
      && (process.platform !== 'win32' || name.endsWith('.exe'));
  });
  const ORDER = ['universal', 'avx2', 'bmi2', 'avxvnni', 'avx512icl', 'vnni512', 'avx512', 'bw512', 'sse41-popcnt'];
  const rank = (f) => { const n = path.basename(f).toLowerCase(); const i = ORDER.findIndex((k) => n.includes(k)); return i < 0 ? ORDER.length : i; };
  cands.sort((a, b) => rank(a) - rank(b));
  const nnue = files.find((f) => path.basename(f) === 'pikafish.nnue');
  for (const f of cands) {
    try {
      if (process.platform !== 'win32') fs.chmodSync(f, 0o755);
      // Đặt tạm nnue cạnh file chạy để chạy thử tính 1 nước (bắt được lỗi thiếu thư viện lẫn lỗi tập lệnh CPU)
      const local = path.join(path.dirname(f), 'pikafish.nnue');
      if (nnue && !fs.existsSync(local)) fs.copyFileSync(nnue, local);
      const out = execFileSync(f, [], { input: 'uci\nisready\nposition startpos\ngo depth 6\n', timeout: 30000, cwd: path.dirname(f) }).toString();
      if (out.includes('uciok') && out.includes('bestmove')) return f;
      console.log(`  ${path.basename(f)}: chạy thử không ra nước đi`);
    } catch (err) {
      console.log(`  ${path.basename(f)}: không chạy được (${String(err.stderr || err.message).split('\n')[0].slice(0, 160)})`);
    }
  }
  return null;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
