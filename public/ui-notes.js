// Chế độ "Góp ý giao diện": mở web với ?gopy=1 (tắt bằng ?gopy=0). Bấm "Chọn chỗ" rồi bấm vào bất kỳ phần tử nào
// để ghi chú; ghi chú lưu trên server (qua API trang quản trị) kèm trang, phần tử, vị trí và cỡ màn hình,
// hiện thành chấm số ngay chỗ đó. Người chơi bình thường không thấy gì.
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  try {
    if (params.get('gopy') === '1') localStorage.setItem('tk-gopy', '1');
    if (params.get('gopy') === '0') localStorage.removeItem('tk-gopy');
    if (localStorage.getItem('tk-gopy') !== '1') return;
  } catch { return; }

  const API = '/admin/api/ui-notes';
  let notes = [];
  let picking = false;
  let hoverEl = null;

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    e.append(...kids.filter(Boolean));
    return e;
  };

  // ---------- Giao diện công cụ (nằm trong 1 lớp riêng, không ảnh hưởng trang) ----------
  const css = `
  .gy-bar{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:6px;align-items:center;padding:8px;border-radius:14px;
    background:#1d1612;color:#f3e9dd;box-shadow:0 10px 30px rgba(0,0,0,.35);font:600 13px "Be Vietnam Pro",system-ui,sans-serif}
  .gy-bar b{color:#ffd27a;padding:0 6px}
  .gy-btn{border:0;border-radius:9px;padding:8px 12px;cursor:pointer;font:inherit;background:#3a2c24;color:#f3e9dd}
  .gy-btn:hover{background:#4a3a2e}.gy-btn.on{background:#c42a1f;color:#fff}
  .gy-hover{position:fixed;z-index:9997;pointer-events:none;border:2px solid #2f6fd6;background:rgba(47,111,214,.08);border-radius:4px;transition:all .05s}
  .gy-hover span{position:absolute;left:-2px;top:-22px;background:#2f6fd6;color:#fff;font:600 11px system-ui;padding:2px 6px;border-radius:4px;white-space:nowrap}
  .gy-pin{position:absolute;z-index:9996;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
    background:#c42a1f;color:#fff;font:800 12px system-ui;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}
  .gy-pin.done{background:#2e9e5b}
  .gy-pop{position:fixed;z-index:10000;width:320px;padding:12px;border-radius:12px;background:#fff;color:#1b1612;box-shadow:0 14px 40px rgba(0,0,0,.35);
    font:13px "Be Vietnam Pro",system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}
  .gy-pop small{color:#7d7268;word-break:break-all}
  .gy-pop textarea{width:100%;min-height:90px;resize:vertical;font:inherit;padding:8px;border:1px solid #ddd4c6;border-radius:8px;box-sizing:border-box}
  .gy-row{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
  .gy-row .gy-btn{background:#f3efe8;color:#1b1612}.gy-row .gy-btn.primary{background:#c42a1f;color:#fff}
  .gy-list{position:fixed;right:16px;bottom:70px;z-index:9999;width:380px;max-height:60vh;overflow:auto;padding:12px;border-radius:14px;background:#fff;
    color:#1b1612;box-shadow:0 14px 40px rgba(0,0,0,.35);font:13px "Be Vietnam Pro",system-ui,sans-serif;display:flex;flex-direction:column;gap:8px}
  .gy-item{border:1px solid #ebe5db;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
  .gy-item.done{opacity:.6}.gy-item b{font-size:12px;color:#c42a1f}.gy-item p{margin:0;white-space:pre-wrap}
  .gy-picking *{cursor:crosshair!important;pointer-events:auto!important}
  .gy-picking .gy-hover,.gy-picking .gy-hover *{pointer-events:none!important}`;
  document.head.appendChild(el('style', { text: css }));

  const hover = el('div', { class: 'gy-hover' }, el('span'));
  hover.style.display = 'none';
  const count = el('b', { text: '0' });
  const pickBtn = el('button', { class: 'gy-btn', text: 'Chọn chỗ', title: 'Bấm rồi chọn phần tử cần góp ý (Esc để thôi)', onclick: () => setPicking(!picking) });
  const listBtn = el('button', { class: 'gy-btn', text: 'Danh sách', onclick: () => toggleList() });
  const offBtn = el('button', { class: 'gy-btn', text: 'Tắt', title: 'Tắt chế độ góp ý (mở lại bằng ?gopy=1)', onclick: () => { localStorage.removeItem('tk-gopy'); location.reload(); } });
  const bar = el('div', { class: 'gy-bar' }, el('span', { text: 'Góp ý' }), count, pickBtn, listBtn, offBtn);
  document.body.append(hover, bar);

  // ---------- Nhận diện phần tử ----------
  const isTool = (e) => e && e.closest && e.closest('.gy-bar, .gy-pop, .gy-list, .gy-pin');
  const screenOf = () => document.body.dataset.screen || '';
  const pageOf = () => (location.hash || '#/') + (location.search.includes('room=') ? ' (phòng)' : '');
  function selectorOf(node) {
    const parts = [];
    for (let n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let s = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !/^(active|hidden|on|cur|selected)$/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName) : [];
      if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  }
  const labelOf = (n) => {
    const t = (n.getAttribute('aria-label') || n.getAttribute('title') || n.innerText || n.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
    return `<${n.tagName.toLowerCase()}> ${t.slice(0, 80)}`;
  };

  function setPicking(on) {
    picking = on;
    pickBtn.classList.toggle('on', on);
    pickBtn.textContent = on ? 'Đang chọn… (Esc)' : 'Chọn chỗ';
    document.documentElement.classList.toggle('gy-picking', on);
    if (!on) { hover.style.display = 'none'; hoverEl = null; }
  }
  // ↑ nới vùng chọn ra phần tử cha, ↓ thu vào lại
  const trail = [];
  function showHover(t) {
    hoverEl = t;
    const r = t.getBoundingClientRect();
    Object.assign(hover.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    hover.firstChild.textContent = labelOf(t).slice(0, 60) + '  (↑ chọn rộng hơn · ↓ hẹp lại)';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setPicking(false); closePop(); }
    if (!picking || !hoverEl) return;
    if (e.key === 'ArrowUp' && hoverEl.parentElement && hoverEl.parentElement !== document.body) { e.preventDefault(); trail.push(hoverEl); showHover(hoverEl.parentElement); }
    if (e.key === 'ArrowDown' && trail.length) { e.preventDefault(); showHover(trail.pop()); }
  });
  document.addEventListener('mousemove', (e) => {
    if (!picking) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || isTool(t) || t === hoverEl || trail.includes(t)) return;
    trail.length = 0;
    showHover(t);
  }, true);
  // Chặn cú bấm tới trang khi đang chọn
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown']) {
    document.addEventListener(type, (e) => {
      if (!picking || isTool(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (type === 'click' && hoverEl) { const target = hoverEl; setPicking(false); openPop(target); }
    }, true);
  }

  // ---------- Ô ghi chú ----------
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  function openPop(target, existing) {
    closePop();
    const r = target ? target.getBoundingClientRect() : { left: innerWidth / 2 - 160, bottom: innerHeight / 2, top: innerHeight / 2 };
    const ta = el('textarea', { placeholder: 'Muốn đổi gì ở chỗ này? (vd: to hơn, đổi màu vàng, bỏ đi, thêm ảnh…)' });
    if (existing) ta.value = existing.text;
    pop = el('div', { class: 'gy-pop' },
      el('b', { text: existing ? `Góp ý #${notes.indexOf(existing) + 1}` : 'Góp ý cho chỗ này' }),
      el('small', { text: existing ? existing.label : labelOf(target) }), ta,
      el('div', { class: 'gy-row' },
        existing ? el('button', { class: 'gy-btn', text: 'Xoá', onclick: () => remove(existing) }) : null,
        existing ? el('button', { class: 'gy-btn', text: existing.status === 'done' ? 'Mở lại' : 'Đánh dấu xong', onclick: () => update(existing, { status: existing.status === 'done' ? 'open' : 'done' }) }) : null,
        el('button', { class: 'gy-btn', text: 'Huỷ', onclick: closePop }),
        el('button', { class: 'gy-btn primary', text: 'Lưu', onclick: () => (existing ? update(existing, { text: ta.value }) : create(target, ta.value)) })));
    pop.style.left = Math.max(8, Math.min(innerWidth - 336, r.left)) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - 260, (r.bottom || r.top) + 8)) + 'px';
    document.body.appendChild(pop);
    ta.focus();
  }

  // ---------- Lưu trên server ----------
  async function call(method, url, body) {
    const res = await fetch(API + url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Cần đăng nhập trang quản trị (/admin) trước để lưu góp ý.');
    if (!res.ok) throw new Error(json.error || 'Không lưu được.');
    return json;
  }
  const fail = (err) => alert(err.message);
  async function create(target, text) {
    if (!text.trim()) return;
    const r = target.getBoundingClientRect();
    try {
      ({ notes } = await call('POST', '', {
        text, page: pageOf(), screen: screenOf(), selector: selectorOf(target), label: labelOf(target),
        rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }, viewport: `${innerWidth}x${innerHeight}`,
      }));
      closePop(); render();
    } catch (err) { fail(err); }
  }
  async function update(n, patch) { try { ({ notes } = await call('PUT', '/' + n.id, patch)); closePop(); render(); } catch (err) { fail(err); } }
  async function remove(n) { if (!confirm('Xoá góp ý này?')) return; try { ({ notes } = await call('DELETE', '/' + n.id)); closePop(); render(); } catch (err) { fail(err); } }

  // ---------- Chấm số trên trang & danh sách ----------
  let pins = [];
  function render() {
    count.textContent = String(notes.filter((n) => n.status !== 'done').length);
    pins.forEach((p) => p.remove());
    pins = [];
    const page = pageOf();
    notes.forEach((n, i) => {
      if (n.page !== page) return;
      let target = null;
      try { target = n.selector ? document.querySelector(n.selector) : null; } catch { /* selector cũ */ }
      const r = target && target.offsetParent !== null ? target.getBoundingClientRect() : null;
      const x = r ? r.left + scrollX + 4 : n.rect && n.rect.x + 4, y = r ? r.top + scrollY + 4 : n.rect && n.rect.y + 4;
      if (x == null) return;
      const pin = el('div', { class: 'gy-pin' + (n.status === 'done' ? ' done' : ''), text: String(i + 1), title: n.text, onclick: (e) => { e.stopPropagation(); openPop(target, n); } });
      pin.style.left = x + 'px'; pin.style.top = y + 'px';
      document.body.appendChild(pin);
      pins.push(pin);
    });
    if (list) fillList();
  }
  let list = null;
  function toggleList() { if (list) { list.remove(); list = null; return; } list = el('div', { class: 'gy-list' }); document.body.appendChild(list); fillList(); }
  function fillList() {
    list.replaceChildren(el('b', { text: `${notes.length} góp ý (${notes.filter((n) => n.status !== 'done').length} chưa xong)` }),
      ...(notes.length ? notes.map((n, i) => el('div', { class: 'gy-item' + (n.status === 'done' ? ' done' : '') },
        el('b', { text: `#${i + 1} · ${n.page}${n.status === 'done' ? ' · đã xong' : ''}` }), el('p', { text: n.text }),
        el('div', { class: 'gy-row' },
          el('button', { class: 'gy-btn', text: 'Tới chỗ này', onclick: () => { if (location.hash !== n.page.split(' ')[0]) location.hash = n.page.split(' ')[0]; setTimeout(render, 600); } }),
          el('button', { class: 'gy-btn', text: 'Sửa', onclick: () => openPop(null, n) })))) : [el('p', { text: 'Chưa có góp ý nào. Bấm "Chọn chỗ" rồi bấm vào phần tử cần sửa.' })]));
  }
  window.addEventListener('hashchange', () => setTimeout(render, 500));
  window.addEventListener('resize', () => render());
  setInterval(() => { if (!picking && !pop) render(); }, 3000); // nội dung trang đổi (vẽ lại) → đặt lại chấm

  call('GET', '').then((d) => { notes = d.notes; render(); }).catch((err) => { count.textContent = '!'; bar.title = err.message; });
})();
