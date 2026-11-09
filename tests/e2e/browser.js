// Headless Chrome for end-to-end tests of the real pages.
// Separate browser process with a temporary profile; nothing is shared with the user's Chrome.
// Requests to the production API and the service worker are blocked, so tests never touch prod.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME_BIN || "google-chrome";
const BLOCKED = ["*api.workoutudm.ru*", "*/sw.js"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json" };

function serveRepo() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Page {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach(fn => fn(msg));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expression, timeout = 30000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(expression); if (last) return last; } catch (e) { last = e.message; }
      await sleep(100);
    }
    throw new Error(`timeout waiting for: ${expression} (last: ${last})`);
  }
  async goto(url) {
    const loaded = new Promise(resolve => {
      const fn = msg => { if (msg.method === "Page.loadEventFired") { this.listeners = this.listeners.filter(f => f !== fn); resolve(); } };
      this.listeners.push(fn);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }
  // Open a page of the app with localStorage seeded beforehand; waits until React has rendered.
  async open(base, file, storage = {}) {
    await this.goto(base + "/manifest.json");
    await this.eval(`localStorage.clear();${Object.entries(storage).map(([k, v]) =>
      `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(JSON.stringify(v))});`).join("")}true`);
    await this.goto(base + "/" + file);
    await this.waitFor(`document.getElementById("root") && document.getElementById("root").children.length > 0`);
  }
  close() { this.ws.close(); }
}

async function startBrowser() {
  const server = await serveRepo();
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wu-calc-e2e-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
  const exited = new Promise(r => chrome.once("exit", r));
  const portFile = path.join(profile, "DevToolsActivePort");
  let port;
  for (let i = 0; i < 200 && !port; i++) {
    if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    if (!port) await sleep(100);
  }
  if (!port) { chrome.kill(); throw new Error(`Chrome did not start (${CHROME}); set CHROME_BIN`); }
  const pages = [];
  return {
    base,
    async newPage() {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
      const page = new Page(ws);
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Network.enable");
      await page.send("Network.setBlockedURLs", { urls: BLOCKED });
      pages.push(page);
      return page;
    },
    async close() {
      pages.forEach(p => p.close());
      try { // graceful shutdown lets Chrome finish writing the profile
        const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const ws = new WebSocket(webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
        ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      } catch { chrome.kill(); }
      await Promise.race([exited, sleep(5000)]);
      try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* group already gone */ }
      server.close();
      // Chrome's helper processes may still be flushing the profile for a moment after exit.
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

// DOM helpers evaluated inside the page (React listens to native input/change/click events).
const DOM = String.raw`
window.__t = {
  setValue(el, value) {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  },
  button(text) {
    return [...document.querySelectorAll("button")].find(b => b.textContent.trim() === text);
  },
  click(text) { const b = this.button(text); if (!b) throw new Error("no button: " + text); b.click(); },
  text() { return document.body.innerText; },
};
true`;

module.exports = { startBrowser, DOM };
