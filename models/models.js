import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const User = sequelize.define("User", {
  name: { type: DataTypes.STRING(120), allowNull: false },
  email: { type: DataTypes.STRING(190), allowNull: false, unique: true, validate: { isEmail: true } },
  password: { type: DataTypes.STRING(255), allowNull: false },
  role: {
    type: DataTypes.ENUM("admin", "pharmacist", "cashier"),
    allowNull: false,
    defaultValue: "cashier"
  },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: "users" });

export const Category = sequelize.define("Category", {
  name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(500), allowNull: true }
}, { tableName: "categories" });

export const Supplier = sequelize.define("Supplier", {
  name: { type: DataTypes.STRING(150), allowNull: false },
  phone: { type: DataTypes.STRING(40), allowNull: true },
  email: { type: DataTypes.STRING(190), allowNull: true, validate: { isEmail: true } },
  address: { type: DataTypes.STRING(500), allowNull: true }
}, { tableName: "suppliers" });

export const Medicine = sequelize.define("Medicine", {
  code: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(180), allowNull: false },
  genericName: { type: DataTypes.STRING(180), allowNull: true },
  brandName: { type: DataTypes.STRING(180), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  strength: { type: DataTypes.STRING(100), allowNull: true },
  dosageForm: { type: DataTypes.STRING(80), allowNull: true },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0 } },
  stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
  minimumStock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5, validate: { min: 0 } },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  batchNumber: { type: DataTypes.STRING(100), allowNull: true },
  expirationDate: { type: DataTypes.DATEONLY, allowNull: true },
  requiresPrescription: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { tableName: "medicines" });

export const Sale = sequelize.define("Sale", {
  reference: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  requestKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  discount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  tax: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  amountReceived: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  changeDue: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  paymentMethod: {
    type: DataTypes.ENUM("cash", "card", "mobile"),
    allowNull: false
  },
  paymentProvider: { type: DataTypes.ENUM("gcash", "maya"), allowNull: true },
  paymentReference: { type: DataTypes.STRING(120), allowNull: true },
  paymentStatus: {
    type: DataTypes.ENUM("paid", "recorded"),
    allowNull: false,
    defaultValue: "paid"
  },
  status: { type: DataTypes.ENUM("completed", "voided"), allowNull: false, defaultValue: "completed" },
  voidedAt: { type: DataTypes.DATE, allowNull: true },
  voidReason: { type: DataTypes.STRING(500), allowNull: true }
}, { tableName: "sales" });

export const SaleItem = sequelize.define("SaleItem", {
  medicineName: { type: DataTypes.STRING(180), allowNull: false },
  medicineCode: { type: DataTypes.STRING(80), allowNull: false },
  medicineBatchNumber: { type: DataTypes.STRING(100), allowNull: true },
  unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
  lineTotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  prescriptionVerifiedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: "sale_items" });

export const InventoryMovement = sequelize.define("InventoryMovement", {
  type: { type: DataTypes.ENUM("stock_in", "sale", "adjustment"), allowNull: false },
  quantityChange: { type: DataTypes.INTEGER, allowNull: false },
  stockAfter: { type: DataTypes.INTEGER, allowNull: false },
  reason: { type: DataTypes.STRING(500), allowNull: false }
}, { tableName: "inventory_movements" });

// Branches share one catalog and inventory; sales record which branch made them.
export const Branch = sequelize.define("Branch", {
  name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: "branches" });

export const Customer = sequelize.define("Customer", {
  name: { type: DataTypes.STRING(120), allowNull: false },
  cardNumber: { type: DataTypes.STRING(60), allowNull: false, unique: true },
  phone: { type: DataTypes.STRING(40), allowNull: true }
}, { tableName: "customers" });

export const Setting = sequelize.define("Setting", {
  key: { type: DataTypes.STRING(100), primaryKey: true },
  value: { type: DataTypes.STRING(500), allowNull: false }
}, { tableName: "settings", timestamps: true });

Category.hasMany(Medicine, { foreignKey: { name: "categoryId", allowNull: true }, onDelete: "RESTRICT" });
Medicine.belongsTo(Category, { foreignKey: "categoryId" });
Supplier.hasMany(Medicine, { foreignKey: { name: "supplierId", allowNull: true }, onDelete: "RESTRICT" });
Medicine.belongsTo(Supplier, { foreignKey: "supplierId" });
User.hasMany(Sale, { foreignKey: { name: "userId", allowNull: false }, onDelete: "RESTRICT" });
Sale.belongsTo(User, { foreignKey: "userId" });
Sale.hasMany(SaleItem, { foreignKey: { name: "saleId", allowNull: false }, onDelete: "RESTRICT" });
SaleItem.belongsTo(Sale, { foreignKey: "saleId" });
User.hasMany(SaleItem, { foreignKey: { name: "prescriptionVerifiedById", allowNull: true }, as: "VerifiedPrescriptionItems", onDelete: "SET NULL" });
SaleItem.belongsTo(User, { foreignKey: { name: "prescriptionVerifiedById", allowNull: true }, as: "PrescriptionVerifier" });
Medicine.hasMany(SaleItem, { foreignKey: { name: "medicineId", allowNull: false }, onDelete: "RESTRICT" });
SaleItem.belongsTo(Medicine, { foreignKey: "medicineId" });
Medicine.hasMany(InventoryMovement, { foreignKey: { name: "medicineId", allowNull: false }, onDelete: "RESTRICT" });
InventoryMovement.belongsTo(Medicine, { foreignKey: "medicineId" });
User.hasMany(InventoryMovement, { foreignKey: { name: "userId", allowNull: false }, onDelete: "RESTRICT" });
InventoryMovement.belongsTo(User, { foreignKey: "userId" });
Sale.hasMany(InventoryMovement, { foreignKey: { name: "saleId", allowNull: true }, onDelete: "RESTRICT" });
InventoryMovement.belongsTo(Sale, { foreignKey: "saleId" });
Branch.hasMany(User, { foreignKey: { name: "branchId", allowNull: true }, onDelete: "SET NULL" });
User.belongsTo(Branch, { foreignKey: "branchId" });
Branch.hasMany(Sale, { foreignKey: { name: "branchId", allowNull: true }, onDelete: "RESTRICT" });
Sale.belongsTo(Branch, { foreignKey: "branchId" });
Customer.hasMany(Sale, { foreignKey: { name: "customerId", allowNull: true }, onDelete: "RESTRICT" });
Sale.belongsTo(Customer, { foreignKey: "customerId" });
Sale.belongsTo(User, { foreignKey: { name: "voidedById", allowNull: true }, as: "VoidedBy" });

export { sequelize };
