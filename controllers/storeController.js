// Void, price check, customers, sales history, branches and store settings.
import { Op } from "sequelize";
import bcrypt from "bcrypt";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Branch, Customer, InventoryMovement, Medicine, Sale, SaleItem, Setting, User, sequelize
} from "../models/models.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { isExpired, toCents } from "../services/saleCalculations.js";
import { getStoreSettings } from "../services/storeSettings.js";
import { asInt, localDate, plain } from "./pharmacyController.js";

const money = cents => (cents / 100).toFixed(2);
const jsonError = (res, status, error) => res.status(status).json({ error });

/* ------------------------------------------------------------------ *
 * Void a completed sale (POS, F2). Needs an active administrator's password.
 * Stock is returned and the sale is kept with status "voided".
 * ------------------------------------------------------------------ */

const VOID_ATTEMPT_LIMIT = 5;
const VOID_LOCK_MS = 15 * 60 * 1000;

export const voidSale = asyncHandler(async (req, res) => {
  const reference = String(req.body.reference || "").trim();
  const reason = String(req.body.reason || "").trim();
  const password = String(req.body.password || "");
  if (!reference || reason.length < 3 || !password) {
    return jsonError(res, 400, "Enter the transaction number, a reason (at least 3 characters), and the owner password.");
  }

  // Slow down password guessing from one session
  const attempts = req.session.voidAttempts || { count: 0, since: Date.now() };
  if (Date.now() - attempts.since > VOID_LOCK_MS) Object.assign(attempts, { count: 0, since: Date.now() });
  if (attempts.count >= VOID_ATTEMPT_LIMIT) {
    return jsonError(res, 429, "Too many wrong passwords. Try again in 15 minutes.");
  }
  const admins = await User.findAll({ where: { role: "admin", active: true }, attributes: ["id", "password"] });
  let approver = null;
  for (const admin of admins) {
    if (await bcrypt.compare(password, admin.password)) { approver = admin; break; }
  }
  if (!approver) {
    attempts.count += 1;
    req.session.voidAttempts = attempts;
    return jsonError(res, 403, "The owner password is incorrect.");
  }
  delete req.session.voidAttempts;

  const where = /^\d+$/.test(reference) ? { id: Number(reference) } : { reference: reference.toUpperCase() };
  const outcome = await sequelize.transaction(async transaction => {
    const sale = await Sale.findOne({ where, lock: transaction.LOCK.UPDATE, transaction });
    if (!sale) return { status: 404, error: `No transaction matches "${reference}".` };
    if (sale.status === "voided") return { status: 409, error: `Transaction ${sale.reference} is already voided.` };

    const items = await SaleItem.findAll({ where: { saleId: sale.id }, transaction });
    const medicines = await Medicine.findAll({
      where: { id: [...new Set(items.map(item => item.medicineId))] },
      order: [["id", "ASC"]], lock: transaction.LOCK.UPDATE, transaction
    });
    const byId = new Map(medicines.map(medicine => [medicine.id, medicine]));
    for (const item of items) {
      const medicine = byId.get(item.medicineId);
      const stockAfter = medicine.stock + item.quantity;
      await medicine.update({ stock: stockAfter }, { transaction });
      await InventoryMovement.create({
        medicineId: medicine.id, userId: req.user.id, saleId: sale.id, type: "adjustment",
        quantityChange: item.quantity, stockAfter,
        reason: `Void of sale ${sale.reference}: ${reason}`.slice(0, 500)
      }, { transaction });
    }
    await sale.update({
      status: "voided", voidedAt: new Date(), voidedById: approver.id, voidReason: reason.slice(0, 500)
    }, { transaction });
    return { status: 200, sale: { id: sale.id, reference: sale.reference, total: sale.total } };
  });
  if (outcome.error) return jsonError(res, outcome.status, outcome.error);
  res.json(outcome);
});

/* ------------------------------------------------------------------ *
 * Price & stock check (POS, F4) – read only
 * ------------------------------------------------------------------ */

export const priceCheck = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 80);
  if (!query) return res.json([]);
  const like = { [Op.like]: `%${query}%` };
  const medicines = await Medicine.findAll({
    where: { active: true, [Op.or]: [{ code: query }, { name: like }, { genericName: like }, { brandName: like }, { code: like }] },
    attributes: ["id", "code", "name", "strength", "dosageForm", "price", "stock", "minimumStock", "expirationDate", "requiresPrescription"],
    order: [["name", "ASC"]], limit: 10
  });
  const exact = query.toLowerCase();
  res.json(medicines
    .map(medicine => ({ ...medicine.get({ plain: true }), expired: isExpired(medicine.expirationDate) }))
    .sort((a, b) => (b.code.toLowerCase() === exact) - (a.code.toLowerCase() === exact)));
});

/* ------------------------------------------------------------------ *
 * Customers (POS, F6)
 * ------------------------------------------------------------------ */

const customerJson = customer => ({
  id: customer.id, name: customer.name, cardNumber: customer.cardNumber, phone: customer.phone || ""
});

export const lookupCustomer = asyncHandler(async (req, res) => {
  const card = String(req.query.card || "").trim().slice(0, 60);
  if (!card) return jsonError(res, 400, "Enter a loyalty card number.");
  const customer = await Customer.findOne({ where: { cardNumber: card } });
  if (!customer) return jsonError(res, 404, `No customer has card number "${card}".`);
  res.json({ customer: customerJson(customer) });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const cardNumber = String(req.body.cardNumber || "").trim();
  const phone = String(req.body.phone || "").trim();
  if (name.length < 2 || name.length > 120) return jsonError(res, 400, "Customer name must be 2 to 120 characters.");
  if (!/^[\w-]{1,60}$/.test(cardNumber)) return jsonError(res, 400, "Card number may use letters, numbers and dashes (up to 60).");
  if (phone.length > 40) return jsonError(res, 400, "Phone number is too long.");
  try {
    const customer = await Customer.create({ name, cardNumber, phone: phone || null });
    res.status(201).json({ customer: customerJson(customer) });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return jsonError(res, 409, `Card number "${cardNumber}" is already registered.`);
    throw error;
  }
});

/* ------------------------------------------------------------------ *
 * Sales history: totals per day / month / year with change vs the previous one
 * ------------------------------------------------------------------ */

const PERIODS = {
  daily: {
    key: date => localDate(date),
    previous: key => { const d = new Date(`${key}T00:00:00`); d.setDate(d.getDate() - 1); return localDate(d); },
    range: key => [key, key],
    windowStart: () => { const d = new Date(); d.setDate(d.getDate() - 89); return d; },
    label: "day"
  },
  monthly: {
    key: date => localDate(date).slice(0, 7),
    previous: key => { const d = new Date(`${key}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return localDate(d).slice(0, 7); },
    range: key => { const end = new Date(`${key}-01T00:00:00`); end.setMonth(end.getMonth() + 1, 0); return [`${key}-01`, localDate(end)]; },
    windowStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 24, 1); return d; },
    label: "month"
  },
  yearly: {
    key: date => String(date.getFullYear()),
    previous: key => String(Number(key) - 1),
    range: key => [`${key}-01-01`, `${key}-12-31`],
    windowStart: () => null,
    label: "year"
  }
};

export const salesHistoryPage = asyncHandler(async (req, res) => {
  const periodName = PERIODS[req.query.period] ? req.query.period : "daily";
  const period = PERIODS[periodName];
  const branchId = asInt(req.query.branch);
  const where = { status: "completed" };
  if (req.query.branch && Number.isInteger(branchId)) where.branchId = branchId;
  const start = period.windowStart();
  const firstKey = start ? period.key(start) : "";
  if (start) {
    // Load one extra period before the window so the oldest row shown still has a comparison
    const [queryFrom] = period.range(period.previous(firstKey));
    where.createdAt = { [Op.gte]: new Date(`${queryFrom}T00:00:00`) };
  }
  const sales = await Sale.findAll({ where, attributes: ["total", "createdAt"], raw: true });

  const groups = new Map();
  for (const sale of sales) {
    const key = period.key(new Date(sale.createdAt));
    const group = groups.get(key) || { count: 0, cents: 0 };
    group.count += 1;
    group.cents += toCents(sale.total);
    groups.set(key, group);
  }
  const branchQuery = where.branchId ? `&branch=${where.branchId}` : "";
  const rows = [...groups.entries()]
    .filter(([key]) => key >= firstKey)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, group]) => {
      const previousCents = groups.get(period.previous(key))?.cents || 0;
      const change = previousCents
        ? (group.cents - previousCents) / previousCents * 100
        : null;
      const [from, to] = period.range(key);
      return {
        key, count: group.count, total: money(group.cents), previous: money(previousCents),
        change: change === null ? "New sales" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
        changeClass: change === null ? "" : change >= 0 ? "change-up" : "change-down",
        link: `/transactions?status=completed&from=${from}&to=${to}${branchQuery}`
      };
    });
  const branches = plain(await Branch.findAll({ order: [["name", "ASC"]] }));
  res.render("sales-history", {
    title: "Sales history", historyView: periodName, period: periodName, periodLabel: period.label, rows,
    branches, selectedBranch: where.branchId ? String(where.branchId) : "",
    grandTotal: money(rows.reduce((sum, row) => sum + toCents(row.total), 0)),
    windowNote: periodName === "daily" ? "Last 90 days" : periodName === "monthly" ? "Last 24 months" : "All years"
  });
});

/* ------------------------------------------------------------------ *
 * Branches
 * ------------------------------------------------------------------ */

export const branchesPage = asyncHandler(async (req, res) => {
  const settings = await getStoreSettings();
  const [branches, staff, sales] = await Promise.all([
    Branch.findAll({ order: [["name", "ASC"]] }),
    User.findAll({ where: { active: true }, attributes: ["branchId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]], group: ["branchId"], raw: true }),
    Sale.findAll({
      where: { status: "completed" },
      attributes: ["branchId", [sequelize.fn("COUNT", sequelize.col("id")), "count"], [sequelize.fn("SUM", sequelize.col("total")), "total"]],
      group: ["branchId"], raw: true
    })
  ]);
  const staffBy = new Map(staff.map(row => [row.branchId, Number(row.count)]));
  const salesBy = new Map(sales.map(row => [row.branchId, row]));
  const rows = branches.map(branch => ({
    id: branch.id, name: branch.name, active: branch.active,
    isDefault: String(branch.id) === settings.defaultBranchId,
    staff: staffBy.get(branch.id) || 0,
    transactions: Number(salesBy.get(branch.id)?.count || 0),
    total: Number(salesBy.get(branch.id)?.total || 0).toFixed(2)
  }));
  const unassigned = salesBy.get(null);
  res.render("branches", {
    title: "Branches", branches: rows,
    unassigned: unassigned ? { transactions: Number(unassigned.count), total: Number(unassigned.total).toFixed(2) } : null
  });
});

export const createBranch = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 120) {
    return res.status(400).render("error", { title: "Invalid branch", message: "Branch name must be 2 to 120 characters." });
  }
  await Branch.create({ name });
  res.redirect("/branches");
});

export const renameBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findByPk(req.params.id);
  if (!branch) return res.status(404).render("error", { title: "Not found", message: "Branch not found." });
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 120) {
    return res.status(400).render("error", { title: "Invalid branch", message: "Branch name must be 2 to 120 characters." });
  }
  await branch.update({ name });
  res.redirect("/branches");
});

export const setUserBranch = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).render("error", { title: "Not found", message: "User not found." });
  const branchId = asInt(req.body.branchId);
  if (req.body.branchId && !(Number.isInteger(branchId) && await Branch.findByPk(branchId))) {
    return res.status(400).render("error", { title: "Invalid branch", message: "Choose an existing branch." });
  }
  await user.update({ branchId: req.body.branchId ? branchId : null });
  res.redirect("/users");
});

/* ------------------------------------------------------------------ *
 * Store settings: name, default branch, logo, POS product grid, auto-print
 * ------------------------------------------------------------------ */

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const LOGO_TYPES = [
  { ext: "png", test: b => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG" },
  { ext: "jpg", test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", test: b => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" }
];

export const updateStoreSettings = asyncHandler(async (req, res) => {
  const fail = message => res.status(400).render("error", { title: "Settings not saved", message });
  const storeName = String(req.body.storeName || "").trim();
  if (storeName.length < 1 || storeName.length > 80) return fail("Store name must be 1 to 80 characters.");
  const defaultBranchId = asInt(req.body.defaultBranchId);
  if (req.body.defaultBranchId && !(Number.isInteger(defaultBranchId) && await Branch.findByPk(defaultBranchId))) {
    return fail("Choose an existing default branch.");
  }

  const current = await getStoreSettings();
  let storeLogo = current.storeLogo;
  const oldLogo = /^\/uploads\/store-logo-\d+\.(png|jpg|webp)$/.test(current.storeLogo) ? current.storeLogo : "";
  if (req.file) {
    // Check the file content itself, not just the name the browser sent
    const type = LOGO_TYPES.find(candidate => candidate.test(req.file.buffer));
    if (!type) return fail("The logo must be a PNG, JPG or WebP image.");
    await fs.mkdir(path.join(publicDir, "uploads"), { recursive: true });
    storeLogo = `/uploads/store-logo-${Date.now()}.${type.ext}`;
    await fs.writeFile(path.join(publicDir, storeLogo), req.file.buffer);
  } else if (req.body.removeLogo === "on") {
    storeLogo = "";
  }

  const values = {
    storeName, storeLogo,
    defaultBranchId: req.body.defaultBranchId ? String(defaultBranchId) : "",
    showProductGrid: req.body.showProductGrid === "on" ? "1" : "0",
    printAfterSale: req.body.printAfterSale === "on" ? "1" : "0"
  };
  await sequelize.transaction(async transaction => {
    for (const [key, value] of Object.entries(values)) await Setting.upsert({ key, value }, { transaction });
  });
  if (oldLogo && oldLogo !== storeLogo) await fs.rm(path.join(publicDir, oldLogo), { force: true });
  res.redirect("/settings");
});
