// Luật cờ tướng — dùng chung cho server (Node) và trình duyệt.
// Bàn cờ 10 hàng x 9 cột. Hàng 0 là phía Đen (trên), hàng 9 là phía Đỏ (dưới).
// Quân cờ là chuỗi 2 ký tự: màu ('r' đỏ / 'b' đen) + loại:
//   K tướng, A sĩ, B tượng, N mã, R xe, C pháo, P tốt.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROWS = 10;
  const COLS = 9;
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  const CHARS = {
    rK: '帥', rA: '仕', rB: '相', rN: '馬', rR: '車', rC: '炮', rP: '兵',
    bK: '將', bA: '士', bB: '象', bN: '馬', bR: '車', bC: '炮', bP: '卒',
  };

  function initialBoard() {
    const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    for (let c = 0; c < COLS; c++) {
      b[0][c] = 'b' + back[c];
      b[9][c] = 'r' + back[c];
    }
    b[2][1] = b[2][7] = 'bC';
    b[7][1] = b[7][7] = 'rC';
    for (let c = 0; c < COLS; c += 2) {
      b[3][c] = 'bP';
      b[6][c] = 'rP';
    }
    return b;
  }

  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const other = (side) => (side === 'r' ? 'b' : 'r');
  const inPalace = (side, r, c) => c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
  const ownHalf = (side, r) => (side === 'r' ? r >= 5 : r <= 4);

  // Nước đi theo luật di chuyển của quân, chưa xét việc tự để tướng bị chiếu.
  function pseudoMoves(b, r, c) {
    const p = b[r][c];
    if (!p) return [];
    const side = p[0];
    const out = [];
    const add = (tr, tc) => {
      if (!inBoard(tr, tc)) return;
      const q = b[tr][tc];
      if (!q || q[0] !== side) out.push([tr, tc]);
    };

    switch (p[1]) {
      case 'K':
        for (const [dr, dc] of ORTH) {
          if (inPalace(side, r + dr, c + dc)) add(r + dr, c + dc);
        }
        break;
      case 'A':
        for (const [dr, dc] of DIAG) {
          if (inPalace(side, r + dr, c + dc)) add(r + dr, c + dc);
        }
        break;
      case 'B':
        for (const [dr, dc] of DIAG) {
          const tr = r + 2 * dr, tc = c + 2 * dc;
          // Không qua sông, không bị cản mắt tượng
          if (inBoard(tr, tc) && ownHalf(side, tr) && !b[r + dr][c + dc]) add(tr, tc);
        }
        break;
      case 'N':
        for (const [dr, dc] of ORTH) {
          const lr = r + dr, lc = c + dc;
          if (!inBoard(lr, lc) || b[lr][lc]) continue; // bị cản chân mã
          if (dr) {
            add(r + 2 * dr, c - 1);
            add(r + 2 * dr, c + 1);
          } else {
            add(r - 1, c + 2 * dc);
            add(r + 1, c + 2 * dc);
          }
        }
        break;
      case 'R':
        for (const [dr, dc] of ORTH) {
          let tr = r + dr, tc = c + dc;
          while (inBoard(tr, tc)) {
            if (b[tr][tc]) {
              if (b[tr][tc][0] !== side) out.push([tr, tc]);
              break;
            }
            out.push([tr, tc]);
            tr += dr;
            tc += dc;
          }
        }
        break;
      case 'C':
        for (const [dr, dc] of ORTH) {
          let tr = r + dr, tc = c + dc;
          while (inBoard(tr, tc) && !b[tr][tc]) {
            out.push([tr, tc]);
            tr += dr;
            tc += dc;
          }
          // Nhảy qua đúng một ngòi để ăn quân
          tr += dr;
          tc += dc;
          while (inBoard(tr, tc)) {
            if (b[tr][tc]) {
              if (b[tr][tc][0] !== side) out.push([tr, tc]);
              break;
            }
            tr += dr;
            tc += dc;
          }
        }
        break;
      case 'P': {
        const f = side === 'r' ? -1 : 1;
        add(r + f, c);
        if (!ownHalf(side, r)) {
          add(r, c - 1);
          add(r, c + 1);
        }
        break;
      }
    }
    return out;
  }

  function findKing(b, side) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 3; c <= 5; c++) {
        if (b[r][c] === side + 'K') return [r, c];
      }
    }
    return null;
  }

  function isInCheck(b, side) {
    const king = findKing(b, side);
    if (!king) return true;
    const [kr, kc] = king;

    // Lộ mặt tướng
    const enemyKing = findKing(b, other(side));
    if (enemyKing && enemyKing[1] === kc) {
      const lo = Math.min(kr, enemyKing[0]), hi = Math.max(kr, enemyKing[0]);
      let blocked = false;
      for (let r = lo + 1; r < hi; r++) {
        if (b[r][kc]) { blocked = true; break; }
      }
      if (!blocked) return true;
    }

    const enemy = other(side);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (!p || p[0] !== enemy || p[1] === 'K') continue;
        for (const [tr, tc] of pseudoMoves(b, r, c)) {
          if (tr === kr && tc === kc) return true;
        }
      }
    }
    return false;
  }

  function applyMove(b, from, to) {
    const nb = b.map((row) => row.slice());
    nb[to[0]][to[1]] = nb[from[0]][from[1]];
    nb[from[0]][from[1]] = null;
    return nb;
  }

  function legalMovesFrom(b, r, c) {
    const p = b[r][c];
    if (!p) return [];
    const side = p[0];
    return pseudoMoves(b, r, c).filter((to) => !isInCheck(applyMove(b, [r, c], to), side));
  }

  function isLegalMove(b, side, from, to) {
    if (!Array.isArray(from) || !Array.isArray(to)) return false;
    const [fr, fc] = from, [tr, tc] = to;
    if (![fr, fc, tr, tc].every(Number.isInteger)) return false;
    if (!inBoard(fr, fc) || !inBoard(tr, tc)) return false;
    const p = b[fr][fc];
    if (!p || p[0] !== side) return false;
    return legalMovesFrom(b, fr, fc).some(([r, c]) => r === tr && c === tc);
  }

  function hasAnyLegalMove(b, side) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p && p[0] === side && legalMovesFrom(b, r, c).length) return true;
      }
    }
    return false;
  }

  // Ký hiệu nước đi kiểu Việt Nam: tên quân + cột + dấu (. tiến, / thoái, - bình) + số.
  // Cột đánh số 1–9 từ phải sang trái theo góc nhìn của bên đi.
  const LETTERS = { K: 'Tg', A: 'S', B: 'T', N: 'M', R: 'X', C: 'P', P: 'B' };
  const fileOf = (side, c) => (side === 'r' ? 9 - c : c + 1);

  function notation(b, from, to) {
    const p = b[from[0]][from[1]];
    if (!p) return '?';
    const side = p[0], t = p[1];
    let name = LETTERS[t];

    // Hai quân cùng loại trên cùng một cột: dùng t (trước) / s (sau)
    const same = [];
    for (let r = 0; r < ROWS; r++) if (b[r][from[1]] === p) same.push(r);
    if (same.length > 1) {
      same.sort((a, z) => (side === 'r' ? a - z : z - a));
      const idx = same.indexOf(from[0]);
      name += same.length === 2 ? (idx === 0 ? 't' : 's') : String(idx + 1);
    } else {
      name += fileOf(side, from[1]);
    }

    const fwd = side === 'r' ? from[0] - to[0] : to[0] - from[0];
    if (fwd === 0) return name + '-' + fileOf(side, to[1]);
    const straight = 'KRCP'.includes(t);
    return name + (fwd > 0 ? '.' : '/') + (straight ? Math.abs(fwd) : fileOf(side, to[1]));
  }

  // Dựng lại các thế cờ từ danh sách nước đi: boards[i] là bàn cờ sau i nước.
  function replay(history) {
    const boards = [initialBoard()];
    const notes = [];
    for (const m of history) {
      const b = boards[boards.length - 1];
      notes.push(notation(b, m.from, m.to));
      boards.push(applyMove(b, m.from, m.to));
    }
    return { boards, notes };
  }

  // Kiểm tra một thế cờ tự bày (bài tập) có hợp lệ không. Trả về null nếu hợp lệ, hoặc câu báo lỗi.
  const LIMITS = { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };
  // Các điểm sĩ / tượng được phép đứng (góc nhìn bên Đỏ)
  const ADVISOR_POINTS = new Set([[7, 3], [7, 5], [8, 4], [9, 3], [9, 5]].map(([r, c]) => r * 9 + c));
  const ELEPHANT_POINTS = new Set([[5, 2], [5, 6], [7, 0], [7, 4], [7, 8], [9, 2], [9, 6]].map(([r, c]) => r * 9 + c));
  const NAMES = { K: 'tướng', A: 'sĩ', B: 'tượng', N: 'mã', R: 'xe', C: 'pháo', P: 'tốt' };
  function validatePosition(b, side) {
    if (!Array.isArray(b) || b.length !== ROWS || b.some((row) => !Array.isArray(row) || row.length !== COLS)) return 'Bàn cờ phải có 10 hàng × 9 cột.';
    if (side !== 'r' && side !== 'b') return 'Chưa chọn bên đi trước.';
    const count = {};
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p === null) continue;
        if (typeof p !== 'string' || !CHARS[p]) return 'Có quân cờ không hợp lệ.';
        count[p] = (count[p] || 0) + 1;
        const s = p[0], t = p[1], color = s === 'r' ? 'Đỏ' : 'Đen';
        const rr = s === 'r' ? r : 9 - r; // quy về góc nhìn bên Đỏ
        if ((t === 'K' || t === 'A') && !inPalace('r', rr, c)) return `${NAMES[t]} ${color} phải đứng trong cung.`;
        if (t === 'A' && !ADVISOR_POINTS.has(rr * 9 + c)) return `Sĩ ${color} đứng sai vị trí (sĩ chỉ đi chéo trong cung).`;
        if (t === 'B' && !ELEPHANT_POINTS.has(rr * 9 + c)) return `Tượng ${color} đứng sai vị trí.`;
        if (t === 'P' && (rr >= 7 || (rr >= 5 && c % 2 === 1))) return `Tốt ${color} đứng sai vị trí (tốt chưa qua sông chỉ ở cột lẻ của hàng tốt).`;
      }
    }
    for (const s of ['r', 'b']) {
      if (count[s + 'K'] !== 1) return `Mỗi bên phải có đúng 1 tướng (bên ${s === 'r' ? 'Đỏ' : 'Đen'}).`;
      for (const t of Object.keys(LIMITS)) {
        if ((count[s + t] || 0) > LIMITS[t]) return `Bên ${s === 'r' ? 'Đỏ' : 'Đen'} có quá ${LIMITS[t]} ${NAMES[t]}.`;
      }
    }
    if (isInCheck(b, other(side))) return 'Bên không được đi đang bị chiếu (hoặc hai tướng đối mặt) — thế cờ không hợp lệ.';
    if (!hasAnyLegalMove(b, side)) return 'Bên đi trước không còn nước đi nào.';
    return null;
  }

  return {
    ROWS, COLS, CHARS,
    initialBoard, other, pseudoMoves, legalMovesFrom, isLegalMove,
    applyMove, isInCheck, hasAnyLegalMove, findKing, notation, replay, validatePosition,
  };
});
