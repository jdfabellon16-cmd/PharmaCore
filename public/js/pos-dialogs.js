/**
 * PharmaCore – POS dialogs: Void (F2), Price check (F4), Customer (F6)
 * File: public/js/pos-dialogs.js   (load after pos-keyboard.js on the POS page)
 *
 * pos-keyboard.js calls window.PharmaPOS.void / priceCheck / customer, which are
 * defined here. The server checks everything again (password, stock, customer).
 */
(function (window, document) {
  'use strict';

  const K = window.PCKeys;
  const $ = id => document.getElementById(id);
  const csrfToken = () => (document.querySelector('#pos-form input[name="_csrf"]') || {}).value || '';
  const toast = (text, type) => (K ? K.toast(text, type, 3200) : window.alert(text));

  function show(modal) { if (K) K.openModal(modal); else modal.hidden = false; }
  function hide(modal) { modal.hidden = true; } // keyboard-core notices and puts focus back

  function say(element, text, ok) {
    element.textContent = text || '';
    element.hidden = !text;
    element.classList.toggle('ok', Boolean(ok));
  }

  // JSON request that also catches an expired session (redirect to the login page)
  async function request(url, options) {
    const init = Object.assign({ headers: { Accept: 'application/json' } }, options);
    if (init.body) init.headers['Content-Type'] = 'application/json';
    const response = await fetch(url, init);
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    if (!isJson) throw new Error('Your session may have expired. Refresh the page and sign in again.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
    return data;
  }

  // Cancel buttons and clicks on the dark backdrop close a dialog
  document.querySelectorAll('.pc-dialog').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-modal-cancel]')) hide(modal);
    });
  });

  /* ---------------- Void transaction ---------------- */

  const voidModal = $('voidModal');
  const voidButton = $('void-submit');
  let voiding = false;

  function openVoid() {
    ['void-reference', 'void-reason', 'void-password'].forEach(id => { $(id).value = ''; });
    say($('void-message'), '');
    show(voidModal);
  }

  voidButton.addEventListener('click', async () => {
    if (voiding) return;
    const body = {
      reference: $('void-reference').value.trim(),
      reason: $('void-reason').value.trim(),
      password: $('void-password').value,
      _csrf: csrfToken()
    };
    if (!body.reference || body.reason.length < 3 || !body.password) {
      say($('void-message'), 'Fill in the transaction, a reason (at least 3 characters), and the password.');
      return;
    }
    if (!window.confirm(`Void transaction ${body.reference}? This cannot be undone.`)) return;
    voiding = true;
    voidButton.disabled = true;
    try {
      const data = await request('/pos/void', { method: 'POST', body: JSON.stringify(body) });
      hide(voidModal);
      toast(`Transaction ${data.sale.reference} voided. The items were returned to stock.`, 'success');
    } catch (error) {
      say($('void-message'), error.message);
      $('void-password').value = '';
      $('void-password').focus();
    } finally {
      voiding = false;
      voidButton.disabled = false;
    }
  });

  /* ---------------- Price & stock check ---------------- */

  const priceModal = $('priceCheckModal');
  const priceResults = $('price-results');

  function openPriceCheck() {
    $('price-query').value = '';
    priceResults.replaceChildren();
    show(priceModal);
  }

  function priceRow(medicine) {
    const row = document.createElement('div');
    row.className = 'price-result';
    const name = document.createElement('strong');
    name.textContent = medicine.name + (medicine.strength ? ' ' + medicine.strength : '');
    const price = document.createElement('span');
    price.className = 'product-price';
    price.textContent = '₱' + Number(medicine.price).toFixed(2);
    const details = document.createElement('small');
    details.textContent = [
      medicine.code, medicine.stock + ' in stock',
      medicine.expirationDate ? 'Expires ' + medicine.expirationDate : '',
      medicine.requiresPrescription ? 'Prescription required' : ''
    ].filter(Boolean).join(' · ');
    row.append(name, price, details);
    const status = medicine.expired ? 'Expired: cannot be sold'
      : medicine.stock <= 0 ? 'Out of stock'
        : medicine.stock <= medicine.minimumStock ? 'Low stock' : '';
    if (status) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-warn';
      badge.textContent = status;
      row.append(badge);
    }
    return row;
  }

  $('price-submit').addEventListener('click', async () => {
    const query = $('price-query').value.trim();
    if (!query) { $('price-query').focus(); return; }
    priceResults.textContent = 'Checking…';
    try {
      const list = await request('/pos/price-check?q=' + encodeURIComponent(query));
      priceResults.replaceChildren(...list.map(priceRow));
      if (!list.length) priceResults.textContent = `No medicine matches "${query}".`;
    } catch (error) {
      priceResults.textContent = error.message;
    }
    $('price-query').select(); // ready for the next scan
  });

  /* ---------------- Customer lookup / new customer ---------------- */

  const customerModal = $('customerModal');
  const customerForm = $('customer-form');

  function setCustomer(customer) {
    $('customer-id').value = customer.id;
    $('customer-name').textContent = `${customer.name} (${customer.cardNumber})`;
    $('clear-customer').hidden = false;
  }
  function clearCustomer() {
    $('customer-id').value = '';
    $('customer-name').textContent = 'Walk-in customer';
    $('clear-customer').hidden = true;
  }
  $('clear-customer').addEventListener('click', clearCustomer);
  // Opening "New customer" (click or Alt+N) goes straight to the name field
  $('customer-new').addEventListener('toggle', () => {
    if ($('customer-new').open && !customerForm.elements.name.value) customerForm.elements.name.focus();
  });

  function openCustomer() {
    $('customer-card').value = '';
    say($('customer-message'), '');
    customerForm.reset();
    $('customer-new').open = false;
    show(customerModal);
  }

  $('customer-lookup').addEventListener('click', async () => {
    const card = $('customer-card').value.trim();
    if (!card) { $('customer-card').focus(); return; }
    try {
      const data = await request('/customers/lookup?card=' + encodeURIComponent(card));
      setCustomer(data.customer);
      hide(customerModal);
      toast('Customer: ' + data.customer.name, 'success');
    } catch (error) {
      say($('customer-message'), error.message + ' You can register them under "New customer".');
      $('customer-new').open = true;
      customerForm.elements.cardNumber.value = card;
      customerForm.elements.name.focus();
    }
  });

  customerForm.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = customerForm.elements;
    try {
      const data = await request('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: fields.name.value.trim(), cardNumber: fields.cardNumber.value.trim(),
          phone: fields.phone.value.trim(), _csrf: csrfToken()
        })
      });
      setCustomer(data.customer);
      hide(customerModal);
      toast('Customer saved: ' + data.customer.name, 'success');
    } catch (error) {
      say($('customer-message'), error.message);
    }
  });

  /* ---------------- Hooks for pos-keyboard.js (F2 / F4 / F6) ---------------- */

  window.PharmaPOS = Object.assign(window.PharmaPOS || {}, {
    void: openVoid, priceCheck: openPriceCheck, customer: openCustomer
  });
  window.PharmaPOSDialogs = { clearCustomer: clearCustomer, setCustomer: setCustomer };
})(window, document);
