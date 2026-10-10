#!/usr/bin/env node
// Adapter runtime "custom" Claw3D -> Claude Code CLI (`claude -p`).
// Claw3D memanggil: GET /health, GET /state, GET /registry, POST /v1/chat/completions.
// Tiap agen di kantor Claw3D = satu peran di AGENTS; jawabannya dibuat oleh Claude Code
// yang sudah login di mesin ini (pakai akun Claude kamu sendiri, bukan API key).
//
// Jalankan:  node server.mjs            (default 127.0.0.1:7770)
// Env:       PORT, HOST, CLAUDE_BIN, CLAUDE_TIMEOUT_MS, MAX_CONCURRENT, WORKDIR

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = Number(process.env.PORT || 7770);
const HOST = process.env.HOST || "127.0.0.1"; // jangan buka ke internet
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 180000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const WORKDIR = process.env.WORKDIR || join(tmpdir(), "claw3d-claude-sandbox");
mkdirSync(WORKDIR, { recursive: true });

// Agen kantor kreatif Jago Game. Kunci = id agen di Claw3D (namanya jadi Title Case).
const AGENTS = {
  juna: "Kamu Juna, Creative Director tim kreatif Jago Game (jasa top up game & cek skin akun Mobile Legends, jagogame.store). Tugasmu menentukan insight, ide besar, dan tone kampanye.",
  jejak: "Kamu Jejak, Ahli Referensi. Kamu mengusulkan format dan tren konten yang cocok, tanpa menyebut kreator atau akun tertentu.",
  kata: "Kamu Kata, Copywriter. Kamu menulis hook, naskah VO, tagline, dan caption. Jangan pakai klaim yang tidak bisa dibuktikan (termurah, 100% aman, angka atau testimoni palsu).",
  rupa: "Kamu Rupa, Art Director. Kamu menentukan palet warna (hex), font, mood, dan gaya editing.",
  garis: "Kamu Garis, Storyboard Artist. Kamu membuat shot list per detik: visual, teks layar, audio.",
  huruf: "Kamu Huruf, Desainer Grafis. Kamu merancang teks cover, end card, dan posisi teks yang aman dari UI TikTok.",
  tenggat: "Kamu Tenggat, Produser. Kamu menyusun kebutuhan produksi, urutan kerja, perkiraan waktu, dan keputusan yang masih harus diambil.",
  coret: "Kamu Coret, Intern Notulen. Kamu meringkas keputusan tim dan langkah berikutnya.",
};
const BASE_RULES =
  "Jawab dalam bahasa Indonesia yang santai tapi jelas, langsung ke isi. Kamu hanya menulis teks; jangan menjalankan perintah, membaca, atau mengubah file.";
const MODEL_ID = "claude-code";

let running = 0;
const queue = [];
const acquire = () =>
  new Promise((res) => (running < MAX_CONCURRENT ? (running++, res()) : queue.push(res)));
const release = () => {
  const next = queue.shift();
  if (next) next();
  else running--;
};

function runClaude(systemPrompt, transcript) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "text",
      "--append-system-prompt", systemPrompt,
      // abaikan konektor MCP dari konfigurasi user (bikin balasan agen nyasar)
      "--strict-mcp-config",
      // hanya teks: matikan semua tool yang bisa menyentuh mesin
      "--disallowedTools", "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep,Task",
    ];
    const child = spawn(CLAUDE_BIN, args, { cwd: WORKDIR, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Claude Code tidak menjawab dalam ${TIMEOUT_MS / 1000} detik.`)); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Gagal menjalankan '${CLAUDE_BIN}': ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error((err || out || `claude keluar dengan kode ${code}`).trim().slice(0, 800)));
    });
    child.stdin.end(transcript);
  });
}

function transcriptFrom(messages) {
  const turns = (Array.isArray(messages) ? messages : []).slice(-12);
  const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text ?? "").join("") : "");
  if (turns.length === 1) return text(turns[0].content);
  return (
    "Percakapan sejauh ini:\n\n" +
    turns.map((m) => `${m.role === "assistant" ? "KAMU" : "USER"}: ${text(m.content)}`).join("\n\n") +
    "\n\nBalas pesan USER yang terakhir."
  );
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, status: "ok", busy: running, queued: queue.length });
    if (req.method === "GET" && url.pathname === "/state")
      return send(res, 200, {
        profileName: "jagogame-creative",
        runtime: { name: "Claude Code", vendor: "Anthropic", status: "ok", active_model: MODEL_ID },
        active: Object.fromEntries(Object.keys(AGENTS).map((id) => [id, MODEL_ID])),
      });
    if (req.method === "GET" && url.pathname === "/registry") return send(res, 200, { models: { [MODEL_ID]: { label: "Claude Code (akun kamu)" } } });
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 512 * 1024) return send(res, 413, { error: "Pesan terlalu panjang." }); }
      const body = JSON.parse(raw || "{}");
      const agentId = String(body.role || body.lane || "juna").toLowerCase();
      const system = `${AGENTS[agentId] || `Kamu anggota tim kreatif Jago Game dengan peran ${agentId}.`} ${BASE_RULES}`;
      await acquire();
      let reply;
      try { reply = await runClaude(system, transcriptFrom(body.messages)); } finally { release(); }
      return send(res, 200, {
        id: "chatcmpl-" + Date.now(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: MODEL_ID,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }],
      });
    }
    send(res, 404, { error: "Tidak ada endpoint ini." });
  } catch (e) {
    send(res, 502, { error: e.message || String(e) });
  }
});

server.listen(PORT, HOST, () => console.log(`Adapter Claw3D -> Claude Code jalan di http://${HOST}:${PORT} (${Object.keys(AGENTS).length} agen)`));
