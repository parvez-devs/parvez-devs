import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "./data";
const PUBLIC_DIR = path.resolve("public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "streams.json");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const sessions = new Map();
const attempts = new Map();
let clickMutationQueue = Promise.resolve();

async function withClickLock(task) {
  const run = clickMutationQueue.then(task);
  clickMutationQueue = run.catch((error) => {
    console.error("click counter mutation failed", error);
  });
  return run;
}

await fsp.mkdir(UPLOAD_DIR, { recursive: true });

const defaults = {
  updatedAt: new Date().toISOString(),
  globalAdUrl: "",
  globalClicks: 0,
  heroMediaUrl: "",
  streams: []
};

function validUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function readDB() {
  try {
    const d = JSON.parse(await fsp.readFile(DB_FILE, "utf8"));
    if (!Array.isArray(d.streams)) d.streams = [];
    if (!("globalAdUrl" in d)) {
      d.globalAdUrl = d.streams.find((x) => x.enabled && validUrl(x.adUrl))?.adUrl || "";
    }
    if (!("globalClicks" in d)) d.globalClicks = 0;
    if (!("heroMediaUrl" in d)) d.heroMediaUrl = "";
    return d;
  } catch {
    await writeDB(defaults);
    return structuredClone(defaults);
  }
}

async function writeDB(data) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, DB_FILE);
}

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  const base = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...headers
  };
  res.writeHead(status, base);
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function json(res, status, value) {
  send(res, status, value);
}

function redirect(res, url) {
  res.writeHead(302, {
    Location: url,
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end();
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const result = {};
  for (const part of raw.split(";")) {
    const item = part.trim();
    if (!item) continue;
    const i = item.indexOf("=");
    if (i < 1) continue;
    result[decodeURIComponent(item.slice(0, i))] = decodeURIComponent(item.slice(i + 1));
  }
  return result;
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function hasAdminSession(req) {
  const raw = parseCookies(req).sa;
  if (!raw) return false;
  const [id, sig] = raw.split(".");
  if (!id || !sig || sign(id) !== sig) return false;
  const expiresAt = sessions.get(id);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function createSession(res) {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, Date.now() + 12 * 60 * 60 * 1000);
  let cookie = "sa=" + id + "." + sign(id) + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200";
  if (process.env.NODE_ENV === "production") cookie += "; Secure";
  res.setHeader("Set-Cookie", cookie);
}

function destroySession(req, res) {
  const raw = parseCookies(req).sa;
  if (raw) sessions.delete(raw.split(".")[0]);
  res.setHeader("Set-Cookie", "sa=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function ip(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isLocked(key) {
  const item = attempts.get(key);
  if (!item) return false;
  if (item.until > Date.now()) return true;
  if (item.until) attempts.delete(key);
  return false;
}

function recordFailure(key) {
  const now = Date.now();
  let item = attempts.get(key) || { count: 0, first: now, until: 0 };
  if (now - item.first > 10 * 60 * 1000) item = { count: 0, first: now, until: 0 };
  item.count += 1;
  if (item.count >= 5) item.until = now + 15 * 60 * 1000;
  attempts.set(key, item);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function readBody(req, max = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}

function parseMultipart(buf, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw new Error("Missing multipart boundary");
  const boundary = Buffer.from("--" + (match[1] || match[2]));
  const parts = [];
  let pos = 0;

  while (true) {
    let start = buf.indexOf(boundary, pos);
    if (start < 0) break;
    start += boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    if (buf.slice(start, start + 2).toString() === "\r\n") start += 2;

    const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd < 0) break;

    const headers = buf.slice(start, headerEnd).toString();
    const end = buf.indexOf(boundary, headerEnd + 4);
    if (end < 0) break;

    const data = buf.slice(headerEnd + 4, end - 2);
    parts.push({
      name: /name="([^"]+)"/i.exec(headers)?.[1] || "",
      filename: /filename="([^"]*)"/i.exec(headers)?.[1] || "",
      type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() || "",
      data
    });
    pos = end;
  }
  return parts;
}

async function serveFile(res, file, type, cache = "no-store") {
  try {
    const stat = await fsp.stat(file);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff"
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

async function route(req, res) {
  const u = new URL(req.url, "http://local");

  if (req.method === "GET" && u.pathname === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && u.pathname === "/") {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && u.pathname === "/admin") {
    return serveFile(res, path.join(PUBLIC_DIR, "admin.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && u.pathname === "/styles.css") {
    return serveFile(res, path.join(PUBLIC_DIR, "styles.css"), "text/css; charset=utf-8", "public, max-age=300");
  }

  if (req.method === "GET" && u.pathname === "/app.js") {
    return serveFile(res, path.join(PUBLIC_DIR, "app.js"), "text/javascript; charset=utf-8", "no-store");
  }

  if (req.method === "GET" && u.pathname === "/admin.js") {
    return serveFile(res, path.join(PUBLIC_DIR, "admin.js"), "text/javascript; charset=utf-8", "no-store");
  }

  if (req.method === "GET" && u.pathname.startsWith("/media/")) {
    const name = path.basename(u.pathname.slice(7));
    const file = path.join(UPLOAD_DIR, name);
    const ext = path.extname(name).toLowerCase();
    const types = {
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png"
    };
    return serveFile(res, file, types[ext] || "application/octet-stream", "public, max-age=604800");
  }

  if (req.method === "GET" && u.pathname === "/api/streams") {
    const d = await readDB();
    const streams = d.streams
      .filter((x) => x.enabled)
      .map(({ clicks, ...x }) => x);
    return json(res, 200, {
      streams,
      heroMediaUrl: validUrl(d.heroMediaUrl) || String(d.heroMediaUrl || "").startsWith("/media/") ? d.heroMediaUrl : "",
      updatedAt: d.updatedAt,
      globalRedirect: validUrl(d.globalAdUrl)
    });
  }

  if (req.method === "GET" && u.pathname === "/go-global") {
    let target = "";
    await withClickLock(async () => {
      const d = await readDB();
      target = d.globalAdUrl;
      if (!validUrl(target)) return;
      d.globalClicks = Number(d.globalClicks || 0) + 1;
      d.updatedAt = new Date().toISOString();
      await writeDB(d);
    });
    if (!validUrl(target)) return redirect(res, "/");
    return redirect(res, target);
  }

  if (req.method === "GET" && u.pathname.startsWith("/go/")) {
    const id = decodeURIComponent(u.pathname.slice(4));
    let target = "";
    await withClickLock(async () => {
      const d = await readDB();
      const stream = d.streams.find((x) => x.id === id && x.enabled);
      if (!stream || !validUrl(stream.adUrl)) return;
      target = stream.adUrl;
      stream.clicks = Number(stream.clicks || 0) + 1;
      d.updatedAt = new Date().toISOString();
      await writeDB(d);
    });
    if (!validUrl(target)) return redirect(res, "/");
    return redirect(res, target);
  }

  if (req.method === "POST" && u.pathname === "/api/admin/login") {
    const key = ip(req);
    if (isLocked(key)) return json(res, 429, { error: "Too many attempts. Try again later." });
    const b = await readJson(req);
    if (safeEqual(b.username, ADMIN_USER) && safeEqual(b.password, ADMIN_PASSWORD)) {
      attempts.delete(key);
      createSession(res);
      return json(res, 200, { ok: true });
    }
    recordFailure(key);
    return json(res, 401, { error: "Invalid username or password" });
  }

  if (req.method === "GET" && u.pathname === "/api/admin/me") {
    return hasAdminSession(req)
      ? json(res, 200, { authenticated: true, username: ADMIN_USER })
      : json(res, 401, { authenticated: false });
  }

  if (req.method === "POST" && u.pathname === "/api/admin/logout") {
    destroySession(req, res);
    return json(res, 200, { ok: true });
  }

  if (u.pathname.startsWith("/api/admin/") && !hasAdminSession(req)) {
    return json(res, 401, { error: "Unauthorized" });
  }

  if (req.method === "GET" && u.pathname === "/api/admin/state") {
    return json(res, 200, await readDB());
  }

  if (req.method === "PUT" && u.pathname === "/api/admin/global") {
    const b = await readJson(req);
    if (!validUrl(b.globalAdUrl)) return json(res, 400, { error: "Invalid global redirect URL" });
    if ("heroMediaUrl" in b && b.heroMediaUrl && !validUrl(b.heroMediaUrl) && !String(b.heroMediaUrl).startsWith("/media/")) {
      return json(res, 400, { error: "Invalid main player media URL" });
    }

    let result;
    await withClickLock(async () => {
      const d = await readDB();
      d.globalAdUrl = b.globalAdUrl;
      if ("heroMediaUrl" in b) d.heroMediaUrl = String(b.heroMediaUrl || "");
      d.globalClicks = Number(d.globalClicks || 0);
      d.updatedAt = new Date().toISOString();
      await writeDB(d);
      result = {
        globalAdUrl: d.globalAdUrl,
        heroMediaUrl: d.heroMediaUrl || "",
        globalClicks: d.globalClicks
      };
    });

    return json(res, 200, result);
  }

  if (req.method === "POST" && u.pathname === "/api/admin/streams") {
    const b = await readJson(req);
    const d = await readDB();
    const stream = {
      id: "s-" + crypto.randomUUID(),
      title: String(b.title || "New Preview").slice(0, 120),
      subtitle: String(b.subtitle || "Sponsored preview").slice(0, 120),
      viewers: String(b.viewers || "Live").slice(0, 30),
      mediaUrl: validUrl(b.mediaUrl) ? b.mediaUrl : "",
      adUrl: validUrl(b.adUrl) ? b.adUrl : (validUrl(d.globalAdUrl) ? d.globalAdUrl : "https://example.com"),
      enabled: b.enabled !== false,
      clicks: 0
    };
    d.streams.push(stream);
    d.updatedAt = new Date().toISOString();
    await writeDB(d);
    return json(res, 201, stream);
  }

  const match = /^\/api\/admin\/streams\/([^/]+)(?:\/(upload))?$/.exec(u.pathname);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const d = await readDB();
    const stream = d.streams.find((x) => x.id === id);
    if (!stream) return json(res, 404, { error: "Stream not found" });

    if (req.method === "PUT" && !match[2]) {
      const b = await readJson(req);
      if ("adUrl" in b && !validUrl(b.adUrl)) return json(res, 400, { error: "Invalid redirect URL" });
      if ("mediaUrl" in b && b.mediaUrl && !validUrl(b.mediaUrl) && !String(b.mediaUrl).startsWith("/media/")) {
        return json(res, 400, { error: "Invalid media URL" });
      }
      for (const key of ["title", "subtitle", "viewers"]) {
        if (key in b) stream[key] = String(b[key]).slice(0, key === "viewers" ? 30 : 120);
      }
      if ("adUrl" in b) stream.adUrl = b.adUrl;
      if ("mediaUrl" in b) stream.mediaUrl = b.mediaUrl || "";
      if ("enabled" in b) stream.enabled = Boolean(b.enabled);
      d.updatedAt = new Date().toISOString();
      await writeDB(d);
      return json(res, 200, stream);
    }

    if (req.method === "DELETE" && !match[2]) {
      d.streams = d.streams.filter((x) => x.id !== id);
      d.updatedAt = new Date().toISOString();
      await writeDB(d);
      if (stream.mediaUrl?.startsWith("/media/")) {
        await fsp.unlink(path.join(UPLOAD_DIR, path.basename(stream.mediaUrl))).catch(() => {});
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && match[2] === "upload") {
      const raw = await readBody(req, 21 * 1024 * 1024);
      const parts = parseMultipart(raw, req.headers["content-type"]);
      const file = parts.find((x) => x.name === "media");
      if (!file) return json(res, 400, { error: "No file uploaded" });

      const ext = {
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
        "image/png": ".png"
      }[file.type];

      if (!ext) return json(res, 400, { error: "Only GIF, WebP, JPG or PNG files are allowed" });
      if (file.data.length > 20 * 1024 * 1024) return json(res, 413, { error: "File too large" });

      const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + ext;
      await fsp.writeFile(path.join(UPLOAD_DIR, name), file.data);

      const old = stream.mediaUrl;
      stream.mediaUrl = "/media/" + name;
      d.updatedAt = new Date().toISOString();
      await writeDB(d);

      if (old?.startsWith("/media/")) {
        await fsp.unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => {});
      }
      return json(res, 200, { mediaUrl: stream.mediaUrl });
    }
  }

  return send(res, 404, "Not found", "text/plain; charset=utf-8");
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "Request failed" });
    else res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Live Preview listening on", PORT, "data", DATA_DIR);
});
