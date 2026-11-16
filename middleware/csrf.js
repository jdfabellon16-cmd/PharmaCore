import crypto from "crypto";

// File-upload routes: their form body is only read by multer inside the route,
// so the token is checked there with verifyCsrf (after the upload is parsed).
const UPLOAD_ROUTES = new Set(["/settings/store"]);

const tokenMatches = (req) => {
  const expected = Buffer.from(req.session.csrfToken);
  const supplied = Buffer.from(String(req.body?._csrf || ""));
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
};

const reject = (req, res) => {
  const message = "Refresh the page and submit the form again.";
  if (req.is("application/json")) return res.status(403).json({ error: `Request expired. ${message}` });
  return res.status(403).render("error", { title: "Request expired", message });
};

export const csrfProtection = (req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method !== "POST") return next();
  if (UPLOAD_ROUTES.has(req.path) && req.is("multipart/form-data")) return next();
  if (!tokenMatches(req)) return reject(req, res);
  next();
};

// Use right after the upload middleware on routes listed in UPLOAD_ROUTES
export const verifyCsrf = (req, res, next) => (tokenMatches(req) ? next() : reject(req, res));
