#!/usr/bin/env node
// Kantor 3D pm2: tiap proses pm2 di VPS jadi satu karakter di kantor.
// Tanpa dependensi. Baca status lewat `pm2 jlist`, log lewat file log pm2,
// restart lewat `pm2 restart <nama>` (butuh token).
//
// Jalankan:  OFFICE_TOKEN=rahasia node server.mjs   (default 127.0.0.1:3200)
// Env:       PORT, HOST, PM2_BIN, OFFICE_TOKEN

import http from "node:http";
import { execFile } from "node:child_process";
import { readFile, open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || "127.0.0.1"; // jangan buka ke internet
const PM2 = process.env.PM2_BIN || "pm2";
const TOKEN = process.env.OFFICE_TOKEN || "";
const HERE = dirname(fileURLToPath(import.meta.url));

const run = (args) =>
  new Promise((res, rej) =>
    execFile(PM2, args, { maxBuffer: 20 * 1024 * 1024, timeout: 20000 }, (e, out, err) =>
      e ? rej(new Error((err || e.message).toString().slice(0, 500))) : res(out)));

async function procs() {
  const raw = await run(["jlist"]);
  const list = JSON.parse(raw.slice(raw.indexOf("[")));
  return list.map((p) => ({
    id: p.pm_id,
    name: p.name,
    status: p.pm2_env?.status ?? "unknown",
    cpu: p.monit?.cpu ?? 0,
    memMB: Math.round((p.monit?.memory ?? 0) / 1048576),
    restarts: p.pm2_env?.restart_time ?? 0,
    uptimeSec: p.pm2_env?.pm_uptime && p.pm2_env?.status === "online" ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0,
    outLog: p.pm2_env?.pm_out_log_path,
    errLog: p.pm2_env?.pm_err_log_path,
  }));
}

// baca ~16 KB terakhir file log, ambil N baris terakhir
async function tail(file, lines = 25) {
  if (!file) return "";
  try {
    const { size } = await stat(file);
    const len = Math.min(size, 16384);
    const fh = await open(file, "r");
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    await fh.close();
    return buf.toString("utf8").split("\n").slice(-lines - 1).join("\n").trim();
  } catch { return ""; }
}

function send(res, status, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
      return send(res, 200, await readFile(join(HERE, "public/index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/procs") {
      const list = await procs();
      return send(res, 200, { at: Date.now(), procs: list.map(({ outLog, errLog, ...p }) => p) });
    }
    const m = url.pathname.match(/^\/api\/(logs|restart)\/([\w.@-]+)$/);
    if (m) {
      const [, action, name] = m;
      const p = (await procs()).find((x) => x.name === name);
      if (!p) return send(res, 404, { error: "Proses tidak ditemukan." });
      if (action === "logs" && req.method === "GET")
        return send(res, 200, { name, out: await tail(p.outLog), err: await tail(p.errLog, 15) });
      if (action === "restart" && req.method === "POST") {
        if (!TOKEN || req.headers["x-office-token"] !== TOKEN) return send(res, 401, { error: "Token salah atau OFFICE_TOKEN belum diset di server." });
        await run(["restart", name]);
        return send(res, 200, { ok: true, name });
      }
    }
    send(res, 404, { error: "Tidak ada endpoint ini." });
  } catch (e) {
    send(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, HOST, () => console.log(`Kantor pm2 jalan di http://${HOST}:${PORT}${TOKEN ? "" : " (restart nonaktif: OFFICE_TOKEN kosong)"}`));
