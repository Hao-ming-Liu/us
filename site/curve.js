const width = 1000;
const step = 142;
const firstNode = 88;
const margin = 18;
const nodeY = index => firstNode + index * step;
const plotHeight = count => Math.max(310, nodeY(count - 1) + 105);

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function eventDate(data) {
  const date = String(data.date || '').slice(0, 10);
  const time = data.time || String(data.date || '').slice(11, 16);
  return [date, time].filter(Boolean).join(' · ');
}
function pointX(y) {
  // Each event sits at the outer turn on its side; the curve stays inside both bubble columns.
  return 500 - 86 * Math.cos((y - firstNode) * Math.PI / step);
}
// A six-pixel sampling interval keeps the displayed path and hit testing on the same geometry.
function curvePoints(height) {
  const points = [];
  for (let y = margin; y < height; y += 6) points.push({ x: pointX(y), y });
  points.push({ x: pointX(height), y: height });
  return points;
}
const plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>';
const grip = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor" stroke="none"><circle cx="7" cy="5" r="1.4"/><circle cx="13" cy="5" r="1.4"/><circle cx="7" cy="10" r="1.4"/><circle cx="13" cy="10" r="1.4"/><circle cx="7" cy="15" r="1.4"/><circle cx="13" cy="15" r="1.4"/></svg>';
function bubble(post, index, height) {
  const y = nodeY(index);
  const title = post.data.title || '未命名事件';
  const stamp = eventDate(post.data);
  return `<li class="cv-stop ${index % 2 ? 'cv-right' : 'cv-left'}" data-id="${escapeText(post.id)}" style="--cx:${pointX(y) / 10}%;--cy:${100*y/height}%">
    <span class="cv-point" aria-hidden="true"></span><span class="cv-stem" aria-hidden="true"></span>
    <div class="cv-bubble"><a class="cv-event-link" href="#journal/post/${encodeURIComponent(post.id)}" draggable="false">
      ${stamp ? `<small>${escapeText(stamp)}</small>` : ''}<strong>${escapeText(title)}</strong>
    </a><button type="button" class="cv-grip" aria-label="调整「${escapeText(title)}」的位置" title="拖动或点击调整位置">${grip}</button></div>
  </li>`;
}
export function renderCurve(row, posts) {
  const height = plotHeight(posts.length);
  const points = curvePoints(height);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y}`).join('');
  const cover = row.data.cover;
  return `<section class="cv-page" aria-labelledby="cv-title">
    <div class="cv-backdrop" aria-hidden="true"><img alt=""><img alt=""></div>
    <a class="cv-back" href="#journal/home">${arrow}纪念册</a>
    <header class="cv-header"><div class="cv-heading">
      ${cover?.path ? `<img class="cv-cover" data-media="${escapeText(cover.path)}" alt="见面封面">` : ''}
      <div><h1 id="cv-title" tabindex="-1">${escapeText(row.data.title || '见面记录')}</h1>
      ${row.data.date ? `<time>${escapeText(eventDate(row.data))}</time>` : ''}</div></div>
      <button class="cv-add" type="button" aria-pressed="false">${plus}<span>添加事件</span></button>
    </header>${row.data.summary ? `<p class="cv-summary">${escapeText(row.data.summary)}</p>` : ''}
    <button class="cv-photo-toggle" type="button" hidden>暂停背景轮播</button>
    <div class="cv-workspace"><div class="cv-tools"><h2>见面时间线 <span>${posts.length} 个事件</span></h2>
      <p class="cv-guide">${posts.length ? '点开气泡查看事件，拖动气泡可调整顺序。' : '点击或拖动右上角的「添加事件」，写下见面的第一件事。'}</p>
      <div class="cv-picker" hidden><label>放置位置<select class="cv-slots"></select></label>
        <button type="button" class="cv-confirm">确认位置</button><button type="button" class="cv-cancel">取消</button></div>
    </div>
    <div class="cv-plot" style="height:${height}px" role="group" aria-label="事件曲线">
      <svg class="cv-track" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${line}" vector-effect="non-scaling-stroke"/></svg>
      <ol class="cv-stops" aria-label="见面事件">${posts.map((post, i) => bubble(post, i, height)).join('')}</ol>
      <span class="cv-cursor" style="--cx:${pointX(margin) / 10}%;--cy:${100*margin/height}%" aria-hidden="true"></span>
    </div><p class="cv-status" role="status" aria-live="polite"></p></div>
  </section>`;
}

// Project in rendered pixels so pointer X has the right weight on wide and narrow displays.
function project(points, widthScale, heightScale, x, y) {
  let best = { x: points[0].x, y: points[0].y, distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const ax = a.x * widthScale, ay = a.y * heightScale;
    const dx = (b.x - a.x) * widthScale, dy = (b.y - a.y) * heightScale;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    if (distance < best.distance) best = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), distance };
  }
  return best;
}

export function mountCurve(container, { onInsert, onMove, onError }) {
  const page = container.matches?.('.cv-page') ? container : container.querySelector('.cv-page');
  if (!page) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  const plot = page.querySelector('.cv-plot'), cursor = page.querySelector('.cv-cursor');
  const add = page.querySelector('.cv-add'), picker = page.querySelector('.cv-picker');
  const slots = page.querySelector('.cv-slots'), guide = page.querySelector('.cv-guide');
  const status = page.querySelector('.cv-status');
  const stops = [...page.querySelectorAll('.cv-stop')].map((el, index) => ({
    el, id: el.dataset.id, title: el.querySelector('strong').textContent, y: nodeY(index),
  }));
  const height = plotHeight(stops.length), points = curvePoints(height);
  const originalGuide = guide.textContent;
  let mode = null, gesture = null, pending = false, blockClickUntil = 0;
  let dropTarget;
  let scrollFrame = 0, ghost = null, lastFocus = null;
  const listen = (target, name, action, options = {}) => target.addEventListener(name, action, { ...options, signal });
  function setCursor(x, y) {
    cursor.style.setProperty('--cx', x / 10 + '%');
    cursor.style.setProperty('--cy', y / height * 100 + '%');
  }
  function stopScroll() { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
  function releaseGesture() {
    const previous = gesture;
    gesture = null;
    stopScroll();
    if (previous && page.hasPointerCapture(previous.pointer)) page.releasePointerCapture(previous.pointer);
    ghost?.remove();
    ghost = null;
    page.classList.remove('cv-dragging');
  }
  function clear(restoreFocus = false) {
    releaseGesture();
    mode = null;
    dropTarget?.classList.remove('cv-drop-target');
    dropTarget = null;
    plot.classList.remove('cv-ready');
    picker.hidden = true;
    guide.textContent = originalGuide;
    add.setAttribute('aria-pressed', 'false');
    page.classList.remove('cv-armed');
    stops.forEach(s => s.el.classList.remove('cv-moving'));
    status.textContent = '';
    if (restoreFocus) lastFocus?.focus({ preventScroll: true });
  }
  function keyboardPosition() {
    const target = mode?.candidates[slots.selectedIndex];
    const available = mode?.candidates || [];
    let y = nodeY(0);
    if (target) {
      const previous = available[slots.selectedIndex - 1];
      y = ((previous?.y || margin) + target.y) / 2;
    } else if (available.length) y = (available.at(-1).y + height - margin) / 2;
    setCursor(pointX(y), y);
  }
  function arm(kind, source, focusPicker = false) {
    const moving = kind === 'move' ? stops.find(s => s.id === source.closest('.cv-stop')?.dataset.id) : null;
    const candidates = stops.filter(s => s !== moving);
    mode = { kind, moving, candidates };
    lastFocus = moving?.el.querySelector('.cv-grip') || add;
    add.setAttribute('aria-pressed', String(kind === 'insert'));
    page.classList.add('cv-armed');
    stops.forEach(s => s.el.classList.toggle('cv-moving', s === moving));
    slots.replaceChildren(...candidates.map(s => new Option('在「' + s.title + '」之前', s.id)), new Option('时间线末尾', ''));
    const next = moving && candidates.find(s => s.y > moving.y);
    slots.value = next?.id || '';
    guide.textContent = kind === 'insert' ? '在曲线上点选插入位置，或在下方选择。' : '在曲线上点选新位置，或在下方选择。';
    picker.hidden = false;
    keyboardPosition();
    if (focusPicker) slots.focus();
  }
  function locate(clientX, clientY) {
    const box = plot.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const point = project(points, box.width / width, box.height / height, clientX - box.left, clientY - box.top);
    setCursor(point.x, point.y);
    const target = mode?.candidates.find(s => s.y > point.y);
    const near = point.distance <= 44 * 44;
    if (mode) {
      slots.value = target?.id || '';
      const nextTarget = near ? target?.el : null;
      if (nextTarget !== dropTarget) {
        dropTarget?.classList.remove('cv-drop-target');
        dropTarget = nextTarget;
        dropTarget?.classList.add('cv-drop-target');
      }
      plot.classList.toggle('cv-ready', near);
    }
    return { near, before: target?.id || null };
  }
  async function commit(before) {
    if (!mode || pending) return;
    const choice = mode;
    if (choice.kind === 'move') {
      const originalNext = stops[stops.indexOf(choice.moving) + 1]?.id || null;
      if (before === originalNext) { clear(true); status.textContent = '事件位置未变。'; return; }
    }
    releaseGesture();
    pending = true;
    page.setAttribute('aria-busy', 'true');
    let failure = null;
    try {
      if (choice.kind === 'insert') await onInsert(before);
      else await onMove(choice.moving.id, before);
    } catch (error) { failure = error; }
    finally {
      pending = false;
      if (!signal.aborted) {
        page.removeAttribute('aria-busy');
        clear();
        if (failure) {
          status.textContent = failure.message || '无法更新位置，请重试。';
          onError?.(failure);
        }
      }
    }
  }
  function positionGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = Math.max(5, Math.min(innerWidth - ghost.offsetWidth - 6, x + 12)) + 'px';
    ghost.style.top = Math.max(5, Math.min(innerHeight - ghost.offsetHeight - 6, y + 12)) + 'px';
  }
  function scrollNearEdge() {
    scrollFrame = 0;
    if (!gesture?.dragging) return;
    const edge = 68;
    const dy = gesture.y < edge ? -Math.ceil((edge - gesture.y) / 6) :
      gesture.y > innerHeight - edge ? Math.ceil((gesture.y - innerHeight + edge) / 6) : 0;
    if (!dy) return;
    const old = scrollY;
    window.scrollBy({ top: dy, behavior: 'instant' });
    if (scrollY !== old) {
      locate(gesture.x, gesture.y);
      scrollFrame = requestAnimationFrame(scrollNearEdge);
    }
  }
  listen(page, 'pointerdown', e => {
    if (pending || !e.isPrimary || e.button !== 0 || gesture) return;
    const source = e.target.closest('.cv-add,.cv-bubble');
    if (!source || (mode && source !== add && !e.target.closest('.cv-grip'))) return;
    gesture = { pointer: e.pointerId, source, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dragging: false };
  });
  listen(window, 'pointermove', e => {
    if (pending || !e.isPrimary) return;
    if (!gesture) {
      if (plot.contains(e.target)) locate(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== gesture.pointer) return;
    gesture.x = e.clientX; gesture.y = e.clientY;
    if (!gesture.dragging && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) < 7) return;
    if (!gesture.dragging) {
      gesture.dragging = true;
      arm(gesture.source === add ? 'insert' : 'move', gesture.source);
      page.setPointerCapture(e.pointerId);
      page.classList.add('cv-dragging');
      ghost = document.createElement('span');
      ghost.className = 'cv-drag-label';
      ghost.textContent = mode.moving?.title || '添加事件';
      ghost.setAttribute('aria-hidden', 'true');
      document.body.append(ghost);
    }
    e.preventDefault();
    positionGhost(e.clientX, e.clientY);
    locate(e.clientX, e.clientY);
    if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollNearEdge);
  }, { passive: false });
  listen(window, 'pointerup', e => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const dragged = gesture.dragging;
    releaseGesture();
    if (!dragged) return;
    blockClickUntil = performance.now() + 300;
    const hit = locate(e.clientX, e.clientY);
    if (hit?.near) commit(hit.before);
    else status.textContent = '请点击曲线上的落点，或选择放置位置。';
  });
  listen(window, 'pointercancel', e => { if (e.pointerId === gesture?.pointer) clear(); });
  listen(window, 'blur', () => { if (gesture) clear(); });
  listen(page, 'dragstart', e => e.preventDefault());
  listen(page, 'click', e => {
    if (performance.now() < blockClickUntil || pending) { e.preventDefault(); return; }
    const handle = e.target.closest('.cv-grip');
    if (e.target.closest('.cv-add')) {
      if (mode?.kind === 'insert') clear();
      else arm('insert', add, e.detail === 0);
    } else if (handle) arm('move', handle, e.detail === 0);
    else if (e.target.closest('.cv-cancel')) clear(true);
    else if (e.target.closest('.cv-confirm')) commit(slots.value || null);
    else if (mode && plot.contains(e.target)) {
      e.preventDefault();
      const hit = locate(e.clientX, e.clientY);
      if (hit?.near) commit(hit.before);
      else status.textContent = '请点击曲线上的落点，或选择放置位置。';
    }
  });
  listen(slots, 'change', keyboardPosition);
  listen(page, 'keydown', e => { if (e.key === 'Escape' && mode && !pending) { e.preventDefault(); clear(true); } });
  return () => { controller.abort(); releaseGesture(); };
}
