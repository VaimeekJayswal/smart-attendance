const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const db = new sqlite3.Database("./attendance.db");

db.serialize(async () => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','faculty','student'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    UNIQUE(student_id, subject_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    faculty_id INTEGER NOT NULL,
    lecture_date TEXT NOT NULL,    -- YYYY-MM-DD
    start_time TEXT NOT NULL,      -- HH:MM (24h)
    window_mins INTEGER NOT NULL DEFAULT 10,
    late_after_mins INTEGER NOT NULL DEFAULT 5
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('P','L','A')),
    marked_at TEXT NOT NULL,
    reason_category TEXT DEFAULT 'None'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS justifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    file_path TEXT,
    submitted_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Pending','Approved','Rejected')) DEFAULT 'Pending',
    faculty_comment TEXT
  )`);

  // Seed defaults ONLY if no users
  db.get("SELECT COUNT(*) AS c FROM users", async (err, row) => {
    if (err) return;

    if (row.c === 0) {
      const adminHash = await bcrypt.hash("admin123", 10);
      const facHash = await bcrypt.hash("fac123", 10);
      const stuHash = await bcrypt.hash("stu123", 10);

      db.run(
        "INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)",
        ["Admin", "admin@demo.com", adminHash, "admin"]
      );
      db.run(
        "INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)",
        ["Faculty One", "faculty@demo.com", facHash, "faculty"]
      );
      db.run(
        "INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)",
        ["Student One", "student@demo.com", stuHash, "student"]
      );

      db.run("INSERT INTO subjects(code,name) VALUES(?,?)", ["AWT101", "Advanced Web Technology"]);

      // enroll student into AWT101
      db.get("SELECT id AS sid FROM users WHERE email='student@demo.com'", (e1, s) => {
        db.get("SELECT id AS subid FROM subjects WHERE code='AWT101'", (e2, sub) => {
          if (s && sub) db.run("INSERT INTO enrollments(student_id,subject_id) VALUES (?,?)", [s.sid, sub.subid]);
        });
      });
    }
  });
});

module.exports = db;
