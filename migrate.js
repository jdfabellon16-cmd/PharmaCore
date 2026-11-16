import "dotenv/config";
import mysql from "mysql2/promise";
import { DataTypes } from "sequelize";
import { sequelize } from "./models/db.js";
import { sessionStore } from "./models/sessionStore.js";
import "./models/models.js";

const database = process.env.DB_NAME || "pharmacore";
if (!/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
}

let connection;
try {
  connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await sequelize.authenticate();
  await sequelize.sync();
  const queryInterface = sequelize.getQueryInterface();
  const salesColumns = await queryInterface.describeTable("sales");
  if (!salesColumns.paymentProvider) {
    await queryInterface.addColumn("sales", "paymentProvider", {
      type: DataTypes.ENUM("gcash", "maya"), allowNull: true
    });
  }
  if (!salesColumns.paymentReference) {
    await queryInterface.addColumn("sales", "paymentReference", {
      type: DataTypes.STRING(120), allowNull: true
    });
  }
  if (!salesColumns.paymentStatus) {
    await queryInterface.addColumn("sales", "paymentStatus", {
      type: DataTypes.ENUM("paid", "recorded"), allowNull: false, defaultValue: "paid"
    });
  }
  const saleItemColumns = await queryInterface.describeTable("sale_items");
  if (!saleItemColumns.medicineBatchNumber) {
    await queryInterface.addColumn("sale_items", "medicineBatchNumber", {
      type: DataTypes.STRING(100), allowNull: true
    });
  }
  if (!saleItemColumns.prescriptionVerifiedById) {
    await queryInterface.addColumn("sale_items", "prescriptionVerifiedById", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });
  }
  if (!saleItemColumns.prescriptionVerifiedAt) {
    await queryInterface.addColumn("sale_items", "prescriptionVerifiedAt", {
      type: DataTypes.DATE, allowNull: true
    });
  }
  // Branches, customers and voids (added after the first release)
  const addIfMissing = async (table, columns, name, definition) => {
    if (!columns[name]) await queryInterface.addColumn(table, name, definition);
  };
  const userColumns = await queryInterface.describeTable("users");
  await addIfMissing("users", userColumns, "branchId", {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL"
  });
  const saleColumnsNow = await queryInterface.describeTable("sales");
  await addIfMissing("sales", saleColumnsNow, "branchId", {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT"
  });
  await addIfMissing("sales", saleColumnsNow, "customerId", {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT"
  });
  await addIfMissing("sales", saleColumnsNow, "voidedById", {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL"
  });
  await addIfMissing("sales", saleColumnsNow, "voidedAt", { type: DataTypes.DATE, allowNull: true });
  await addIfMissing("sales", saleColumnsNow, "voidReason", { type: DataTypes.STRING(500), allowNull: true });

  // First run only: create a default branch and file existing sales under it
  const { Branch, Sale, Setting } = sequelize.models;
  if (await Branch.count() === 0) {
    const main = await Branch.create({ name: "Main Branch" });
    await Setting.upsert({ key: "defaultBranchId", value: String(main.id) });
    await Sale.update({ branchId: main.id }, { where: { branchId: null } });
    console.log('Created "Main Branch" as the default branch.');
  }

  await sessionStore.sync();
  console.log(`Database "${database}" is ready. Existing tables and records were preserved.`);
} catch (error) {
  console.error("Database setup failed:", error.message);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
  await sequelize.close();
}
