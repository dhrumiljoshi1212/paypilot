/**
 * Records a demo film as one continuous browser session.
 *
 * This is a TEMPLATE. The helpers above the line are reusable; the beat list at
 * the bottom is what you edit per project.
 *
 *   node record.mjs http://localhost:3000 session.webm
 *
 * Reads  timings.json  (how long each beat holds — written by narrate.py)
 * Writes beats.json    (when each beat actually began — needed by mux.py)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const ROOT = process.env.DEMO_DIR ?? process.cwd();
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? path.join(ROOT, "session.webm");
const W = Number(process.env.VIEW_W ?? 1920);
const H = Number(process.env.VIEW_H ?? 1080);
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

const timings = JSON.parse(fs.readFileSync(path.join(ROOT, "timings.json"), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome for Testing — the headless *shell* build cannot screencast. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(cache)) {
    for (const version of fs.readdirSync(cache)) {
      const guess = path.join(cache, version, `chrome-${process.platform === "darwin" ? "mac" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`);
      const mac = path.join(guess, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (fs.existsSync(mac)) return mac;
      const linux = path.join(guess, "chrome");
      if (fs.existsSync(linux)) return linux;
    }
  }
  const system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(system)) return system;
  throw new Error("No Chrome found — set CHROME_PATH");
}

/* ------------------------------------------------------------------ */
/* Injected page helpers                                               */
/* ------------------------------------------------------------------ */

/** Headless Chrome renders no cursor, so draw one the viewer can follow. */
const CURSOR = `
(() => {
  if (window.__cursor) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:22px;height:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))';
  el.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 2l14 8.4-6.1 1.2 3.2 6.6-2.7 1.3-3.2-6.6-4 3.6z" fill="#111" stroke="#fff" stroke-width="1.3"/></svg>';
  document.body.appendChild(el);
  let x = innerWidth * .5, y = innerHeight * .62;
  const put = () => el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  put();
  window.__cursor = {
    async glide(nx, ny, ms) {
      const sx = x, sy = y, t0 = performance.now();
      return new Promise((done) => {
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          const e = p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
          x = sx + (nx - sx) * e; y = sy + (ny - sy) * e; put();
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
        setTimeout(() => { x = nx; y = ny; put(); done(); }, ms + 250);
      });
    },
    ripple() {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + x + 'px;top:' + y + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:999px;border:2px solid rgba(0,0,0,.5)';
      document.body.appendChild(r);
      r.animate([{transform:'scale(1)',opacity:.9},{transform:'scale(4.2)',opacity:0}],
        {duration:550,easing:'cubic-bezier(.22,1,.36,1)'}).onfinish = () => r.remove();
    }
  };
})();`;

/** Dims everything except a window over what the narrator is discussing. */
const SPOTLIGHT = `
(() => {
  if (window.__spot) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border-radius:14px;opacity:0;transition:opacity .45s ease, all .55s cubic-bezier(.22,1,.36,1);box-shadow:0 0 0 9999px rgba(15,23,42,.34);left:50%;top:50%;width:0;height:0';
  document.body.appendChild(el);
  window.__spot = {
    on(r, pad = 16) {
      el.style.left = (r.left - pad) + 'px'; el.style.top = (r.top - pad) + 'px';
      el.style.width = (r.width + pad*2) + 'px'; el.style.height = (r.height + pad*2) + 'px';
      el.style.opacity = '1';
    },
    off() { el.style.opacity = '0'; }
  };
})();`;

/** Eased scrolling — instant jumps read as cuts and disorient. */
const SCROLLER = `
window.__scrollTo = (top, ms) => new Promise((done) => {
  const start = scrollY, delta = top - start, t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = p < .5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2;
    scrollTo(0, start + delta * e);
    p < 1 ? requestAnimationFrame(step) : done();
  };
  requestAnimationFrame(step);
  setTimeout(() => { scrollTo(0, top); done(); }, ms + 250);
});
window.__chapterTop = (id, off = 56) => {
  const el = document.getElementById(id);
  return el ? el.getBoundingClientRect().top + scrollY - off : 0;
};`;

/* ------------------------------------------------------------------ */
/* Driving helpers                                                     */
/* ------------------------------------------------------------------ */

export async function dress(page) {
  for (const snippet of [CURSOR, SPOTLIGHT, SCROLLER]) await page.evaluate(snippet);
}

/** Waits until the page has genuinely stopped moving before measuring. */
export async function settle(page, timeout = 3000) {
  const started = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - started < timeout) {
    const y = await page.evaluate(() => Math.round(scrollY));
    stable = y === last ? stable + 100 : 0;
    if (stable >= 300) return;
    last = y;
    await wait(100);
  }
}

export async function clickAt(page, text, { glide = 700 } = {}) {
  const point = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll("button, a, [role=button]")]
      .find((n) => n.textContent.trim().includes(needle));
    if (!el) throw new Error("no clickable element containing: " + needle);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  await page.evaluate((p, ms) => window.__cursor.glide(p.x, p.y, ms), point, glide);
  await wait(glide + 90);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => window.__cursor.ripple());
  await page.mouse.click(point.x, point.y);
  await wait(140);
}

export async function typeInto(page, selector, text, { delay = 26 } = {}) {
  const point = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(260, r.width / 2), y: r.top + 44 };
  }, selector);
  await page.evaluate((p, ms) => window.__cursor.glide(p.x, p.y, ms), point, 800);
  await wait(880);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => window.__cursor.ripple());
  await page.keyboard.type(text, { delay });
}

export async function scrollToChapter(page, id, ms = 1600) {
  await page.evaluate((c, d) => window.__scrollTo(window.__chapterTop(c), d), id, ms);
  await wait(ms + 120);
}

/**
 * Spotlights an element for a while. `finder` runs in the page and returns an
 * element — a function rather than a selector, because the interesting targets
 * usually have no stable class to hang a selector on.
 */
export async function focusOn(page, finderSource, ms, pad = 18) {
  const found = await page.evaluate((src, padding) => {
    const el = new Function("return (" + src + ")()")();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    window.__spot.on({ left: r.left, top: r.top, width: r.width, height: r.height }, padding);
    return true;
  }, finderSource, pad);
  if (!found) return;
  await wait(ms);
  await page.evaluate(() => window.__spot.off());
  await wait(400);
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* PayPilot-specific helpers                                           */
/* ------------------------------------------------------------------ */

const DRY = process.env.DRY === "1"; // rehearsal: no PayPal reminder, no payment
const CARDS = path.join(ROOT, "cards");
const PAY_INVOICE = process.env.PAY_INVOICE ?? "INV2-5M2P-HLUK-BB6L-JZS8"; // $2,000, due Nov 13
const AGENT_Q1 = "Which invoices are a week or more overdue, and which should I chase first?";
const AGENT_Q2 = "Draft a friendly reminder for that one.";
const EXTRA_LINE = "\n\nHappy to jump on a quick call if that helps.";

/** Finds the smallest element whose text includes `text`, then climbs to a bordered box (or one containing `until`). */
const FINDER = `
window.__box = (text, until, opts = {}) => {
  const all = [...document.querySelectorAll(opts.scope ?? 'main *, [role=dialog] *, body *')]
    .filter(n => n.offsetParent !== null && n.textContent && n.textContent.toLowerCase().includes(text.toLowerCase()));
  let el = all.sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (opts.last) el = all.filter(n => n.textContent.length <= el.textContent.length * 1.01).pop() ?? el;
  if (!el) return null;
  for (let i = 0; i < 12 && el.parentElement; i++) {
    const cs = getComputedStyle(el);
    const bordered = parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0;
    if (until ? el.textContent.toLowerCase().includes(until.toLowerCase()) && (!opts.bordered || bordered) : bordered) return el;
    el = el.parentElement;
  }
  return el;
};`;

async function dressAll(page) {
  await dress(page);
  await page.evaluate(FINDER);
}

async function card(page, name) {
  await page.goto("file://" + path.join(CARDS, name + ".html"), { waitUntil: "networkidle0" });
}

async function go(page, pathname) {
  await page.goto(BASE + pathname, { waitUntil: "networkidle2", timeout: 60000 });
  await dressAll(page);
}

/** Sidebar navigation by link text, then wait for the page heading. */
const HREF = { Overview: "/dashboard", Invoices: "/invoices", "AI Agent": "/agent", Activity: "/activity" };

async function nav(page, linkText, heading) {
  await page.evaluate(FINDER);
  const pt = await page.evaluate((href) => {
    const el = [...document.querySelectorAll(`a[href="${href}"]`)].find((a) => a.offsetParent !== null);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 70), y: r.top + r.height / 2 };
  }, HREF[linkText]);
  if (!pt) throw new Error("no sidebar link for " + linkText);
  await page.evaluate((p) => window.__cursor.glide(p.x, p.y, 650), pt);
  await wait(700);
  await page.evaluate(() => window.__cursor.ripple());
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((h) => [...document.querySelectorAll("h1")].some((e) => e.textContent.trim() === h), { timeout: 30000 }, heading);
  await wait(500);
  await dressAll(page);
}

const spot = (text, until, opts = {}) =>
  `() => window.__box(${JSON.stringify(text)}, ${JSON.stringify(until ?? null)}, ${JSON.stringify(opts)})`;

async function hover(page, finderSource, ms = 700) {
  const pt = await page.evaluate((src) => {
    const el = new Function("return (" + src + ")()")();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 260), y: r.top + r.height / 2 };
  }, finderSource);
  if (!pt) return;
  await page.evaluate((p, d) => window.__cursor.glide(p.x, p.y, d), pt, ms);
  await wait(ms + 60);
  await page.mouse.move(pt.x, pt.y);
}

async function typeAgent(page, text) {
  const sel = "textarea[placeholder^='Ask PayPilot'], input[placeholder^='Ask PayPilot']";
  await page.waitForSelector(sel);
  const pt = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + 120, y: r.top + r.height / 2 };
  }, sel);
  await page.evaluate((p) => window.__cursor.glide(p.x, p.y, 700), pt);
  await wait(760);
  await page.mouse.click(pt.x, pt.y);
  await page.evaluate(() => window.__cursor.ripple());
  await page.keyboard.type(text, { delay: 24 });
  await wait(250);
  await page.keyboard.press("Enter");
}

async function waitForAgentIdle(page, timeout = 90000) {
  await page.waitForSelector(".thinking-dot", { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".thinking-dot"), { timeout, polling: 200 });
}

async function paypalToken() {
  const base = process.env.PAYPAL_BASE_URL;
  const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET).toString("base64");
  const r = await fetch(base + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return (await r.json()).access_token;
}

/** Records an external (bank transfer) payment on a sandbox invoice inside PayPal. */
async function recordPaymentInPayPal(invoiceId) {
  const base = process.env.PAYPAL_BASE_URL;
  if (!base?.includes("sandbox")) throw new Error("refusing: not a sandbox base URL");
  const token = await paypalToken();
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${base}/v2/invoicing/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "BANK_TRANSFER",
      payment_date: today,
      amount: { currency_code: "USD", value: "2000.00" },
      note: "PayPilot demo: payment recorded in PayPal Sandbox",
    }),
  });
  const text = await r.text();
  console.log(`        PayPal record-payment → HTTP ${r.status} ${text.slice(0, 120)}`);
  if (!r.ok) throw new Error("record payment failed");
}

async function waitForActivity(predicate, timeout = 40000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const r = await fetch(BASE + "/api/activity").then((x) => x.json()).catch(() => null);
    const items = r?.items ?? r?.events ?? (Array.isArray(r) ? r : []);
    if (items.some(predicate)) return true;
    await wait(1000);
  }
  console.log("        (timed out waiting for activity)");
  return false;
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

// Warm the server so the first navigation on camera is quick.
for (const p of ["/dashboard", "/invoices", "/agent", "/activity"]) await fetch(BASE + p).catch(() => {});

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  protocolTimeout: 40000,
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
page.on("dialog", (d) => d.dismiss());
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await card(page, "hook");

/*
 * Own CDP frame capture instead of page.screencast(): the built-in recorder pipes
 * 1080p frames into a realtime VP9 encoder, fell behind on this machine, and
 * stopped acknowledging frames (the picture froze). Here every frame goes to disk
 * with its timestamp and is encoded after the session.
 */
const FRAMES = path.join(ROOT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
const cdp = await page.createCDPSession();
const frames = [];
const writes = [];
let lastFrameAt = 0;
let lastCastAt = Date.now();
function keepFrame(data) {
  const file = path.join(FRAMES, String(frames.length).padStart(6, "0") + ".jpg");
  lastFrameAt = Date.now();
  frames.push({ file, ts: lastFrameAt / 1000 }); // one clock for screencast and fallback frames
  writes.push(fs.promises.writeFile(file, Buffer.from(data, "base64")));
}
cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
  lastCastAt = Date.now();
  keepFrame(data);
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
const CAST = { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 };
await cdp.send("Page.startScreencast", CAST);
/*
 * Watchdog: Chrome's screencast intermittently stops delivering frames for tens
 * of seconds while the page keeps changing. Fill any gap with direct screenshots
 * and periodically restart the screencast so the film never freezes.
 */
let stopping = false;
let capturing = false;
const watchdog = setInterval(async () => {
  if (stopping || capturing) return;
  const now = Date.now();
  if (now - lastFrameAt < 120) return;
  capturing = true;
  try {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    if (!stopping) keepFrame(data);
    if (Date.now() - lastCastAt > 2000) {
      lastCastAt = Date.now();
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.send("Page.startScreencast", CAST).catch(() => {});
    }
  } catch {}
  capturing = false;
}, 40);
const t0 = Date.now();
const recorder = {
  async stop() {
    const end = Date.now() / 1000;
    stopping = true;
    clearInterval(watchdog);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(writes);
    const start = t0 / 1000;
    let list = "ffconcat version 1.0\n";
    frames.forEach((f, i) => {
      const from = i === 0 ? start : f.ts;
      const to = i + 1 < frames.length ? frames[i + 1].ts : end;
      list += `file '${f.file}'\nduration ${Math.max(0.001, to - from).toFixed(4)}\n`;
    });
    if (frames.length) list += `file '${frames[frames.length - 1].file}'\n`;
    const listFile = path.join(FRAMES, "frames.ffconcat");
    fs.writeFileSync(listFile, list);
    const { execFileSync } = await import("node:child_process");
    execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", OUT], { stdio: "inherit" });
    console.log(`\n${frames.length} frames → ${OUT}`);
  },
};
const marks = {};

async function beat(id, label, action) {
  const startedAt = Date.now();
  marks[id] = (startedAt - t0) / 1000;
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(id)) return;
  console.log(`  ${marks[id].toFixed(1).padStart(6)}s  ${id} ${label}   [frames ${frames.length}]`);
  if (action) {
    try {
      await action();
    } catch (error) {
      console.log(`        ✖ beat ${id} error: ${String(error.message ?? error).slice(0, 200)}`);
    }
  }
  const remaining = timings[id] * 1000 - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);
  else console.log(`        ⚠ beat ${id} overran by ${(-remaining / 1000).toFixed(1)}s`);
}

try {
  await beat("01", "card: hook");

  await beat("02", "card: intro", async () => {
    await card(page, "intro");
  });

  await beat("03", "dashboard metrics", async () => {
    await go(page, "/dashboard");
    await wait(900);
    await focusOn(page, spot("Outstanding", "Due in next 7 days"), Math.max(2500, timings["03"] * 1000 - 5200), 14);
  });

  await beat("04", "briefing + ranking", async () => {
    await focusOn(page, spot("overdue invoices need attention", null), 4200, 10);
    await hover(page, spot("score 79", null));
    await focusOn(page, spot("Recommended next actions", "score 79"), 4600, 6);
  });

  await beat("05", "invoices table", async () => {
    await nav(page, "Invoices", "Invoices");
    await hover(page, spot("PILOT-1794474025465-A", "Overdue", { last: true }), 800);
    await focusOn(page, spot("PILOT-1794474025465-A", "PILOT-1794474025465-B"), 3200, 8);
    await hover(page, spot("PAYPAL: SENT", null), 600);
  });

  await beat("06", "agent: ask", async () => {
    await nav(page, "AI Agent", "AI Agent");
    await typeAgent(page, AGENT_Q1);
  });

  await beat("07", "agent: tool calls", async () => {
    await page.evaluate(FINDER);
    await waitForAgentIdle(page);
    await wait(500);
    await focusOn(page, spot("Tool activity", "analyze_overdue_invoices"), 4800, 10);
  });

  await beat("08", "agent: answer", async () => {
    await focusOn(page, `() => [...document.querySelectorAll("div.whitespace-pre-wrap.border")].pop()`, timings["08"] * 1000 - 1200, 12);
  });

  await beat("09", "agent: ask for draft", async () => {
    await typeAgent(page, AGENT_Q2);
  });

  await beat("10", "agent: drafting (no send tool)", async () => {
    await focusOn(page, spot("Approval queue", null), 3500, 8);
  });

  await beat("11", "approval card", async () => {
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Approve & send reminder")), { timeout: 90000 });
    await wait(700);
    await dressAll(page);
    await focusOn(page, spot("Recipient", "Why PayPilot suggests this"), 3600, 8);
    await focusOn(page, spot("Nothing has been sent. Review", null), 1800, 6);
  });

  await beat("12", "edit the draft", async () => {
    const pt = await page.evaluate(() => {
      const ta = [...document.querySelectorAll("textarea")].find((t) => t.id.startsWith("message-"));
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.scrollTop = ta.scrollHeight;
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width * 0.6, y: r.bottom - 30 };
    });
    await page.evaluate((p) => window.__cursor.glide(p.x, p.y, 600), pt);
    await wait(650);
    await page.evaluate(() => window.__cursor.ripple());
    await page.keyboard.type(EXTRA_LINE, { delay: 28 });
  });

  await beat("13", "approve & send", async () => {
    if (DRY) {
      await hover(page, spot("Approve & send reminder", null), 700);
      return;
    }
    await clickAt(page, "Approve & send reminder");
    await page.waitForFunction(() => document.body.innerText.includes("PayPal accepted the reminder request"), { timeout: 45000 });
    await wait(400);
    await dressAll(page);
  });

  await beat("14", "HTTP 204 result", async () => {
    if (DRY) return;
    await focusOn(page, spot("PayPal accepted the reminder request.", "HTTP"), 4200, 8);
    await focusOn(page, spot("PayPal sends its own system reminder email", "HTTP"), timings["14"] * 1000 - 5600, 8);
  });

  let paid = Promise.resolve();
  await beat("15", "payment recorded in PayPal", async () => {
    if (!DRY) paid = recordPaymentInPayPal(PAY_INVOICE);
    const close = await page.evaluate(() => {
      const b = document.querySelector('[role=dialog] button[aria-label="Close"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (close) {
      await page.evaluate((p) => window.__cursor.glide(p.x, p.y, 600), close);
      await wait(650);
      await page.evaluate(() => window.__cursor.ripple());
      await page.mouse.click(close.x, close.y);
      await wait(400);
    }
    await nav(page, "Invoices", "Invoices");
    await focusOn(page, spot("PILOT-1794474060305-C", "Nov 13, 2026", { bordered: false }), 3000, 6);
  });

  await beat("16", "webhook arrives", async () => {
    await paid;
    if (!DRY) await waitForActivity((e) => /INVOICING\.INVOICE\.PAID/.test(e.title ?? "") && /5M2P/.test(e.detail ?? ""));
    await nav(page, "Activity", "Activity");
    await wait(600);
    await focusOn(page, DRY ? spot("PayPal webhook:", "Verified event") : spot("PayPal webhook: INVOICING.INVOICE.PAID", "Verified event"), 4200, 10);
  });

  await beat("17", "the audit trail", async () => {
    // Stay on the newest entries; older rows are rehearsal drafts.
    await focusOn(page, DRY ? spot("AI drafted", "ago") : spot("PayPal reminder sent for invoice", "HTTP 204"), 3000, 8);
    await focusOn(page, spot("Approved reminder for", "ago"), 1600, 8);
    await focusOn(page, spot("AI drafted", "ago"), 1600, 8);
  });

  await beat("18", "dashboard after", async () => {
    await nav(page, "Overview", "Overview");
    await wait(700);
    await focusOn(page, spot("Outstanding", "Due in next 7 days"), 3600, 14);
  });

  await beat("19", "card: close", async () => {
    await card(page, "close");
  });
} finally {
  await recorder.stop();
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "beats.json"), JSON.stringify(marks, null, 1));
}
console.log(`\nrecorded ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
