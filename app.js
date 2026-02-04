const express = require("express");
const session = require("express-session");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");

require("./db"); // initialize DB

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const facultyRoutes = require("./routes/faculty");
const studentRoutes = require("./routes/student");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(
  session({
    secret: "attendance_secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use("/", authRoutes);
app.use("/", adminRoutes);
app.use("/", facultyRoutes);
app.use("/", studentRoutes);

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const role = req.session.user.role;
  if (role === "admin") return res.redirect("/admin/users");
  if (role === "faculty") return res.redirect("/faculty/lectures");
  return res.redirect("/student/dashboard");
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
