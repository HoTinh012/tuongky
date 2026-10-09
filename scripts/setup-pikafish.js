// Tải engine Pikafish (bản phát hành chính thức trên GitHub) về engines/pikafish/.
// Chạy: npm run setup:engine   (đặt PIKAFISH_TAG để chọn bản cụ thể, vd Pikafish-2026-09-06)
// Pikafish dùng giấy phép GPL-3.0: https://github.com/official-pikafish/Pikafish
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { path7za } = require('7zip-bin');

const REPO = 'official-pikafish/Pikafish';
const DEST = path.join(__dirname, '..', 'engines', 'pikafish');

async function main() {
  const tag = process.env.PIKAFISH_TAG;
  const api = `https://api.github.com/repos/${REPO}/releases/${tag ? `tags/${tag}` : 'latest'}`;
  const rel = await (await fetch(api, { headers: { 'User-Agent': 'tuongky-setup' } })).json();
  const asset = (rel.assets || []).find((a) => a.name.endsWith('.7z'));
  if (!asset) throw new Error(`Không tìm thấy file .7z trong bản phát hành ${rel.tag_name || tag}`);

  fs.mkdirSync(DEST, { recursive: true });
  const archive = path.join(DEST, asset.name);
  if (!fs.existsSync(archive)) {
    console.log(`Đang tải ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)...`);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  if (process.platform !== 'win32') fs.chmodSync(path7za, 0o755);
  const raw = path.join(DEST, 'release');
  fs.rmSync(raw, { recursive: true, force: true });
  execFileSync(path7za, ['x', archive, `-o${raw}`, '-y'], { stdio: 'ignore' });

  // Chọn file chạy phù hợp hệ điều hành + CPU, rồi đặt cạnh pikafish.nnue
  const files = walk(raw);
  const nnue = files.find((f) => path.basename(f) === 'pikafish.nnue');
  if (!nnue) throw new Error('Không thấy pikafish.nnue trong gói tải về');
  const binary = pickBinary(files);
  if (!binary) throw new Error(`Không có bản Pikafish cho ${process.platform}/${process.arch}`);
  const exe = path.join(DEST, process.platform === 'win32' ? 'pikafish.exe' : 'pikafish');
  fs.copyFileSync(binary, exe);
  fs.copyFileSync(nnue, path.join(DEST, 'pikafish.nnue'));
  for (const lic of ['Copying.txt', 'NNUE-License.md', 'AUTHORS']) {
    const f = files.find((x) => path.basename(x) === lic);
    if (f) fs.copyFileSync(f, path.join(DEST, lic));
  }
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(DEST, 'VERSION'), `${rel.tag_name || tag}\n${path.relative(raw, binary)}\n`);
  fs.rmSync(raw, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  console.log(`Đã cài ${rel.tag_name || tag}: ${path.relative(raw, binary)} → ${path.relative(process.cwd(), exe)}`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

// Tìm file chạy theo hệ điều hành (vd Pikafish-Windows-x86-64-universal.exe, hoặc thư mục windows/ ở bản cũ),
// chạy thử "uci" để loại bản CPU không hỗ trợ.
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
  for (const f of cands) {
    try {
      if (process.platform !== 'win32') fs.chmodSync(f, 0o755);
      const out = execFileSync(f, [], { input: 'uci\nquit\n', timeout: 10000, cwd: path.dirname(f) }).toString();
      if (out.includes('uciok')) return f;
    } catch { /* CPU không hỗ trợ tập lệnh này */ }
  }
  return null;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
