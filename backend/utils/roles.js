// Who is who. The account named "admin" is the administrator; teachers have role "teacher"; everyone else is a student.
const isSuper   = (u) => !!u && u.username === "admin";
const isTeacher = (u) => !!u && u.role === "teacher" && u.username !== "admin";
const isStaff   = (u) => isSuper(u) || isTeacher(u);

// Mongo filter for "students only" (not the admin, not teachers). $ne also matches accounts that have no role field (old students).
const STUDENTS = { username: { $ne: "admin" }, role: { $ne: "teacher" } };

// Tests this person may see/manage: the admin all, a teacher only the ones they created
const ownTests = (u) => (isSuper(u) ? {} : { createdBy: u._id });
const canManageTest = (u, test) => !!test && (isSuper(u) || (isTeacher(u) && String(test.createdBy) === String(u._id)));

// Subjects a teacher may use (null = no restriction, i.e. the admin)
const allowedSubjects = (u) => (isTeacher(u) ? (u.subjects || []) : null);

module.exports = { isSuper, isTeacher, isStaff, STUDENTS, ownTests, canManageTest, allowedSubjects };
