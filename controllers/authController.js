import bcrypt from "bcrypt";
import { User } from "../models/models.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const loginPage = (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  res.render("login", {
    title: "Sign in",
    error: req.flash("error")[0] || "",
    success: req.flash("success")[0] || ""
  });
};

export const registerPage = (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  res.render("register", {
    title: "Request an account",
    error: "",
    name: "",
    email: ""
  });
};

export const registerUser = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const formData = { title: "Request an account", name, email };

  if (name.length < 2 || name.length > 120) {
    return res.status(400).render("register", { ...formData, error: "Name must be between 2 and 120 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return res.status(400).render("register", { ...formData, error: "Enter a valid email address." });
  }
  if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).render("register", { ...formData, error: "Password must be at least 10 characters and no more than 72 bytes." });
  }
  if (password !== confirmPassword) {
    return res.status(400).render("register", { ...formData, error: "The passwords do not match." });
  }

  const existingUser = await User.findOne({ where: { email }, attributes: ["id"] });
  if (existingUser) {
    return res.status(409).render("register", {
      ...formData,
      error: "An account with that email already exists. Sign in or contact your administrator."
    });
  }

  try {
    await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role: "cashier",
      active: false
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).render("register", {
        ...formData,
        error: "An account with that email already exists. Sign in or contact your administrator."
      });
    }
    throw error;
  }

  req.flash("success", "Your account request was submitted. An administrator must activate it before you can sign in.");
  res.redirect("/login");
});

export const loginUser = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await User.findOne({ where: { email } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.password))) {
    req.flash("error", "Email or password is incorrect.");
    return res.redirect("/login");
  }
  req.session.regenerate(error => {
    if (error) return res.status(500).render("error", { title: "Sign in failed", message: "Please try again." });
    req.session.userId = user.id;
    res.redirect("/dashboard");
  });
});

export const logoutUser = (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("pharmacore.sid");
    res.redirect("/login");
  });
};
