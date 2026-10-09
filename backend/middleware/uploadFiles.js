// Bulk file upload (Excel / CSV / PDF), several files per request.
// Accepts the multi-file field "files" and the old single-file field "file" (kept for existing scripts).
const multer = require("multer");

const MAX_FILES = 20;
const MAX_MB = 10;

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: MAX_FILES } })
  .fields([{ name: "files", maxCount: MAX_FILES }, { name: "file", maxCount: 1 }]);

// backUrl: where to send the admin if the upload itself is rejected
module.exports = (backUrl) => (req, res, next) => parser(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === "LIMIT_FILE_SIZE" ? `A file is larger than ${MAX_MB} MB`
    : (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") ? `You can upload at most ${MAX_FILES} files at once`
    : err.message;
  req.flash("error", msg);
  res.redirect(backUrl);
});

module.exports.filesOf = (req) => (Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat());
module.exports.MAX_FILES = MAX_FILES;
module.exports.MAX_MB = MAX_MB;
