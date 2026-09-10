import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";

test("alur utama PKL berjalan tanpa fitur lokasi", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "simon-pkl-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const app = await createApp({
    dataDir: path.join(temporaryRoot, "data"),
    uploadDir: path.join(temporaryRoot, "uploads"),
    sessionSecret: randomUUID() + randomUUID(),
  });
  const agent = request.agent(app);
  const adminPassword = `Aa9-${randomUUID()}`;
  const teacherPassword = `Bb8-${randomUUID()}`;
  const supervisorPassword = `Cc7-${randomUUID()}`;
  const studentPassword = `Dd6-${randomUUID()}`;

  let response = await agent.get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/setup");

  response = await agent.get("/setup");
  assert.equal(response.status, 200);
  assert.match(response.text, /Development by Nanang A\.S/);
  assert.doesNotMatch(response.text, /GPS|koordinat|ambil lokasi/i);

  response = await agent
    .post("/setup")
    .type("form")
    .send({
      name: "Administrator Uji",
      username: "admin.uji",
      password: adminPassword,
      confirmPassword: adminPassword,
    });
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^\/admin\?success=/);

  response = await agent.get("/admin");
  assert.equal(response.status, 200);
  assert.match(response.text, /Pengaturan PKL/);
  assert.match(response.text, /Development by Nanang A\.S/);

  const store = app.locals.store;
  const departmentId = store.data.departments[0].id;

  for (const account of [
    {
      name: "Guru Uji",
      username: "guru.uji",
      password: teacherPassword,
      role: "GURU",
      departmentId,
    },
    {
      name: "Pembimbing Lapangan Uji",
      username: "pembimbing.uji",
      password: supervisorPassword,
      role: "PEMBIMBING_LAPANGAN",
      departmentId: "",
    },
    {
      name: "Siswa Uji",
      username: "siswa.uji",
      password: studentPassword,
      role: "SISWA",
      departmentId,
      nis: "12345",
      className: "XI AT",
    },
  ]) {
    response = await agent.post("/admin/users").type("form").send(account);
    assert.equal(response.status, 302);
  }

  response = await agent
    .post("/admin/partners")
    .type("form")
    .send({
      name: "DUDI Uji",
      address: "Ketapang",
      contactName: "Kontak Uji",
    });
  assert.equal(response.status, 302);

  const teacher = store.data.users.find((item) => item.username === "guru.uji");
  const supervisor = store.data.users.find(
    (item) => item.username === "pembimbing.uji",
  );
  const student = store.data.users.find((item) => item.username === "siswa.uji");
  const partner = store.data.partners.find((item) => item.name === "DUDI Uji");

  response = await agent
    .post("/admin/groups")
    .type("form")
    .send({
      name: "Kelompok Uji",
      academicYear: "2026/2027",
      semester: "Ganjil",
      departmentId,
      partnerId: partner.id,
      teacherId: teacher.id,
      fieldSupervisorId: supervisor.id,
      studentIds: student.id,
      startDate: "2026-07-01",
      endDate: "2026-12-01",
    });
  assert.equal(response.status, 302);

  const group = store.data.groups.find((item) => item.name === "Kelompok Uji");
  assert.ok(group);

  await agent.post("/logout");
  response = await agent
    .post("/login")
    .type("form")
    .send({ username: "siswa.uji", password: studentPassword });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/dashboard");

  response = await agent.get("/journals/new");
  assert.equal(response.status, 200);
  assert.match(response.text, /foto, dokumen, atau video/i);
  assert.doesNotMatch(response.text, /GPS|koordinat|ambil lokasi/i);

  response = await agent
    .post("/journals")
    .field("groupId", group.id)
    .field("date", "2026-09-10")
    .field("attendance", "HADIR")
    .field("startTime", "08:00")
    .field("endTime", "15:00")
    .field("activity", "Menguji alur pencatatan jurnal PKL.")
    .field("learning", "Memahami prosedur kerja harian.")
    .attach("attachments", Buffer.from("bukti-uji"), {
      filename: "bukti-uji.pdf",
      contentType: "application/pdf",
    });
  assert.equal(response.status, 302);

  const journal = store.data.journals[0];
  assert.ok(journal);
  assert.equal(journal.attachments.length, 1);
  assert.equal(Object.hasOwn(journal, "location"), false);

  response = await agent.get(`/journals/${journal.id}`);
  assert.equal(response.status, 200);
  assert.match(response.text, /Menguji alur/);
  assert.match(response.text, /Development by Nanang A\.S/);

  response = await agent.get(`/portfolio/${student.id}.pdf?groupId=${group.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /application\/pdf/);

  await agent.post("/logout");
  response = await agent
    .post("/login")
    .type("form")
    .send({ username: "guru.uji", password: teacherPassword });
  assert.equal(response.status, 302);

  response = await agent
    .post(`/journals/${journal.id}/review`)
    .type("form")
    .send({ status: "approved", comment: "Kegiatan sudah sesuai." });
  assert.equal(response.status, 302);
  assert.equal(store.data.journals[0].status, "approved");

  response = await agent.get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});
