/**
 * PharmaCore – Keyboard Core
 * File: public/js/keyboard-core.js
 *
 * Shared keyboard engine used by every PharmaCore page.
 * Load it on ALL pages (put it in your main layout / footer partial),
 * BEFORE pos-keyboard.js or page-keyboard.js.
 *
 * What it gives you:
 *   1. data-shortcut="F1"           → pressing the key clicks that element
 *   2. [data-modal] dialogs         → Tab stays inside, Esc cancels, Enter submits,
 *                                     focus jumps to [autofocus] when it opens
 *   3. Sidebar navigation           → data-shortcut="Alt+Shift+1" on sidebar links
 *   4. "?" help overlay             → lists every shortcut available on the page
 *   5. Visible focus ring + <kbd> hints on buttons, and small toast messages
 *
 * Shortcuts only CLICK your existing buttons/links. They never replace your
 * server-side validation, role checks or database logic.
 */
(function (window, document) {
  'use strict';

  if (window.PCKeys) return; // already loaded

  /* ------------------------------------------------------------------ *
   * 1. Small helpers
   * ------------------------------------------------------------------ */

  const ALIASES = {
    esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete',
    enter: 'Enter', return: 'Enter', space: 'Space', tab: 'Tab',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    backspace: 'Backspace', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
    insert: 'Insert'
  };

  // Turn "ctrl+shift+s" / "Ctrl++" / "esc" into one standard spelling.
  function normalizeCombo(text) {
    const raw = String(text).trim();
    let parts = raw.split('+');
    let key;
    if (raw.endsWith('++') || raw === '+') { // the "+" key itself
      key = '+';
      parts = parts.slice(0, -2);
    } else {
      key = parts.pop();
    }
    const mods = parts.map(function (p) { return p.trim().toLowerCase(); });
    const k = key.trim();
    let name;
    if (/^f\d{1,2}$/i.test(k)) name = k.toUpperCase();
    else if (k.length === 1) name = k.toUpperCase();
    else name = ALIASES[k.toLowerCase()] || k;

    const out = [];
    if (mods.includes('ctrl') || mods.includes('control') || mods.includes('cmd')) out.push('Ctrl');
    if (mods.includes('alt') || mods.includes('option')) out.push('Alt');
    // Shift is ignored for symbols such as ? + * because the symbol already implies it
    const isSymbol = name.length === 1 && !/[A-Z0-9]/.test(name);
    if (mods.includes('shift') && !isSymbol) out.push('Shift');
    out.push(name);
    return out.join('+');
  }

  // Build the same standard spelling from a real keyboard event.
  // Letters and digits use event.code so Shift/CapsLock/keyboard layout
  // do not change them (Alt+Shift+1 stays "1", not "!").
  function comboFromEvent(e) {
    const code = e.code || '';
    let name;
    if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
    else if (/^Digit\d$/.test(code)) name = code.slice(5);
    else if (/^F\d{1,2}$/.test(e.key)) name = e.key;
    else if (e.key === ' ') name = 'Space';
    else if (e.key && e.key.length === 1) name = e.key.toUpperCase();
    else name = e.key;

    const isSymbol = name.length === 1 && !/[A-Z0-9]/.test(name);
    const out = [];
    if (e.ctrlKey || e.metaKey) out.push('Ctrl');
    if (e.altKey) out.push('Alt');
    if (e.shiftKey && !isSymbol) out.push('Shift');
    out.push(name);
    return out.join('+');
  }

  function prettyCombo(combo) {
    return combo
      .replace('ArrowUp', '↑').replace('ArrowDown', '↓')
      .replace('ArrowLeft', '←').replace('ArrowRight', '→')
      .replace('Escape', 'Esc').replace('Delete', 'Del');
  }

  // Is the user typing in a text box right now?
  function isTypingTarget(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type || 'text');
    }
    return false;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden]')) return false;
    return el.getClientRects().length > 0;
  }

  function isUsable(el) {
    return isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }

  // Function keys and Ctrl/Alt combos are safe to use even inside a text box.
  // Plain letters are not (they would steal typing).
  const EDITING_COMBOS = ['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y',
    'Ctrl+Backspace', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight', 'Ctrl+Shift+Z'];
  function isSafeWhileTyping(combo) {
    if (/^F\d{1,2}$/.test(combo) || /^Shift\+F\d{1,2}$/.test(combo)) return true;
    if (/^(Ctrl|Alt)\+/.test(combo)) return !EDITING_COMBOS.includes(combo);
    return false;
  }

  function focusEl(el, select) {
    if (!el) return false;
    el.focus({ preventScroll: false });
    if (select && typeof el.select === 'function') el.select();
    return document.activeElement === el;
  }

  /* ------------------------------------------------------------------ *
   * 2. Styles (injected so you do not need to rebuild Tailwind)
   * ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('pc-keys-style')) return;
    const css = `
      :focus-visible { outline: 3px solid #16a34a !important; outline-offset: 2px !important; }
      .pc-kbd { display:inline-block; margin-left:.4rem; padding:0 .35rem; min-width:1.4rem;
        font:600 .7rem/1.25rem ui-monospace,SFMono-Regular,Menlo,monospace; text-align:center;
        border:1px solid currentColor; border-radius:.3rem; opacity:.75; vertical-align:middle; }
      .pc-row-active, .pc-row-active > td { background:#dcfce7 !important; }
      .pc-row-active > td:first-child { box-shadow: inset 4px 0 0 #16a34a; }
      .pc-toast-wrap { position:fixed; right:1rem; bottom:3.5rem; z-index:9999; display:flex;
        flex-direction:column; gap:.5rem; pointer-events:none; }
      .pc-toast { pointer-events:auto; padding:.6rem .9rem; border-radius:.5rem; color:#fff;
        font:500 .875rem/1.3 system-ui,sans-serif; box-shadow:0 6px 20px rgba(0,0,0,.18);
        background:#1e293b; max-width:22rem; }
      .pc-toast.success { background:#15803d; } .pc-toast.error { background:#b91c1c; }
      .pc-toast.warn { background:#b45309; }
      .pc-help-chip { position:fixed; right:1rem; bottom:1rem; z-index:9998; border:0;
        background:#14532d; color:#fff; border-radius:999px; padding:.4rem .8rem;
        font:500 .75rem system-ui,sans-serif; opacity:.85; cursor:pointer; }
      .pc-help-overlay { position:fixed; inset:0; z-index:10000; background:rgba(15,23,42,.55);
        display:flex; align-items:center; justify-content:center; padding:1rem; }
      .pc-help-overlay[hidden] { display:none; }
      .pc-help-box { background:#fff; color:#0f172a; border-radius:.75rem; width:min(820px,100%);
        max-height:85vh; overflow:auto; padding:1.25rem 1.5rem; font:14px/1.45 system-ui,sans-serif; }
      .pc-help-box h2 { font-size:1.15rem; font-weight:700; margin:0 0 .75rem; color:#14532d; }
      .pc-help-box h3 { font-size:.75rem; letter-spacing:.06em; text-transform:uppercase;
        color:#64748b; margin:1rem 0 .35rem; }
      .pc-help-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:.1rem 1.5rem; }
      .pc-help-row { display:flex; justify-content:space-between; gap:.75rem; padding:.25rem 0;
        border-bottom:1px solid #f1f5f9; }
      .pc-help-filter { width:100%; margin:0 0 .5rem; padding:.5rem .7rem; border:1px solid #cbd5e1;
        border-radius:.4rem; font:inherit; }
      .pc-help-box h2.pc-help-part { font-size:.95rem; margin:1.1rem 0 0; padding-top:.6rem;
        border-top:2px solid #dcfce7; color:#15803d; }
      .pc-help-row kbd { font:600 .75rem ui-monospace,monospace; background:#f1f5f9;
        border:1px solid #cbd5e1; border-radius:.3rem; padding:0 .35rem; white-space:nowrap; }
      @media print { .pc-toast-wrap, .pc-help-chip, .pc-kbd { display:none !important; } }
    `;
    const style = document.createElement('style');
    style.id = 'pc-keys-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * 3. Toast messages (screen-reader friendly)
   * ------------------------------------------------------------------ */

  let toastWrap = null;
  function toast(message, type, ms) {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'pc-toast-wrap';
      toastWrap.setAttribute('aria-live', 'polite');
      toastWrap.setAttribute('role', 'status');
      document.body.appendChild(toastWrap);
    }
    const t = document.createElement('div');
    t.className = 'pc-toast ' + (type || '');
    t.textContent = message;
    toastWrap.appendChild(t);
    while (toastWrap.children.length > 3) toastWrap.firstChild.remove();
    setTimeout(function () { t.remove(); }, ms || 2600);
  }

  /* ------------------------------------------------------------------ *
   * 4. Modals: any element with data-modal
   *
   *   <div id="voidModal" data-modal hidden> ...
   *      <input autofocus>                 ← gets focus when the modal opens
   *      <button data-modal-cancel>        ← Esc clicks this
   *      <button data-modal-submit>        ← Enter (in a text box) clicks this
   *   </div>
   * ------------------------------------------------------------------ */

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),' +
    'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function getOpenModal() {
    const open = Array.from(document.querySelectorAll('[data-modal]')).filter(isVisible);
    return open.length ? open[open.length - 1] : null;
  }

  function openModal(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;
    el.hidden = false;
    el.classList.remove('hidden');
    const display = el.getAttribute('data-modal-display'); // e.g. "flex" for Tailwind modals
    if (display) el.classList.add(display);
    checkModals();
    return true;
  }

  function closeModal(target) {
    const el = target ? (typeof target === 'string' ? document.querySelector(target) : target) : getOpenModal();
    if (!el) return false;
    const cancel = el.querySelector('[data-modal-cancel]');
    if (cancel && isUsable(cancel)) {
      cancel.click(); // use YOUR close handler (it may reset fields)
    }
    if (isVisible(el)) { // still open? hide it ourselves
      const display = el.getAttribute('data-modal-display');
      if (display) el.classList.remove(display);
      el.classList.add('hidden');
      el.hidden = true;
    }
    checkModals();
    return true;
  }

  // Watch for modals opening/closing (even when YOUR code opens them)
  // so focus moves in and comes back out automatically.
  const modalState = new Map(); // element -> element focused before it opened
  function checkModals() {
    modalState.forEach(function (before, m) { // modals removed from the page count as closed
      if (!m.isConnected) closedModal(m, before);
    });
    document.querySelectorAll('[data-modal]').forEach(function (m) {
      const visible = isVisible(m);
      if (visible && !modalState.has(m)) {
        modalState.set(m, document.activeElement);
        if (!m.getAttribute('role')) m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        const first = m.querySelector('[autofocus]') ||
          m.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])') ||
          m.querySelector(FOCUSABLE);
        if (first && !m.contains(document.activeElement)) setTimeout(function () { focusEl(first, true); }, 0);
      } else if (!visible && modalState.has(m)) {
        closedModal(m, modalState.get(m));
      }
    });
  }

  function closedModal(m, before) {
    modalState.delete(m);
    if (!getOpenModal()) {
      if (before && before.isConnected && isVisible(before) && before !== document.body) before.focus();
      document.dispatchEvent(new CustomEvent('pc:modal-closed', { detail: { modal: m } }));
    }
  }

  function handleModalKey(e, combo, modal) {
    // Keep Tab / Shift+Tab inside the dialog
    if (combo === 'Tab' || combo === 'Shift+Tab') {
      const items = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(isUsable);
      if (!items.length) { e.preventDefault(); return true; }
      const first = items[0], last = items[items.length - 1];
      const inside = modal.contains(document.activeElement);
      if (!inside) { e.preventDefault(); first.focus(); return true; }
      if (combo === 'Tab' && document.activeElement === last) { e.preventDefault(); first.focus(); return true; }
      if (combo === 'Shift+Tab' && document.activeElement === first) { e.preventDefault(); last.focus(); return true; }
      return true; // normal Tab movement inside the modal
    }
    if (combo === 'Escape') {
      e.preventDefault();
      closeModal(modal);
      return true;
    }
    // Enter in a text box submits the modal (only if no <form> does it already)
    const t = e.target;
    const submit = modal.querySelector('[data-modal-submit]');
    if (combo === 'Enter' && submit && isTypingTarget(t) && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT' && !t.form) {
      e.preventDefault();
      if (!e.repeat && isUsable(submit)) submit.click();
      return true;
    }
    if (combo === 'Ctrl+Enter' && submit) {
      e.preventDefault();
      if (!e.repeat && isUsable(submit)) submit.click();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 5. Shortcut registry
   * ------------------------------------------------------------------ */

  const handlers = new Map(); // combo -> [handler, ...]   (newest first)
  const reserved = new Set(); // combos whose browser default should be blocked

  /**
   * PCKeys.bind('F5', fn, options)
   * options:
   *   description     text shown in the "?" help
   *   group           heading in the "?" help
   *   allowWhileTyping  run even when focus is in a text box (default: true for F-keys / Ctrl / Alt)
   *   allowInModal    run while a dialog is open (default false)
   *   repeatable      run again while the key is held down (default false)
   *   when(e)         return false to skip
   *   hidden          do not list in help
   * The function can return false to say "not handled, let the browser continue".
   */
  function bind(combos, run, opts) {
    opts = opts || {};
    [].concat(combos).forEach(function (c) {
      const combo = normalizeCombo(c);
      const h = Object.assign({ combo: combo, run: run }, opts);
      if (h.allowWhileTyping === undefined) h.allowWhileTyping = isSafeWhileTyping(combo);
      if (!handlers.has(combo)) handlers.set(combo, []);
      handlers.get(combo).unshift(h);
    });
  }

  function reserve(combos) {
    [].concat(combos).forEach(function (c) { reserved.add(normalizeCombo(c)); });
  }

  // Find a visible element whose data-shortcut contains this combo
  function findShortcutElement(combo, root) {
    const scope = root || document;
    const els = scope.querySelectorAll('[data-shortcut]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!root && el.closest('[data-modal]')) continue; // modal buttons only work while their modal is open
      const list = el.getAttribute('data-shortcut').split(/\s+/).filter(Boolean).map(normalizeCombo);
      if (list.includes(combo) && isUsable(el)) return el;
    }
    return null;
  }

  function activate(el) {
    const msg = el.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) return;
    if (isTypingTarget(el)) focusEl(el, true);
    else el.click();
  }

  let passThrough = false; // set by PCKeys.passThrough() to let one event reach page code

  function onKeyDown(e) {
    if (passThrough) return;
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    const combo = comboFromEvent(e);
    const typing = isTypingTarget(e.target);
    const modal = getOpenModal();

    if (modal && handleModalKey(e, combo, modal)) return;

    // 1) Explicitly registered handlers (newest first)
    const list = handlers.get(combo) || [];
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (modal && !h.allowInModal) continue;
      if (typing && !h.allowWhileTyping) continue;
      if (h.when && !h.when(e)) continue;
      if (e.repeat && !h.repeatable) { e.preventDefault(); return; }
      if (h.run(e) === false) continue;
      e.preventDefault();
      if (/^(F\d|Ctrl\+|Alt\+|Shift\+F)/.test(combo)) e.stopPropagation();
      return;
    }

    // 2) data-shortcut elements (inside the open modal, or on the page)
    if (!typing || isSafeWhileTyping(combo)) {
      const el = findShortcutElement(combo, modal || null);
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) activate(el);
        return;
      }
    }

    // 3) Block browser defaults such as F5 reload on pages that reserve them
    if (reserved.has(combo)) e.preventDefault();
  }

  /* ------------------------------------------------------------------ *
   * 6. <kbd> hints on buttons that have data-shortcut
   *    Opt out per element with data-shortcut-hint="off"
   * ------------------------------------------------------------------ */

  function decorateHints(root) {
    (root || document).querySelectorAll('[data-shortcut]').forEach(function (el) {
      if (el.getAttribute('data-shortcut-hint') === 'off') return;
      if (isTypingTarget(el) || el.querySelector('.pc-kbd')) return;
      const first = el.getAttribute('data-shortcut').split(/\s+/)[0];
      if (!first) return;
      const kbd = document.createElement('kbd');
      kbd.className = 'pc-kbd';
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = prettyCombo(normalizeCombo(first));
      el.appendChild(kbd);
      if (!el.getAttribute('aria-keyshortcuts')) {
        el.setAttribute('aria-keyshortcuts', el.getAttribute('data-shortcut').replace(/Ctrl/g, 'Control'));
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. "?" help overlay – built from what is really on the page,
   *    so it automatically matches the user's role.
   * ------------------------------------------------------------------ */

  const extraHelp = []; // {keys, description, group} added with PCKeys.describe()
  function describe(keys, description, group) {
    extraHelp.push({ keys: [].concat(keys), description: description, group: group || 'General' });
  }

  function labelOf(el) {
    const own = el.getAttribute('data-shortcut-label') || el.getAttribute('aria-label') || el.getAttribute('title');
    if (own) return own;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.pc-kbd').forEach(function (k) { k.remove(); });
    return clone.textContent.replace(/\s+/g, ' ').replace(/\(F\d+\)/, '').trim() || 'Action';
  }

  function collectHelp() {
    const groups = new Map();
    // group -> (description -> Set of keys), so "J" and "↓" for "Next row" share one line
    function add(group, keys, desc) {
      if (!groups.has(group)) groups.set(group, new Map());
      const g = groups.get(group);
      if (!g.has(desc)) g.set(desc, new Set());
      keys.forEach(function (c) {
        // keep free-text labels such as "3@CODE" or "A–Z" as written
        g.get(desc).add(/^[\w+\/?=\-\[\]]+$/.test(c) && !/@|\*/.test(c) ? prettyCombo(normalizeCombo(c)) : c);
      });
    }
    handlers.forEach(function (list) {
      list.forEach(function (h) {
        if (h.hidden || !h.description || (h.when && h.helpWhen === false)) return;
        add(h.group || 'General', [h.combo], h.description);
      });
    });
    document.querySelectorAll('[data-shortcut]').forEach(function (el) {
      if (!isVisible(el) && !el.closest('[data-modal]')) return;
      const group = el.getAttribute('data-shortcut-group') ||
        (el.closest('[data-modal]') ? 'In dialogs' : el.closest('nav,aside') ? 'Navigation' : 'This page');
      add(group, el.getAttribute('data-shortcut').split(/\s+/).filter(Boolean), labelOf(el));
    });
    extraHelp.forEach(function (x) { add(x.group, x.keys, x.description); });
    add('General', ['?', 'Ctrl+/'], 'Show / hide this help');
    return groups;
  }

  // Full reference shown under "All shortcuts" in the help window.
  // `path`: only listed when the sidebar links to that page (so it follows the user's role).
  const ALL_SHORTCUTS = [
    { title: 'Everywhere', keys: [
      ['? / Ctrl+/', 'Show or hide this help'],
      ['Tab / Shift+Tab', 'Move between fields and buttons'],
      ['Alt+Shift+1 … 0', 'Dashboard, POS, Medicines, Categories, Suppliers, Inventory, Sales history, Reports, Users, Settings'],
      ['Shift+1 … 0', 'Same pages (when not typing in a box)'],
      ['Alt+Shift+B', 'Branches'],
      ['Alt+Shift+L', 'Sign out (asks first)']
    ] },
    { title: 'Dialogs', keys: [
      ['Enter', 'Confirm (in a text box)'],
      ['Ctrl+Enter', 'Confirm from anywhere in the dialog'],
      ['Esc', 'Close / cancel'],
      ['Tab', 'Stays inside the dialog']
    ] },
    { title: 'Point of Sale – actions', path: '/pos', keys: [
      ['F1', 'New transaction'], ['F2', 'Void a transaction'], ['F3', 'Search medicine'],
      ['F4', 'Price & stock check'], ['F5 / Ctrl+Enter', 'Complete sale'], ['F6', 'Customer lookup / new customer'],
      ['Shift+F6', 'Remove customer from the sale'], ['Alt+N', 'New customer (in the Customer dialog)'],
      ['F7', 'Discount'], ['F8', 'Amount received / reference no.'], ['Shift+F8', 'Exact cash amount'],
      ['F9', 'Next payment method'], ['F10', 'Print last receipt'], ['Ctrl+Delete', 'Clear cart']
    ] },
    { title: 'Point of Sale – search, grid and cart', path: '/pos', keys: [
      ['A–Z / 0–9', 'Start typing or scan a barcode anywhere'], ['3@CODE / 3*CODE', 'Add 3 pieces by code'],
      ['Enter', 'Add the code match or pick a result'], ['↑ / ↓', 'Move through search results'],
      ['Alt+G', 'Go to the product grid'], ['Arrows + Enter', 'Move in the grid / add one piece'],
      ['Ctrl+↓', 'Go to the cart'], ['Ctrl+↑', 'Back to search'], ['↑ / ↓', 'Next / previous cart item'],
      ['+ / −', 'Quantity +1 / −1'], ['Enter', 'Type a quantity for the item'],
      ['Delete', 'Remove the item'], ['Esc', 'Step back / clear search']
    ] },
    { title: 'Receipt', path: '/pos', keys: [['P / F10', 'Print receipt'], ['N / F1', 'New transaction']] },
    { title: 'Lists and tables', keys: [
      ['J / ↓', 'Next row'], ['K / ↑', 'Previous row'], ['Home / End', 'First / last row'],
      ['Enter', 'Open the selected row'], ['/', 'Focus search'], ['F', 'Focus filters'],
      ['Esc', 'Leave search, back to the table']
    ] },
    { title: 'Forms', keys: [
      ['Ctrl+S / Ctrl+Enter', 'Save'], ['Esc', 'Leave the field'], ['Esc twice', 'Cancel (asks if there are changes)']
    ] },
    { title: 'Dashboard', path: '/dashboard', keys: [
      ['L', 'Low-stock medicines'], ['X', 'Expiring medicines'], ['T', 'Transactions'],
      ['M', 'Monthly sales (admin, pharmacist)'], ['Y', 'Yearly sales (admin, pharmacist)']
    ] },
    { title: 'Medicines', path: '/medicines', keys: [['N', 'Add medicine (admin)'], ['Enter', 'Medicine details']] },
    { title: 'Categories', path: '/categories', keys: [['N', 'Add category'], ['E', 'Edit name of selected row'], ['Delete', 'Delete unused category']] },
    { title: 'Suppliers', path: '/suppliers', keys: [['N', 'Add supplier'], ['E', 'Edit selected supplier'], ['Delete', 'Delete unused supplier']] },
    { title: 'Inventory', path: '/inventory', keys: [['A', 'Adjust stock of selected row'], ['Enter', 'Open the medicine']] },
    { title: 'Sales history', path: '/transactions', keys: [
      ['T', 'Transactions list'], ['D / M / Y', 'Daily / Monthly / Yearly totals (admin, pharmacist)'],
      ['Enter', 'Open the receipt, or the transactions of the selected period']
    ] },
    { title: 'Reports', path: '/reports', keys: [['X', 'Export CSV'], ['P', 'Print']] },
    { title: 'Branches', path: '/branches', keys: [['N', 'Add branch'], ['E', 'Rename selected branch'], ['Enter', 'View its sales']] },
    { title: 'User management', path: '/users', keys: [
      ['N', 'Add user'], ['B', 'Change branch (then Ctrl+S)'], ['Delete', 'Activate / deactivate']
    ] },
    { title: 'Settings', path: '/settings', keys: [['S', 'Store settings'], ['T', 'Tax rate'], ['Ctrl+S', 'Save']] }
  ];

  function userCanOpen(path) {
    return location.pathname.indexOf(path) === 0 ||
      Boolean(document.querySelector('nav a[href="' + path + '"]'));
  }

  function helpSection(title, rows) {
    return '<section class="pc-help-section"><h3>' + escapeHtml(title) + '</h3><div class="pc-help-grid">' +
      rows.map(function (row) {
        return '<div class="pc-help-row"><span>' + escapeHtml(row[1]) + '</span><kbd>' + escapeHtml(row[0]) + '</kbd></div>';
      }).join('') + '</div></section>';
  }

  // Typing in the filter box hides rows (and empty sections) that do not match
  function filterHelp(box, text) {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    box.querySelectorAll('.pc-help-section').forEach(function (section) {
      let shown = 0;
      section.querySelectorAll('.pc-help-row').forEach(function (row) {
        const hay = (section.querySelector('h3').textContent + ' ' + row.textContent).toLowerCase();
        const match = words.every(function (w) { return hay.indexOf(w) !== -1; });
        row.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      section.style.display = shown ? '' : 'none';
    });
  }

  let helpEl = null;
  function toggleHelp() {
    if (helpEl && isVisible(helpEl)) { closeModal(helpEl); return; }
    if (helpEl) helpEl.remove();
    helpEl = document.createElement('div');
    helpEl.className = 'pc-help-overlay';
    helpEl.setAttribute('data-modal', '');
    helpEl.setAttribute('aria-label', 'Keyboard shortcuts');
    const box = document.createElement('div');
    box.className = 'pc-help-box';
    let html = '<h2>Keyboard shortcuts</h2>' +
      '<input type="search" class="pc-help-filter" autofocus placeholder="Type to find a shortcut (e.g. void, print, F5)…" aria-label="Find a shortcut">' +
      '<h2 class="pc-help-part">On this page</h2>';
    collectHelp().forEach(function (items, group) {
      const rows = [];
      items.forEach(function (keys, desc) { rows.push([Array.from(keys).join(' / '), desc]); });
      html += helpSection(group, rows);
    });
    html += '<h2 class="pc-help-part">All shortcuts</h2>';
    ALL_SHORTCUTS.forEach(function (section) {
      if (!section.path || userCanOpen(section.path)) html += helpSection(section.title, section.keys);
    });
    html += '<p style="margin-top:1rem;color:#64748b">Press <kbd>Esc</kbd> to close.</p>' +
      '<button type="button" data-modal-cancel style="margin-top:.5rem;padding:.4rem .9rem;' +
      'border-radius:.4rem;background:#15803d;color:#fff;border:0">Close</button>';
    box.innerHTML = html;
    box.querySelector('.pc-help-filter').addEventListener('input', function (ev) { filterHelp(box, ev.target.value); });
    helpEl.appendChild(box);
    const overlay = helpEl;
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay || ev.target.hasAttribute('data-modal-cancel')) {
        // Remove it outright: the overlay's display:flex would otherwise keep a
        // [hidden] overlay on screen while the code treats it as closed.
        overlay.remove();
        if (helpEl === overlay) helpEl = null;
        checkModals();
      }
    });
    document.body.appendChild(helpEl);
    checkModals();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addHelpChip() {
    if (document.body.hasAttribute('data-no-shortcut-chip')) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pc-help-chip';
    chip.textContent = 'Shortcuts  ?';
    chip.setAttribute('aria-label', 'Show keyboard shortcuts');
    chip.tabIndex = -1; // reachable by "?" key, no need to tab to it
    chip.addEventListener('click', toggleHelp);
    document.body.appendChild(chip);
  }

  /* ------------------------------------------------------------------ *
   * 8. Start
   * ------------------------------------------------------------------ */

  bind(['?', 'Ctrl+/'], function () { toggleHelp(); }, { allowInModal: true, hidden: true });

  function init() {
    injectStyles();
    decorateHints();
    addHelpChip();
    checkModals();
    // Re-check when the page changes (results lists, cart rows, modals)
    let scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        decorateHints();
        checkModals();
      });
    }).observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'open', 'disabled'] });
  }

  window.addEventListener('keydown', onKeyDown, true); // capture: runs before page handlers

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public API
  window.PCKeys = {
    bind: bind,
    reserve: reserve,
    describe: describe,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    getOpenModal: getOpenModal,
    toggleHelp: toggleHelp,
    isTypingTarget: isTypingTarget,
    isVisible: isVisible,
    isUsable: isUsable,
    focus: focusEl,
    normalizeCombo: normalizeCombo,
    comboFromEvent: comboFromEvent,
    prettyCombo: prettyCombo,
    // Let ONE synthetic event reach your own page handlers without PCKeys touching it
    passThrough: function (fn) { passThrough = true; try { fn(); } finally { passThrough = false; } }
  };
})(window, document);
