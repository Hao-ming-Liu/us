// The edge handle is always available by tap or keyboard, including on hybrid devices.
export function mountDrawer(host, signal) {
  const drawer = host.querySelector('.glass-drawer');
  const handle = host.querySelector('.edge-handle');
  let closeTimer;
  let gesture;
  const listen = (node, name, fn, options = {}) => node.addEventListener(name, fn, { ...options, signal });
  const opened = () => handle.getAttribute('aria-expanded') === 'true';
  const close = (restore = false) => {
    clearTimeout(closeTimer);
    if (restore || drawer.contains(document.activeElement)) handle.focus({ preventScroll: true });
    handle.setAttribute('aria-expanded', 'false');
    handle.setAttribute('aria-label', '打开导航');
    drawer.inert = true;
    host.classList.remove('nav-open');
  };
  const open = () => {
    clearTimeout(closeTimer);
    drawer.inert = false;
    host.classList.add('nav-open');
    handle.setAttribute('aria-expanded', 'true');
    handle.setAttribute('aria-label', '关闭导航');
  };
  let hoverOpened = false;
  listen(handle, 'pointerenter', event => {
    if (event.pointerType === 'mouse' && !opened()) { open(); hoverOpened = true; }
  });
  listen(handle, 'click', event => {
    if (event.detail && hoverOpened) { hoverOpened = false; open(); return; }
    if (opened()) close(true);
    else { open(); if (!event.detail) drawer.querySelector('a')?.focus(); }
  });
  const scheduleClose = event => {
    if (event.pointerType !== 'mouse') return;
    hoverOpened = false;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!drawer.matches(':hover') && !handle.matches(':hover') && !drawer.contains(document.activeElement)) close();
    }, 460);
  };
  listen(handle, 'pointerleave', scheduleClose);
  listen(drawer, 'pointerleave', scheduleClose);
  listen(drawer, 'pointerenter', () => clearTimeout(closeTimer));
  listen(drawer, 'click', e => { if (e.target.closest('a')) close(); });
  listen(document, 'pointerdown', e => {
    if (opened() && !drawer.contains(e.target) && !handle.contains(e.target)) close();
  });
  listen(document, 'keydown', e => {
    if (e.key === 'Escape' && opened()) { e.preventDefault(); close(true); }
  });
  listen(host, 'touchstart', e => {
    gesture = null;
    if (e.touches.length !== 1 || e.target.closest('input,textarea,select,video,[contenteditable],.cv-add,.cv-bubble,.cv-picker,.cv-armed,.cv-dragging')) return;
    const touch = e.changedTouches[0];
    gesture = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  listen(host, 'touchcancel', () => { gesture = null; }, { passive: true });
  listen(host, 'touchend', e => {
    if (!gesture || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - gesture.x;
    const dy = e.changedTouches[0].clientY - gesture.y;
    gesture = null;
    if (Math.abs(dx) < 55 || Math.abs(dx) < 1.8 * Math.abs(dy)) return;
    if (dx < 0) open(); else if (opened()) close();
  }, { passive: true });
  listen(window, 'hashchange', () => close());
  signal.addEventListener('abort', () => clearTimeout(closeTimer), { once: true });
}
