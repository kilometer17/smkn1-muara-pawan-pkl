import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export function attachmentType(mime = "") {
  if (mime.startsWith("image/")) return "PHOTO";
  if (mime.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

export function createUploader({ uploadDir, maxFileBytes }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 12);
      callback(null, `${Date.now()}-${randomUUID()}${extension}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: maxFileBytes,
      files: 6,
    },
    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.has(file.mimetype)) {
        return callback(
          new multer.MulterError(
            "LIMIT_UNEXPECTED_FILE",
            "Jenis file tidak didukung.",
          ),
        );
      }
      callback(null, true);
    },
  });
}
