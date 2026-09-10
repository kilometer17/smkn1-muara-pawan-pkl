export const roleLabels = {
  ADMIN: "Administrator",
  GURU: "Guru Pembimbing",
  PEMBIMBING_LAPANGAN: "Pembimbing Lapangan",
  SISWA: "Siswa",
};

export const statusLabels = {
  submitted: "Menunggu verifikasi",
  approved: "Disetujui",
  revision: "Perlu revisi",
};

export const attendanceLabels = {
  HADIR: "Hadir",
  SAKIT: "Sakit",
  IZIN: "Izin",
  ALPA: "Alpa",
};

export function formatDate(value, options = {}) {
  if (!value) return "—";
  const date =
    value.length === 10 ? new Date(`${value}T12:00:00+07:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: options.dateStyle || "long",
    timeZone: "Asia/Pontianak",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Pontianak",
  }).format(date);
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function bodyText(value, maxLength = 5000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function bodyArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

export function userCanAccessGroup(user, group) {
  if (!user || !group) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "GURU") return group.teacherId === user.id;
  if (user.role === "PEMBIMBING_LAPANGAN") {
    return group.fieldSupervisorId === user.id;
  }
  if (user.role === "SISWA") return group.studentIds.includes(user.id);
  return false;
}

export function userCanAccessJournal(user, journal, store) {
  if (!user || !journal) return false;
  if (user.role === "SISWA") return journal.studentId === user.id;
  return userCanAccessGroup(user, store.groupById(journal.groupId));
}

export function accessibleGroups(user, groups) {
  return groups.filter((group) => userCanAccessGroup(user, group));
}

export function queryMessage(req) {
  return {
    success: bodyText(req.query.success, 240),
    error: bodyText(req.query.error, 240),
  };
}

export function redirectWith(res, targetPath, type, message) {
  const hashIndex = targetPath.indexOf("#");
  const base = hashIndex >= 0 ? targetPath.slice(0, hashIndex) : targetPath;
  const hash = hashIndex >= 0 ? targetPath.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  res.redirect(`${base}${separator}${type}=${encodeURIComponent(message)}${hash}`);
}

export function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function safeFilename(value) {
  return String(value || "file")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
