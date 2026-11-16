import { User } from "../models/models.js";

export const loadCurrentUser = async (req, res, next) => {
  try {
    if (req.session.userId) {
      req.user = await User.findByPk(req.session.userId, {
        attributes: ["id", "name", "email", "role", "active", "branchId"]
      });
      if (!req.user || !req.user.active) {
        delete req.session.userId;
        req.user = null;
      }
    }
    res.locals.user = req.user || null;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth = (req, res, next) => {
  if (!req.user) return res.redirect("/login");
  next();
};

export const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.redirect("/login");
  if (!roles.includes(req.user.role)) return res.status(403).render("error", {
    title: "Access denied",
    message: "Your account does not have permission to access this page."
  });
  next();
};
