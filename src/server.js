import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const app = await createApp(config);
const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  console.log("");
  console.log(`SIMON PKL berjalan di http://localhost:${config.port}`);
  console.log(`Jaringan sekolah: http://<IP-KOMPUTER>:${config.port}`);
  console.log("Tekan Ctrl+C untuk menghentikan server.");
  console.log("");
});

function shutdown(signal) {
  console.log(`\nMenerima ${signal}, server dihentikan dengan aman.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
