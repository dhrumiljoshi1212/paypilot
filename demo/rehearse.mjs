import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = process.argv[2];
const prompts = JSON.parse(process.argv[3]);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await p.goto(BASE + "/agent", { waitUntil: "networkidle0", timeout: 90000 });
let i = 0;
for (const text of prompts) {
  i++;
  await p.click("textarea, input[placeholder^='Ask PayPilot']");
  await p.keyboard.type(text, { delay: 5 });
  const t = Date.now();
  await p.keyboard.press("Enter");
  await p.waitForSelector(".thinking-dot", { timeout: 10000 }).catch(() => {});
  let sawTools = [];
  while (await p.$(".thinking-dot")) {
    const tools = await p.evaluate(() => [...document.querySelectorAll("li")].map(l => l.textContent.trim()).filter(s => /\.\.\.|…/.test(s)));
    for (const x of tools) if (!sawTools.includes(x)) sawTools.push(x);
    await wait(250);
    if (Date.now() - t > 120000) break;
  }
  console.log(`prompt ${i}: ${((Date.now() - t)/1000).toFixed(1)}s tools=${JSON.stringify(sawTools)}`);
  await wait(1200);
  await p.screenshot({ path: `shots/agent_${i}.png` });
  await p.screenshot({ path: `shots/agent_${i}_full.png`, fullPage: true });
}
const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
console.log("----PAGE TEXT----\n" + text);
await b.close();
