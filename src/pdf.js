import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  attendanceLabels,
  formatDate,
  formatDateTime,
  statusLabels,
} from "./helpers.js";

const navy = "#102A56";
const gold = "#F4C430";
const muted = "#5F6B7A";

function labelValue(doc, label, value) {
  doc
    .font("Helvetica-Bold")
    .fillColor(navy)
    .text(label, { continued: true })
    .font("Helvetica")
    .fillColor("#1F2937")
    .text(`  ${value || "—"}`);
}

function drawShield(doc, x, y, size) {
  doc
    .save()
    .moveTo(x + size * 0.5, y)
    .lineTo(x + size, y + size * 0.18)
    .lineTo(x + size * 0.9, y + size * 0.78)
    .lineTo(x + size * 0.5, y + size)
    .lineTo(x + size * 0.1, y + size * 0.78)
    .lineTo(x, y + size * 0.18)
    .closePath()
    .fill(navy);
  doc
    .fillColor(gold)
    .font("Helvetica-Bold")
    .fontSize(size * 0.19)
    .text("SMK", x, y + size * 0.33, { width: size, align: "center" });
  doc.restore();
}

function addSection(doc, title, value) {
  doc
    .moveDown(0.45)
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(navy)
    .text(title.toUpperCase());
  doc
    .moveDown(0.15)
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#1F2937")
    .text(value || "—", { lineGap: 2 });
}

export function streamPortfolio({
  res,
  settings,
  student,
  group,
  partner,
  teacher,
  fieldSupervisor,
  journals,
  uploadDir,
}) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 55, right: 52, bottom: 58, left: 52 },
    bufferPages: true,
    info: {
      Title: `Portofolio PKL - ${student.name}`,
      Author: settings.schoolName,
      Subject: "Jurnal Harian Praktik Kerja Lapangan",
    },
  });

  const safeStudentName = student.name
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `Portofolio-PKL-${safeStudentName || "Siswa"}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"`,
  );
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#F7FAFF");
  doc.rect(0, 0, 18, doc.page.height).fill(gold);
  drawShield(doc, doc.page.width / 2 - 47, 88, 94);
  doc
    .fillColor(navy)
    .font("Helvetica-Bold")
    .fontSize(23)
    .text("PORTOFOLIO PKL", 60, 220, { width: doc.page.width - 120, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(12)
    .fillColor(muted)
    .text("Jurnal Harian Praktik Kerja Lapangan", { align: "center" });
  doc
    .moveDown(2)
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#111827")
    .text(student.name, { align: "center" });
  doc
    .moveDown(0.5)
    .font("Helvetica")
    .fontSize(11)
    .fillColor(muted)
    .text(
      [student.nis && `NIS ${student.nis}`, student.className]
        .filter(Boolean)
        .join(" • ") || "Siswa PKL",
      { align: "center" },
    );
  doc
    .moveDown(4)
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(navy)
    .text(settings.schoolName, { align: "center" });
  doc
    .moveDown(0.35)
    .font("Helvetica")
    .fontSize(9)
    .fillColor(muted)
    .text(settings.address, { width: doc.page.width - 120, align: "center" });
  doc
    .moveDown(1)
    .fontSize(10)
    .text(`Tahun Pelajaran ${group?.academicYear || settings.academicYear} • Semester ${group?.semester || settings.semester}`, {
      align: "center",
    });

  doc.addPage();
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(navy)
    .text("Identitas Pelaksanaan PKL");
  doc.moveDown(1);
  labelValue(doc, "Nama siswa", student.name);
  labelValue(doc, "NIS", student.nis);
  labelValue(doc, "Kelas", student.className);
  labelValue(doc, "Kelompok", group?.name);
  labelValue(doc, "DUDI", partner?.name);
  labelValue(doc, "Alamat DUDI", partner?.address);
  labelValue(doc, "Guru pembimbing", teacher?.name);
  labelValue(doc, "Pembimbing lapangan", fieldSupervisor?.name);
  labelValue(
    doc,
    "Periode",
    [group?.startDate && formatDate(group.startDate), group?.endDate && formatDate(group.endDate)]
      .filter(Boolean)
      .join(" – "),
  );
  doc
    .moveDown(2)
    .font("Helvetica")
    .fontSize(10)
    .fillColor(muted)
    .text(
      `Portofolio ini memuat ${journals.length} jurnal harian yang tersimpan dalam sistem.`,
    );

  for (const [index, journal] of journals.entries()) {
    doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor(navy)
      .text(`Jurnal ${String(index + 1).padStart(2, "0")}`);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(muted)
      .text(
        `${formatDate(journal.date)} • ${attendanceLabels[journal.attendance] || journal.attendance} • ${statusLabels[journal.status] || journal.status}`,
      );

    addSection(doc, "Kegiatan yang dikerjakan", journal.activity);
    addSection(doc, "Hasil/pelajaran yang diperoleh", journal.learning);
    addSection(doc, "Kendala", journal.obstacle || "Tidak ada kendala.");
    addSection(doc, "Catatan siswa", journal.notes || "—");

    if (journal.review) {
      addSection(
        doc,
        "Verifikasi pembimbing",
        `${journal.review.comment || "Tanpa catatan"}\nDiverifikasi ${formatDateTime(journal.review.reviewedAt)}`,
      );
    }

    const images = (journal.attachments || []).filter(
      (item) => item.type === "PHOTO" && /image\/(jpeg|png)/.test(item.mime),
    );

    if (images.length) {
      doc.moveDown(0.8).font("Helvetica-Bold").fontSize(10).fillColor(navy).text("DOKUMENTASI");
      let x = doc.page.margins.left;
      const y = doc.y + 8;
      const imageWidth = 145;
      for (const item of images.slice(0, 3)) {
        const filePath = path.join(uploadDir, item.storedName);
        if (!fs.existsSync(filePath)) continue;
        try {
          doc.image(filePath, x, y, { fit: [imageWidth, 120], align: "center", valign: "center" });
          x += imageWidth + 12;
        } catch {
          // Berkas tetap tercantum pada daftar lampiran jika pratinjau gagal.
        }
      }
      doc.y = y + 130;
    }

    if (journal.attachments?.length) {
      addSection(
        doc,
        "Lampiran",
        journal.attachments
          .map((item) => `• ${item.originalName} (${item.type.toLowerCase()})`)
          .join("\n"),
      );
    }
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        `${settings.developer}  •  Halaman ${index + 1} dari ${range.count}`,
        52,
        doc.page.height - 36,
        { width: doc.page.width - 104, align: "center", lineBreak: false },
      );
  }

  doc.end();
}
