const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.status(403).send("Forbidden");
    next();
  };
}

// Users
router.get("/admin/users", requireLogin, requireRole("admin"), (req, res) => {
  db.all("SELECT id,name,email,role FROM users ORDER BY id DESC", (err, users) => {
    res.render("admin_users", { users: users || [], error: null });
  });
});

router.post("/admin/users", requireLogin, requireRole("admin"), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return db.all("SELECT id,name,email,role FROM users ORDER BY id DESC", (e, users) =>
      res.render("admin_users", { users: users || [], error: "All fields required" })
    );
  }

  const hash = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)",
    [name, email, hash, role],
    (err) => {
      if (err) {
        return db.all("SELECT id,name,email,role FROM users ORDER BY id DESC", (e, users) =>
          res.render("admin_users", { users: users || [], error: "Email already exists" })
        );
      }
      res.redirect("/admin/users");
    }
  );
});

// Subjects
router.get("/admin/subjects", requireLogin, requireRole("admin"), (req, res) => {
  db.all("SELECT * FROM subjects ORDER BY id DESC", (err, subjects) => {
    res.render("admin_subjects", { subjects: subjects || [], error: null });
  });
});

router.post("/admin/subjects", requireLogin, requireRole("admin"), (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.redirect("/admin/subjects");

  db.run("INSERT INTO subjects(code,name) VALUES (?,?)", [code, name], (err) => {
    res.redirect("/admin/subjects");
  });
});

// Enroll
router.get("/admin/enroll", requireLogin, requireRole("admin"), (req, res) => {
  db.all("SELECT id,name,email FROM users WHERE role='student' ORDER BY name", (e1, students) => {
    db.all("SELECT * FROM subjects ORDER BY name", (e2, subjects) => {
      db.all(
        `SELECT e.id, u.name AS student_name, s.code AS subject_code
         FROM enrollments e
         JOIN users u ON u.id=e.student_id
         JOIN subjects s ON s.id=e.subject_id
         ORDER BY e.id DESC`,
        (e3, enrollments) => {
          res.render("admin_enroll", { students: students || [], subjects: subjects || [], enrollments: enrollments || [] });
        }
      );
    });
  });
});

router.post("/admin/enroll", requireLogin, requireRole("admin"), (req, res) => {
  const { student_id, subject_id } = req.body;
  if (!student_id || !subject_id) return res.redirect("/admin/enroll");

  db.run("INSERT OR IGNORE INTO enrollments(student_id,subject_id) VALUES (?,?)", [student_id, subject_id], () => {
    res.redirect("/admin/enroll");
  });
});

module.exports = router;
