# PharmaCore

PharmaCore is an XianFire/Express pharmacy inventory and point-of-sale application. The application uses `.xian` Handlebars views, Sequelize, and MySQL; it does not use a client-side replacement framework.

## Structure and database relationships

```text
controllers/       Authentication and pharmacy workflows
middleware/        Authentication, roles, CSRF, async error forwarding
models/            MySQL connection, Sequelize models, associations
routes/            XianFire Express route registration
services/          Shared sales calculations and validation
views/             Page templates and reusable partials
public/            Application stylesheet and static assets
scripts/           Explicit admin creation and development seed commands
tests/              Business-rule tests
```

Database relationships:

- A `Category` and a `Supplier` can each have many `Medicine` records.
- A `User` processes many `Sale` records. Sales retain their cashier, total, payment details, and unique idempotency key.
- A `Sale` has many `SaleItem` rows. Each item preserves the medicine name, code, unit price, quantity, and line total at the time of sale.
- Sale rows retain the payment reference, payment provider, and recorded/paid status. Sale items retain the batch number and, when needed, the pharmacist/admin account and time that verified a prescription.
- A `Medicine` has many `SaleItem` and `InventoryMovement` records. Stock movements retain the responsible staff member, reason, quantity change, and resulting stock.
- Express sessions are stored in the MySQL `sessions` table, with HTTP-only cookies and secure-cookie behavior enabled in production.
- The `settings` table stores administrator-managed settings such as the POS tax rate.
- Medicines referenced by sales or stock history are retained; categories and suppliers in use cannot be deleted.

## Requirements

- Node.js 20 or newer
- MySQL 8 or compatible MySQL server
- A MySQL account allowed to create the configured database and tables

## Windows setup (PowerShell)

1. Install Node.js and MySQL, then open PowerShell in this project folder.
2. Install project dependencies:

   ```powershell
   npm.cmd install
   ```

3. Optional for the default local MySQL setup, create a local environment file and edit it with your MySQL credentials:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   For development without `.env`, PharmaCore defaults to MySQL user `root` with an empty password and generates a temporary session secret (sessions reset when the server restarts). If your MySQL credentials differ, create `.env` and set `DB_USER` and `DB_PASSWORD`. For persistent development sessions, set `SESSION_SECRET` too. Production requires all three values, and production session secrets must be at least 32 characters. `SALES_TAX_RATE` is the initial/default tax rate; an administrator can save the operating rate in Settings. Generate a session secret with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Put the generated value in `SESSION_SECRET`. Keep `.env` private and out of source control. `SALES_TAX_RATE` is a decimal rate between 0 and 1 (`0.12` means 12%).

4. Create the database and application tables and apply additive POS columns without dropping existing data:

   ```powershell
   npm.cmd run migrate
   ```

   The migration command creates the configured database if needed, calls Sequelize `sync()` without `force`, and adds missing payment/prescription audit columns to existing sales tables.

5. Create the first administrator interactively. The password is masked and hashed before storage:

   ```powershell
   npm.cmd run create:admin
   ```

6. Optionally add development-only sample categories, a supplier, and medicine stock:

   ```powershell
   npm.cmd run seed
   ```

   This command is blocked in production and does not add fake sales.

7. Start the server and open `http://localhost:3000`:

   ```powershell
   npm.cmd start
   ```

## Roles and use

- **Administrator:** dashboard, medicine/category/supplier management, inventory adjustments, all transactions and reports, staff accounts, and settings.
- **Pharmacist:** inventory, prescription verification during POS checkout, sales, transactions, and reports.
- **Cashier:** POS, medicine lookup, and only their own transactions.

Staff can request an account from the login page. Self-registered accounts are assigned the cashier role and remain inactive until an administrator activates them from **User management**. Administrators can also create or activate staff directly. The initial administrator is created through the explicit setup command.

For a sale, search medicines by name, generic name, brand, strength, or code, then add quantities in POS. Confirm a paper prescription where required as a pharmacist/administrator. Cash payments calculate change; card and GCash/Maya payments require a reference and are recorded as unverified by a gateway (no payment gateway is connected). Price and stock are reloaded and validated in a MySQL transaction; a unique request key prevents the same checkout form from recording twice. Stock movements and sale item rows are saved in that same transaction. Receipts can be printed or reprinted from transaction history, and reports use completed database transactions.

Inventory currently stores one batch number and expiry date per medicine record rather than a separate multi-batch inventory table. Checkout records that batch number on each sale item and prevents expired medicine sales; true FEFO allocation across multiple batches requires a future batch-level inventory migration.

POS keyboard shortcuts: `F2` focuses medicine search; arrow keys navigate results and `Enter` adds the highlighted medicine; `F6` focuses payment method; `F8` focuses amount received; `F9` completes the sale through the existing form validation; `F10` prints the last viewed/completed receipt; `Esc` closes search results; `Ctrl+Backspace` clears the cart using the existing confirmation.

Sidebar navigation shortcuts: `Shift+1` Dashboard, `Shift+2` Point of Sale, `Shift+3` Medicines, `Shift+4` Categories, `Shift+5` Suppliers, `Shift+6` Inventory, `Shift+7` Transactions, `Shift+8` Reports, `Shift+9` User Management, and `Shift+0` Settings. A shortcut only opens a page present in the current user's sidebar; sign-out has no shortcut.

Point of Sale and transaction history are two in-place tabs on `/pos`. Use the tabs or left/right arrow keys (when not editing a field) to switch panes. The existing `/transactions` URL redirects to the transaction tab, and receipt detail links remain available from the table.

## Tests

Run the business-rule tests:

```powershell
npm.cmd test
```

These cover monetary rounding, discounts and tax, empty/invalid cart quantities, insufficient stock, expiry validation, prescription verification, and payment validation. Full MySQL integration checks (including concurrent/duplicate checkout and rollback behavior) require a configured MySQL database and should be run against a non-production test database.

To run the checkout integration test, create a disposable MySQL database and use its name with the `test_` prefix. The test removes the records it creates but never drops tables:

```powershell
$env:TEST_DB_NAME = "test_pharmacore"
npm.cmd test
```
