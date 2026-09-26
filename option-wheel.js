// Vanilla JS port of React Bits' OptionWheel. Same animation math (rAF-eased
// position, circular curve/tilt layout, wheel/drag/keyboard input), just
// driven by direct DOM writes instead of React state.
//
// Usage:
//   const wheel = createOptionWheel(containerEl, {
//     items: ['Lot 001 — Vase', 'Lot 002 — Painting'],
//     onChange: (index, item) => { ... },
//     side: 'left', fontSize: 1.7, ...
//   });
//   wheel.setItems(newItems);   // swap items later (e.g. live Firestore data)
//   wheel.destroy();

function createOptionWheel(root, options = {}) {
  const cfg = {
    items: options.items || [],
    defaultSelected: options.defaultSelected || 0,
    onChange: options.onChange || (() => {}),
    textColor: options.textColor || '#a6a6a6',
    activeColor: options.activeColor || '#ffffff',
    side: options.side || 'left',
    fontSize: options.fontSize ?? 3,
    spacing: options.spacing ?? 1.4,
    curve: options.curve ?? 1,
    tilt: options.tilt ?? 6,
    blur: options.blur ?? 2,
    fade: options.fade ?? 0.25,
    minOpacity: options.minOpacity ?? 0.05,
    smoothing: options.smoothing ?? 200,
    inset: options.inset ?? 80,
    loop: options.loop ?? false,
    draggable: options.draggable ?? true,
    soundUrl: options.soundUrl || '',
    soundVolume: options.soundVolume ?? 0.5,
    className: options.className || '',
  };

  let items = cfg.items.slice();
  let itemEls = [];
  let pos = cfg.defaultSelected;
  let target = cfg.defaultSelected;
  let selected = cfg.defaultSelected;
  let rafId = null;
  let lastT = 0;
  let dragging = null;
  let dragMoved = false;
  let wheelTimer = null;
  let audio = null;
  let lastTick = 0;

  root.setAttribute('role', 'listbox');
  root.setAttribute('tabindex', '0');
  root.setAttribute('aria-label', 'Option wheel');
  root.classList.add('option-wheel');
  if (cfg.side === 'right') root.classList.add('option-wheel--right');
  if (cfg.className) root.classList.add(cfg.className);
  root.style.setProperty('--ow-text-color', cfg.textColor);
  root.style.setProperty('--ow-active-color', cfg.activeColor);
  root.style.setProperty('--ow-font-size', cfg.fontSize + 'rem');
  root.style.setProperty('--ow-inset', cfg.inset + 'px');

  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const rowH = () => Math.max(cfg.fontSize * cfg.spacing * remPx, 1);

  function buildItems() {
    root.innerHTML = '';
    itemEls = items.map((label, index) => {
      const el = document.createElement('div');
      el.className = 'option-wheel__item';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(index === selected));
      el.textContent = label;
      el.addEventListener('click', () => handleItemClick(index));
      root.appendChild(el);
      return el;
    });
  }

  function layout(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    const tau = Math.max(cfg.smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);
    let next = pos + (target - pos) * k;
    const settled = Math.abs(target - next) < 0.001;
    if (settled) next = target;
    pos = next;

    const n = items.length;
    const mirror = cfg.side === 'right' ? -1 : 1;
    const tiltRad = (cfg.tilt * Math.PI) / 180;
    const R = tiltRad > 0.0005 ? rowH() / tiltRad : 0;

    for (let i = 0; i < n; i++) {
      const el = itemEls[i];
      if (!el) continue;
      let d = i - pos;
      if (cfg.loop && n > 1) {
        d = ((d % n) + n) % n;
        if (d > n / 2) d -= n;
      }
      const dist = Math.abs(d);
      let x = 0, y = d * rowH(), rot = 0;
      if (R > 0) {
        const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad));
        y = R * Math.sin(ang);
        x = -mirror * R * (1 - Math.cos(ang)) * cfg.curve;
        rot = (mirror * ang * 180) / Math.PI;
      }
      el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`;
      el.style.opacity = String(Math.max(cfg.minOpacity, 1 - dist * cfg.fade));
      el.style.filter = cfg.blur > 0 ? `blur(${(dist * cfg.blur).toFixed(2)}px)` : 'none';
      el.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4));
    }

    rafId = settled ? null : requestAnimationFrame(layout);
  }

  function startLoop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    lastT = performance.now();
    rafId = requestAnimationFrame(layout);
  }

  function playTick() {
    if (!cfg.soundUrl) return;
    const now = performance.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    if (!audio) { audio = new Audio(cfg.soundUrl); audio.preload = 'auto'; }
    audio.volume = Math.min(Math.max(cfg.soundVolume, 0), 1);
    audio.currentTime = 0;
    audio.play()?.catch(() => {});
  }

  function applyTarget(value, snap) {
    const n = items.length;
    let v = value;
    if (!cfg.loop) v = Math.min(Math.max(v, 0), Math.max(n - 1, 0));
    if (snap) v = Math.round(v);
    target = v;
    const idx = n ? ((Math.round(v) % n) + n) % n : 0;
    if (idx !== selected) {
      selected = idx;
      itemEls.forEach((el, i) => el.setAttribute('aria-selected', String(i === idx)));
      cfg.onChange(idx, items[idx]);
      playTick();
    }
    startLoop();
  }

  function handleItemClick(index) {
    if (dragMoved) return;
    const n = items.length;
    const cur = ((target % n) + n) % n;
    let d = index - cur;
    if (cfg.loop && n > 1) {
      if (d > n / 2) d -= n;
      else if (d < -n / 2) d += n;
    }
    applyTarget(target + d, true);
  }

  function onWheelEvt(e) {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
    const step = Math.max(-1, Math.min(1, delta / rowH()));
    applyTarget(target + step, false);
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => applyTarget(target, true), 140);
  }

  function onPointerDown(e) {
    if (!cfg.draggable) return;
    dragging = { y: e.clientY, start: target, id: e.pointerId };
    dragMoved = false;
    root.classList.add('option-wheel--dragging');
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dy = e.clientY - dragging.y;
    if (!dragMoved && Math.abs(dy) > 4) {
      dragMoved = true;
      root.setPointerCapture(dragging.id);
    }
    if (dragMoved) applyTarget(dragging.start - dy / rowH(), false);
  }
  function onPointerEnd() {
    if (!dragging) return;
    dragging = null;
    root.classList.remove('option-wheel--dragging');
    if (dragMoved) applyTarget(target, true);
  }
  function onKeyDown(e) {
    let delta = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
    if (delta == null) return;
    e.preventDefault();
    applyTarget(Math.round(target) + delta, true);
  }

  root.addEventListener('wheel', onWheelEvt, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('keydown', onKeyDown);

  function setItems(newItems, keepSelection = true) {
    items = newItems.slice();
    const keep = keepSelection ? Math.min(selected, Math.max(items.length - 1, 0)) : cfg.defaultSelected;
    selected = -1; // force onChange to fire even if index number is unchanged
    buildItems();
    pos = keep;
    applyTarget(keep, true);
  }

  function destroy() {
    if (rafId != null) cancelAnimationFrame(rafId);
    if (wheelTimer) clearTimeout(wheelTimer);
    root.removeEventListener('wheel', onWheelEvt);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('keydown', onKeyDown);
    root.innerHTML = '';
  }

  buildItems();
  applyTarget(cfg.defaultSelected, true);

  return { setItems, destroy, getSelected: () => selected };
}
