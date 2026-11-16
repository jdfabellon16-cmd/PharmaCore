/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import express from "express";
import path from "path";
import session from "express-session";
import flash from "connect-flash";
import { engine } from "express-handlebars";
import router from "./routes/index.js";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";
import { loadCurrentUser } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { sequelize } from "./models/db.js";
import { sessionStore } from "./models/sessionStore.js";
import { getStoreSettings } from "./services/storeSettings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET must be set in the environment.");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Relative to this file, so CSS/JS still load when started from another folder (e.g. Electron)
app.use(express.static(path.join(__dirname, "public")));
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(session({
  name: "pharmacore.sid",
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(flash());
app.use(csrfProtection);
app.use(loadCurrentUser);
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.isAdmin = req.user?.role === "admin";
  res.locals.isPharmacist = req.user?.role === "pharmacist";
  res.locals.isCashier = req.user?.role === "cashier";
  next();
});
// Store name/logo for page headers and receipts (signed-in pages only)
app.use((req, res, next) => {
  if (!req.user || req.method !== "GET") return next();
  getStoreSettings()
    .then(settings => { res.locals.store = { name: settings.storeName, logo: settings.storeLogo }; next(); })
    .catch(next);
});


app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");
const partialsDir = path.join(__dirname, "views/partials");
app.engine("xian", engine({
  extname: ".xian",
  defaultLayout: false,
  partialsDir,
  helpers: {
    eq: (left, right) => String(left) === String(right),
    lte: (left, right) => Number(left) <= Number(right),
    // Rounded so 0.07 x 100 shows as 7, not 7.000000000000001
    multiply: (left, right) => Number((Number(left) * Number(right)).toFixed(6))
  }
}));

app.use("/", router);
app.use((req, res) => res.status(404).render("error", {
  title: "Page not found",
  message: "The page you requested does not exist."
}));
// Database errors caused by the submitted form (duplicate code/email/name, invalid
// email, missing category) are shown to the user instead of a generic server error.
const userFacingDatabaseError = error => {
  switch (error?.name) {
    case "SequelizeUniqueConstraintError": {
      const fields = Object.keys(error.fields || {}).join(", ") || "value";
      return { status: 409, title: "Already exists", message: `A record with the same ${fields} already exists.` };
    }
    case "SequelizeValidationError":
      return { status: 400, title: "Invalid input", message: error.errors.map(item => item.message).join(" ") };
    case "SequelizeForeignKeyConstraintError":
      return { status: 400, title: "Invalid selection", message: "A selected record no longer exists or is still in use." };
    default:
      return null;
  }
};

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const known = userFacingDatabaseError(error);
  if (known) return res.status(known.status).render("error", { title: known.title, message: known.message });
  console.error(error);
  res.status(500).render("error", {
    title: "Something went wrong",
    message: process.env.NODE_ENV === "development" ? error.message : "The request could not be completed."
  });
});

export default app;

// Start the HTTP server; resolves once the server is listening.
// Exported so the Electron main process can control startup itself.
export const startServer = (port = PORT) => {
  return (async () => {
    await sequelize.authenticate();
    await sessionStore.sync();
    return new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`PharmaCore running at http://localhost:${port}`);
        resolve(server);
      });
      server.on("error", reject);
    });
  })();
};

// Auto-start only when executed directly (node index.js).
// When imported by electron/main.js, Electron manages the server lifecycle.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun && !process.env.XIAN_ELECTRON) {
  startServer().catch(error => {
    console.error("Could not start PharmaCore:", error.message);
    process.exitCode = 1;
  });
}
