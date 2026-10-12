# Kantor VPS (pm2 office 3D)

Kantor 3D online: tiap proses pm2 di VPS jadi satu karakter di meja. Hijau = online, merah = errored, abu = stopped. Karakter yang CPU-nya tinggi "sibuk" (gerak). Klik karakter atau baris di daftar buat lihat CPU/RAM/uptime, baca log terakhir, dan restart.

Tanpa dependensi (cuma Node.js + pm2 + Three.js dari CDN).

## Jalankan di VPS

```bash
cd /root/smscode-bot && git pull
# token untuk mengizinkan tombol Restart (wajib kalau mau bisa restart)
OFFICE_TOKEN=ganti-dengan-rahasia pm2 start tools/pm2-office/server.mjs --name pm2-office
pm2 save
curl -s localhost:3200/api/procs | head -c 200
```

Default: `127.0.0.1:3200`, hanya bisa diakses dari dalam VPS (tidak dibuka ke internet). Env: `PORT`, `HOST`, `PM2_BIN`, `OFFICE_TOKEN`.

## Buka dari HP / laptop

Jangan buka port 3200 ke internet. Pakai salah satu:

- **SSH tunnel:** `ssh -L 3200:localhost:3200 root@IP_VPS`, lalu buka `http://localhost:3200`.
- **Tailscale:** pasang di VPS + perangkatmu, buka `http://IP_TAILSCALE_VPS:3200`.

Pertama kali menekan Restart, halaman minta `OFFICE_TOKEN` (yang sama dengan di server) dan menyimpannya di browser.

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/procs` | daftar proses + status, cpu, ram, uptime, restarts |
| GET | `/api/logs/<nama>` | ~25 baris terakhir stdout + stderr |
| POST | `/api/restart/<nama>` | restart (butuh header `x-office-token`) |

## Catatan

- Kalau `OFFICE_TOKEN` kosong, tombol Restart dinonaktifkan (view-only). Aman kalau cuma mau memantau.
- Hanya restart; tidak ada stop/delete, biar tidak sengaja mematikan proses.
- Sudah dites dengan pm2 tiruan (4 proses). Jalankan di VPS untuk data asli.
