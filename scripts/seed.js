import "dotenv/config";
import { Category, InventoryMovement, Medicine, Supplier, User, sequelize } from "../models/models.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed data cannot be loaded when NODE_ENV=production.");
}

try {
  await sequelize.authenticate();
  await sequelize.sync();
  const admin = await User.findOne({ where: { role: "admin", active: true } });
  if (!admin) throw new Error("Create an administrator before loading development seed data.");
  const [analgesics] = await Category.findOrCreate({
    where: { name: "Analgesics" }, defaults: { description: "Pain and fever relief products" }
  });
  const [rehydration] = await Category.findOrCreate({
    where: { name: "Rehydration" }, defaults: { description: "Development sample category" }
  });
  const [supplier] = await Supplier.findOrCreate({
    where: { name: "Demo Health Supply" },
    defaults: { phone: "000-000-0000", email: "demo@example.invalid", address: "Development sample only" }
  });
  const samples = [
    { code: "DEMO-PAR-500", name: "Paracetamol", genericName: "Paracetamol", strength: "500 mg", dosageForm: "Tablet", price: "2.50", categoryId: analgesics.id },
    { code: "DEMO-ORS-01", name: "Oral Rehydration Salts", genericName: "Oral rehydration salts", strength: "20.5 g", dosageForm: "Sachet", price: "18.00", categoryId: rehydration.id }
  ];
  for (const sample of samples) {
    const [medicine, created] = await Medicine.findOrCreate({
      where: { code: sample.code },
      defaults: {
        ...sample, stock: 25, minimumStock: 5,
        batchNumber: `DEV-${sample.code}`, expirationDate: "2028-12-31",
        categoryId: sample.categoryId, supplierId: supplier.id
      }
    });
    if (created) {
      await InventoryMovement.create({
        medicineId: medicine.id, userId: admin.id, type: "stock_in",
        quantityChange: medicine.stock, stockAfter: medicine.stock, reason: "Development seed opening stock"
      });
    }
  }
  console.log("Development sample medicines are ready. No sample transactions were created.");
} finally {
  await sequelize.close();
}
