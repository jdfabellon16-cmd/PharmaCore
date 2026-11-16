import { Op, Transaction } from "sequelize";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  Branch, Category, Customer, InventoryMovement, Medicine, Sale, SaleItem, Setting, Supplier, User, sequelize
} from "../models/models.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { calculateSaleTotals, validatePayment, validateSaleItems } from "../services/saleCalculations.js";
import { branchIdForUser, getStoreSettings } from "../services/storeSettings.js";

// Dates use the server's local time zone (e.g. Asia/Manila), not UTC, so "today"
// starts at local midnight instead of 08:00.
export const localDate = (date = new Date()) => {
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const today = () => localDate();
const daysFromToday = days => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
};
// Handlebars only reads an object's own properties, so Sequelize instances must be
// turned into plain objects before rendering (otherwise fields render blank).
export const plain = value => Array.isArray(value)
  ? value.map(item => item.get({ plain: true }))
  : value?.get ? value.get({ plain: true }) : value;
export const asInt = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : NaN;
};
const safeReturn = (req, res, path) => {
  const message = String(req.query.message || "");
  res.redirect(`${path}${message ? `?message=${encodeURIComponent(message)}` : ""}`);
};
export const getDateRange = (from, to) => {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new Error("Choose a valid date range.");
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1); // local midnight after the last day
  return { start: new Date(`${from}T00:00:00`), end };
};
const getReportDates = period => {
  const start = new Date();
  if (period === "weekly") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  } else if (period === "monthly") {
    start.setDate(1);
  }
  return { from: localDate(start), to: today() };
};

export const dashboardPage = asyncHandler(async (req, res) => {
  const { start, end } = getDateRange(today(), today());
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const yearStart = new Date(start.getFullYear(), 0, 1);
  const completedSince = from => Sale.sum("total", { where: { status: "completed", createdAt: { [Op.gte]: from, [Op.lt]: end } } });
  const [salesMonth, salesYear] = await Promise.all([completedSince(monthStart), completedSince(yearStart)]);
  const [medicineCount, stockRows, lowStock, expirationCount, sales, saleCount, recentSales] = await Promise.all([
    Medicine.count({ where: { active: true } }),
    Medicine.findAll({ where: { active: true }, attributes: ["stock"] }),
    Medicine.count({ where: { active: true, [Op.and]: [sequelize.where(sequelize.col("stock"), Op.lte, sequelize.col("minimumStock"))] } }),
    Medicine.count({ where: { active: true, expirationDate: { [Op.between]: [today(), daysFromToday(30)] } } }),
    Sale.sum("total", { where: { status: "completed", createdAt: { [Op.gte]: start, [Op.lt]: end } } }),
    Sale.count({ where: { status: "completed", createdAt: { [Op.gte]: start, [Op.lt]: end } } }),
    Sale.findAll({ where: { status: "completed" }, include: [{ model: User, attributes: ["name"] }], order: [["createdAt", "DESC"]], limit: 8 })
  ]);
  res.render("dashboard", {
    title: "Dashboard",
    stats: {
      medicineCount,
      stockCount: stockRows.reduce((total, medicine) => total + medicine.stock, 0),
      lowStock,
      expirationCount,
      salesToday: Number(sales || 0).toFixed(2),
      salesMonth: Number(salesMonth || 0).toFixed(2),
      salesYear: Number(salesYear || 0).toFixed(2),
      saleCount
    },
    recentSales: plain(recentSales)
  });
});

const medicineFormData = async () => ({
  categories: plain(await Category.findAll({ order: [["name", "ASC"]] })),
  suppliers: plain(await Supplier.findAll({ order: [["name", "ASC"]] }))
});

export const medicinesPage = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const where = {};
  where.active = true;
  if (search) where[Op.or] = [
    { name: { [Op.like]: `%${search}%` } },
    { genericName: { [Op.like]: `%${search}%` } },
    { code: { [Op.like]: `%${search}%` } }
  ];
  const categoryId = asInt(req.query.category);
  if (req.query.category && Number.isInteger(categoryId)) where.categoryId = categoryId;
  if (req.query.stock === "low") where[Op.and] = [sequelize.where(sequelize.col("stock"), Op.lte, sequelize.col("minimumStock"))];
  if (req.query.stock === "empty") where.stock = 0;
  const medicines = await Medicine.findAll({
    where, include: [Category, Supplier], order: [["name", "ASC"]]
  });
  res.render("medicines", {
    title: "Medicines", medicines: plain(medicines), ...(await medicineFormData()),
    search, selectedCategory: req.query.category || "", stockFilter: req.query.stock || ""
  });
});

export const createMedicine = asyncHandler(async (req, res) => {
  const price = Number(req.body.price);
  const stock = asInt(req.body.stock);
  const minimumStock = asInt(req.body.minimumStock);
  if (!req.body.code?.trim() || !req.body.name?.trim() || !Number.isFinite(price) || price < 0 ||
      !Number.isInteger(stock) || stock < 0 || !Number.isInteger(minimumStock) || minimumStock < 0) {
    return res.status(400).render("error", { title: "Invalid medicine", message: "Provide a code, name, valid price, and non-negative whole-number stock values." });
  }
  const medicine = await sequelize.transaction(async transaction => {
    const created = await Medicine.create({
      code: req.body.code.trim(), name: req.body.name.trim(), genericName: req.body.genericName?.trim() || null,
      brandName: req.body.brandName?.trim() || null, description: req.body.description?.trim() || null,
      strength: req.body.strength?.trim() || null, dosageForm: req.body.dosageForm?.trim() || null,
      price: price.toFixed(2), stock, minimumStock, batchNumber: req.body.batchNumber?.trim() || null,
      expirationDate: req.body.expirationDate || null, categoryId: req.body.categoryId || null,
      supplierId: req.body.supplierId || null, requiresPrescription: req.body.requiresPrescription === "on"
    }, { transaction });
    if (stock > 0) {
      await InventoryMovement.create({
        medicineId: created.id, userId: req.user.id, type: "stock_in",
        quantityChange: stock, stockAfter: stock, reason: "Opening stock"
      }, { transaction });
    }
    return created;
  });
  res.redirect(`/medicines/${medicine.id}`);
});

export const medicineDetails = asyncHandler(async (req, res) => {
  const medicine = await Medicine.findByPk(req.params.id, {
    // separate: true is required for the order and limit on a hasMany include to apply
    include: [Category, Supplier, {
      model: InventoryMovement, include: [User], separate: true, order: [["createdAt", "DESC"]], limit: 20
    }]
  });
  if (!medicine) return res.status(404).render("error", { title: "Not found", message: "Medicine not found." });
  res.render("medicine-detail", { title: medicine.name, medicine: plain(medicine), ...(await medicineFormData()) });
});

export const updateMedicine = asyncHandler(async (req, res) => {
  const medicine = await Medicine.findByPk(req.params.id);
  if (!medicine) return res.status(404).render("error", { title: "Not found", message: "Medicine not found." });
  const price = Number(req.body.price);
  const minimumStock = asInt(req.body.minimumStock);
  if (typeof req.body.code !== "string" || !req.body.code.trim() ||
      typeof req.body.name !== "string" || !req.body.name.trim() ||
      !Number.isFinite(price) || price < 0 || !Number.isInteger(minimumStock) || minimumStock < 0) {
    return res.status(400).render("error", { title: "Invalid medicine", message: "Provide a name, non-negative price, and valid minimum stock." });
  }
  await medicine.update({
    name: req.body.name.trim(), code: req.body.code.trim(), genericName: req.body.genericName?.trim() || null,
    brandName: req.body.brandName?.trim() || null, description: req.body.description?.trim() || null,
    strength: req.body.strength?.trim() || null, dosageForm: req.body.dosageForm?.trim() || null,
    price: price.toFixed(2), minimumStock, batchNumber: req.body.batchNumber?.trim() || null,
    expirationDate: req.body.expirationDate || null, categoryId: req.body.categoryId || null,
    supplierId: req.body.supplierId || null, requiresPrescription: req.body.requiresPrescription === "on"
  });
  res.redirect(`/medicines/${medicine.id}`);
});

export const archiveMedicine = asyncHandler(async (req, res) => {
  const medicine = await Medicine.findByPk(req.params.id);
  if (!medicine) return res.status(404).render("error", { title: "Not found", message: "Medicine not found." });
  if (medicine.stock !== 0) {
    return res.status(409).render("error", { title: "Medicine has stock", message: "Record an adjustment to zero before archiving this medicine." });
  }
  await medicine.update({ active: false });
  res.redirect("/medicines");
});

export const categoriesPage = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({ include: [{ model: Medicine, attributes: ["id", "name", "code"] }], order: [["name", "ASC"]] });
  res.render("categories", {
    title: "Categories",
    categories: categories.map(category => category.get({ plain: true }))
  });
});

export const createCategory = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).render("error", { title: "Invalid category", message: "Category name is required." });
  await Category.create({ name, description: req.body.description?.trim() || null });
  safeReturn(req, res, "/categories");
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return res.status(404).render("error", { title: "Not found", message: "Category not found." });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).render("error", { title: "Invalid category", message: "Category name is required." });
  await category.update({ name, description: req.body.description?.trim() || null });
  safeReturn(req, res, "/categories");
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return res.status(404).render("error", { title: "Not found", message: "Category not found." });
  if (await Medicine.count({ where: { categoryId: category.id } })) {
    return res.status(409).render("error", { title: "Category in use", message: "Move or remove its medicines before deleting this category." });
  }
  await category.destroy();
  safeReturn(req, res, "/categories");
});

export const suppliersPage = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const suppliers = await Supplier.findAll({
    where: search ? { name: { [Op.like]: `%${search}%` } } : {},
    include: [{ model: Medicine, attributes: ["id", "name", "code"] }], order: [["name", "ASC"]]
  });
  res.render("suppliers", {
    title: "Suppliers",
    suppliers: suppliers.map(supplier => supplier.get({ plain: true })),
    search
  });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).render("error", { title: "Invalid supplier", message: "Supplier name is required." });
  await Supplier.create({
    name, phone: req.body.phone?.trim() || null, email: req.body.email?.trim() || null,
    address: req.body.address?.trim() || null
  });
  safeReturn(req, res, "/suppliers");
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByPk(req.params.id);
  if (!supplier) return res.status(404).render("error", { title: "Not found", message: "Supplier not found." });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).render("error", { title: "Invalid supplier", message: "Supplier name is required." });
  await supplier.update({
    name, phone: req.body.phone?.trim() || null,
    email: req.body.email?.trim() || null, address: req.body.address?.trim() || null
  });
  safeReturn(req, res, "/suppliers");
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByPk(req.params.id);
  if (!supplier) return res.status(404).render("error", { title: "Not found", message: "Supplier not found." });
  if (await Medicine.count({ where: { supplierId: supplier.id } })) {
    return res.status(409).render("error", { title: "Supplier in use", message: "Reassign its medicines before deleting this supplier." });
  }
  await supplier.destroy();
  safeReturn(req, res, "/suppliers");
});

// Transaction history filters that the Sales history page understands
const TRANSACTION_FILTERS = ["search", "from", "to", "paymentMethod", "status", "branch"];
const filterQuery = query => {
  const filters = new URLSearchParams();
  for (const key of TRANSACTION_FILTERS) {
    if (typeof query[key] === "string" && query[key]) filters.set(key, query[key]);
  }
  const text = filters.toString();
  return text ? `?${text}` : "";
};

// The POS only sells; transaction history lives on its own page (/transactions)
export const posPage = asyncHandler(async (req, res) => {
  if (req.query.tab === "transactions") return res.redirect(`/transactions${filterQuery(req.query)}`); // old links
  const savedTaxRate = await Setting.findByPk("salesTaxRate");
  const settings = await getStoreSettings();
  // Optional clickable grid of sellable medicines (Settings → Show product grid)
  const gridMedicines = settings.showProductGrid === "1" ? await Medicine.findAll({
    where: {
      active: true, stock: { [Op.gt]: 0 },
      [Op.or]: [{ expirationDate: null }, { expirationDate: { [Op.gte]: today() } }]
    },
    attributes: ["id", "code", "name", "strength", "price", "stock", "requiresPrescription"],
    order: [["name", "ASC"]], limit: 60
  }) : [];
  res.render("pos", {
    title: "Point of Sale",
    taxRate: Number(savedTaxRate?.value ?? process.env.SALES_TAX_RATE ?? 0),
    checkoutKey: crypto.randomUUID(),
    canVerifyPrescription: ["admin", "pharmacist"].includes(req.user.role),
    gridMedicines: plain(gridMedicines)
  });
});

export const searchPosMedicines = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 80);
  if (!search) return res.json([]);
  const medicines = await Medicine.findAll({
    where: {
      active: true,
      stock: { [Op.gt]: 0 },
      [Op.or]: [
        { name: { [Op.like]: `%${search}%` } },
        { genericName: { [Op.like]: `%${search}%` } },
        { brandName: { [Op.like]: `%${search}%` } },
        { code: { [Op.like]: `%${search}%` } },
        { strength: { [Op.like]: `%${search}%` } }
      ],
      [Op.and]: [{ [Op.or]: [{ expirationDate: null }, { expirationDate: { [Op.gte]: today() } }] }]
    },
    attributes: ["id", "code", "name", "genericName", "brandName", "strength", "dosageForm", "price", "stock", "expirationDate", "requiresPrescription", "batchNumber"],
    include: [{ model: Category, attributes: ["name"] }],
    order: [["expirationDate", "ASC"], ["name", "ASC"]],
    limit: 30
  });
  res.json(medicines);
});

export const completeSale = asyncHandler(async (req, res) => {
  const requestKey = String(req.body.requestKey || "");
  if (!/^[\w-]{16,80}$/.test(requestKey)) {
    return res.status(400).render("error", { title: "Invalid checkout", message: "Refresh the POS and submit the sale again." });
  }
  const existing = await Sale.findOne({ where: { requestKey } });
  if (existing) return res.redirect(`/transactions/${existing.id}`);

  let submittedItems;
  try {
    submittedItems = JSON.parse(req.body.items || "[]");
  } catch {
    return res.status(400).render("error", { title: "Invalid cart", message: "The submitted cart could not be read." });
  }
  if (!Array.isArray(submittedItems) || !submittedItems.length) {
    return res.status(400).render("error", { title: "Empty cart", message: "Add at least one medicine before checkout." });
  }
  const consolidated = new Map();
  for (const item of submittedItems) {
    if (!item || typeof item !== "object") {
      return res.status(400).render("error", { title: "Invalid cart", message: "Cart items must contain a medicine ID and quantity." });
    }
    const id = asInt(item.id);
    const quantity = asInt(item.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).render("error", { title: "Invalid cart", message: "Cart item IDs and quantities must be valid." });
    }
    const combinedQuantity = (consolidated.get(id) || 0) + quantity;
    if (!Number.isSafeInteger(combinedQuantity)) {
      return res.status(400).render("error", { title: "Invalid cart", message: "A medicine quantity exceeds the supported limit." });
    }
    consolidated.set(id, combinedQuantity);
  }
  const ids = [...consolidated.keys()].sort((a, b) => a - b);
  let printAfterSale = false;
  const transaction = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED });
  try {
    const medicines = await Medicine.findAll({
      where: { id: ids, active: true }, order: [["id", "ASC"]],
      lock: transaction.LOCK.UPDATE, transaction
    });
    if (medicines.length !== ids.length) throw new Error("One or more medicines are no longer available.");
    const rawPrescriptionIds = req.body.verifiedPrescriptionIds || [];
    const prescriptionIds = new Set((Array.isArray(rawPrescriptionIds) ? rawPrescriptionIds : [rawPrescriptionIds]).map(String));
    const items = medicines.map(medicine => ({
      medicine, quantity: consolidated.get(medicine.id), price: Number(medicine.price)
    }));
    validateSaleItems(items, req.user.role, prescriptionIds);
    const discount = Number(req.body.discount || 0);
    const savedTaxRate = await Setting.findByPk("salesTaxRate", { transaction });
    const taxRate = Number(savedTaxRate?.value ?? process.env.SALES_TAX_RATE ?? 0);
    const totals = calculateSaleTotals(items.map(item => ({ price: item.price, quantity: item.quantity })), discount, taxRate);
    const total = Number(totals.total);
    const paymentMethod = String(req.body.paymentMethod || "");
    const payment = validatePayment({
      paymentMethod, amountReceived: req.body.amountReceived, total,
      paymentReference: req.body.paymentReference,
      paymentProvider: req.body.paymentProvider
    });
    const settings = await getStoreSettings({ transaction });
    let customerId = null;
    if (req.body.customerId) {
      customerId = asInt(req.body.customerId);
      if (!Number.isInteger(customerId) || !(await Customer.findByPk(customerId, { transaction }))) {
        throw new Error("The selected customer no longer exists. Look the customer up again (F6).");
      }
    }
    printAfterSale = settings.printAfterSale === "1";
    const sale = await Sale.create({
      reference: `PC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      requestKey, ...totals, ...payment, paymentMethod, userId: req.user.id,
      branchId: branchIdForUser(req.user, settings), customerId
    }, { transaction });
    for (const item of items) {
      const stockAfter = item.medicine.stock - item.quantity;
      await item.medicine.update({ stock: stockAfter }, { transaction });
      await SaleItem.create({
        saleId: sale.id, medicineId: item.medicine.id, medicineName: item.medicine.name,
        medicineCode: item.medicine.code, medicineBatchNumber: item.medicine.batchNumber,
        unitPrice: item.price.toFixed(2),
        quantity: item.quantity, lineTotal: (item.price * item.quantity).toFixed(2),
        prescriptionVerifiedById: item.medicine.requiresPrescription ? req.user.id : null,
        prescriptionVerifiedAt: item.medicine.requiresPrescription ? new Date() : null
      }, { transaction });
      await InventoryMovement.create({
        medicineId: item.medicine.id, userId: req.user.id, saleId: sale.id, type: "sale",
        quantityChange: -item.quantity, stockAfter,
        reason: item.medicine.requiresPrescription
          ? `POS sale ${sale.reference}; prescription verified by ${req.user.name}`
          : `POS sale ${sale.reference}`
      }, { transaction });
    }
    await transaction.commit();
    // ?print=1 makes the receipt page open the print dialog (Settings → Print after each sale)
    return res.redirect(`/transactions/${sale.id}${printAfterSale ? "?print=1" : ""}`);
  } catch (error) {
    await transaction.rollback();
    const errorName = error?.name || "";
    if (errorName === "SequelizeUniqueConstraintError") {
      const duplicate = await Sale.findOne({ where: { requestKey } });
      if (duplicate) return res.redirect(`/transactions/${duplicate.id}`);
    }
    if (error instanceof Error && !errorName.startsWith("Sequelize")) {
      return res.status(400).render("error", { title: "Sale not completed", message: error.message });
    }
    throw error;
  }
});

const getTransactionPageData = async req => {
  const where = {};
  if (req.user.role === "cashier") where.userId = req.user.id;
  if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
  if (["completed", "voided"].includes(req.query.status)) where.status = req.query.status;
  const branchId = asInt(req.query.branch);
  if (req.query.branch && Number.isInteger(branchId)) where.branchId = branchId;
  const search = String(req.query.search || "").trim();
  if (search) where[Op.or] = [
    { reference: { [Op.like]: `%${search}%` } },
    { "$User.name$": { [Op.like]: `%${search}%` } },
    { "$Customer.name$": { [Op.like]: `%${search}%` } },
    { "$Customer.cardNumber$": search }
  ];
  if (req.query.from || req.query.to) {
    const range = getDateRange(req.query.from || "1900-01-01", req.query.to || "9999-12-31");
    where.createdAt = {};
    where.createdAt[Op.gte] = range.start;
    where.createdAt[Op.lt] = range.end;
  }
  const sales = await Sale.findAll({
    where,
    include: [
      { model: User, attributes: ["name"] },
      { model: Customer, attributes: ["name", "cardNumber"] },
      { model: Branch, attributes: ["name"] },
      // separate: true keeps the LIMIT query from hiding User.name from the search filter
      { model: SaleItem, attributes: ["saleId", "quantity"], separate: true }
    ],
    order: [["createdAt", "DESC"]], limit: 200
  });
  return {
    branches: plain(await Branch.findAll({ order: [["name", "ASC"]] })),
    branch: where.branchId ? String(where.branchId) : "",
    sales: sales.map(sale => {
      const plainSale = sale.get({ plain: true });
      plainSale.itemCount = plainSale.SaleItems.reduce((count, item) => count + item.quantity, 0);
      return plainSale;
    }),
    from: req.query.from || "",
    to: req.query.to || "",
    paymentMethod: req.query.paymentMethod || "",
    status: req.query.status || "",
    search
  };
};

// Sales history → Transactions: every sale with filters (cashiers see their own only)
export const transactionsPage = asyncHandler(async (req, res) => {
  let transactionData;
  try {
    transactionData = await getTransactionPageData(req);
  } catch (error) {
    return res.status(400).render("error", { title: "Invalid transaction filter", message: error.message });
  }
  res.render("transactions", { title: "Sales history", historyView: "transactions", ...transactionData });
});

export const transactionDetails = asyncHandler(async (req, res) => {
  const sale = await Sale.findByPk(req.params.id, {
    include: [
      { model: User, attributes: ["name"] },
      { model: Customer, attributes: ["name", "cardNumber", "phone"] },
      { model: Branch, attributes: ["name"] },
      { model: User, as: "VoidedBy", attributes: ["name"] },
      { model: SaleItem, include: [Medicine, { model: User, as: "PrescriptionVerifier", attributes: ["name"] }] }
    ]
  });
  if (!sale) return res.status(404).render("error", { title: "Not found", message: "Transaction not found." });
  if (req.user.role === "cashier" && sale.userId !== req.user.id) {
    return res.status(403).render("error", { title: "Access denied", message: "You can only view transactions you processed." });
  }
  res.render("receipt", {
    title: `Receipt ${sale.reference}`,
    sale: plain(sale)
  });
});

export const inventoryPage = asyncHandler(async (req, res) => {
  const medicines = await Medicine.findAll({
    where: {
      active: true,
      [Op.or]: [
        { stock: { [Op.lte]: sequelize.col("minimumStock") } },
        { stock: 0 },
        { expirationDate: { [Op.lte]: daysFromToday(30) } }
      ]
    },
    include: [Category], order: [["expirationDate", "ASC"]]
  });
  const movements = await InventoryMovement.findAll({
    include: [Medicine, User], order: [["createdAt", "DESC"]], limit: 30
  });
  res.render("inventory", { title: "Inventory monitoring", medicines: plain(medicines), movements: plain(movements) });
});

export const adjustInventory = asyncHandler(async (req, res) => {
  const medicineId = asInt(req.params.id);
  const quantityChange = asInt(req.body.quantityChange);
  const reason = String(req.body.reason || "").trim();
  if (!Number.isInteger(quantityChange) || quantityChange === 0 || !reason) {
    return res.status(400).render("error", { title: "Invalid adjustment", message: "Enter a non-zero whole-number change and a reason." });
  }
  // Problems the user can fix are shown as a 400 page instead of a generic server error
  let problem = "";
  await sequelize.transaction(async transaction => {
    const medicine = await Medicine.findByPk(medicineId, { lock: transaction.LOCK.UPDATE, transaction });
    if (!medicine) { problem = "Medicine not found."; return; }
    const stockAfter = medicine.stock + quantityChange;
    if (stockAfter < 0) { problem = `Adjustment cannot reduce stock below zero (current stock: ${medicine.stock}).`; return; }
    await medicine.update({ stock: stockAfter }, { transaction });
    await InventoryMovement.create({
      medicineId, userId: req.user.id, type: quantityChange > 0 ? "stock_in" : "adjustment",
      quantityChange, stockAfter, reason: reason.slice(0, 500)
    }, { transaction });
  });
  if (problem) return res.status(400).render("error", { title: "Adjustment not recorded", message: problem });
  res.redirect("/inventory");
});

export const reportsPage = asyncHandler(async (req, res) => {
  const period = ["daily", "weekly", "monthly", "custom"].includes(req.query.period)
    ? req.query.period
    : "daily";
  const { from, to } = period === "custom"
    ? { from: req.query.from || today(), to: req.query.to || today() }
    : getReportDates(period);
  let dateRange;
  try {
    dateRange = getDateRange(from, to);
  } catch (error) {
    return res.status(400).render("error", { title: "Invalid report range", message: error.message });
  }
  const sales = await Sale.findAll({
    where: { status: "completed", createdAt: { [Op.gte]: dateRange.start, [Op.lt]: dateRange.end } },
    attributes: ["id", "reference", "total", "paymentMethod", "paymentProvider", "createdAt"],
    include: [
      { model: SaleItem, attributes: ["medicineName", "quantity", "lineTotal"] },
      { model: User, attributes: ["name"] }
    ]
  });
  const total = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const byPayment = sales.reduce((groups, sale) => {
    const method = sale.paymentProvider
      ? `${sale.paymentProvider.toUpperCase()} (mobile)`
      : sale.paymentMethod;
    groups[method] = (groups[method] || 0) + Number(sale.total);
    return groups;
  }, {});
  const byCashier = sales.reduce((groups, sale) => {
    const cashier = sale.User.name;
    groups[cashier] = (groups[cashier] || 0) + Number(sale.total);
    return groups;
  }, {});
  const paymentBars = Object.entries(byPayment)
    .map(([method, amount]) => ({
      method, amount: amount.toFixed(2),
      share: total ? Math.max(4, Math.round(amount / total * 100)) : 0
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const cashierTotals = Object.entries(byCashier)
    .map(([name, amount]) => ({ name, amount: amount.toFixed(2) }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const bestSelling = new Map();
  for (const sale of sales) for (const item of sale.SaleItems) {
    const current = bestSelling.get(item.medicineName) || 0;
    bestSelling.set(item.medicineName, current + item.quantity);
  }
  const topItems = [...bestSelling].map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  const inventory = plain(await Medicine.findAll({
    where: { active: true }, include: [Category], order: [["name", "ASC"]]
  }));
  const expiringBy = daysFromToday(30);
  const lowStock = inventory.filter(item => item.stock <= item.minimumStock);
  const expiring = inventory.filter(item => item.expirationDate && item.expirationDate <= expiringBy);
  res.render("reports", {
    title: "Reports", from, to, period, sales: plain(sales),
    inventory, lowStock, expiring,
    summary: { total: total.toFixed(2), count: sales.length, paymentBars, cashierTotals, topItems }
  });
});

export const exportReport = asyncHandler(async (req, res) => {
  const from = req.query.from || today();
  const to = req.query.to || today();
  let dateRange;
  try {
    dateRange = getDateRange(from, to);
  } catch (error) {
    return res.status(400).render("error", { title: "Invalid report range", message: error.message });
  }
  const sales = await Sale.findAll({
    where: { status: "completed", createdAt: { [Op.gte]: dateRange.start, [Op.lt]: dateRange.end } },
    include: [
      { model: SaleItem }, { model: User, attributes: ["name"] },
      { model: Branch, attributes: ["name"] }, { model: Customer, attributes: ["name", "cardNumber"] }
    ],
    order: [["createdAt", "ASC"]]
  });
  const quote = value => {
    const text = String(value ?? "");
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const rows = [[
    "Reference", "Date", "Cashier", "Branch", "Customer", "Loyalty card", "Payment method", "Payment provider",
    "Payment status", "Payment reference", "Medicine", "Quantity", "Line total"
  ]];
  for (const sale of sales) {
    for (const item of sale.SaleItems) rows.push([
      sale.reference, sale.createdAt.toISOString(), sale.User.name, sale.Branch?.name || "",
      sale.Customer?.name || "", sale.Customer?.cardNumber || "", sale.paymentMethod,
      sale.paymentProvider || "", sale.paymentStatus, sale.paymentReference || "",
      item.medicineName, item.quantity, item.lineTotal
    ]);
  }
  res.type("text/csv").attachment(`pharmacore-sales-${from}-to-${to}.csv`)
    .send(rows.map(row => row.map(quote).join(",")).join("\r\n"));
});

export const usersPage = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    attributes: ["id", "name", "email", "role", "active", "branchId", "createdAt"],
    include: [{ model: Branch, attributes: ["name"] }], order: [["name", "ASC"]]
  });
  const branches = plain(await Branch.findAll({ order: [["name", "ASC"]] }));
  res.render("users", {
    title: "User management",
    branches,
    // each row gets its own copy of the branch list with its branch marked as selected
    users: plain(users).map(user => ({
      ...user, branchOptions: branches.map(branch => ({ ...branch, selected: branch.id === user.branchId }))
    }))
  });
});

export const createUser = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 ||
      !["admin", "pharmacist", "cashier"].includes(role)) {
    return res.status(400).render("error", { title: "Invalid user", message: "Provide a name, valid email, role, and password with at least 10 characters." });
  }
  const branchId = asInt(req.body.branchId);
  const validBranch = req.body.branchId && Number.isInteger(branchId) && await Branch.findByPk(branchId);
  await User.create({ name, email, password: await bcrypt.hash(password, 12), role, branchId: validBranch ? branchId : null });
  res.redirect("/users");
});

export const toggleUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).render("error", { title: "Not found", message: "User not found." });
  if (user.id === req.user.id) return res.status(400).render("error", { title: "Invalid action", message: "You cannot deactivate your own account." });
  if (user.active && user.role === "admin" &&
      await User.count({ where: { role: "admin", active: true, id: { [Op.ne]: user.id } } }) === 0) {
    return res.status(409).render("error", { title: "Administrator required", message: "At least one active administrator account must remain." });
  }
  await user.update({ active: !user.active });
  res.redirect("/users");
});

export const settingsPage = asyncHandler(async (req, res) => {
  const savedTaxRate = await Setting.findByPk("salesTaxRate");
  const settings = await getStoreSettings();
  const branches = plain(await Branch.findAll({ order: [["name", "ASC"]] }))
    .map(branch => ({ ...branch, selected: String(branch.id) === settings.defaultBranchId }));
  res.render("settings", {
    title: "Settings",
    settings, branches,
    // Round away float noise such as 0.07 * 100 = 7.000000000000001
    taxRate: Number((Number(savedTaxRate?.value ?? process.env.SALES_TAX_RATE ?? 0) * 100).toFixed(4))
  });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const taxRatePercent = Number(req.body.taxRatePercent);
  if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100) {
    return res.status(400).render("error", { title: "Invalid tax rate", message: "Tax rate must be a percentage between 0 and 100." });
  }
  await Setting.upsert({ key: "salesTaxRate", value: String(taxRatePercent / 100) });
  res.redirect("/settings");
});
