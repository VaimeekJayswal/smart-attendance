const express = require("express");
const db = require("../db");

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireFaculty(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "faculty") return res.status(403).send("Forbidden");
  next();
}

// Helpers
function lectureStartISO(lecture_date, start_time) {
  // local-ish ISO for comparisons
  return new Date(`${lecture_date}T${start_time}:00`);
}

router.get("/faculty/lectures", requireLogin, requireFaculty, (req, res) => {
  const fid = req.session.user.id;

  db.all(
    `SELECT l.*, s.code, s.name AS subject_name
     FROM lectures l JOIN subjects s ON s.id=l.subject_id
     WHERE l.faculty_id=?
     ORDER BY l.id DESC`,
    [fid],
    (err, lectures) => {
      db.all("SELECT * FROM subjects ORDER BY name", (e2, subjects) => {
        res.render("faculty_lectures", { lectures: lectures || [], subjects: subjects || [] });
      });
    }
  );
});

router.post("/faculty/lectures", requireLogin, requireFaculty, (req, res) => {
  const fid = req.session.user.id;
  const { subject_id, lecture_date, start_time, window_mins, late_after_mins } = req.body;

  db.run(
    `INSERT INTO lectures(subject_id, faculty_id, lecture_date, start_time, window_mins, late_after_mins)
     VALUES (?,?,?,?,?,?)`,
    [subject_id, fid, lecture_date, start_time, Number(window_mins || 10), Number(late_after_mins || 5)],
    () => res.redirect("/faculty/lectures")
  );
});

// Mark attendance page
router.get("/faculty/lectures/:id/mark", requireLogin, requireFaculty, (req, res) => {
  const lectureId = Number(req.params.id);

  db.get(
    `SELECT l.*, s.code, s.name AS subject_name
     FROM lectures l JOIN subjects s ON s.id=l.subject_id
     WHERE l.id=?`,
    [lectureId],
    (err, lecture) => {
      if (!lecture) return res.status(404).send("Lecture not found");

      // get enrolled students for subject
      db.all(
        `SELECT u.id, u.name, u.email
         FROM enrollments e
         JOIN users u ON u.id=e.student_id
         WHERE e.subject_id=?
         ORDER BY u.name`,
        [lecture.subject_id],
        (e2, students) => {
          // existing attendance
          db.all(
            `SELECT * FROM attendance WHERE lecture_id=?`,
            [lectureId],
            (e3, attRows) => {
              const attMap = new Map((attRows || []).map(r => [r.student_id, r]));
              const start = lectureStartISO(lecture.lecture_date, lecture.start_time);
              const now = new Date();
              const minsFromStart = Math.floor((now - start) / 60000);

              const withinWindow = minsFromStart >= 0 && minsFromStart <= lecture.window_mins;

              res.render("faculty_mark", {
                lecture,
                students: students || [],
                attMap,
                minsFromStart,
                withinWindow
              });
            }
          );
        }
      );
    }
  );
});

// Submit marking (P/L/A). Enforce window + auto-late.
router.post("/faculty/lectures/:id/mark", requireLogin, requireFaculty, (req, res) => {
  const lectureId = Number(req.params.id);

  db.get("SELECT * FROM lectures WHERE id=?", [lectureId], (err, lecture) => {
    if (!lecture) return res.status(404).send("Lecture not found");

    const start = lectureStartISO(lecture.lecture_date, lecture.start_time);
    const now = new Date();
    const minsFromStart = Math.floor((now - start) / 60000);

    const withinWindow = minsFromStart >= 0 && minsFromStart <= lecture.window_mins;
    if (!withinWindow) return res.status(400).send("Attendance window closed.");

    const student_id = Number(req.body.student_id);
    let status = req.body.status; // "P","L","A"
    const reason_category = req.body.reason_category || "None";

    // auto-late rule: if they try Present after late_after_mins, convert to Late
    if (status === "P" && minsFromStart > lecture.late_after_mins) status = "L";

    const marked_at = new Date().toISOString();

    // upsert-ish: delete then insert (simple)
    db.run("DELETE FROM attendance WHERE lecture_id=? AND student_id=?", [lectureId, student_id], () => {
      db.run(
        "INSERT INTO attendance(lecture_id, student_id, status, marked_at, reason_category) VALUES (?,?,?,?,?)",
        [lectureId, student_id, status, marked_at, reason_category],
        () => res.redirect(`/faculty/lectures/${lectureId}/mark`)
      );
    });
  });
});

// Justifications list
router.get("/faculty/justifications", requireLogin, requireFaculty, (req, res) => {
  db.all(
    `SELECT j.*, u.name AS student_name, s.code AS subject_code, l.lecture_date, l.start_time, a.status AS att_status
     FROM justifications j
     JOIN users u ON u.id=j.student_id
     JOIN attendance a ON a.id=j.attendance_id
     JOIN lectures l ON l.id=a.lecture_id
     JOIN subjects s ON s.id=l.subject_id
     ORDER BY j.id DESC`,
    (err, rows) => res.render("faculty_justifications", { rows: rows || [] })
  );
});

// Approve/Reject
router.post("/faculty/justifications/:id", requireLogin, requireFaculty, (req, res) => {
  const jid = Number(req.params.id);
  const { action, faculty_comment, convert_to } = req.body; // action: Approved/Rejected, convert_to: P/L/A

  db.get("SELECT * FROM justifications WHERE id=?", [jid], (err, j) => {
    if (!j) return res.status(404).send("Not found");

    db.run(
      "UPDATE justifications SET status=?, faculty_comment=? WHERE id=?",
      [action, faculty_comment || "", jid],
      () => {
        // If approved, optionally convert attendance status
        if (action === "Approved" && convert_to) {
          db.run("UPDATE attendance SET status=? WHERE id=?", [convert_to, j.attendance_id], () =>
            res.redirect("/faculty/justifications")
          );
        } else {
          res.redirect("/faculty/justifications");
        }
      }
    );
  });
});

// Reports (simple analytics + low attendance)
router.get("/faculty/reports", requireLogin, requireFaculty, (req, res) => {
  // subject-wise summary for all subjects
  db.all(
    `SELECT s.id, s.code, s.name,
      (SELECT COUNT(*) FROM lectures l WHERE l.subject_id=s.id) AS total_lectures
     FROM subjects s
     ORDER BY s.code`,
    (e1, subjects) => {
      db.all(
        `SELECT u.id, u.name
         FROM users u WHERE u.role='student' ORDER BY u.name`,
        (e2, students) => {
          // compute percent per student per subject (simple)
          const threshold = 75;

          // We'll compute in JS by pulling attendance joins
          db.all(
            `SELECT s.id AS subject_id, u.id AS student_id, a.status
             FROM attendance a
             JOIN lectures l ON l.id=a.lecture_id
             JOIN subjects s ON s.id=l.subject_id
             JOIN users u ON u.id=a.student_id`,
            (e3, rows) => {
              const bySS = new Map(); // key: subjectId-studentId -> {p,l,a}
              for (const r of rows || []) {
                const key = `${r.subject_id}-${r.student_id}`;
                if (!bySS.has(key)) bySS.set(key, { P: 0, L: 0, A: 0 });
                bySS.get(key)[r.status] += 1;
              }

              const report = [];
              for (const sub of subjects || []) {
                for (const stu of students || []) {
                  const key = `${sub.id}-${stu.id}`;
                  const counts = bySS.get(key) || { P: 0, L: 0, A: 0 };
                  const attended = counts.P + counts.L; // treat L as attended (simple)
                  const total = counts.P + counts.L + counts.A;
                  const pct = total === 0 ? 0 : Math.round((attended / total) * 100);
                  report.push({
                    subject: `${sub.code}`,
                    student: stu.name,
                    P: counts.P,
                    L: counts.L,
                    A: counts.A,
                    pct,
                    low: pct > 0 && pct < threshold
                  });
                }
              }

              res.render("faculty_reports", { report, threshold });
            }
          );
        }
      );
    }
  );
});

module.exports = router;
