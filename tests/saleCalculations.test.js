import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSaleTotals, isExpired, validatePayment, validateSaleItems
} from "../services/saleCalculations.js";

const medicine = overrides => ({
  id: 1, name: "Example medicine", stock: 10, expirationDate: null,
  requiresPrescription: false, ...overrides
});

test("calculates price, discount, tax, and total in cents", () => {
  assert.deepEqual(calculateSaleTotals([
    { price: 12.35, quantity: 2 },
    { price: 5.1, quantity: 1 }
  ], 2, 0.1), {
    subtotal: "29.80", discount: "2.00", tax: "2.78", total: "30.58"
  });
});

test("rejects empty carts, invalid quantities, and discounts above subtotal", () => {
  assert.throws(() => calculateSaleTotals([]), /at least one item/);
  assert.throws(() => calculateSaleTotals([{ price: 2, quantity: 0 }]), /positive whole numbers/);
  assert.throws(() => calculateSaleTotals([{ price: 2, quantity: 1 }], 3), /cannot exceed/);
});

test("rejects insufficient stock and expired medicines", () => {
  assert.throws(() => validateSaleItems([
    { medicine: medicine({ stock: 1 }), quantity: 2 }
  ], "cashier"), /Not enough stock/);
  assert.throws(() => validateSaleItems([
    { medicine: medicine({ expirationDate: "2020-01-01" }), quantity: 1 }
  ], "cashier"), /expired/);
});

test("prescription sales require an authorized role and a verification record", () => {
  const item = { medicine: medicine({ requiresPrescription: true }), quantity: 1 };
  assert.throws(() => validateSaleItems([item], "cashier", new Set(["1"])), /verify the prescription/);
  assert.throws(() => validateSaleItems([item], "pharmacist"), /verify the prescription/);
  assert.doesNotThrow(() => validateSaleItems([item], "pharmacist", new Set(["1"])));
});

test("rejects underpaid or unknown payment and calculates cash change", () => {
  assert.throws(() => validatePayment({ paymentMethod: "cash", amountReceived: 4, total: 5 }), /cover the total/);
  assert.throws(() => validatePayment({ paymentMethod: "cheque", amountReceived: 5, total: 5 }), /valid payment/);
  assert.throws(() => validatePayment({ paymentMethod: "card", total: 5 }), /payment reference/);
  assert.throws(() => validatePayment({
    paymentMethod: "cash", amountReceived: 4.99, total: 5
  }), /cover the total/);
  assert.deepEqual(validatePayment({ paymentMethod: "cash", amountReceived: 8, total: 5 }), {
    amountReceived: "8.00", changeDue: "3.00",
    paymentReference: null, paymentProvider: null, paymentStatus: "paid"
  });
  assert.throws(() => validatePayment({
    paymentMethod: "mobile", total: 5, paymentReference: "GCASH-123"
  }), /provider/);
  assert.deepEqual(validatePayment({
    paymentMethod: "mobile", total: 5, paymentReference: "GCASH-123", paymentProvider: "gcash"
  }), {
    amountReceived: "5.00", changeDue: "0.00",
    paymentReference: "GCASH-123", paymentProvider: "gcash", paymentStatus: "recorded"
  });
});

test("treats the expiration date itself as sellable", () => {
  assert.equal(isExpired("2026-10-29", new Date("2026-10-29T15:00:00")), false);
  assert.equal(isExpired("2026-10-28", new Date("2026-10-29T00:00:00")), true);
});
