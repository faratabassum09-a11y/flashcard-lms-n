module.exports.getLogin = (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect("/dashboard");
  res.render("users/login", { title: "Sign in" });
};

module.exports.postLogin = (req, res) => {
  if (!req.user) return res.redirect("/login");
  return res.redirect("/dashboard");
};

module.exports.getLogout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "You have been signed out");
    res.redirect("/login");
  });
};
