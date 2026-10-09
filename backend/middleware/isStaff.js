const { isStaff } = require("../utils/roles");

// Admin or teacher
module.exports = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) { req.flash("error", "Please login first"); return res.redirect("/login"); }
  if (!isStaff(req.user)) { req.flash("error", "Access denied"); return res.redirect("/dashboard"); }
  next();
};
