/**
 * PharmaCore – POS Keyboard Handlers
 * File: public/js/pos-keyboard.js
 *
 * Load ONLY on the Point of Sale page, AFTER keyboard-core.js:
 *   <script src="/js/keyboard-core.js" defer></script>
 *   <script src="/js/pos-keyboard.js" defer></script>
 *
 * The whole checkout can be done without a mouse:
 *
 *   F1  New transaction          F6  Customer lookup
 *   F2  Void transaction         F7  Discount (Senior / PWD)
 *   F3  Search medicine          F8  Payment (amount / reference no.)
 *   F4  Price & stock check      Shift+F8  Exact cash amount
 *   F5  Complete sale            F9  Next payment method
 *   F10 Print last receipt       Ctrl+Delete  Clear cart
 *   Ctrl+↓ go to cart, Ctrl+↑ back to search, Esc = back / close
 *
 * These handlers only TRIGGER your existing buttons and functions.
 * Stock, expiry, prices and totals must still be validated on the server.
 */
(function (window, document) {
  'use strict';

  const K = window.PCKeys;
  if (!K) {
    console.error('[PharmaCore] Load /js/keyboard-core.js before /js/pos-keyboard.js');
    return;
  }

  /* ------------------------------------------------------------------ *
   * 1. Settings – change these if your element IDs are different.
   *    You can also override them before this script loads:
   *      <script>window.PHARMACORE_POS_CONFIG = { search: '#mySearch' };</script>
   * ------------------------------------------------------------------ */

  const DEFAULTS = {
    search: '#medicineSearch',            // the search / barcode input
    results: '#medicineResults',          // container of search results
    resultItem: '[data-medicine-result]', // one result (preferably a <button>)
    cart: '#cartItems',                   // container (e.g. <tbody>) of cart lines
    cartLine: '[data-cart-line]',         // one cart line (e.g. <tr>)
    qtyInput: '[data-qty-input]',         // quantity input inside a line
    qtyInc: '[data-qty-inc]',             // "+" button inside a line
    qtyDec: '[data-qty-dec]',             // "−" button inside a line
    removeLine: '[data-remove-line]',     // remove button inside a line
    paymentMethod: '#paymentMethod',      // <select> cash / gcash / maya / card
    amountReceived: '#amountReceived',
    paymentReference: '#paymentReference',
    total: '#totalAmount',                // element showing the grand total (data-value="123.20" preferred)

    // Your EXISTING buttons that already contain the real logic
    buttons: {
      newTransaction: '#newTransactionBtn',
      void: '#voidBtn',
      priceCheck: '#priceCheckBtn',
      complete: '#completeSaleBtn',
      customer: '#customerBtn',
      discount: '#discountBtn',
      rxVerify: '#rxVerifyBtn',
      print: '#printReceiptBtn',
      clearCart: '#clearCartBtn'
    },
    // Used only if there is no button above: the modal is simply shown
    modals: {
      void: '#voidModal',
      priceCheck: '#priceCheckModal',
      customer: '#customerModal',
      discount: '#discountModal',
      rxVerify: '#rxModal'
    },

    searchWaitMs: 1500,          // how long to wait for search results after Enter / a scan
    clearSearchAfterAdd: true,   // empty the search box after a medicine is added
    confirmNewTransaction: true  // ask before F1 throws away a non-empty cart
  };

  const user = window.PHARMACORE_POS_CONFIG || {};
  const CFG = Object.assign({}, DEFAULTS, user, {
    buttons: Object.assign({}, DEFAULTS.buttons, user.buttons),
    modals: Object.assign({}, DEFAULTS.modals, user.modals)
  });

  // Optional: your own functions. If window.PharmaPOS.addToCart exists it is
  // used instead of clicking. Supported: addToCart(id, qty), addByCode(code, qty),
  // setQuantity(lineId, qty), removeLine(lineId), newTransaction(), void(),
  // priceCheck(), complete(), customer(), discount(), rxVerify(), print(), clearCart()
  // addByCode may return false to say "nothing was added" (e.g. several matches
  // were listed instead); the search box is then left as it is.
  function api(name) {
    const a = window.PharmaPOS;
    return a && typeof a[name] === 'function' ? a[name].bind(a) : null;
  }

  /* ------------------------------------------------------------------ *
   * 2. Helpers
   * ------------------------------------------------------------------ */

  const $ = function (sel, root) { return sel ? (root || document).querySelector(sel) : null; };
  const $$ = function (sel, root) { return sel ? Array.from((root || document).querySelectorAll(sel)) : []; };

  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function setValue(el, value) { el.value = value; fire(el, 'input'); fire(el, 'change'); }
  function money(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? NaN : n;
  }
  function peso(n) { return '₱' + Number(n).toFixed(2); }

  const searchBox = function () { return $(CFG.search); };
  const results = function () { return $$(CFG.resultItem, $(CFG.results) || document).filter(K.isVisible); };
  const cartLines = function () { return $$(CFG.cartLine, $(CFG.cart) || document).filter(K.isVisible); };
  const cartCount = function () { return cartLines().length; };
  const lineKey = function (line) { return line && (line.dataset.lineId || line.dataset.medicineId || ''); };
  const lineName = function (line) {
    return line.dataset.name || (line.querySelector('td,div') || line).textContent.trim().split('\n')[0];
  };
  // The POS shortcuts only apply while the sale screen is showing
  // (e.g. not while another tab such as Transactions covers it).
  const posActive = function () { const s = searchBox(); return !s || K.isVisible(s); };

  function findLine(key) {
    if (!key) return null;
    return cartLines().find(function (l) { return lineKey(l) === String(key) || l.dataset.medicineId === String(key); }) || null;
  }
  function lineQty(line) {
    if (!line) return 0;
    const input = $(CFG.qtyInput, line);
    const q = parseInt(input ? input.value : line.dataset.qty, 10);
    return isNaN(q) ? 0 : q;
  }
  function grandTotal() {
    const el = $(CFG.total);
    if (!el) return NaN;
    return money(el.dataset.value != null ? el.dataset.value : (el.value != null ? el.value : el.textContent));
  }
  function isCash() {
    const m = $(CFG.paymentMethod);
    return !m || String(m.value).toLowerCase() === 'cash';
  }
  function waitFor(test, ms) {
    return new Promise(function (resolve) {
      const start = Date.now();
      (function poll() {
        if (test()) return resolve(true);
        if (Date.now() - start > ms) return resolve(false);
        setTimeout(poll, 40);
      })();
    });
  }

  // Run an action: your function → your button → show the modal
  function trigger(name) {
    const fn = api(name);
    if (fn) { fn(); return true; }
    const btn = $(CFG.buttons[name]);
    if (btn && !btn.matches('[data-pos-action]')) {
      if (!K.isUsable(btn)) return false;
      btn.click();
      return true;
    }
    if (CFG.modals[name] && $(CFG.modals[name])) return K.openModal(CFG.modals[name]);
    return false;
  }

  // Don't lose a cart by refreshing / closing the tab
  let unloadOkUntil = 0;
  function allowUnloadFor(ms) { unloadOkUntil = Date.now() + ms; }
  window.addEventListener('beforeunload', function (e) {
    if (Date.now() < unloadOkUntil || cartCount() === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ------------------------------------------------------------------ *
   * 3. Actions (shared by keys and by the action bar buttons)
   * ------------------------------------------------------------------ */

  function focusSearch() {
    const s = searchBox();
    if (!s) { K.toast('Search box not found (' + CFG.search + ')', 'error'); return; }
    K.focus(s, true);
  }

  function newTransaction() {
    if (cartCount() > 0 && CFG.confirmNewTransaction &&
        !window.confirm('Start a new transaction? The current cart will be cleared.')) return;
    allowUnloadFor(5000);
    if (!trigger('newTransaction')) { K.toast('New transaction is not set up on this page.', 'warn'); return; }
    setTimeout(focusSearch, 60);
  }

  function openOrWarn(name, label) {
    if (!trigger(name)) K.toast(label + ' is not available here.', 'warn');
  }

  function paymentField() {
    const ref = $(CFG.paymentReference);
    if (!isCash() && ref && K.isVisible(ref)) return ref;
    return $(CFG.amountReceived);
  }

  function focusPayment() {
    const el = paymentField();
    if (!el || !K.isUsable(el)) { K.toast('Payment field is not available.', 'warn'); return; }
    K.focus(el, true);
  }

  function exactAmount() {
    if (!isCash()) { K.toast('Exact amount is for cash payments only.', 'warn'); return; }
    const t = grandTotal();
    const amount = $(CFG.amountReceived);
    if (!amount) return;
    if (!(t > 0)) { K.toast('Cart is empty.', 'warn'); return; }
    setValue(amount, t.toFixed(2));
    K.focus(amount, true);
    K.toast('Amount received set to ' + peso(t), 'success', 1500);
  }

  function nextPaymentMethod() {
    const sel = $(CFG.paymentMethod);
    if (!sel) return;
    const opts = Array.from(sel.options).filter(function (o) { return !o.disabled && o.value; });
    if (!opts.length) return;
    const i = opts.findIndex(function (o) { return o.value === sel.value; });
    setValue(sel, opts[(i + 1) % opts.length].value);
    K.toast('Payment method: ' + sel.options[sel.selectedIndex].text, 'success', 1400);
    setTimeout(focusPayment, 0); // the reference field may appear for GCash / Maya / Card
  }

  function printReceipt() {
    const btn = $(CFG.buttons.print);
    if (btn && K.isUsable(btn)) { btn.click(); return; }
    const fn = api('print');
    if (fn) { fn(); return; }
    K.toast('No completed sale to print yet.', 'warn');
  }

  function clearCart() {
    if (cartCount() === 0) { K.toast('Cart is already empty.'); return; }
    if (!trigger('clearCart')) { K.toast('Clear cart is not set up on this page.', 'warn'); return; }
    setTimeout(focusSearch, 60);
  }

  let checkoutLockUntil = 0;
  function completeSale() {
    if (Date.now() < checkoutLockUntil) return; // stops double F5 / double Enter
    if (cartCount() === 0) { K.toast('Cart is empty — press F3 and add a medicine first.', 'error'); return; }

    // Prescription medicines must be verified first
    const pending = cartLines().filter(function (l) {
      return l.dataset.rxRequired === 'true' && l.dataset.rxVerified !== 'true';
    });
    if (pending.length) {
      K.toast('Prescription check needed: ' + pending.map(lineName).join(', '), 'warn', 3500);
      if (!trigger('rxVerify')) K.toast('Ask the pharmacist to verify the prescription.', 'warn');
      return;
    }

    // Quick checks so the cashier gets instant feedback (the server checks again)
    if (isCash()) {
      const amount = $(CFG.amountReceived);
      const t = grandTotal();
      const got = amount ? money(amount.value) : NaN;
      if (amount && !isNaN(t) && (isNaN(got) || got < t)) {
        K.toast('Amount received is less than the total (' + peso(t) + ').', 'error');
        focusPayment();
        return;
      }
    } else {
      const ref = $(CFG.paymentReference);
      if (ref && K.isVisible(ref) && !ref.value.trim()) {
        K.toast('Enter the payment reference number.', 'error');
        K.focus(ref, true);
        return;
      }
    }

    checkoutLockUntil = Date.now() + 2500;
    allowUnloadFor(10000);
    if (!trigger('complete')) {
      checkoutLockUntil = 0;
      K.toast('Checkout is not available right now.', 'error');
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. Search, barcode scanning and "3@CODE" quantities
   * ------------------------------------------------------------------ */

  let lastInputAt = 0;
  let lastResultsAt = 0;
  let searching = false;

  function pickResult(list, query) {
    const q = query.toLowerCase();
    const exact = list.find(function (r) {
      return [r.dataset.medicineCode, r.dataset.barcode].some(function (c) { return c && c.toLowerCase() === q; });
    });
    if (exact) return exact;
    return list.length === 1 ? list[0] : null;
  }

  function waitForFreshResults() {
    const since = lastInputAt;
    return new Promise(function (resolve) {
      const start = Date.now();
      (function poll() {
        const fresh = lastResultsAt > since;
        const list = results();
        if (fresh && list.length) return resolve(list);
        if (fresh && !list.length && Date.now() - lastResultsAt > 300) return resolve([]); // "no results"
        if (Date.now() - start > CFG.searchWaitMs) return resolve(null);                // nothing happened
        setTimeout(poll, 40);
      })();
    });
  }

  async function addResult(el, qty) {
    if (!el) return false;
    const blocked = el.disabled || el.dataset.expired === 'true' || el.dataset.available === 'false';
    if (blocked) {
      K.toast(el.dataset.blockReason || 'This medicine cannot be sold (expired or out of stock).', 'error', 3000);
      return false;
    }
    const id = el.dataset.medicineId;
    const stock = parseInt(el.dataset.stock, 10);
    const already = lineQty(findLine(id));
    if (!isNaN(stock) && already + qty > stock) {
      K.toast('Only ' + stock + ' in stock' + (already ? ' (' + already + ' already in cart)' : '') + '.', 'error', 3000);
      return false;
    }

    const add = api('addToCart');
    if (add && id) {
      await add(id, qty);
    } else {
      el.click(); // your existing "add to cart" click handler
      if (qty > 1) {
        await waitFor(function () { return lineQty(findLine(id)) > already; }, CFG.searchWaitMs);
        setLineQty(findLine(id), already + qty);
      }
    }
    afterAdd();
    return true;
  }

  function afterAdd() {
    const s = searchBox();
    if (!s) return;
    if (CFG.clearSearchAfterAdd && s.value) { s.value = ''; fire(s, 'input'); }
    setTimeout(focusSearch, 30);
  }

  async function submitSearch() {
    if (searching) return;
    const s = searchBox();
    let query = s.value.trim();
    let qty = 1;

    if (!query) { if (results().length) results()[0].focus(); return; }

    // "3@PCM500" or "3*PCM500" → 3 pieces of PCM500 (the scanner sends the code after you type 3@)
    const m = query.match(/^(\d{1,4})\s*[@*]\s*(.+)$/);
    if (m) {
      qty = parseInt(m[1], 10);
      query = m[2].trim();
      if (qty < 1) { K.toast('Quantity must be at least 1.', 'error'); return; }
      s.value = query;
      lastInputAt = Date.now();
      fire(s, 'input');
    }

    searching = true;
    try {
      const byCode = api('addByCode');
      if (byCode) {
        if ((await byCode(query, qty)) !== false) afterAdd();
        return;
      }

      let list = await waitForFreshResults();
      if (list === null) {
        // Your search may only run on Enter: let your own Enter handler run once
        const before = cartCount();
        lastInputAt = Date.now();
        K.passThrough(function () {
          s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        });
        list = await waitForFreshResults();
        if (cartCount() !== before) { afterAdd(); return; } // your handler already added it
      }
      if (!list || !list.length) { K.toast('No medicine found for "' + query + '".', 'error'); K.focus(s, true); return; }

      const pick = pickResult(list, query);
      if (pick) { await addResult(pick, qty); return; }
      list[0].focus();
      K.toast(list.length + ' matches — use ↑/↓ then Enter.', 'info', 2000);
    } finally {
      searching = false;
    }
  }

  // Start typing anywhere (or scan a barcode) → it goes into the search box
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!e.key || e.key.length !== 1 || e.key === ' ') return;
    if (e.shiftKey && /^Digit\d$/.test(e.code)) return; // Shift+1…0 = sidebar navigation
    if (K.isTypingTarget(e.target) || K.getOpenModal()) return;
    const s = searchBox();
    if (!s || !K.isUsable(s)) return;
    e.preventDefault();
    s.focus();
    s.value = e.key;
    lastInputAt = Date.now();
    fire(s, 'input');
  }, true);

  /* ------------------------------------------------------------------ *
   * 5. Cart lines
   * ------------------------------------------------------------------ */

  let lastCartFocus = { key: null, index: 0, at: 0 };

  function focusLine(line) {
    if (!line) return;
    if (!line.hasAttribute('tabindex')) line.tabIndex = 0;
    line.focus();
    line.scrollIntoView({ block: 'nearest' });
    lastCartFocus = { key: lineKey(line), index: cartLines().indexOf(line), at: Date.now() };
  }

  function focusCart(which) {
    const lines = cartLines();
    if (!lines.length) { K.toast('Cart is empty.'); return; }
    focusLine(which === 'first' ? lines[0] : lines[lines.length - 1]);
  }

  function moveLine(line, delta) {
    const lines = cartLines();
    const i = lines.indexOf(line);
    if (delta < 0 && i === 0) { focusSearch(); return; }
    focusLine(lines[Math.max(0, Math.min(lines.length - 1, i + delta))]);
  }

  function setLineQty(line, qty) {
    if (!line) return;
    const fn = api('setQuantity');
    if (fn) { fn(lineKey(line), qty); return; }
    const input = $(CFG.qtyInput, line);
    if (input) { setValue(input, qty); return; }
    // No input: press the +/− buttons the right number of times
    const diff = qty - lineQty(line);
    const btn = $(diff > 0 ? CFG.qtyInc : CFG.qtyDec, line);
    for (let i = 0; btn && i < Math.abs(diff); i++) btn.click();
  }

  function changeQty(line, delta) {
    const qty = lineQty(line);
    const stock = parseInt(line.dataset.stock, 10);
    if (delta > 0 && !isNaN(stock) && qty + delta > stock) { K.toast('Only ' + stock + ' in stock.', 'warn'); return; }
    if (delta < 0 && qty <= 1) { K.toast('Quantity is 1 — press Delete to remove the item.', 'warn'); return; }
    const btn = $(delta > 0 ? CFG.qtyInc : CFG.qtyDec, line);
    if (!api('setQuantity') && btn && K.isUsable(btn)) btn.click();
    else setLineQty(line, qty + delta);
    lastCartFocus = { key: lineKey(line), index: cartLines().indexOf(line), at: Date.now() };
  }

  function removeLine(line) {
    const index = cartLines().indexOf(line);
    lastCartFocus = { key: null, index: index, at: Date.now() };
    const fn = api('removeLine');
    if (fn) fn(lineKey(line));
    else {
      const btn = $(CFG.removeLine, line);
      if (btn) btn.click();
      else { K.toast('Remove button not found in this cart line.', 'error'); return; }
    }
    setTimeout(restoreCartFocus, 50);
  }

  // After your code re-renders the cart, put focus back on the same line
  function restoreCartFocus() {
    if (Date.now() - lastCartFocus.at > 2000) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const lines = cartLines();
    if (!lines.length) { focusSearch(); return; }
    focusLine(findLine(lastCartFocus.key) || lines[Math.min(lastCartFocus.index, lines.length - 1)]);
  }

  const inLine = function (e) {
    const line = e.target.closest && e.target.closest(CFG.cartLine);
    return line && e.target === line ? line : null;
  };
  const inQtyInput = function (e) { return e.target.matches && e.target.matches(CFG.qtyInput); };
  const isResult = function (e) { return e.target.matches && e.target.matches(CFG.resultItem); };

  /* Product grid (Settings → Show product grid): Alt+G, then arrows; Enter adds */
  const isTile = function (e) { return e.target.matches && e.target.matches('[data-grid-medicine]'); };
  const tiles = function () { return $$('[data-grid-medicine]').filter(K.isVisible); };
  function focusGrid() {
    const list = tiles();
    if (!list.length) { K.toast('The product grid is off. An admin can turn it on in Settings.', 'warn'); return; }
    list[0].focus();
  }
  function moveTile(e, direction) {
    const list = tiles();
    const i = list.indexOf(e.target);
    const columns = list.filter(function (t) { return t.offsetTop === list[0].offsetTop; }).length || 1;
    let j = { left: i - 1, right: i + 1, up: i - columns, down: i + columns }[direction];
    if (direction === 'up' && j < 0) { focusSearch(); return; }
    j = Math.max(0, Math.min(list.length - 1, j));
    list[j].focus();
    list[j].scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ *
   * 6. Key bindings
   * ------------------------------------------------------------------ */

  // Like K.bind, but only while the sale screen is showing
  function bindPos(keys, run, opts) {
    opts = Object.assign({}, opts);
    const extra = opts.when;
    opts.when = function (e) { return posActive() && (!extra || extra(e)); };
    K.bind(keys, run, opts);
  }

  const G = 'Point of Sale';
  bindPos('F1', newTransaction, { description: 'New transaction', group: G });
  bindPos('F2', function () { openOrWarn('void', 'Void transaction'); }, { description: 'Void a transaction', group: G });
  bindPos('F3', focusSearch, { description: 'Search medicine / barcode', group: G });
  bindPos('F4', function () { openOrWarn('priceCheck', 'Price check'); }, { description: 'Price & stock check', group: G });
  bindPos(['F5', 'Ctrl+Enter'], completeSale, { description: 'Complete sale', group: G });
  bindPos('F6', function () { openOrWarn('customer', 'Customer lookup'); }, { description: 'Customer lookup', group: G });
  bindPos('F7', function () { openOrWarn('discount', 'Discount'); }, { description: 'Discount (Senior / PWD)', group: G });
  bindPos('F8', focusPayment, { description: 'Amount received / reference no.', group: G });
  bindPos('Shift+F8', exactAmount, { description: 'Exact cash amount', group: G });
  bindPos('F9', nextPaymentMethod, { description: 'Next payment method', group: G });
  bindPos('F10', printReceipt, { description: 'Print last receipt', group: G });

  bindPos('Ctrl+Delete', clearCart, {
    description: 'Clear cart', group: G, allowWhileTyping: true,
    when: function (e) { return !K.isTypingTarget(e.target) || (e.target === searchBox() && !searchBox().value); }
  });
  bindPos('Ctrl+ArrowDown', function () { focusCart('last'); }, { description: 'Go to cart', group: 'Cart', allowWhileTyping: true });
  bindPos('Ctrl+ArrowUp', focusSearch, { description: 'Back to search', group: 'Cart', allowWhileTyping: true });
  bindPos('Alt+G', focusGrid, { description: 'Go to product grid', group: 'Search' });
  K.bind('ArrowRight', function (e) { moveTile(e, 'right'); }, { when: isTile, repeatable: true, hidden: true });
  K.bind('ArrowLeft', function (e) { moveTile(e, 'left'); }, { when: isTile, repeatable: true, hidden: true });
  K.bind('ArrowDown', function (e) { moveTile(e, 'down'); }, { when: isTile, repeatable: true, hidden: true });
  K.bind('ArrowUp', function (e) { moveTile(e, 'up'); }, { when: isTile, repeatable: true, hidden: true });
  K.describe(['←', '→', '↑', '↓', 'Enter'], 'Move in the product grid / add one piece', 'Search');

  K.bind('Ctrl+R', function () {
    K.toast('Refresh is blocked while a sale is in progress. Use F1 for a new transaction.', 'warn', 3000);
  }, { allowWhileTyping: true, hidden: true, when: function () { return cartCount() > 0; } });

  // Block browser actions of F1–F10 on this page (help, find, reload, menu…)
  K.reserve(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);

  // Search box
  K.bind('Enter', function (e) {
    e.stopPropagation(); // your own Enter handler must not add the item a second time
    submitSearch();
  }, { allowWhileTyping: true, hidden: true, when: function (e) { return e.target === searchBox(); } });
  K.bind('ArrowDown', function (e) {
    const list = results();
    if (!list.length) return false;
    e.stopPropagation();
    list[0].focus();
  }, { allowWhileTyping: true, hidden: true, when: function (e) { return e.target === searchBox(); } });

  // Search results
  function moveResult(e, delta) {
    const list = results();
    const i = list.indexOf(e.target);
    if (delta === -1 && i === 0) { focusSearch(); return; }
    const next = list[delta === 'home' ? 0 : delta === 'end' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + delta))];
    if (next) next.focus();
  }
  K.bind('ArrowDown', function (e) { moveResult(e, 1); }, { when: isResult, repeatable: true, hidden: true });
  K.bind('ArrowUp', function (e) { moveResult(e, -1); }, { when: isResult, repeatable: true, hidden: true });
  K.bind('Home', function (e) { moveResult(e, 'home'); }, { when: isResult, hidden: true });
  K.bind('End', function (e) { moveResult(e, 'end'); }, { when: isResult, hidden: true });
  K.bind('Enter', function (e) { e.stopPropagation(); addResult(e.target, 1); }, { when: isResult, hidden: true });

  // Cart lines (focus a line with Ctrl+↓)
  K.bind('ArrowDown', function (e) { moveLine(inLine(e), 1); }, { when: inLine, repeatable: true, description: 'Next / previous item', group: 'Cart' });
  K.bind('ArrowUp', function (e) { moveLine(inLine(e), -1); }, { when: inLine, repeatable: true, hidden: true });
  K.bind(['+', '='], function (e) { changeQty(inLine(e), 1); }, { when: inLine, repeatable: true, description: 'Quantity +1', group: 'Cart' });
  K.bind('-', function (e) { changeQty(inLine(e), -1); }, { when: inLine, repeatable: true, description: 'Quantity −1', group: 'Cart' });
  K.bind('Enter', function (e) {
    const input = $(CFG.qtyInput, inLine(e));
    if (input) K.focus(input, true);
  }, { when: inLine, description: 'Type a quantity', group: 'Cart' });
  K.bind(['Delete', 'Backspace'], function (e) { removeLine(inLine(e)); }, { when: inLine, description: 'Remove item', group: 'Cart' });

  // Quantity input inside a line
  K.bind('Enter', function (e) {
    e.stopPropagation();
    const line = e.target.closest(CFG.cartLine);
    const stock = parseInt(line.dataset.stock, 10);
    const qty = parseInt(e.target.value, 10);
    if (isNaN(qty) || qty < 1) { K.toast('Quantity must be at least 1.', 'error'); return; }
    if (!isNaN(stock) && qty > stock) { K.toast('Only ' + stock + ' in stock.', 'error'); return; }
    fire(e.target, 'change');
    lastCartFocus = { key: lineKey(line), index: cartLines().indexOf(line), at: Date.now() };
    focusLine(line);
  }, { allowWhileTyping: true, hidden: true, when: inQtyInput });

  // Payment fields: Enter completes the sale
  K.bind('Enter', function (e) { e.stopPropagation(); completeSale(); }, {
    allowWhileTyping: true, hidden: true,
    when: function (e) { return e.target === $(CFG.amountReceived) || e.target === $(CFG.paymentReference); }
  });

  // Esc: step back one level (results → search, cart → search, clear search)
  K.bind('Escape', function (e) {
    const t = e.target;
    const s = searchBox();
    if (inQtyInput(e)) { focusLine(t.closest(CFG.cartLine)); return; }
    if (isResult(e) || inLine(e) || isTile(e)) { focusSearch(); return; }
    if (t === s) {
      if (!s.value) return false;
      s.value = '';
      lastInputAt = Date.now();
      fire(s, 'input');
      return;
    }
    if (t === $(CFG.amountReceived) || t === $(CFG.paymentReference) || t === $(CFG.paymentMethod)) { focusSearch(); return; }
    return false;
  }, { allowWhileTyping: true, description: 'Back / close / clear search', group: 'General' });

  K.describe(['A–Z', '0–9'], 'Start typing or scan a barcode anywhere', 'Search');
  K.describe(['3@CODE', '3*CODE'], 'Add 3 pieces by medicine code', 'Search');
  K.describe(['↑', '↓', 'Enter'], 'Pick a search result', 'Search');
  K.describe(['Esc'], 'Close / cancel (in a dialog)', 'In dialogs');
  K.describe(['Enter'], 'Confirm (in a dialog)', 'In dialogs');

  /* ------------------------------------------------------------------ *
   * 7. Action bar buttons (data-pos-action="...") and start-up
   * ------------------------------------------------------------------ */

  const ACTIONS = {
    newTransaction: newTransaction,
    void: function () { openOrWarn('void', 'Void transaction'); },
    search: focusSearch,
    priceCheck: function () { openOrWarn('priceCheck', 'Price check'); },
    complete: completeSale,
    customer: function () { openOrWarn('customer', 'Customer lookup'); },
    discount: function () { openOrWarn('discount', 'Discount'); },
    payment: focusPayment,
    exactAmount: exactAmount,
    paymentMethod: nextPaymentMethod,
    print: printReceipt,
    clearCart: clearCart,
    cart: function () { focusCart('last'); }
  };

  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('[data-pos-action]');
    if (btn && ACTIONS[btn.dataset.posAction]) { e.preventDefault(); ACTIONS[btn.dataset.posAction](); return; }
    // Clicking your real checkout button with the mouse must not trigger the "leave page?" warning
    const complete = $(CFG.buttons.complete);
    if (complete && complete.contains(e.target)) allowUnloadFor(10000);
  });

  function init() {
    // Track when search results change, to know they are "fresh"
    const s = searchBox();
    if (s) {
      s.setAttribute('autocomplete', 'off');
      s.addEventListener('input', function () { lastInputAt = Date.now(); });
    }
    const box = $(CFG.results);
    if (box) {
      new MutationObserver(function () {
        lastResultsAt = Date.now();
        results().forEach(function (r) { if (r.tagName !== 'BUTTON' && !r.hasAttribute('tabindex')) r.tabIndex = -1; });
      }).observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
    }
    // Make cart lines focusable and restore focus after re-render
    const cart = $(CFG.cart);
    if (cart) {
      new MutationObserver(function () {
        cartLines().forEach(function (l) { if (!l.hasAttribute('tabindex')) l.tabIndex = 0; });
        restoreCartFocus();
      }).observe(cart, { childList: true, subtree: true });
      cartLines().forEach(function (l) { if (!l.hasAttribute('tabindex')) l.tabIndex = 0; });
    }
    // When a dialog closes: nothing focused, or the sale is finished (empty cart)
    // → go back to the search box, ready for the next customer
    document.addEventListener('pc:modal-closed', function () {
      setTimeout(function () {
        const a = document.activeElement;
        if (!a || a === document.body || cartCount() === 0) focusSearch();
      }, 0);
    });
    if ((!document.activeElement || document.activeElement === document.body) && posActive()) focusSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.PharmaPOSKeys = { actions: ACTIONS, config: CFG, completeSale: completeSale, focusSearch: focusSearch };
})(window, document);
