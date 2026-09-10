import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { getConfig } from "./config.js";
import { createAuth, safeNext } from "./auth.js";
import { DataStore, makeId } from "./store.js";
import { attachmentType, createUploader } from "./upload.js";
import { streamPortfolio } from "./pdf.js";
import {
  accessibleGroups,
  attendanceLabels,
  bodyArray,
  bodyText,
  csvCell,
  formatBytes,
  formatDate,
  formatDateTime,
  queryMessage,
  redirectWith,
  roleLabels,
  safeFilename,
  statusLabels,
  userCanAccessGroup,
  userCanAccessJournal,
} from "./helpers.js";

const userRoles = new Set([
  "ADMIN",
  "GURU",
  "PEMBIMBING_LAPANGAN",
  "SISWA",
]);
const attendanceValues = new Set(["HADIR", "SAKIT", "IZIN", "ALPA"]);
const reviewValues = new Set(["approved", "revision"]);

const now = () => new Date().toISOString();

function passwordError(password) {
  if (password.length < 10) return "Kata sandi minimal 10 karakter.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Kata sandi harus memuat huruf besar, huruf kecil, dan angka.";
  }
  return "";
}

function normalizedUsername(value) {
  return bodyText(value, 60).toLowerCase().replace(/\s+/g, "");
}

function validUsername(value) {
  return /^[a-z0-9._-]{3,60}$/.test(value);
}

async function removeUploadedFiles(files = []) {
  await Promise.all(
    files.map((file) => fs.unlink(file.path).catch(() => undefined)),
  );
}

function groupForStudent(store, studentId, preferredGroupId = "") {
  const groups = store.data.groups.filter((group) =>
    group.studentIds.includes(studentId),
  );
  return (
    groups.find((group) => group.id === preferredGroupId) ||
    groups.find(
      (group) =>
        group.active &&
        group.academicYear === store.data.settings.academicYear &&
        group.semester === store.data.settings.semester,
    ) ||
    groups[0]
  );
}

function enrichJournal(store, journal) {
  const group = store.groupById(journal.groupId);
  return {
    ...journal,
    student: store.userById(journal.studentId),
    group,
    partner: store.data.partners.find((item) => item.id === group?.partnerId),
    reviewer: store.userById(journal.review?.reviewerId),
  };
}

function dashboardData(store, user) {
  const groups = accessibleGroups(user, store.data.groups);
  const groupIds = new Set(groups.map((item) => item.id));
  const journals =
    user.role === "SISWA"
      ? store.data.journals.filter((item) => item.studentId === user.id)
      : store.data.journals.filter((item) => groupIds.has(item.groupId));
  const studentIds = new Set(groups.flatMap((item) => item.studentIds));
  const today = new Date().toISOString().slice(0, 10);

  return {
    groups,
    recentJournals: journals
      .toSorted((left, right) => right.date.localeCompare(left.date))
      .slice(0, 6)
      .map((item) => enrichJournal(store, item)),
    stats: {
      groups: groups.length,
      students: user.role === "SISWA" ? 1 : studentIds.size,
      pending: journals.filter((item) => item.status === "submitted").length,
      approved: journals.filter((item) => item.status === "approved").length,
      today: journals.filter((item) => item.date === today).length,
    },
  };
}

function validateGroupReferences(store, payload) {
  const teacher = store.userById(payload.teacherId);
  const supervisor = store.userById(payload.fieldSupervisorId);
  const partner = store.data.partners.find((item) => item.id === payload.partnerId);
  const department = store.data.departments.find(
    (item) => item.id === payload.departmentId,
  );
  const students = payload.studentIds
    .map((id) => store.userById(id))
    .filter(Boolean);

  if (!teacher || teacher.role !== "GURU") return "Guru pembimbing tidak valid.";
  if (!supervisor || supervisor.role !== "PEMBIMBING_LAPANGAN") {
    return "Pembimbing lapangan tidak valid.";
  }
  if (!partner) return "DUDI tidak valid.";
  if (!department) return "Kompetensi keahlian tidak valid.";
  if (!students.length || students.some((item) => item.role !== "SISWA")) {
    return "Pilih sekurang-kurangnya satu siswa.";
  }
  return "";
}

export async function createApp(overrides = {}) {
  const config = getConfig(overrides);
  const store = overrides.store || (await new DataStore(config.dataDir).init());
  const app = express();
  const auth = createAuth({
    store,
    secret: config.sessionSecret,
    secure: config.secureCookies,
  });
  const upload = createUploader(config);
  const loginAttempts = new Map();

  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.set("views", path.join(config.rootDir, "views"));

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "media-src": ["'self'"],
          "style-src": ["'self'"],
          "script-src": ["'self'"],
          "form-action": ["'self'"],
        },
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    express.static(path.join(config.rootDir, "public"), {
      maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    }),
  );
  app.use(auth.middleware);

  app.use((req, res, next) => {
    res.locals.settings = store.data.settings;
    res.locals.currentPath = req.path;
    res.locals.message = queryMessage(req);
    res.locals.roleLabels = roleLabels;
    res.locals.statusLabels = statusLabels;
    res.locals.attendanceLabels = attendanceLabels;
    res.locals.formatDate = formatDate;
    res.locals.formatDateTime = formatDateTime;
    res.locals.formatBytes = formatBytes;
    res.locals.userById = (id) => store.userById(id);
    res.locals.departmentById = (id) =>
      store.data.departments.find((item) => item.id === id);
    res.locals.partnerById = (id) =>
      store.data.partners.find((item) => item.id === id);
    next();
  });

  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (!origin) return next();

    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).render("error", {
          title: "Permintaan ditolak",
          status: 403,
          detail: "Asal permintaan tidak sesuai dengan alamat aplikasi.",
        });
      }
    } catch {
      return res.status(403).render("error", {
        title: "Permintaan ditolak",
        status: 403,
        detail: "Header asal permintaan tidak valid.",
      });
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      application: store.data.settings.applicationName,
      schemaVersion: store.data.meta.schemaVersion,
      time: now(),
    });
  });

  app.get("/", (req, res) => {
    if (!store.hasAdministrator()) return res.redirect("/setup");
    return res.redirect(req.user ? "/dashboard" : "/login");
  });

  app.get("/setup", (req, res) => {
    if (store.hasAdministrator()) return res.redirect("/login");
    res.render("setup", { title: "Siapkan Administrator" });
  });

  app.post("/setup", async (req, res) => {
    if (store.hasAdministrator()) {
      return redirectWith(res, "/login", "error", "Administrator sudah tersedia.");
    }

    const name = bodyText(req.body.name, 120);
    const username = normalizedUsername(req.body.username);
    const password = String(req.body.password || "");
    const confirmation = String(req.body.confirmPassword || "");
    const validation =
      (!name && "Nama administrator wajib diisi.") ||
      (!validUsername(username) &&
        "Nama pengguna minimal 3 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.") ||
      passwordError(password) ||
      (password !== confirmation && "Konfirmasi kata sandi tidak sama.");

    if (validation) {
      return redirectWith(res, "/setup", "error", validation);
    }

    const admin = {
      id: makeId("usr"),
      username,
      passwordHash: await bcrypt.hash(password, 12),
      name,
      role: "ADMIN",
      departmentId: "",
      phone: "",
      active: true,
      createdAt: now(),
    };

    await store.mutate((data) => {
      if (data.users.some((item) => item.role === "ADMIN" && item.active)) {
        throw new Error("Administrator sudah dibuat.");
      }
      data.users.push(admin);
    });

    auth.setLoginCookie(res, admin.id);
    redirectWith(
      res,
      "/admin",
      "success",
      "Administrator berhasil dibuat. Lengkapi data PKL berikutnya.",
    );
  });

  app.get("/login", (req, res) => {
    if (!store.hasAdministrator()) return res.redirect("/setup");
    if (req.user) return res.redirect("/dashboard");
    res.render("login", {
      title: "Masuk",
      next: safeNext(req.query.next),
    });
  });

  app.post("/login", async (req, res) => {
    if (!store.hasAdministrator()) return res.redirect("/setup");

    const key = req.ip || "unknown";
    const state = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60_000 };
    if (Date.now() > state.resetAt) {
      state.count = 0;
      state.resetAt = Date.now() + 15 * 60_000;
    }
    if (state.count >= 10) {
      return redirectWith(
        res,
        "/login",
        "error",
        "Terlalu banyak percobaan. Coba kembali dalam 15 menit.",
      );
    }

    const username = normalizedUsername(req.body.username);
    const user = store.data.users.find((item) => item.username === username);
    const matches =
      user?.active && (await bcrypt.compare(String(req.body.password || ""), user.passwordHash));

    if (!matches) {
      state.count += 1;
      loginAttempts.set(key, state);
      return redirectWith(res, "/login", "error", "Nama pengguna atau kata sandi salah.");
    }

    loginAttempts.delete(key);
    auth.setLoginCookie(res, user.id);
    res.redirect(safeNext(req.body.next));
  });

  app.post("/logout", (_req, res) => {
    auth.clearLoginCookie(res);
    redirectWith(res, "/login", "success", "Anda telah keluar dari aplikasi.");
  });

  app.get("/dashboard", auth.requireAuth, (req, res) => {
    const data = dashboardData(store, req.user);
    const activeGroup =
      req.user.role === "SISWA" ? groupForStudent(store, req.user.id) : null;
    res.render("dashboard", {
      title: "Ringkasan",
      ...data,
      activeGroup,
    });
  });

  app.get("/journals", auth.requireAuth, (req, res) => {
    const groups = accessibleGroups(req.user, store.data.groups);
    const groupIds = new Set(groups.map((item) => item.id));
    let journals =
      req.user.role === "SISWA"
        ? store.data.journals.filter((item) => item.studentId === req.user.id)
        : store.data.journals.filter((item) => groupIds.has(item.groupId));

    const status = bodyText(req.query.status, 30);
    const groupId = bodyText(req.query.groupId, 100);
    const studentId = bodyText(req.query.studentId, 100);
    if (statusLabels[status]) journals = journals.filter((item) => item.status === status);
    if (groupIds.has(groupId)) journals = journals.filter((item) => item.groupId === groupId);
    if (studentId) journals = journals.filter((item) => item.studentId === studentId);

    journals = journals
      .toSorted((left, right) =>
        `${right.date}${right.createdAt}`.localeCompare(`${left.date}${left.createdAt}`),
      )
      .map((item) => enrichJournal(store, item));

    res.render("journals/index", {
      title: "Jurnal Harian",
      journals,
      groups,
      filters: { status, groupId, studentId },
    });
  });

  app.get(
    "/journals/new",
    auth.allowRoles("SISWA"),
    (req, res) => {
      const groups = accessibleGroups(req.user, store.data.groups).filter(
        (group) => group.active,
      );
      res.render("journals/form", {
        title: "Tambah Jurnal",
        journal: null,
        groups,
        formAction: "/journals",
      });
    },
  );

  app.post(
    "/journals",
    auth.allowRoles("SISWA"),
    upload.array("attachments", 6),
    async (req, res) => {
      const groups = accessibleGroups(req.user, store.data.groups).filter(
        (group) => group.active,
      );
      const group = groups.find((item) => item.id === bodyText(req.body.groupId, 100));
      const date = bodyText(req.body.date, 10);
      const attendance = bodyText(req.body.attendance, 20);
      const activity = bodyText(req.body.activity, 5000);
      const learning = bodyText(req.body.learning, 5000);
      const obstacle = bodyText(req.body.obstacle, 3000);
      const notes = bodyText(req.body.notes, 3000);
      const startTime = bodyText(req.body.startTime, 5);
      const endTime = bodyText(req.body.endTime, 5);

      const validation =
        (!group && "Kelompok PKL tidak valid.") ||
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) && "Tanggal jurnal tidak valid.") ||
        (!attendanceValues.has(attendance) && "Status kehadiran tidak valid.") ||
        (activity.length < 5 && "Uraian kegiatan/keterangan minimal 5 karakter.");

      if (validation) {
        await removeUploadedFiles(req.files);
        return redirectWith(res, "/journals/new", "error", validation);
      }

      const duplicate = store.data.journals.some(
        (item) =>
          item.studentId === req.user.id &&
          item.groupId === group.id &&
          item.date === date,
      );
      if (duplicate) {
        await removeUploadedFiles(req.files);
        return redirectWith(
          res,
          "/journals",
          "error",
          "Jurnal pada tanggal tersebut sudah ada. Gunakan menu ubah.",
        );
      }

      const attachments = (req.files || []).map((file) => ({
        id: makeId("att"),
        originalName: path.basename(file.originalname).slice(0, 180),
        storedName: file.filename,
        mime: file.mimetype,
        size: file.size,
        type: attachmentType(file.mimetype),
        createdAt: now(),
      }));

      const journal = {
        id: makeId("journal"),
        studentId: req.user.id,
        groupId: group.id,
        date,
        attendance,
        startTime,
        endTime,
        activity,
        learning,
        obstacle,
        notes,
        attachments,
        status: "submitted",
        review: null,
        createdAt: now(),
        updatedAt: now(),
      };

      await store.mutate((data) => data.journals.push(journal));
      redirectWith(res, `/journals/${journal.id}`, "success", "Jurnal berhasil dikirim.");
    },
  );

  app.get("/journals/:id", auth.requireAuth, (req, res) => {
    const journal = store.journalById(req.params.id);
    if (!journal || !userCanAccessJournal(req.user, journal, store)) {
      return res.status(404).render("error", {
        title: "Jurnal tidak ditemukan",
        status: 404,
        detail: "Data jurnal tidak tersedia atau bukan bagian dari akses Anda.",
      });
    }
    res.render("journals/show", {
      title: "Detail Jurnal",
      journal: enrichJournal(store, journal),
    });
  });

  app.get(
    "/journals/:id/edit",
    auth.allowRoles("SISWA"),
    (req, res) => {
      const journal = store.journalById(req.params.id);
      if (!journal || journal.studentId !== req.user.id) {
        return res.status(404).render("error", {
          title: "Jurnal tidak ditemukan",
          status: 404,
          detail: "Data jurnal tidak tersedia.",
        });
      }
      if (journal.status === "approved") {
        return redirectWith(
          res,
          `/journals/${journal.id}`,
          "error",
          "Jurnal yang sudah disetujui tidak dapat diubah.",
        );
      }
      res.render("journals/form", {
        title: "Ubah Jurnal",
        journal,
        groups: accessibleGroups(req.user, store.data.groups),
        formAction: `/journals/${journal.id}/edit`,
      });
    },
  );

  app.post(
    "/journals/:id/edit",
    auth.allowRoles("SISWA"),
    upload.array("attachments", 6),
    async (req, res) => {
      const journal = store.journalById(req.params.id);
      if (!journal || journal.studentId !== req.user.id) {
        await removeUploadedFiles(req.files);
        return res.status(404).render("error", {
          title: "Jurnal tidak ditemukan",
          status: 404,
          detail: "Data jurnal tidak tersedia.",
        });
      }
      if (journal.status === "approved") {
        await removeUploadedFiles(req.files);
        return redirectWith(
          res,
          `/journals/${journal.id}`,
          "error",
          "Jurnal yang sudah disetujui tidak dapat diubah.",
        );
      }

      const attendance = bodyText(req.body.attendance, 20);
      const activity = bodyText(req.body.activity, 5000);
      if (!attendanceValues.has(attendance) || activity.length < 5) {
        await removeUploadedFiles(req.files);
        return redirectWith(
          res,
          `/journals/${journal.id}/edit`,
          "error",
          "Periksa kembali status kehadiran dan uraian kegiatan.",
        );
      }

      const attachments = (req.files || []).map((file) => ({
        id: makeId("att"),
        originalName: path.basename(file.originalname).slice(0, 180),
        storedName: file.filename,
        mime: file.mimetype,
        size: file.size,
        type: attachmentType(file.mimetype),
        createdAt: now(),
      }));

      await store.mutate((data) => {
        const current = data.journals.find((item) => item.id === journal.id);
        Object.assign(current, {
          attendance,
          startTime: bodyText(req.body.startTime, 5),
          endTime: bodyText(req.body.endTime, 5),
          activity,
          learning: bodyText(req.body.learning, 5000),
          obstacle: bodyText(req.body.obstacle, 3000),
          notes: bodyText(req.body.notes, 3000),
          attachments: [...current.attachments, ...attachments],
          status: "submitted",
          review: null,
          updatedAt: now(),
        });
      });

      redirectWith(
        res,
        `/journals/${journal.id}`,
        "success",
        "Perubahan jurnal berhasil dikirim ulang.",
      );
    },
  );

  app.post(
    "/journals/:id/review",
    auth.allowRoles("ADMIN", "GURU", "PEMBIMBING_LAPANGAN"),
    async (req, res) => {
      const journal = store.journalById(req.params.id);
      if (!journal || !userCanAccessJournal(req.user, journal, store)) {
        return res.status(404).render("error", {
          title: "Jurnal tidak ditemukan",
          status: 404,
          detail: "Data jurnal tidak tersedia atau bukan bagian dari akses Anda.",
        });
      }

      const status = bodyText(req.body.status, 20);
      const comment = bodyText(req.body.comment, 2000);
      if (!reviewValues.has(status)) {
        return redirectWith(res, `/journals/${journal.id}`, "error", "Status verifikasi tidak valid.");
      }
      if (status === "revision" && comment.length < 5) {
        return redirectWith(
          res,
          `/journals/${journal.id}`,
          "error",
          "Tuliskan catatan revisi minimal 5 karakter.",
        );
      }

      await store.mutate((data) => {
        const current = data.journals.find((item) => item.id === journal.id);
        current.status = status;
        current.review = {
          reviewerId: req.user.id,
          comment,
          reviewedAt: now(),
        };
        current.updatedAt = now();
      });
      redirectWith(res, `/journals/${journal.id}`, "success", "Verifikasi jurnal tersimpan.");
    },
  );

  app.get(
    "/files/:journalId/:attachmentId",
    auth.requireAuth,
    (req, res) => {
      const journal = store.journalById(req.params.journalId);
      if (!journal || !userCanAccessJournal(req.user, journal, store)) {
        return res.sendStatus(404);
      }
      const attachment = journal.attachments.find(
        (item) => item.id === req.params.attachmentId,
      );
      if (!attachment) return res.sendStatus(404);

      const disposition =
        attachment.type === "DOCUMENT" &&
        !["application/pdf"].includes(attachment.mime)
          ? "attachment"
          : "inline";
      res.setHeader("Content-Type", attachment.mime);
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${safeFilename(attachment.originalName)}"`,
      );
      res.sendFile(attachment.storedName, { root: config.uploadDir }, (error) => {
        if (error && !res.headersSent) res.sendStatus(404);
      });
    },
  );

  app.get("/portfolio/:studentId.pdf", auth.requireAuth, (req, res) => {
    const student = store.userById(req.params.studentId);
    if (!student || student.role !== "SISWA") {
      return res.status(404).render("error", {
        title: "Siswa tidak ditemukan",
        status: 404,
        detail: "Data siswa tidak tersedia.",
      });
    }

    const group = groupForStudent(store, student.id, bodyText(req.query.groupId, 100));
    if (!group || !userCanAccessGroup(req.user, group)) {
      return res.status(403).render("error", {
        title: "Akses ditolak",
        status: 403,
        detail: "Anda tidak memiliki akses ke portofolio siswa tersebut.",
      });
    }

    const partner = store.data.partners.find((item) => item.id === group.partnerId);
    const journals = store.data.journals
      .filter((item) => item.studentId === student.id && item.groupId === group.id)
      .toSorted((left, right) => left.date.localeCompare(right.date));

    streamPortfolio({
      res,
      settings: store.data.settings,
      student,
      group,
      partner,
      teacher: store.userById(group.teacherId),
      fieldSupervisor: store.userById(group.fieldSupervisorId),
      journals,
      uploadDir: config.uploadDir,
    });
  });

  app.get("/exports/journals.csv", auth.requireAuth, (req, res) => {
    const groups = accessibleGroups(req.user, store.data.groups);
    const groupIds = new Set(groups.map((item) => item.id));
    const journals =
      req.user.role === "SISWA"
        ? store.data.journals.filter((item) => item.studentId === req.user.id)
        : store.data.journals.filter((item) => groupIds.has(item.groupId));

    const header = [
      "Tanggal",
      "Siswa",
      "Kelompok",
      "Kehadiran",
      "Kegiatan",
      "Hasil Belajar",
      "Kendala",
      "Status",
    ];
    const rows = journals.map((journal) => {
      const group = store.groupById(journal.groupId);
      return [
        journal.date,
        store.userById(journal.studentId)?.name,
        group?.name,
        attendanceLabels[journal.attendance],
        journal.activity,
        journal.learning,
        journal.obstacle,
        statusLabels[journal.status],
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="rekap-jurnal-pkl.csv"',
    );
    res.send(`\uFEFF${csv}`);
  });

  app.get("/account", auth.requireAuth, (req, res) => {
    res.render("account", { title: "Akun Saya" });
  });

  app.post("/account/password", auth.requireAuth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmation = String(req.body.confirmPassword || "");
    if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      return redirectWith(res, "/account", "error", "Kata sandi lama tidak sesuai.");
    }
    const validation =
      passwordError(newPassword) ||
      (newPassword !== confirmation && "Konfirmasi kata sandi baru tidak sama.");
    if (validation) return redirectWith(res, "/account", "error", validation);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await store.mutate((data) => {
      data.users.find((item) => item.id === req.user.id).passwordHash = passwordHash;
    });
    auth.clearLoginCookie(res);
    redirectWith(res, "/login", "success", "Kata sandi diubah. Silakan masuk kembali.");
  });

  app.get("/admin", auth.allowRoles("ADMIN"), (req, res) => {
    res.render("admin", {
      title: "Pengaturan PKL",
      departments: store.data.departments,
      users: store.data.users.toSorted((a, b) => a.name.localeCompare(b.name)),
      teachers: store.data.users.filter((item) => item.role === "GURU" && item.active),
      supervisors: store.data.users.filter(
        (item) => item.role === "PEMBIMBING_LAPANGAN" && item.active,
      ),
      students: store.data.users.filter((item) => item.role === "SISWA" && item.active),
      partners: store.data.partners,
      groups: store.data.groups,
    });
  });

  app.post("/admin/settings", auth.allowRoles("ADMIN"), async (req, res) => {
    const applicationName = bodyText(req.body.applicationName, 80);
    const schoolName = bodyText(req.body.schoolName, 150);
    const address = bodyText(req.body.address, 300);
    const academicYear = bodyText(req.body.academicYear, 20);
    const semester = bodyText(req.body.semester, 20);
    if (
      !applicationName ||
      !schoolName ||
      !/^\d{4}\/\d{4}$/.test(academicYear) ||
      !["Ganjil", "Genap"].includes(semester)
    ) {
      return redirectWith(res, "/admin#settings", "error", "Periksa kembali pengaturan periode dan sekolah.");
    }

    await store.mutate((data) => {
      Object.assign(data.settings, {
        applicationName,
        schoolName,
        address,
        academicYear,
        semester,
        developer: "Development by Nanang A.S",
      });
    });
    redirectWith(res, "/admin#settings", "success", "Pengaturan aplikasi diperbarui.");
  });

  app.post("/admin/users", auth.allowRoles("ADMIN"), async (req, res) => {
    const username = normalizedUsername(req.body.username);
    const password = String(req.body.password || "");
    const name = bodyText(req.body.name, 120);
    const role = bodyText(req.body.role, 40);
    const validation =
      (!name && "Nama pengguna wajib diisi.") ||
      (!validUsername(username) && "Format nama pengguna tidak valid.") ||
      (!userRoles.has(role) && "Peran akun tidak valid.") ||
      passwordError(password) ||
      (store.data.users.some((item) => item.username === username) &&
        "Nama pengguna sudah dipakai.");

    if (validation) return redirectWith(res, "/admin#users", "error", validation);

    const user = {
      id: makeId("usr"),
      username,
      passwordHash: await bcrypt.hash(password, 12),
      name,
      role,
      departmentId: bodyText(req.body.departmentId, 100),
      nis: role === "SISWA" ? bodyText(req.body.nis, 40) : "",
      className: role === "SISWA" ? bodyText(req.body.className, 50) : "",
      phone: bodyText(req.body.phone, 40),
      active: true,
      createdAt: now(),
    };
    await store.mutate((data) => data.users.push(user));
    redirectWith(res, "/admin#users", "success", "Akun berhasil ditambahkan.");
  });

  app.post("/admin/users/:id", auth.allowRoles("ADMIN"), async (req, res) => {
    const user = store.userById(req.params.id);
    if (!user) return redirectWith(res, "/admin#users", "error", "Akun tidak ditemukan.");

    const name = bodyText(req.body.name, 120);
    const username = normalizedUsername(req.body.username);
    const role = bodyText(req.body.role, 40);
    const active = req.body.active === "on";
    if (
      !name ||
      !validUsername(username) ||
      !userRoles.has(role) ||
      store.data.users.some(
        (item) => item.id !== user.id && item.username === username,
      )
    ) {
      return redirectWith(res, "/admin#users", "error", "Data akun tidak valid atau nama pengguna sudah dipakai.");
    }
    if (
      user.role === "ADMIN" &&
      (!active || role !== "ADMIN") &&
      store.data.users.filter((item) => item.role === "ADMIN" && item.active).length <= 1
    ) {
      return redirectWith(res, "/admin#users", "error", "Administrator aktif terakhir tidak dapat dinonaktifkan.");
    }

    const newPassword = String(req.body.password || "");
    const passwordValidation = newPassword ? passwordError(newPassword) : "";
    if (passwordValidation) {
      return redirectWith(res, "/admin#users", "error", passwordValidation);
    }
    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : null;

    await store.mutate((data) => {
      const current = data.users.find((item) => item.id === user.id);
      Object.assign(current, {
        name,
        username,
        role,
        active,
        departmentId: bodyText(req.body.departmentId, 100),
        nis: role === "SISWA" ? bodyText(req.body.nis, 40) : "",
        className: role === "SISWA" ? bodyText(req.body.className, 50) : "",
        phone: bodyText(req.body.phone, 40),
        ...(passwordHash ? { passwordHash } : {}),
      });
    });
    redirectWith(res, "/admin#users", "success", "Akun berhasil diperbarui.");
  });

  app.post("/admin/partners", auth.allowRoles("ADMIN"), async (req, res) => {
    const name = bodyText(req.body.name, 150);
    if (!name) return redirectWith(res, "/admin#partners", "error", "Nama DUDI wajib diisi.");

    await store.mutate((data) =>
      data.partners.push({
        id: makeId("partner"),
        name,
        address: bodyText(req.body.address, 300),
        phone: bodyText(req.body.phone, 40),
        contactName: bodyText(req.body.contactName, 120),
        active: true,
        createdAt: now(),
      }),
    );
    redirectWith(res, "/admin#partners", "success", "Data DUDI berhasil ditambahkan.");
  });

  app.post("/admin/partners/:id", auth.allowRoles("ADMIN"), async (req, res) => {
    const partner = store.data.partners.find((item) => item.id === req.params.id);
    if (!partner) return redirectWith(res, "/admin#partners", "error", "DUDI tidak ditemukan.");
    const name = bodyText(req.body.name, 150);
    if (!name) return redirectWith(res, "/admin#partners", "error", "Nama DUDI wajib diisi.");

    await store.mutate((data) => {
      Object.assign(
        data.partners.find((item) => item.id === partner.id),
        {
          name,
          address: bodyText(req.body.address, 300),
          phone: bodyText(req.body.phone, 40),
          contactName: bodyText(req.body.contactName, 120),
          active: req.body.active === "on",
        },
      );
    });
    redirectWith(res, "/admin#partners", "success", "Data DUDI diperbarui.");
  });

  app.post("/admin/groups", auth.allowRoles("ADMIN"), async (req, res) => {
    const payload = {
      name: bodyText(req.body.name, 150),
      academicYear: bodyText(req.body.academicYear, 20),
      semester: bodyText(req.body.semester, 20),
      departmentId: bodyText(req.body.departmentId, 100),
      partnerId: bodyText(req.body.partnerId, 100),
      teacherId: bodyText(req.body.teacherId, 100),
      fieldSupervisorId: bodyText(req.body.fieldSupervisorId, 100),
      studentIds: bodyArray(req.body.studentIds),
      startDate: bodyText(req.body.startDate, 10),
      endDate: bodyText(req.body.endDate, 10),
    };
    const validation =
      (!payload.name && "Nama kelompok wajib diisi.") ||
      (!/^\d{4}\/\d{4}$/.test(payload.academicYear) && "Tahun pelajaran tidak valid.") ||
      (!["Ganjil", "Genap"].includes(payload.semester) && "Semester tidak valid.") ||
      validateGroupReferences(store, payload);
    if (validation) return redirectWith(res, "/admin#groups", "error", validation);

    const clash = store.data.groups.some(
      (group) =>
        group.active &&
        group.academicYear === payload.academicYear &&
        group.semester === payload.semester &&
        group.studentIds.some((id) => payload.studentIds.includes(id)),
    );
    if (clash) {
      return redirectWith(
        res,
        "/admin#groups",
        "error",
        "Ada siswa yang sudah masuk kelompok aktif pada periode yang sama.",
      );
    }

    await store.mutate((data) =>
      data.groups.push({
        id: makeId("group"),
        ...payload,
        active: true,
        createdAt: now(),
      }),
    );
    redirectWith(res, "/admin#groups", "success", "Kelompok PKL berhasil dibuat.");
  });

  app.post("/admin/groups/:id", auth.allowRoles("ADMIN"), async (req, res) => {
    const group = store.groupById(req.params.id);
    if (!group) return redirectWith(res, "/admin#groups", "error", "Kelompok tidak ditemukan.");
    const payload = {
      name: bodyText(req.body.name, 150),
      academicYear: bodyText(req.body.academicYear, 20),
      semester: bodyText(req.body.semester, 20),
      departmentId: bodyText(req.body.departmentId, 100),
      partnerId: bodyText(req.body.partnerId, 100),
      teacherId: bodyText(req.body.teacherId, 100),
      fieldSupervisorId: bodyText(req.body.fieldSupervisorId, 100),
      studentIds: bodyArray(req.body.studentIds),
      startDate: bodyText(req.body.startDate, 10),
      endDate: bodyText(req.body.endDate, 10),
    };
    const validation =
      (!payload.name && "Nama kelompok wajib diisi.") ||
      validateGroupReferences(store, payload);
    if (validation) return redirectWith(res, "/admin#groups", "error", validation);

    await store.mutate((data) => {
      Object.assign(
        data.groups.find((item) => item.id === group.id),
        payload,
        { active: req.body.active === "on" },
      );
    });
    redirectWith(res, "/admin#groups", "success", "Kelompok PKL diperbarui.");
  });

  app.use((req, res) => {
    res.status(404).render("error", {
      title: "Halaman tidak ditemukan",
      status: 404,
      detail: `Alamat ${req.path} tidak tersedia.`,
    });
  });

  app.use(async (error, req, res, _next) => {
    await removeUploadedFiles(req.files || []);
    console.error(error);

    if (error instanceof multer.MulterError) {
      const detail =
        error.code === "LIMIT_FILE_SIZE"
          ? `Ukuran satu file melebihi batas ${Math.round(config.maxFileBytes / 1024 / 1024)} MB.`
          : "Unggahan gagal. Maksimal 6 file dan gunakan format yang didukung.";
      return res.status(400).render("error", {
        title: "Unggahan gagal",
        status: 400,
        detail,
      });
    }

    res.status(500).render("error", {
      title: "Terjadi kesalahan",
      status: 500,
      detail:
        process.env.NODE_ENV === "production"
          ? "Aplikasi tidak dapat memproses permintaan ini."
          : error.message,
    });
  });

  app.locals.store = store;
  app.locals.config = config;
  return app;
}
