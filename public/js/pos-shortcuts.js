// Receipt printing for the POS and receipt pages.
// Keyboard shortcuts live in /js/keyboard-core.js and /js/pos-keyboard.js.
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("pos-form");
  const receiptPrint = document.getElementById("print-receipt");
  const lastReceiptPrint = document.getElementById("print-last-receipt");
  const userId = form?.dataset.userId || document.getElementById("receipt-page")?.dataset.userId;
  const receiptKey = userId ? `pharmacore-last-receipt:${userId}` : "";

  if (receiptPrint && receiptKey) {
    sessionStorage.setItem(receiptKey, window.location.pathname);
    receiptPrint.addEventListener("click", () => window.print());
    if (new URLSearchParams(window.location.search).get("print") === "1") {
      window.addEventListener("load", () => receiptPrint.click(), { once: true });
    }
  }

  if (lastReceiptPrint && receiptKey) {
    const lastReceipt = sessionStorage.getItem(receiptKey);
    lastReceiptPrint.disabled = !lastReceipt;
    lastReceiptPrint.addEventListener("click", () => {
      const receiptUrl = sessionStorage.getItem(receiptKey);
      if (receiptUrl) window.open(`${receiptUrl}?print=1`, "_blank", "noopener");
    });
  }
});
