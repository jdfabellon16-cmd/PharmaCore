import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

test("checkout is idempotent and rolls back partial failures", {
  skip: !process.env.TEST_DB_NAME && "Set TEST_DB_NAME to a disposable MySQL database."
}, async () => {
  if (!/^test_[a-z0-9_]+$/i.test(process.env.TEST_DB_NAME)) {
    throw new Error("TEST_DB_NAME must start with test_ to protect non-test databases.");
  }
  process.env.DB_NAME = process.env.TEST_DB_NAME;
  process.env.SALES_TAX_RATE = "0";
  const { sequelize, User, Medicine, Sale, SaleItem, InventoryMovement } =
    await import("../models/models.js");
  const { completeSale } = await import("../controllers/pharmacyController.js");
  const suffix = crypto.randomUUID();
  let user;
  let medicine;
  const createdRequestKeys = [];

  const submit = async requestKey => {
    const req = {
      user: { id: user.id, role: "cashier" },
      body: {
        requestKey, items: JSON.stringify([{ id: medicine.id, quantity: 1 }]),
        paymentMethod: "cash", amountReceived: "1000", discount: "0"
      }
    };
    const res = {
      statusCode: 200,
      redirectTo: null,
      message: "",
      status(code) { this.statusCode = code; return this; },
      redirect(url) { this.redirectTo = url; return this; },
      render(_view, options) { this.message = options.message; return this; }
    };
    await completeSale(req, res, error => {
      if (error) throw error;
    });
    return res;
  };

  try {
    await sequelize.authenticate();
    await sequelize.sync();
    user = await User.create({
      name: "Integration cashier", email: `cashier-${suffix}@example.test`,
      password: "integration-test-hash", role: "cashier"
    });
    medicine = await Medicine.create({
      code: `IT-${suffix}`, name: "Integration medicine", price: "10.00",
      stock: 3, minimumStock: 1, active: true
    });

    const requestKey = suffix;
    createdRequestKeys.push(requestKey);
    const responses = await Promise.all([submit(requestKey), submit(requestKey)]);
    assert.equal(responses[0].redirectTo, responses[1].redirectTo);
    assert.match(responses[0].redirectTo, /^\/transactions\/\d+$/);
    assert.equal(await Sale.count({ where: { requestKey } }), 1);
    assert.equal((await Medicine.findByPk(medicine.id)).stock, 2);
    const sale = await Sale.findOne({ where: { requestKey } });
    assert.equal(await SaleItem.count({ where: { saleId: sale.id } }), 1);
    assert.equal(await InventoryMovement.count({ where: { saleId: sale.id } }), 1);

    const failedRequestKey = crypto.randomUUID();
    createdRequestKeys.push(failedRequestKey);
    const originalCreate = InventoryMovement.create;
    InventoryMovement.create = async function (values, options) {
      if (values.saleId) throw new Error("Simulated movement write failure.");
      return originalCreate.call(this, values, options);
    };
    let failedResponse;
    try {
      failedResponse = await submit(failedRequestKey);
    } finally {
      InventoryMovement.create = originalCreate;
    }
    assert.equal(failedResponse.statusCode, 400);
    assert.equal(await Sale.count({ where: { requestKey: failedRequestKey } }), 0);
    assert.equal((await Medicine.findByPk(medicine.id)).stock, 2);
  } finally {
    if (medicine) {
      await InventoryMovement.destroy({ where: { medicineId: medicine.id } });
      await SaleItem.destroy({ where: { medicineId: medicine.id } });
      for (const requestKey of createdRequestKeys) {
        await Sale.destroy({ where: { requestKey } });
      }
      await medicine.destroy();
    }
    if (user) await user.destroy();
    await sequelize.close();
  }
});
