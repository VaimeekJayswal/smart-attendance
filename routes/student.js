const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireStudent(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "student") return res.status(403).send("Forbidden");
  next();
}

// file upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const safe = Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, safe);
  },
});
const upload = multer({ storage });

router.get("/student/dashboard", requireLogin, requireStudent, (req, res) => {
  const sid = req.session.user.id;

  db.all(
    `SELECT s.id, s.code, s.name
     FROM enrollments e JOIN subjects s ON s.id=e.subject_id
     WHERE e.student_id=?
     ORDER BY s.code`,
    [sid],
    (err, subjects) => {
      // compute percent per subject
      db.all(
        `SELECT s.id AS subject_id, a.status
         FROM attendance a
         JOIN lectures l ON l.id=a.lecture_id
         JOIN subjects s ON s.id=l.subject_id
         WHERE a.student_id=?`,
        [sid],
        (e2, rows) => {
          const map = new Map(); // subjectId -> {P,L,A}
          for (const r of rows || []) {
            if (!map.has(r.subject_id)) map.set(r.subject_id, { P: 0, L: 0, A: 0 });
            map.get(r.subject_id)[r.status] += 1;
          }

          const cards = (subjects || []).map(sub => {
            const c = map.get(sub.id) || { P: 0, L: 0, A: 0 };
            const total = c.P + c.L + c.A;
            const attended = c.P + c.L;
            const pct = total === 0 ? 0 : Math.round((attended / total) * 100);
            return { ...sub, ...c, pct };
          });

          res.render("student_dashboard", { cards });
        }
      );
    }
  );
});

router.get("/student/subject/:id", requireLogin, requireStudent, (req, res) => {
  const sid = req.session.user.id;
  const subjectId = Number(req.params.id);

  db.get("SELECT * FROM subjects WHERE id=?", [subjectId], (e0, subject) => {
    db.all(
      `SELECT a.id AS attendance_id, l.lecture_date, l.start_time, a.status, a.reason_category
       FROM attendance a
       JOIN lectures l ON l.id=a.lecture_id
       WHERE a.student_id=? AND l.subject_id=?
       ORDER BY l.lecture_date DESC, l.start_time DESC`,
      [sid, subjectId],
      (err, rows) => {
        res.render("student_subject", { subject, rows: rows || [] });
      }
    );
  });
});

router.get("/student/justify/:attendanceId", requireLogin, requireStudent, (req, res) => {
  const sid = req.session.user.id;
  const attendanceId = Number(req.params.attendanceId);

  db.get(
    `SELECT a.id, a.status, l.lecture_date, l.start_time, s.code
     FROM attendance a
     JOIN lectures l ON l.id=a.lecture_id
     JOIN subjects s ON s.id=l.subject_id
     WHERE a.id=? AND a.student_id=?`,
    [attendanceId, sid],
    (err, row) => {
      if (!row) return res.status(404).send("Not found");
      res.render("student_justify", { row, error: null });
    }
  );
});

router.post("/student/justify/:attendanceId", requireLogin, requireStudent, upload.single("proof"), (req, res) => {
  const sid = req.session.user.id;
  const attendanceId = Number(req.params.attendanceId);
  const { message } = req.body;

  if (!message) {
    return res.render("student_justify", { row: { id: attendanceId }, error: "Message required" });
  }

  const file_path = req.file ? `/uploads/${req.file.filename}` : null;

  const submitted_at = new Date().toISOString();

  db.run(
    `INSERT INTO justifications(attendance_id, student_id, message, file_path, submitted_at, status)
     VALUES (?,?,?,?,?, 'Pending')`,
    [attendanceId, sid, message, file_path, submitted_at],
    () => res.redirect("/student/dashboard")
  );
});

module.exports = router;
