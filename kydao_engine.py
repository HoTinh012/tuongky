#!/usr/bin/env python3
"""
kydao_engine.py - Lấy dữ liệu cờ tướng từ kydao.net và phân tích bằng engine UCI (Pikafish...).

Cài đặt:  pip install requests beautifulsoup4
Engine:   tải Pikafish tại https://github.com/official-pikafish/Pikafish/releases
          (đặt file pikafish.nnue cùng thư mục với file chạy của engine)

Ví dụ:
  python kydao_engine.py list games                       # ván mới cập nhật ở trang chủ
  python kydao_engine.py list tournaments                 # danh sách giải đấu
  python kydao_engine.py list players                     # danh sách kỳ thủ
  python kydao_engine.py list openings                    # các nhánh khai cuộc
  python kydao_engine.py list games --url "<link giải đấu hoặc kỳ thủ>" --csv games.csv
  python kydao_engine.py game "<link ván đấu>" --pgn van.pgn
  python kydao_engine.py analyze "<link ván đấu>" --engine ./pikafish --depth 16
  python kydao_engine.py analyze --moves "P2-5 M8.7 M2.3 X9.1" --engine ./pikafish
  python kydao_engine.py solve "<link tàn cục / sát cục>" --engine ./pikafish
  python kydao_engine.py convert "P2-5 M8.7 M2.3 X9.1"   # chỉ đổi ký hiệu, không cần mạng
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import unquote, urljoin

BASE = "https://kydao.net"
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

# ============================================================================
# 1. BÀN CỜ + CHUYỂN ĐỔI KÝ HIỆU
#    Toạ độ engine (UCI/ICCS): cột a..i (trái->phải theo phía Đỏ), hàng 0..9 (Đỏ ở hàng 0)
# ============================================================================

class Board:
    def __init__(self, fen=START_FEN):
        self.grid = [[None] * 9 for _ in range(10)]  # grid[rank][col]
        parts = fen.split()
        rows = parts[0].split("/")
        for i, row in enumerate(rows):
            rank, col = 9 - i, 0
            for ch in row:
                if ch.isdigit():
                    col += int(ch)
                else:
                    self.grid[rank][col] = ch
                    col += 1
        self.red_to_move = len(parts) < 2 or parts[1] in ("w", "r")

    def copy(self):
        b = Board.__new__(Board)
        b.grid = [r[:] for r in self.grid]
        b.red_to_move = self.red_to_move
        return b

    def fen(self):
        rows = []
        for rank in range(9, -1, -1):
            s, empty = "", 0
            for col in range(9):
                p = self.grid[rank][col]
                if p is None:
                    empty += 1
                else:
                    s += (str(empty) if empty else "") + p
                    empty = 0
            rows.append(s + (str(empty) if empty else ""))
        return "/".join(rows) + (" w" if self.red_to_move else " b") + " - - 0 1"

    def push_uci(self, mv):
        c1, r1, c2, r2 = ord(mv[0]) - 97, int(mv[1]), ord(mv[2]) - 97, int(mv[3])
        self.grid[r2][c2] = self.grid[r1][c1]
        self.grid[r1][c1] = None
        self.red_to_move = not self.red_to_move

    def is_plausible(self, mv):
        """Kiểm tra nhanh: ô đi có quân của bên đang đi, ô đến không có quân mình."""
        if not re.fullmatch(r"[a-i][0-9][a-i][0-9]", mv):
            return False
        p = self.grid[int(mv[1])][ord(mv[0]) - 97]
        q = self.grid[int(mv[3])][ord(mv[2]) - 97]
        if p is None or p.isupper() != self.red_to_move:
            return False
        return q is None or q.isupper() != self.red_to_move


# Ký hiệu tiếng Việt: X Xe, M Mã, T Tượng, S Sĩ, Tg Tướng, P Pháo, B/C Tốt
# Hướng: "." tiến, "/" thoái, "-" bình.  Phân biệt quân: t = trước, s = sau, g = giữa
VN_PIECE = {"X": "R", "M": "N", "T": "B", "S": "A", "TG": "K", "P": "C", "B": "P", "C": "P"}
VN_WORD = {"xe": "X", "mã": "M", "ma": "M", "tượng": "T", "tuong": "T", "tương": "T",
           "sĩ": "S", "si": "S", "sỹ": "S", "tướng": "TG", "pháo": "P", "phao": "P",
           "tốt": "B", "tot": "B", "chốt": "B", "chot": "B", "binh": "B"}
VN_DIR = {"tiến": ".", "tien": ".", "thoái": "/", "thoai": "/", "lui": "/", "bình": "-", "binh": "-"}
VN_MARK = {"trước": "t", "truoc": "t", "sau": "s", "giữa": "g", "giua": "g"}
PIECE_VN = {v: k for k, v in VN_PIECE.items() if k not in ("C",)}

VN_SHORT_RE = re.compile(r"^(Tg|TG|[XMTSPBC])([tsg]?)(\d?)([tsg]?)([.\-/=+])(\d)$")
VN_LONG_RE = re.compile(
    r"(Xe|Mã|Ma|Tượng|Tương|Tuong|Sĩ|Sỹ|Si|Tướng|Pháo|Phao|Tốt|Tot|Chốt|Chot|Binh)\s*"
    r"(trước|truoc|sau|giữa|giua)?\s*(\d)?\s*(tiến|tien|thoái|thoai|lui|bình|binh)\s*(\d)",
    re.IGNORECASE)


def _file_to_col(red, n):
    return 9 - n if red else n - 1


def _col_to_file(red, col):
    return 9 - col if red else col + 1


def normalize_vn(token):
    """Đổi dạng chữ đầy đủ ('Pháo 2 bình 5') về dạng ngắn ('P2-5')."""
    m = VN_LONG_RE.fullmatch(token.strip())
    if not m:
        return token.strip()
    piece = VN_WORD[m.group(1).lower()]
    mark = VN_MARK.get((m.group(2) or "").lower(), "")
    return f"{piece}{mark}{m.group(3) or ''}{VN_DIR[m.group(4).lower()]}{m.group(5)}"


def vn_to_uci(board, token):
    token = normalize_vn(token)
    m = VN_SHORT_RE.match(token)
    if not m:
        raise ValueError(f"Không đọc được nước đi: {token!r}")
    letter, mark1, file_s, mark2, act, num = m.groups()
    ptype = VN_PIECE[letter.upper()]
    mark = mark1 or mark2
    act = {"=": "-", "+": "."}.get(act, act)
    red = board.red_to_move
    sym = ptype if red else ptype.lower()
    fwd = 1 if red else -1
    num = int(num)

    squares = [(r, c) for r in range(10) for c in range(9) if board.grid[r][c] == sym]
    if file_s:
        col = _file_to_col(red, int(file_s))
        squares = [s for s in squares if s[1] == col]
    elif mark:  # chỉ có t/s/g: lấy cột có từ 2 quân cùng loại trở lên
        by_col = {}
        for s in squares:
            by_col.setdefault(s[1], []).append(s)
        squares = next((v for v in by_col.values() if len(v) >= 2), [])
    if not squares:
        raise ValueError(f"Không tìm thấy quân cho nước {token!r}")
    squares.sort(key=lambda s: s[0] * fwd, reverse=True)  # quân tiến xa nhất đứng đầu
    if len(squares) > 1:
        if mark == "t":
            squares = squares[:1]
        elif mark == "s":
            squares = squares[-1:]
        elif mark == "g" and len(squares) >= 3:
            squares = squares[1:2]
    r, c = squares[0]

    if ptype in "RCKP":  # quân đi thẳng
        if act == "-":
            r2, c2 = r, _file_to_col(red, num)
        else:
            r2, c2 = r + (num if act == "." else -num) * fwd, c
    else:  # Mã, Tượng, Sĩ: số sau là cột đích
        c2 = _file_to_col(red, num)
        dx = abs(c2 - c)
        dy = {"N": 3 - dx, "B": 2, "A": 1}[ptype]
        r2 = r + (dy if act == "." else -dy) * fwd
    if not (0 <= r2 <= 9 and 0 <= c2 <= 8):
        raise ValueError(f"Nước đi ra ngoài bàn cờ: {token!r}")
    return f"{chr(97 + c)}{r}{chr(97 + c2)}{r2}"


def uci_to_vn(board, mv):
    """Đổi nước đi của engine (h2e2) sang ký hiệu Việt (P2-5)."""
    c1, r1, c2, r2 = ord(mv[0]) - 97, int(mv[1]), ord(mv[2]) - 97, int(mv[3])
    sym = board.grid[r1][c1]
    if sym is None:
        return mv
    red = sym.isupper()
    ptype = sym.upper()
    fwd = 1 if red else -1
    same_file = sorted([r for r in range(10) if board.grid[r][c1] == sym],
                       key=lambda r: r * fwd, reverse=True)
    if len(same_file) >= 2 and ptype not in "KAB":
        idx = same_file.index(r1)
        mark = "t" if idx == 0 else ("s" if idx == len(same_file) - 1 else "g")
        head = PIECE_VN[ptype] + mark
    else:
        head = PIECE_VN[ptype] + str(_col_to_file(red, c1))
    if r1 == r2:
        return f"{head}-{_col_to_file(red, c2)}"
    act = "." if (r2 - r1) * fwd > 0 else "/"
    if ptype in "RCKP":
        return f"{head}{act}{abs(r2 - r1)}"
    return f"{head}{act}{_col_to_file(red, c2)}"


def moves_to_uci(tokens, fen=START_FEN):
    board, out = Board(fen), []
    for t in tokens:
        mv = t if re.fullmatch(r"[a-i][0-9][a-i][0-9]", t) else vn_to_uci(board, t)
        if not board.is_plausible(mv):
            raise ValueError(f"Nước {t!r} ({mv}) không hợp lệ ở thế cờ hiện tại")
        board.push_uci(mv)
        out.append(mv)
    return out


def split_move_text(text):
    """Tách chuỗi kiểu '1. P2-5 M8.7 2. M2.3 ...' hoặc 'Pháo 2 bình 5, Mã 8 tiến 7'."""
    text = VN_LONG_RE.sub(lambda m: normalize_vn(m.group(0)), text)
    return [t for t in re.split(r"[\s,;]+", text)
            if t and not re.fullmatch(r"\d+\.+", t) and t not in ("1-0", "0-1", "1/2-1/2")]


# ============================================================================
# 2. TẢI TRANG (lịch sự: tôn trọng robots.txt, có độ trễ, có cache)
# ============================================================================

class Client:
    def __init__(self, delay=2.0, cache_dir=".kydao_cache"):
        import requests
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "Mozilla/5.0 (kydao-engine personal research script)"
        self.delay, self.last = delay, 0.0
        self.cache = Path(cache_dir)
        self.cache.mkdir(exist_ok=True)
        self.robots = urllib.robotparser.RobotFileParser(BASE + "/robots.txt")
        try:
            self.robots.read()
        except Exception:
            self.robots = None

    def get(self, url):
        from requests.utils import requote_uri
        url = requote_uri(urljoin(BASE, url))
        key = self.cache / (hashlib.sha1(url.encode()).hexdigest() + ".html")
        if key.exists():
            return key.read_text(encoding="utf-8")
        if self.robots and not self.robots.can_fetch(self.s.headers["User-Agent"], url):
            raise PermissionError(f"robots.txt không cho phép tải: {url}")
        wait = self.delay - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        r = self.s.get(url, timeout=30)
        self.last = time.time()
        r.raise_for_status()
        r.encoding = r.encoding or "utf-8"
        key.write_text(r.text, encoding="utf-8")
        return r.text


LINK_PATTERNS = {
    "games": re.compile(r"/van-dau/([A-Za-z0-9=+%]+)/([^\"'#?]+)"),
    "tournaments": re.compile(r"/giai-dau/([^/\"'#?]+)/(\d+)"),
    "players": re.compile(r"/ky-thu/([^/\"'#?]+)/(\d+)"),
    "openings": re.compile(r"/khai-cuc/(\d+)/([\w-]+)"),
    "endgames": re.compile(r"/(tan-cuc|sat-cuc)/([^\"'#?]+)"),
}
DEFAULT_PAGE = {"games": "/", "tournaments": "/giai-dau", "players": "/ky-thu",
                "openings": "/", "endgames": "/tan-cuc"}


def list_items(client, kind, url=None):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(client.get(url or DEFAULT_PAGE[kind]), "html.parser")
    seen, items = set(), []
    for a in soup.find_all("a", href=True):
        href = unquote(a["href"])
        m = LINK_PATTERNS[kind].search(href)
        if not m:
            continue
        full = urljoin(BASE, href)
        if full in seen:
            continue
        seen.add(full)
        item = {"url": full, "text": a.get_text(" ", strip=True)}
        if kind == "games":
            title = m.group(2).strip()
            g = re.match(r"^(.*?)\s+(thắng|hòa|thua)\s+(.*)$", title)
            if g:
                res = {"thắng": "1-0", "hòa": "1/2-1/2", "thua": "0-1"}[g.group(2)]
                item.update(red=g.group(1), black=g.group(3), result=res)
            item["id"] = m.group(1)
        else:
            item["id"] = m.group(2) if kind in ("tournaments", "players") else m.group(1)
            item["name"] = m.group(1) if kind in ("tournaments", "players") else m.group(2)
        items.append(item)
    return items


# ============================================================================
# 3. TRÍCH NƯỚC ĐI / THẾ CỜ TỪ TRANG VÁN ĐẤU
#    Chưa rõ kydao lưu dữ liệu dạng nào, nên thử nhiều cách và kiểm tra bằng bàn cờ.
# ============================================================================

FEN_RE = re.compile(r"((?:[rnbakcpRNBAKCP1-9]{1,9}/){9}[rnbakcpRNBAKCP1-9]{1,9})(?:\s+([wbr]))?")


def _try_sequence(moves, fen):
    try:
        return moves_to_uci(moves, fen) if len(moves) >= 2 else None
    except ValueError:
        return None


def extract_game(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    info = {"title": soup.title.get_text(strip=True) if soup.title else ""}

    fen = START_FEN
    m = FEN_RE.search(html)
    if m and m.group(1) != START_FEN.split()[0]:
        fen = f"{m.group(1)} {'b' if m.group(2) == 'b' else 'w'} - - 0 1"
        info["fen"] = fen

    scripts = " ".join(s.get_text() for s in soup.find_all("script"))
    candidates = []
    # a) DhtmlXQ / số 4 chữ số: "7747 7967 ..." (cột 0-8 từ trái, hàng 0-9 từ trên)
    for blob in re.findall(r"DhtmlXQ_movelist\]([0-9]+)\[", html) + \
            re.findall(r"[\"']((?:\d{4}){4,})[\"']", scripts):
        if len(blob) % 4 == 0:
            mv = [f"{chr(97 + int(blob[i]))}{9 - int(blob[i + 1])}"
                  f"{chr(97 + int(blob[i + 2]))}{9 - int(blob[i + 3])}"
                  for i in range(0, len(blob), 4)]
            candidates.append(("dhtmlxq", mv))
    # b) ICCS trong script: h2e2 / H2-E2
    iccs = re.findall(r"\b([a-iA-I][0-9])-?([a-iA-I][0-9])\b", scripts)
    if iccs:
        candidates.append(("iccs", [(a + b).lower() for a, b in iccs]))
    # c) Ký hiệu tiếng Việt trong nội dung trang
    text = soup.get_text(" ")
    vn = [t for t in split_move_text(text) if VN_SHORT_RE.match(t)]
    if vn:
        candidates.append(("vn", vn))

    for source, mv in candidates:
        uci = _try_sequence(mv, fen)
        if uci:
            info.update(source=source, moves=uci)
            return info
    info["moves"] = []
    return info


def to_pgn(meta, moves, fen=START_FEN):
    head = {"Game": "Chinese Chess", "Event": meta.get("event", "?"),
            "Red": meta.get("red", "?"), "Black": meta.get("black", "?"),
            "Result": meta.get("result", "*"), "Format": "ICCS", "Site": meta.get("url", BASE)}
    if fen != START_FEN:
        head["FEN"] = fen
    lines = [f'[{k} "{v}"]' for k, v in head.items()]
    body, board = [], Board(fen)
    for i, mv in enumerate(moves):
        if i % 2 == 0:
            body.append(f"{i // 2 + 1}.")
        body.append(f"{mv[:2].upper()}-{mv[2:].upper()}")
        board.push_uci(mv)
    return "\n".join(lines) + "\n\n" + " ".join(body) + f" {head['Result']}\n"


# ============================================================================
# 4. ĐIỀU KHIỂN ENGINE QUA GIAO THỨC UCI (Pikafish và các engine tương thích)
# ============================================================================

class Engine:
    def __init__(self, path, threads=2, hash_mb=128):
        self.p = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1,
                                  cwd=str(Path(path).resolve().parent))
        self._send("uci")
        self._wait("uciok")
        self._send(f"setoption name Threads value {threads}")
        self._send(f"setoption name Hash value {hash_mb}")
        self._send("isready")
        self._wait("readyok")

    def _send(self, cmd):
        self.p.stdin.write(cmd + "\n")
        self.p.stdin.flush()

    def _wait(self, token):
        lines = []
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("Engine đã dừng bất ngờ (thiếu file .nnue?)")
            lines.append(line.strip())
            if line.startswith(token):
                return lines

    def analyse(self, fen, moves=(), depth=16, movetime=None):
        self._send(f"position fen {fen}" + (" moves " + " ".join(moves) if moves else ""))
        self._send(f"go movetime {movetime}" if movetime else f"go depth {depth}")
        out = {"cp": None, "mate": None, "pv": [], "bestmove": None}
        for line in self._wait("bestmove"):
            if line.startswith("info") and " pv " in line:
                m = re.search(r"score (cp|mate) (-?\d+)", line)
                if m:
                    out["cp" if m.group(1) == "cp" else "mate"] = int(m.group(2))
                    out["cp" if m.group(1) == "mate" else "mate"] = None
                out["pv"] = line.split(" pv ", 1)[1].split()
            elif line.startswith("bestmove"):
                out["bestmove"] = line.split()[1]
        return out

    def close(self):
        try:
            self._send("quit")
            self.p.wait(timeout=3)
        except Exception:
            self.p.kill()


def red_score(res, red_to_move):
    """Điểm theo góc nhìn bên Đỏ (centipawn); chiếu hết quy đổi thành ±30000."""
    if res["mate"] is not None:
        v = 30000 - abs(res["mate"]) if res["mate"] > 0 else -30000 + abs(res["mate"])
    else:
        v = res["cp"] or 0
    return v if red_to_move else -v


def analyse_game(engine, moves, fen=START_FEN, depth=16, blunder=150):
    board = Board(fen)
    prev = red_score(engine.analyse(fen, [], depth), board.red_to_move)
    rows = []
    for i, mv in enumerate(moves):
        mover_red = board.red_to_move
        best = engine.analyse(fen, moves[:i], depth)
        vn = uci_to_vn(board, mv)
        best_vn = uci_to_vn(board, best["bestmove"]) if best["bestmove"] else ""
        board.push_uci(mv)
        cur = red_score(engine.analyse(fen, moves[:i + 1], depth), board.red_to_move)
        loss = (prev - cur) if mover_red else (cur - prev)
        tag = "??" if loss >= blunder * 2 else ("?" if loss >= blunder else "")
        rows.append({"ply": i + 1, "side": "Đỏ" if mover_red else "Đen", "move": vn, "uci": mv,
                     "eval_red": cur, "loss": max(loss, 0), "mark": tag,
                     "best": best_vn if best["bestmove"] != mv else ""})
        print(f"{(i // 2) + 1:>3}{'.' if mover_red else '...'} {vn:<8} {tag:<2} "
              f"điểm(Đỏ)={cur:>6}  " + (f"engine đề nghị: {best_vn}" if tag else ""))
        prev = cur
    return rows


# ============================================================================
# 5. GIAO DIỆN DÒNG LỆNH
# ============================================================================

def load_game(args, client):
    if getattr(args, "moves", None):
        return {"url": "", "fen": args.fen or START_FEN,
                "moves": moves_to_uci(split_move_text(args.moves), args.fen or START_FEN)}
    html = client.get(args.url)
    info = extract_game(html)
    info["url"] = args.url
    g = re.search(r"/van-dau/[^/]+/(.*?)\s+(thắng|hòa|thua)\s+(.*)$", unquote(args.url))
    if g:
        info.update(red=g.group(1), black=g.group(3),
                    result={"thắng": "1-0", "hòa": "1/2-1/2", "thua": "0-1"}[g.group(2)])
    if not info["moves"] and "fen" not in info:
        dbg = Path("debug_page.html")
        dbg.write_text(html, encoding="utf-8")
        sys.exit(f"Không tìm thấy nước đi/thế cờ trong trang. Đã lưu HTML vào {dbg} "
                 "- gửi file này để chỉnh lại bộ trích xuất.")
    return info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delay", type=float, default=2.0, help="giây chờ giữa 2 lần tải trang")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="liệt kê ván đấu / giải đấu / kỳ thủ / khai cuộc / tàn cục")
    p.add_argument("kind", choices=list(LINK_PATTERNS))
    p.add_argument("--url", help="trang nguồn (vd. trang 1 giải đấu hoặc 1 kỳ thủ)")
    p.add_argument("--csv"), p.add_argument("--json")

    p = sub.add_parser("game", help="lấy nước đi của 1 ván, xuất PGN")
    p.add_argument("url"), p.add_argument("--pgn")

    p = sub.add_parser("analyze", help="phân tích từng nước bằng engine")
    p.add_argument("url", nargs="?"), p.add_argument("--moves"), p.add_argument("--fen")
    p.add_argument("--engine", required=True), p.add_argument("--depth", type=int, default=16)
    p.add_argument("--threads", type=int, default=2), p.add_argument("--csv")

    p = sub.add_parser("solve", help="tìm lời giải cho thế tàn cục / sát cục")
    p.add_argument("url", nargs="?"), p.add_argument("--fen")
    p.add_argument("--engine", required=True), p.add_argument("--depth", type=int, default=24)

    p = sub.add_parser("convert", help="đổi ký hiệu Việt <-> toạ độ engine (không cần mạng)")
    p.add_argument("moves"), p.add_argument("--fen", default=START_FEN)

    args = ap.parse_args()
    if args.cmd == "convert":
        board = Board(args.fen)
        for t in split_move_text(args.moves):
            mv = vn_to_uci(board, t) if not re.fullmatch(r"[a-i]\d[a-i]\d", t) else t
            print(f"{uci_to_vn(board, mv):<8} -> {mv}")
            board.push_uci(mv)
        print("FEN cuối:", board.fen())
        return

    client = Client(delay=args.delay)

    if args.cmd == "list":
        items = list_items(client, args.kind, args.url)
        for it in items:
            print(json.dumps(it, ensure_ascii=False))
        print(f"-- {len(items)} mục", file=sys.stderr)
        if args.csv and items:
            keys = sorted({k for it in items for k in it})
            with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.DictWriter(f, fieldnames=keys)
                w.writeheader(), w.writerows(items)
        if args.json:
            Path(args.json).write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    elif args.cmd == "game":
        info = load_game(args, client)
        fen = info.get("fen", START_FEN)
        board = Board(fen)
        print(f"{info.get('red', '?')} vs {info.get('black', '?')}  ({info.get('result', '*')})"
              f"  - nguồn: {info.get('source', '?')}")
        for i, mv in enumerate(info["moves"]):
            print(("\n%3d. " % (i // 2 + 1) if i % 2 == 0 else "  ") + uci_to_vn(board, mv), end="")
            board.push_uci(mv)
        print()
        if args.pgn:
            Path(args.pgn).write_text(to_pgn(info, info["moves"], fen), encoding="utf-8")
            print("Đã ghi", args.pgn)

    elif args.cmd == "analyze":
        if not (args.url or args.moves):
            sys.exit("Cần link ván đấu hoặc --moves")
        info = load_game(args, client)
        eng = Engine(args.engine, threads=args.threads)
        try:
            rows = analyse_game(eng, info["moves"], info.get("fen", START_FEN), args.depth)
        finally:
            eng.close()
        if args.csv:
            with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0]))
                w.writeheader(), w.writerows(rows)

    elif args.cmd == "solve":
        fen = args.fen
        if not fen:
            if not args.url:
                sys.exit("Cần link thế cờ hoặc --fen")
            info = extract_game(client.get(args.url))
            fen = info.get("fen")
            if not fen:
                sys.exit("Không tìm thấy FEN trong trang - hãy chép thế cờ và dùng --fen")
        eng = Engine(args.engine)
        try:
            res = eng.analyse(fen, [], args.depth)
        finally:
            eng.close()
        board, line = Board(fen), []
        for mv in res["pv"]:
            line.append(uci_to_vn(board, mv))
            board.push_uci(mv)
        verdict = f"chiếu hết sau {abs(res['mate'])} nước" if res["mate"] else f"{res['cp']} cp"
        print("Đánh giá:", verdict)
        print("Diễn biến chính:", " ".join(line))


if __name__ == "__main__":
    main()
