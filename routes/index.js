import express from "express";
import { loginPage, loginUser, logoutUser, registerPage, registerUser } from "../controllers/authController.js";
import * as pharmacy from "../controllers/pharmacyController.js";
import * as store from "../controllers/storeController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import multer from "multer";

// Store logo: kept in memory, checked and written by the controller
const logoUpload = (req, res, next) => multer({
  storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 }
}).single("logo")(req, res, error => {
  if (!error) return next();
  res.status(400).render("error", {
    title: "Logo not uploaded",
    message: error.code === "LIMIT_FILE_SIZE" ? "The logo must be 2 MB or smaller." : "The logo could not be read."
  });
});

const router = express.Router();
const admin = allowRoles("admin");
const inventoryStaff = allowRoles("admin", "pharmacist");
const reportStaff = allowRoles("admin", "pharmacist");
const salesStaff = allowRoles("admin", "pharmacist", "cashier");

router.get("/", (req, res) => res.redirect(req.user ? "/dashboard" : "/login"));
router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
router.post("/register", registerUser);
router.post("/logout", requireAuth, logoutUser);

router.get("/dashboard", requireAuth, pharmacy.dashboardPage);
router.get("/medicines", requireAuth, pharmacy.medicinesPage);
router.post("/medicines", admin, pharmacy.createMedicine);
router.get("/medicines/:id", requireAuth, pharmacy.medicineDetails);
router.post("/medicines/:id", admin, pharmacy.updateMedicine);
router.post("/medicines/:id/archive", admin, pharmacy.archiveMedicine);

router.get("/categories", admin, pharmacy.categoriesPage);
router.post("/categories", admin, pharmacy.createCategory);
router.post("/categories/:id/update", admin, pharmacy.updateCategory);
router.post("/categories/:id/delete", admin, pharmacy.deleteCategory);
router.get("/suppliers", admin, pharmacy.suppliersPage);
router.post("/suppliers", admin, pharmacy.createSupplier);
router.post("/suppliers/:id/update", admin, pharmacy.updateSupplier);
router.post("/suppliers/:id/delete", admin, pharmacy.deleteSupplier);

router.get("/pos", salesStaff, pharmacy.posPage);
router.get("/pos/medicines", salesStaff, pharmacy.searchPosMedicines);
router.post("/pos/checkout", salesStaff, pharmacy.completeSale);
router.get("/transactions", requireAuth, pharmacy.transactionsPage);
router.get("/transactions/:id", requireAuth, pharmacy.transactionDetails);
router.get("/inventory", inventoryStaff, pharmacy.inventoryPage);
router.post("/inventory/:id/adjustments", inventoryStaff, pharmacy.adjustInventory);
router.get("/reports", reportStaff, pharmacy.reportsPage);
router.get("/reports/export.csv", reportStaff, pharmacy.exportReport);
router.get("/users", admin, pharmacy.usersPage);
router.post("/users", admin, pharmacy.createUser);
router.post("/users/:id/toggle", admin, pharmacy.toggleUser);
router.post("/users/:id/branch", admin, store.setUserBranch);
router.get("/settings", admin, pharmacy.settingsPage);
router.post("/settings", admin, pharmacy.updateSettings);
router.post("/settings/store", admin, logoUpload, verifyCsrf, store.updateStoreSettings);

// POS dialogs (JSON)
router.post("/pos/void", salesStaff, store.voidSale);
router.get("/pos/price-check", salesStaff, store.priceCheck);
router.get("/customers/lookup", salesStaff, store.lookupCustomer);
router.post("/customers", salesStaff, store.createCustomer);

router.get("/sales-history", reportStaff, store.salesHistoryPage);
router.get("/branches", admin, store.branchesPage);
router.post("/branches", admin, store.createBranch);
router.post("/branches/:id/rename", admin, store.renameBranch);

export default router;
