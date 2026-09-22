# kentford-erp-auth

Small, standalone Node/Express backend that owns authentication and user management for
Kentford ERP. It is intentionally separate from the rest of the app: business data (customers,
orders, quotations, etc.) still lives per-browser in IndexedDB via `js/core.js`'s `Store`/`DB`
in the `kentford-erp` frontend — only login/users/sessions/password-reset now go through this
shared backend, so a user registered here can log in from any device/browser.

## Data model

Single JSON file (`data/db.json`, atomic write via temp-file+rename) with two collections:
- `users`: id, name, email (unique), roleId, position/jabatan, deptId, location, approverId,
  approvalLimit, delegateTo, status (active/inactive/suspended), bcrypt `passwordHash`,
  nullable `resetToken`/`resetTokenExpiresAt`, timestamps, soft-delete `deletedAt`.
- `sessions`: token, userId, createdAt, expiresAt (~12h).

`roles.js` is a **manually maintained mirror** of `ROLE_SEED` in `kentford-erp/js/schema.js`.
If you change roles/permissions in the frontend, update `roles.js` here too — there is no
automated sync between the two copies (see the comment at the top of `roles.js`).

## Running locally

```
npm install
cp .env.example .env   # edit as needed
npm start               # listens on 127.0.0.1:$PORT (default 8091)
node seed-bootstrap.js  # creates the first director account if none exist yet
```

## Endpoints

- `POST /api/auth/login` `{email,password}`
- `POST /api/auth/logout` (Bearer token)
- `GET /api/auth/session` (Bearer token)
- `POST /api/auth/forgot-password` `{email}` — always generic response; see "Email" below.
- `POST /api/auth/reset-password` `{token,newPassword}`
- `GET/POST/PUT/DELETE /api/admin/users[...]` — requires a session for a `director` or
  `deputy_director` user (the only two roles with `users:'w'` in the frontend RBAC).

## Email (password reset)

Real email requires `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in `.env`
(see `.env.example` for Gmail-app-password and transactional-relay examples). **No real SMTP
credentials are configured by default.** Until you set them, forgot-password requests are
logged to `pending-resets.log` (one line: timestamp, email, reset link) instead of emailed,
and the service prints a loud warning to stdout (visible via `pm2 logs kentford-auth`).

## Deployment (VPS, already done by the session that built this)

- Service runs under PM2 as `kentford-auth`, listening on `127.0.0.1:8091` only (not exposed
  publicly on its own port).
- Existing nginx site `/etc/nginx/sites-available/kentford-erp` (port 8090, serving the static
  frontend) has a `location /api/ { proxy_pass http://127.0.0.1:8091; ... }` block added so the
  frontend can call same-origin relative `/api/...` paths.
- `.env` lives at `/root/kentford-erp-auth/.env` on the VPS (not committed to git).
- **No TLS yet** — the whole app (including login credentials and session tokens) is served
  over plain HTTP on port 8090. This should be fixed by registering a domain and running
  certbot; not done in this pass per explicit scope constraints.
