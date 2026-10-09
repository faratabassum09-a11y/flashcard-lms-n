module.exports = (req, res, next) => {
  if (!req.isAuthenticated()) {
    // the exam screen talks JSON: answer 401 so it can keep the student's answers and ask them to sign in again
    if (req.is("application/json")) return res.status(401).json({ ok: false, auth: false, message: "You were signed out" });
    req.flash("error", "Please login first");
    return res.redirect("/login");
  }
  next();
};
