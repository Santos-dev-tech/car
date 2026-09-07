# Deploying MotoKE

Read this before running anything. There is one decision to make and it is not obvious.

---

## Why Cloudflare needs a container, not a Worker

MotoKE is a Node server. It uses `node:sqlite`, which is **synchronous** — 236 database
calls across the codebase are written as `get(...)`, `all(...)`, `run(...)` with no `await`.

Cloudflare Workers cannot run that. Its database, D1, is **asynchronous**. Porting means
rewriting all 236 call sites *and* making every function that contains them async, which
cascades up through every route handler in `lib/api.js`. It is days of work and it would
put all 596 tests at risk.

**Cloudflare Containers runs the app unchanged.** A small Worker (`worker.js`) sits in
front and forwards every request to a container running exactly what runs on your laptop.
No port, no rewrite, no risk to the tests.

That is what the files here set up.

---

## Before you start — three things to know

### 1. It needs the Workers **Paid** plan — $5/month

Containers are not on the free tier. The $5 plan includes a monthly container allowance,
and containers **scale to zero**, so an idle demo costs nothing beyond the $5.

### 2. It needs **Docker Desktop**, which is not installed

Cloudflare builds the image locally and pushes it. Install from
<https://www.docker.com/products/docker-desktop/> (~500 MB), start it, and confirm with:

```bash
docker --version
```

### 3. **The database does not survive a restart**

This is the important one.

The SQLite file lives on the container's own disk. Containers sleep when idle and the disk
goes with them. On the next request the container starts fresh and **re-seeds**.

| | |
|---|---|
| **Fine for** | Demos. Every dealer visit starts with clean, complete demo data. |
| **Not fine for** | Real customers. An application submitted on Monday is gone by Tuesday. |

Do not put a real dealership on this without fixing it first. The fix is to move the
database off the container disk — either D1 (which means the async port above) or a
managed Postgres/Turso instance behind a small adapter in `lib/db.js`. Roughly a day's
work, and it is the one thing standing between this and production.

---

## Deploy

```bash
cd "C:\Users\ADMIN\New folder (2)\motoke"

# 1. The two build-time packages. These run at the edge, never in the app —
#    the app itself still has zero runtime dependencies, and tools/audit.js
#    enforces that.
npm install --save-dev wrangler @cloudflare/containers

# 2. Sign in. This opens a browser; you authorise it, not me.
npx wrangler login

# 3. Build the image and ship it. First run takes a few minutes.
npx wrangler deploy
```

Wrangler prints the URL when it finishes — `https://motoke.<your-subdomain>.workers.dev`.

### Watch it

```bash
npx wrangler tail
```

---

## Before showing it to a dealership

Two settings, both in the console under **Admin → Dealership** and **Admin → Lenders**:

- **Turn `demo_mode` off.** It echoes the two-factor code to the browser, which is
  convenient for you and a hole for anyone else.
- **Replace the lenders and rates.** Every one in the seed is fictional. Real published
  terms before any commercial conversation.

And set the site dealership's name, branding and branches so it is their yard, not Summit
Motors.

---

## If you would rather not pay $5

The app is a plain Node server with no dependencies, so it runs anywhere Node runs. These
need no Docker, no container config, and no code change at all:

| | Free tier | Note |
|---|---|---|
| **Render** | Yes | Sleeps when idle; disk is also ephemeral unless you add a volume |
| **Railway** | Trial credit | Persistent volumes available |
| **Fly.io** | Yes | Persistent volumes; closest region is Johannesburg |

For any of them: build command none, start command `node --no-warnings server.js`, and it
will pick up `PORT` from the environment on its own.

**Fly.io with a volume is the one I would pick if the database has to survive** — it keeps
the SQLite file on real disk, which is the whole reason this app is fast and simple.

---

## What each file here does

| File | |
|---|---|
| `Dockerfile` | Node 22 slim, non-root, health check. No install step — there is nothing to install. |
| `.dockerignore` | Keeps the database, the encryption key and the generated photographs out of the image. An image is as public as the registry holding it. |
| `wrangler.jsonc` | One container, `basic` instance, capped at 2 replicas |
| `worker.js` | Forwards every request to a **single, named** container instance |

### Why one instance

The database is a file on that container's disk. Two instances would be two different
databases, and a customer would see their application appear and disappear depending on
which one answered. `getContainer(env.MOTOKE, 'motoke-main')` pins every request to the
same one. Do not remove that name.

---

*Set up 2026-09-07.*
