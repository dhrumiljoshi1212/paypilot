/**
 * 3:2 stills of the live app (1440x960 CSS px at 2x → 2880x1920 PNG).
 *
 *   node stills.mjs https://<app-host> ../docs/screenshots
 *
 * Side effect: shot 3 asks the agent to draft a reminder (PENDING_APPROVAL,
 * nothing sent). The draft is cancelled afterwards so the queue stays clean.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const BASE = process.argv[2];
const OUT = process.argv[3] ?? "screenshots";
const W = 1440;
const H = 960;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  protocolTimeout: 60000,
  args: ["--hide-scrollbars", "--force-prefers-reduced-motion=reduce"],
});
const page = await browser.newPage();
page.on("dialog", (d) => d.dismiss());
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });

async function open(p) {
  await page.goto(BASE + p, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(1200);
}
async function shot(name) {
  await page.mouse.move(W - 5, H - 5); // no hover states
  await wait(400);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log("wrote", file);
}
async function clickText(selector, text) {
  const ok = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find((n) => n.offsetParent !== null && n.textContent.includes(t));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector, text);
  if (!ok) throw new Error(`nothing matching ${selector} "${text}"`);
  await wait(800);
}
async function ask(text) {
  const sel = "textarea[placeholder^='Ask PayPilot'], input[placeholder^='Ask PayPilot']";
  await page.click(sel);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".thinking-dot", { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".thinking-dot"), { timeout: 120000, polling: 250 });
  await wait(1500);
}

try {
  // 5 first, so the draft created for shot 3 is not in the timeline.
  await open("/activity");
  await shot("5-activity-verified-webhooks.png");

  await open("/dashboard");
  await shot("1-dashboard-paypal-sandbox.png");

  // 4: executed reminder, reopened from invoice A's drawer.
  await open("/invoices");
  await clickText("tr, [role=row], button, a", "PILOT-1794474025465-A");
  await page.waitForFunction(() => /executed/i.test(document.body.innerText) && [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "View"), { timeout: 20000 });
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("li, div")].filter((n) => /executed/i.test(n.textContent) && n.querySelector("button"));
    const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "View");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) throw new Error("no executed action to view");
  await page.waitForFunction(() => document.body.innerText.includes("PayPal accepted the reminder request"), { timeout: 20000 });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("PayPal accepted the reminder request"));
    el.scrollIntoView({ block: "center" });
  });
  await wait(600);
  await shot("4-executed-reminder-paypal-204.png");

  // 2: agent answer + tool activity.
  await open("/agent");
  await ask("Which invoices are overdue, and which should I chase first?");
  await page.evaluate(() => {
    const tools = [...document.querySelectorAll("p")].find((p) => /tool activity/i.test(p.textContent));
    tools?.closest("div.rounded-lg")?.scrollIntoView({ block: "end" });
    window.scrollTo(0, Math.max(0, document.querySelector("h1").getBoundingClientRect().top + scrollY - 24));
  });
  await wait(600);
  await shot("2-agent-answer-tool-activity.png");

  // 3: draft → approval card with "Nothing has been sent".
  await ask("Draft a friendly reminder for invoice PILOT-1794474025465-B.");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Approve & send reminder")), { timeout: 60000 });
  await wait(1000);
  await shot("3-approval-card-nothing-sent.png");

  const draftId = await page.evaluate(() => {
    const m = document.querySelector("[role=dialog]")?.innerText.match(/action ([0-9a-f]{8})/);
    return m?.[1] ?? null;
  });
  console.log("draft", draftId);
} finally {
  await browser.close();
}
