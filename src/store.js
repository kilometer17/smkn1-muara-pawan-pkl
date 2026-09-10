import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
export const makeId = (prefix) => `${prefix}_${randomUUID()}`;

function seedDatabase() {
  const academicYear = process.env.DEFAULT_ACADEMIC_YEAR || "2026/2027";
  const semester = process.env.DEFAULT_SEMESTER || "Ganjil";
  const createdAt = now();

  return {
    meta: {
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
    },
    settings: {
      applicationName: "SIMON PKL",
      schoolName: "SMK Negeri 1 Muara Pawan",
      address:
        "Jalan Raya Ketapang–Siduk Km. 17, Sei Awan Kiri, Muara Pawan, Ketapang, Kalimantan Barat",
      academicYear,
      semester,
      developer: "Development by Nanang A.S",
    },
    departments: [
      { id: makeId("dept"), code: "AT", name: "Agribisnis Tanaman" },
      {
        id: makeId("dept"),
        code: "ATPH",
        name: "Agribisnis Tanaman Pangan dan Hortikultura",
      },
      { id: makeId("dept"), code: "AK", name: "Akuntansi" },
      { id: makeId("dept"), code: "ATU", name: "Agribisnis Ternak Unggas" },
    ],
    users: [],
    partners: [],
    groups: [],
    journals: [],
  };
}

export class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "database.json");
    this.data = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });

    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = seedDatabase();
      await this.#writeAtomic();
    }

    return this;
  }

  async #writeAtomic() {
    this.data.meta.updatedAt = now();
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.data, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }

  mutate(mutator) {
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        const result = await mutator(this.data);
        await this.#writeAtomic();
        return result;
      });

    this.queue = operation.catch(() => undefined);
    return operation;
  }

  userById(id) {
    return this.data.users.find((item) => item.id === id);
  }

  groupById(id) {
    return this.data.groups.find((item) => item.id === id);
  }

  journalById(id) {
    return this.data.journals.find((item) => item.id === id);
  }

  hasAdministrator() {
    return this.data.users.some((item) => item.role === "ADMIN" && item.active);
  }
}
