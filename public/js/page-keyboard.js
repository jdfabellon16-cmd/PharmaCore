/**
 * PharmaCore – Keyboard handlers for list, table and form pages
 * File: public/js/page-keyboard.js
 *
 * Load on every page EXCEPT the POS, after keyboard-core.js:
 *   Medicines, Categories, Suppliers, Transactions, Inventory Monitoring,
 *   Inventory Adjustments, Reports, User Management, Settings.
 *
 * Tables  (<table data-keyboard-table>)
 *   J / ↓  next row          K / ↑  previous row
 *   Enter  open row          + any key you put on a row button with data-row-key
 *          (E = edit, A = adjust stock, R = reprint, V = void, Delete = delete …)
 *          A data-row-key on a text field moves the cursor into it.
 * Search & filters
 *   /      focus search      F  focus first filter
 * Forms  (<form data-keyboard-form>)
 *   Ctrl+S or Ctrl+Enter  save        Esc  leave field, Esc again = cancel
 *   Cancel clicks [data-form-cancel] if there is one, otherwise it clears the form.
 * Anything else: put data-shortcut="N" (or "P", "X", "[", "]", "1"…) on the button.
 */
(function (window, document) {
  'use strict';

  const K = window.PCKeys;
  if (!K) {
    console.error('[PharmaCore] Load /js/keyboard-core.js before /js/page-keyboard.js');
    return;
  }

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------------ *
   * 1. Keyboard table navigation
   * ------------------------------------------------------------------ */

  let current = null; // the selected <tr>

  function tables() { return $$('table[data-keyboard-table]').filter(K.isVisible); }
  function rowsOf(table) {
    return $$('tbody > tr', table).filter(function (r) { return K.isVisible(r) && !r.hasAttribute('data-no-row'); });
  }
  function allRows() {
    return tables().reduce(function (acc, t) { return acc.concat(rowsOf(t)); }, []);
  }

  function selectRow(row) {
    if (!row) return;
    if (current && current !== row) {
      current.classList.remove('pc-row-active');
      current.removeAttribute('aria-selected');
    }
    current = row;
    row.classList.add('pc-row-active');
    row.setAttribute('aria-selected', 'true');
    if (!row.hasAttribute('tabindex')) row.tabIndex = -1;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  }

  function moveRow(delta) {
    const rows = allRows();
    if (!rows.length) return false;
    let i = current && current.isConnected ? rows.indexOf(current) : -1;
    if (i === -1) i = delta > 0 ? -1 : rows.length;
    selectRow(rows[Math.max(0, Math.min(rows.length - 1, i + delta))]);
  }

  function rowHasFocus() {
    return current && current.isConnected && current.contains(document.activeElement);
  }

  // Row keys: <a data-row-key="E" href="/medicines/5/edit">Edit</a>
  function rowElementFor(row, combo) {
    const els = $$('[data-row-key]', row);
    for (let i = 0; i < els.length; i++) {
      const keys = els[i].getAttribute('data-row-key').split(/\s+/).filter(Boolean).map(K.normalizeCombo);
      if (keys.includes(combo)) return els[i];
    }
    return null;
  }

  function activate(el) {
    const msg = el.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) return;
    if (K.isTypingTarget(el)) { K.focus(el, true); return; } // e.g. "A" → the row's quantity box
    el.click();
    // <summary data-row-key="E">Edit</summary>: open it and go to its first field
    if (el.tagName === 'SUMMARY' && el.parentElement.open) {
      const field = el.parentElement.querySelector('input:not([type=hidden]),select,textarea');
      if (field) K.focus(field, true);
    }
  }

  K.bind(['J', 'ArrowDown'], function (e) {
    if (e.key === 'ArrowDown' && !rowHasFocus()) return false; // let ↓ scroll the page normally
    return moveRow(1);
  }, { repeatable: true, description: 'Next row', group: 'Tables' });

  K.bind(['K', 'ArrowUp'], function (e) {
    if (e.key === 'ArrowUp' && !rowHasFocus()) return false;
    return moveRow(-1);
  }, { repeatable: true, description: 'Previous row', group: 'Tables' });

  K.bind(['Home'], function () { const r = allRows(); if (!r.length) return false; selectRow(r[0]); },
    { when: rowHasFocus, hidden: true });
  K.bind(['End'], function () { const r = allRows(); if (!r.length) return false; selectRow(r[r.length - 1]); },
    { when: rowHasFocus, hidden: true });

  // Any key on the selected row → its matching data-row-key element.
  // Enter/O fall back to the first link in the row.
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.repeat || !rowHasFocus() || K.getOpenModal()) return;
    if (K.isTypingTarget(e.target)) return;
    const combo = K.comboFromEvent(e);
    let el = rowElementFor(current, combo);
    if (!el && (combo === 'Enter' || combo === 'O') && e.target === current) el = $('a[href]', current);
    if (!el || !K.isUsable(el)) return;
    e.preventDefault();
    e.stopPropagation();
    activate(el);
  }, true);

  // Clicking a row with the mouse also selects it (so mouse + keyboard stay in sync)
  document.addEventListener('click', function (e) {
    const row = e.target.closest && e.target.closest('table[data-keyboard-table] tbody > tr');
    if (row && !row.hasAttribute('data-no-row')) {
      if (current) current.classList.remove('pc-row-active');
      current = row;
      row.classList.add('pc-row-active');
    }
  });

  /* ------------------------------------------------------------------ *
   * 2. Search and filters
   * ------------------------------------------------------------------ */

  K.bind('/', function () {
    const s = $('[data-page-search]') || $('input[type=search]');
    if (!s || !K.isUsable(s)) return false;
    K.focus(s, true);
  }, { description: 'Focus search', group: 'This page' });

  K.bind('F', function () {
    const f = $$('[data-page-filter]').find(K.isUsable);
    if (!f) return false;
    K.focus(f, true);
  }, { description: 'Focus filters', group: 'This page' });

  // Enter in a search box that is not in a form: click its search button if it has one
  K.bind('Enter', function (e) {
    const btn = $('[data-page-search-submit]');
    if (!btn || !K.isUsable(btn)) return false;
    btn.click();
  }, { allowWhileTyping: true, hidden: true, when: function (e) { return e.target.matches('[data-page-search]') && !e.target.form; } });

  // Esc in search/filter → back to the table
  K.bind('Escape', function (e) {
    const t = e.target;
    if (!t.matches('[data-page-search],[data-page-filter],input[type=search]')) return false;
    t.blur();
    const rows = allRows();
    if (rows.length) selectRow(current && current.isConnected ? current : rows[0]);
  }, { allowWhileTyping: true, hidden: true });

  /* ------------------------------------------------------------------ *
   * 3. Forms: Add / Edit Medicine, Supplier, Category, User, Settings,
   *           Inventory Adjustment …
   * ------------------------------------------------------------------ */

  // The keyboard form the user is working in (focus is inside it)
  function focusedForm() {
    const a = document.activeElement;
    return (a && a.closest && a.closest('form[data-keyboard-form]')) || null;
  }
  // For saving: the focused form, or the page's only keyboard form
  function formToSave() {
    const f = focusedForm();
    if (f) return f;
    const visible = $$('form[data-keyboard-form]').filter(K.isVisible);
    return visible.length === 1 ? visible[0] : null;
  }

  const dirty = new WeakSet();
  document.addEventListener('input', function (e) {
    const f = e.target.closest && e.target.closest('form[data-keyboard-form]');
    if (f) dirty.add(f);
  });
  document.addEventListener('submit', function (e) {
    if (e.target.matches && e.target.matches('form[data-keyboard-form]')) dirty.delete(e.target);
  }, true);
  window.addEventListener('beforeunload', function (e) {
    const unsaved = $$('form[data-keyboard-form]').some(function (f) { return dirty.has(f); });
    if (unsaved) { e.preventDefault(); e.returnValue = ''; }
  });

  K.bind(['Ctrl+S', 'Ctrl+Enter'], function () {
    const form = formToSave();
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') form.requestSubmit(); // runs HTML validation + your submit handlers
    else form.submit();
  }, { description: 'Save form', group: 'Forms' });

  // First Esc leaves the field; second Esc cancels the form
  K.bind('Escape', function (e) {
    const form = e.target.closest && e.target.closest('form[data-keyboard-form]');
    if (!form || e.target === form) return false;
    e.target.blur();
    if (!form.hasAttribute('tabindex')) form.tabIndex = -1;
    form.focus({ preventScroll: true });
    K.toast('Press Esc again to cancel, Ctrl+S to save.', 'info', 1800);
  }, { allowWhileTyping: true, hidden: true });

  // Only when the user is in the form (after the first Esc): never cancel a form
  // from elsewhere on the page.
  K.bind('Escape', function () {
    const form = focusedForm();
    if (!form || document.activeElement !== form) return false;
    if (dirty.has(form) && !window.confirm('Discard your changes?')) return;
    dirty.delete(form);
    const cancel = $('[data-form-cancel]', form) || $('[data-form-cancel]');
    if (cancel) { cancel.click(); return; }
    // Forms that sit on a list page (no cancel link): clear them instead of leaving the page
    form.reset();
    form.blur();
    K.toast('Form cleared.', 'info', 1400);
  }, { description: 'Cancel form (Esc twice from a field)', group: 'Forms' });

  /* ------------------------------------------------------------------ *
   * 4. Help entries for the row keys on this page
   * ------------------------------------------------------------------ */

  function describeRowKeys() {
    const first = allRows()[0];
    if (!first) return;
    $$('[data-row-key]', first).forEach(function (el) {
      const label = el.getAttribute('data-shortcut-label') || el.getAttribute('title') || el.textContent.trim();
      K.describe(el.getAttribute('data-row-key').split(/\s+/), label + ' (selected row)', 'Tables');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', describeRowKeys);
  else describeRowKeys();
})(window, document);
