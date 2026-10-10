# Adapter Claw3D → Claude Code

Server kecil yang membuat [Claw3D](https://github.com/iamlukethedev/Claw3D) bisa memakai **Claude Code yang sudah login di mesin ini** (akun Claude kamu, tanpa API key) sebagai otak agen.

Claw3D punya runtime `custom` yang memanggil 4 endpoint HTTP. Server ini menjawab keempatnya, lalu meneruskan tiap pesan chat ke `claude -p`:

| Endpoint | Isi |
|---|---|
| `GET /health` | status adapter |
| `GET /state` | daftar 8 agen kantor kreatif Jago Game (Juna, Jejak, Kata, Rupa, Garis, Huruf, Tenggat, Coret) |
| `GET /registry` | satu model: `claude-code` |
| `POST /v1/chat/completions` | jalanin `claude -p` dengan peran agen, balas format OpenAI |

Tool Claude Code dimatikan (`--disallowedTools`), jadi agen cuma bisa menulis teks, tidak bisa menjalankan perintah atau menyentuh file.

## Jalankan di VPS

Prasyarat: Node.js 20+ dan Claude Code yang sudah login (`claude` bisa dijalankan dan `claude -p "halo"` membalas).

```bash
# 1. adapter
cd /root/smscode-bot && git pull
pm2 start tools/claw3d-claude-adapter/server.mjs --name claw3d-adapter
curl -s localhost:7770/health

# 2. Claw3D
cd /root && git clone https://github.com/iamlukethedev/Claw3D.git && cd Claw3D
npm install
npm run dev            # lihat README Claw3D untuk port dan opsi lain
```

Di Claw3D, buka pengaturan koneksi, pilih profil **custom**, isi URL `http://localhost:7770`, lalu buka `/office`.

Untuk membuka Claw3D dari HP/laptop tanpa membuka port ke internet:

```bash
ssh -L 3000:localhost:3000 root@IP_VPS
# lalu buka http://localhost:3000 di browser
```

## Pengaturan (env)

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `7770` | port adapter |
| `HOST` | `127.0.0.1` | hanya bisa diakses dari mesin ini |
| `CLAUDE_BIN` | `claude` | path ke Claude Code CLI |
| `CLAUDE_TIMEOUT_MS` | `180000` | batas waktu satu jawaban |
| `MAX_CONCURRENT` | `2` | maksimal `claude -p` yang jalan bersamaan, sisanya antre |

## Catatan

- Tiap pesan agen memakai kuota langganan Claude kamu. Pakai untuk diri sendiri saja; jangan buka adapter ini ke internet atau ke orang lain.
- Claw3D sendiri menyebut adapter Claude Code belum resmi didukung. Adapter ini lewat jalur runtime `custom` yang memang disediakan untuk orkestrator luar.
- Sudah dites dengan `claude` palsu (keempat endpoint jalan). Belum dites dengan Claw3D dan Claude Code asli.
