export const toCents = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Price must be a non-negative number.");
  return Math.round((amount + Number.EPSILON) * 100);
};

export const calculateSaleTotals = (items, discountValue = 0, taxRate = 0) => {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Add at least one item to the cart.");
  const subtotalCents = items.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Item quantities must be positive whole numbers.");
    return sum + toCents(item.price) * quantity;
  }, 0);
  const discountCents = toCents(discountValue);
  if (discountCents > subtotalCents) throw new Error("Discount cannot exceed the subtotal.");
  if (!Number.isFinite(Number(taxRate)) || Number(taxRate) < 0 || Number(taxRate) > 1) {
    throw new Error("Tax rate must be between 0 and 1.");
  }
  const taxCents = Math.round((subtotalCents - discountCents) * Number(taxRate));
  const totalCents = subtotalCents - discountCents + taxCents;
  return {
    subtotal: (subtotalCents / 100).toFixed(2),
    discount: (discountCents / 100).toFixed(2),
    tax: (taxCents / 100).toFixed(2),
    total: (totalCents / 100).toFixed(2)
  };
};

export const isExpired = (expirationDate, today = new Date()) => {
  if (!expirationDate) return false;
  const expiration = new Date(`${expirationDate}T00:00:00`);
  const currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Number.isNaN(expiration.getTime()) || expiration < currentDate;
};

export const validateSaleItems = (items, role, verifiedPrescriptionIds = new Set()) => {
  for (const { medicine, quantity } of items) {
    if (medicine.stock < quantity) throw new Error(`Not enough stock for ${medicine.name}.`);
    if (isExpired(medicine.expirationDate)) throw new Error(`${medicine.name} is expired and cannot be sold.`);
    if (medicine.requiresPrescription &&
        (!["admin", "pharmacist"].includes(role) || !verifiedPrescriptionIds.has(String(medicine.id)))) {
      throw new Error(`A pharmacist must verify the prescription for ${medicine.name}.`);
    }
  }
};

export const validatePayment = ({
  paymentMethod, amountReceived, total, paymentReference = "", paymentProvider = ""
}) => {
  if (!["cash", "card", "mobile"].includes(paymentMethod)) throw new Error("Select a valid payment method.");
  const reference = String(paymentReference || "").trim();
  const provider = String(paymentProvider || "");
  if (paymentMethod !== "cash" && !/^[\w .:/-]{3,120}$/.test(reference)) {
    throw new Error("Enter a valid payment reference for this payment method.");
  }
  if (paymentMethod === "mobile" && !["gcash", "maya"].includes(provider)) {
    throw new Error("Select GCash or Maya as the mobile payment provider.");
  }
  const received = paymentMethod === "cash" ? Number(amountReceived) : Number(total);
  if (!Number.isFinite(received) || received < 0 || toCents(received) < toCents(total)) {
    throw new Error("Amount received must cover the total.");
  }
  const receivedCents = toCents(received);
  return {
    amountReceived: (receivedCents / 100).toFixed(2),
    changeDue: ((receivedCents - toCents(total)) / 100).toFixed(2),
    paymentReference: paymentMethod === "cash" ? null : reference,
    paymentProvider: paymentMethod === "mobile" ? provider : null,
    paymentStatus: paymentMethod === "cash" ? "paid" : "recorded"
  };
};
