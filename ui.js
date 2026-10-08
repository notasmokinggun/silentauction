/* Shared in-page UI: replaces the browser's alert() / confirm() pop-ups.
 *   ui.toast(message, 'ok' | 'error' | 'info')        small message that fades away
 *   await ui.alert({ title, message, okText })         one-button notice
 *   await ui.confirm({ title, message, yesText, noText, danger })  -> true / false
 *   const done = ui.busy('Saving...'); ... done();     full-screen loading overlay
 * Styles are injected here, and use each page's own colour variables when present. */
(function () {
  if (window.ui) return;

  var css = [
    '.ui-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;',
    '  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:ui-fade .15s ease-out;}',
    '.ui-card{width:100%;max-width:380px;background:var(--surface,#1B1815);color:var(--text,#F3EBDA);border:1px solid var(--border,#2E2820);',
    '  border-radius:18px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit;animation:ui-pop .18s ease-out;}',
    '.ui-card h2{margin:0 0 8px;font-size:20px;font-weight:700;line-height:1.25;}',
    '.ui-card p{margin:0 0 18px;font-size:15px;line-height:1.5;color:var(--muted,#9C9086);white-space:pre-line;overflow-wrap:anywhere;}',
    '.ui-actions{display:flex;flex-direction:column;gap:10px;}',
    '.ui-btn{font:inherit;font-size:16px;font-weight:700;min-height:46px;padding:11px 16px;border-radius:12px;cursor:pointer;',
    '  border:1px solid var(--border,#2E2820);background:var(--surface2,#221E19);color:var(--text,#F3EBDA);}',
    '.ui-btn.primary{background:var(--cream,#F3EBDA);border-color:var(--cream,#F3EBDA);color:#1B140A;}',
    '.ui-btn.danger{background:var(--red,#D9836E);border-color:var(--red,#D9836E);color:#2A0F08;}',
    '.ui-btn:focus-visible{outline:2px solid var(--gold,#E3B75C);outline-offset:2px;}',
    '.ui-toasts{position:fixed;left:0;right:0;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:100001;display:flex;flex-direction:column;',
    '  align-items:center;gap:8px;padding:0 14px;pointer-events:none;}',
    '.ui-toast{max-width:460px;width:fit-content;background:var(--surface,#1B1815);color:var(--text,#F3EBDA);border:1px solid var(--border,#2E2820);',
    '  border-left-width:4px;border-radius:12px;padding:12px 16px;font-size:15px;line-height:1.4;box-shadow:0 10px 30px rgba(0,0,0,.45);',
    '  overflow-wrap:anywhere;animation:ui-toast-in .2s ease-out;transition:opacity .25s,transform .25s;}',
    '.ui-toast.ok{border-left-color:var(--green,#7FBF8E);}',
    '.ui-toast.error{border-left-color:var(--red,#D9836E);}',
    '.ui-toast.info{border-left-color:var(--gold,#E3B75C);}',
    '.ui-toast.out{opacity:0;transform:translateY(8px);}',
    '.ui-busy{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;',
    '  text-align:center;padding:24px;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}',
    '.ui-spin{width:54px;height:54px;border-radius:50%;border:5px solid rgba(255,255,255,.25);border-top-color:var(--gold,#E3B75C);animation:ui-rot .9s linear infinite;}',
    '.ui-busy p{margin:20px 0 0;font-size:19px;font-weight:700;color:#fff;}',
    '@keyframes ui-rot{to{transform:rotate(360deg);}}',
    '@keyframes ui-fade{from{opacity:0;}to{opacity:1;}}',
    '@keyframes ui-pop{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:none;}}',
    '@keyframes ui-toast-in{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}',
    '@media (prefers-reduced-motion:reduce){.ui-backdrop,.ui-card,.ui-toast{animation:none;transition:none;}.ui-spin{animation-duration:3s;}}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var toastBox = null;
  function toast(message, kind, ms) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'ui-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    var t = document.createElement('div');
    t.className = 'ui-toast ' + (kind || 'info');
    t.textContent = String(message == null ? '' : message);
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.removeChild(toastBox.firstChild);
    var life = ms || (kind === 'error' ? 6000 : 3500);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, life);
  }

  // Dialogs are shown one at a time, in order.
  var queue = Promise.resolve();
  function dialog(opts) {
    var run = function () {
      return new Promise(function (resolve) {
        var prevFocus = document.activeElement;
        var back = document.createElement('div');
        back.className = 'ui-backdrop';
        var card = document.createElement('div');
        card.className = 'ui-card';
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-modal', 'true');
        var h = document.createElement('h2');
        h.textContent = opts.title || '';
        var p = document.createElement('p');
        p.textContent = opts.message || '';
        var actions = document.createElement('div');
        actions.className = 'ui-actions';
        var id = 'ui-dlg-' + Date.now();
        h.id = id; card.setAttribute('aria-labelledby', id);
        if (opts.title) card.appendChild(h);
        if (opts.message) card.appendChild(p);

        function finish(val) {
          document.removeEventListener('keydown', onKey, true);
          if (back.parentNode) back.parentNode.removeChild(back);
          try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
          resolve(val);
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
          if (e.key === 'Tab') {
            var b = card.querySelectorAll('button');
            if (!b.length) return;
            var first = b[0], last = b[b.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }

        var yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'ui-btn ' + (opts.danger ? 'danger' : 'primary');
        yes.textContent = opts.yesText || 'OK';
        yes.onclick = function () { finish(true); };
        var no = null;
        if (opts.cancelable) {
          no = document.createElement('button');
          no.type = 'button';
          no.className = 'ui-btn';
          no.textContent = opts.noText || 'Cancel';
          no.onclick = function () { finish(false); };
          // the safe choice comes first, and gets the focus
          actions.appendChild(no);
        }
        actions.appendChild(yes);
        card.appendChild(actions);
        back.appendChild(card);
        back.addEventListener('mousedown', function (e) { if (e.target === back && opts.cancelable) finish(false); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(back);
        (no || yes).focus();
      });
    };
    var result = queue.then(run);
    queue = result.catch(function () {});
    return result;
  }

  function alertBox(o) {
    o = typeof o === 'string' ? { message: o } : (o || {});
    return dialog({ title: o.title || 'Heads up', message: o.message, yesText: o.okText || 'OK', cancelable: false });
  }
  function confirmBox(o) {
    o = o || {};
    return dialog({ title: o.title || 'Are you sure?', message: o.message, yesText: o.yesText || 'Yes',
      noText: o.noText || 'Cancel', danger: !!o.danger, cancelable: true });
  }

  var busyCount = 0, busyEl = null, busyText = null;
  function busy(message) {
    busyCount++;
    if (!busyEl) {
      busyEl = document.createElement('div');
      busyEl.className = 'ui-busy';
      busyEl.setAttribute('role', 'status');
      busyEl.setAttribute('aria-live', 'assertive');
      var s = document.createElement('div'); s.className = 'ui-spin';
      busyText = document.createElement('p');
      busyEl.appendChild(s); busyEl.appendChild(busyText);
    }
    busyText.textContent = message || 'Working\u2026';
    if (!busyEl.parentNode) document.body.appendChild(busyEl);
    var since = Date.now(), done = false;
    return function () {
      if (done) return; done = true;
      // stays up at least 400ms so it never just flashes
      setTimeout(function () {
        busyCount = Math.max(0, busyCount - 1);
        if (!busyCount && busyEl && busyEl.parentNode) busyEl.parentNode.removeChild(busyEl);
      }, Math.max(0, 400 - (Date.now() - since)));
    };
  }

  window.ui = { toast: toast, alert: alertBox, confirm: confirmBox, busy: busy };
})();
