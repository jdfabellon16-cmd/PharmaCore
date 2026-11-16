import { Setting } from "../models/models.js";

// Store-wide settings kept in the `settings` table as key/value strings.
const DEFAULTS = {
  storeName: "PharmaCore",
  storeLogo: "",          // public URL such as /uploads/store-logo-123.png
  defaultBranchId: "",    // branch used for sales by users without their own branch
  showProductGrid: "0",   // "1" = show a clickable medicine grid on the POS
  printAfterSale: "0"     // "1" = open the print dialog when the receipt appears
};

export const getStoreSettings = async (options = {}) => {
  const settings = { ...DEFAULTS };
  for (const row of await Setting.findAll(options)) settings[row.key] = row.value;
  return settings;
};

// The branch a sale is recorded against: the user's own branch, else the store default.
export const branchIdForUser = (user, settings) =>
  user.branchId || Number(settings.defaultBranchId) || null;
