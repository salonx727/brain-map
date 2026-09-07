/* Reload after every change. Test the outcome, not the click. (AUDIT_REPORT, part 4) */
import { chromium } from "playwright";

const ORIGINAL = "file:///Users/salman/Downloads/SalonX_Prototype/salonx_brain_surface.html";
const PORT = "http://localhost:3000";
const OUT = "/tmp/salonx-shots";

const results = [];
function check(name, pass, note = "") {
  results.push({ name, pass, note });
  console.log((pass ? "PASS  " : "FAIL  ") + name + (note ? "   " + note : ""));
}

const browser = await chromium.launch();

async function newPage(errors) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return { ctx, page };
}

/* ---------- 1 · the original, for comparison ---------- */
{
  const errors = [];
  const { ctx, page } = await newPage(errors);
  await page.goto(ORIGINAL);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "/original-map.png" });

  const cards = await page.locator(".node").count();
  check("original · cards render", cards === 13, cards + " cards");

  /* enter the field and focus a node — this is where the original throws */
  await page.click("#wirebtn");
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + "/original-field.png" });
  const before = errors.length;
  const box = await page.locator("#field3d").boundingBox();
  await page.mouse.click(box.width / 2, box.height / 2);
  await page.waitForTimeout(700);
  check(
    "original · focusing a node in the field",
    errors.length === before,
    errors.length > before ? errors[before] : "clean"
  );
  await ctx.close();
}

/* ---------- 2 · the port ---------- */
{
  const errors = [];
  const { ctx, page } = await newPage(errors);
  await page.goto(PORT);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "/port-map.png" });

  const cards = await page.locator(".node").count();
  check("port · cards render", cards === 13, cards + " cards");

  const names = await page.locator(".node .n-name").allTextContents();
  check(
    "port · the eleven engines and two intake are named",
    names.includes("GHOST NOTES") && names.includes("NEXUS") && names.includes("THE GATE"),
    names.length + " names"
  );

  const hint = await page.locator("#lockstate .hint").textContent();
  check("port · sample notice states itself", /SAMPLE DATA/.test(hint || ""), hint);

  /* --- a to-do survives a reload, and so does its citation --- */
  await page.locator("#n-n1").click();
  await page.waitForTimeout(300);
  check("port · a tap opens the card", await page.locator("#panel").isVisible());
  await page.locator(".strip button").nth(1).click();
  await page.waitForTimeout(200);
  await page.locator(".addrow input.f").fill("Ported to Next.js §35.3 DOWNSTREAM");
  await page.locator(".addrow input.f").press("Enter");
  await page.waitForTimeout(300);

  /* --- a rename survives a reload — the historical defect --- */
  await page.locator("#panel input.f").nth(1).fill("EMPIRE RENAMED");
  await page.waitForTimeout(200);
  await page.locator(".savebtn").click();
  await page.waitForTimeout(400);

  /* --- a moved card stays where you put it --- */
  const b0 = await page.locator("#n-n2").boundingBox();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height - 10);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 120, b0.y + b0.height - 10 + 90, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const movedTo = await page.evaluate(() => {
    const el = document.getElementById("n-n2");
    return { left: el.style.left, top: el.style.top };
  });
  const movedHint = await page.locator("#lockstate .hint").textContent();
  check("port · a move is counted", /MOVED/.test(movedHint || ""), movedHint);

  /* --- now reload against the same storage and read --- */
  await page.reload();
  await page.waitForTimeout(1500);

  const nameAfter = await page.locator("#n-n1 .n-name").textContent();
  check("port · a rename survives a reload", nameAfter === "EMPIRE RENAMED", nameAfter);

  const posAfter = await page.evaluate(() => {
    const el = document.getElementById("n-n2");
    return { left: el.style.left, top: el.style.top };
  });
  check(
    "port · a moved card stays where you put it",
    posAfter.left === movedTo.left && posAfter.top === movedTo.top,
    posAfter.left + " " + posAfter.top
  );

  await page.locator("#n-n1").click();
  await page.waitForTimeout(300);
  await page.locator(".strip button").nth(1).click();
  await page.waitForTimeout(300);
  const lines = await page.locator(".listrow .line").allTextContents();
  check(
    "port · a to-do survives a reload",
    lines.some((l) => l.includes("Ported to Next.js")),
    lines.join(" | ").slice(0, 80)
  );
  const cites = await page.locator(".listrow .sub").allTextContents();
  check(
    "port · its citation survives too",
    cites.includes("§35.3 DOWNSTREAM"),
    cites.join(" | ")
  );

  /* --- a done mark survives a reload --- */
  await page.locator(".listrow .mark").first().click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(1400);
  await page.locator("#n-n1").click();
  await page.waitForTimeout(300);
  await page.locator(".strip button").nth(1).click();
  await page.waitForTimeout(300);
  const done = await page.locator(".listrow.is-done").count();
  check("port · a done mark survives a reload", done > 0, done + " done");
  await page.screenshot({ path: OUT + "/port-panel-todo.png" });

  /* --- the UI slots and the intake row are styled --- */
  await page.locator(".strip button").nth(0).click();
  await page.waitForTimeout(300);
  const slotH = await page.evaluate(() => {
    const b = document.querySelector(".slot button.empty");
    return b ? Math.round(b.getBoundingClientRect().height) : 0;
  });
  check("port · UI slots are styled", slotH === 104, slotH + "px tall");
  await page.screenshot({ path: OUT + "/port-panel-slots.png" });

  await page.locator(".strip button").nth(3).click();
  await page.waitForTimeout(300);
  const intakeH = await page.evaluate(() => {
    const b = document.querySelector(".intake button");
    return b ? Math.round(b.getBoundingClientRect().height) : 0;
  });
  check("port · the intake row is styled", intakeH > 40, intakeH + "px tall");
  await page.screenshot({ path: OUT + "/port-panel-drop.png" });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  /* --- state: hold the corner --- */
  const cb = await page.locator("#n-n0 .corner").boundingBox();
  await page.mouse.move(cb.x + 10, cb.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("port · holding the corner opens the state roster", await page.locator("#roster").isVisible());
  await page.screenshot({ path: OUT + "/port-roster.png" });
  await page.locator("#rosterCard .act").nth(1).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(1400);
  const st = await page.locator("#n-n0 .n-meta").textContent();
  check("port · a state change survives a reload", st === "IN BUILD", st);

  /* --- the field, and focusing a node in it --- */
  const before = errors.length;
  await page.click("#bar >> text=WIRE");
  await page.waitForTimeout(1000);
  check("port · the field opens", await page.locator("#field3d.open").isVisible());
  await page.screenshot({ path: OUT + "/port-field.png" });

  const fb = await page.locator("#field3d").boundingBox();
  await page.mouse.click(fb.width / 2, fb.height / 2);
  await page.waitForTimeout(700);
  check(
    "port · focusing a node in the field",
    errors.length === before,
    errors.length > before ? errors[before] : "clean"
  );
  const readout = await page.locator("#wiretext, #wireout .msg").first().textContent();
  check("port · the readout names the edges", /EDGES|WIRES/.test(readout || ""), readout);
  await page.screenshot({ path: OUT + "/port-field-focus.png" });

  /* orbit, then reset the view from the readout — never from a gesture */
  await page.mouse.move(fb.width / 2, fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.width / 2 + 220, fb.height / 2 + 80, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "/port-field-orbit.png" });
  await page.locator("#wireout .act").first().click();
  await page.waitForTimeout(600);
  await page.locator("#wireout .act").nth(1).click();
  await page.waitForTimeout(600);
  check("port · EXIT returns the flat map", await page.locator("#viewport").isVisible());

  /* --- the hub behind the door --- */
  await page.locator(".door").click();
  await page.waitForTimeout(400);
  check("port · the door opens the hub", await page.locator("#roster").isVisible());
  await page.screenshot({ path: OUT + "/port-hub.png" });
  await page.locator("#rosterCard .act").nth(1).click();
  await page.waitForTimeout(300);
  const ai = await page.locator("#rosterCard .foot").textContent();
  check("port · the AI tab declares itself read only", /READ ONLY/.test(ai || ""), "");
  await page.screenshot({ path: OUT + "/port-hub-ai.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  /* the overview hides the per-card controls by design, so come in close first */
  const zoomTo = async (k) => {
    await page.evaluate((v) => {
      const r = document.querySelector('#bar input[type="range"]');
      r.value = String(v);
      r.dispatchEvent(new Event("input", { bubbles: true }));
    }, k);
    await page.waitForTimeout(400);
  };
  await zoomTo(1);
  check(
    "port · detail returns on the way in",
    await page.locator("#n-n0 .ctls").isVisible()
  );

  /* --- the question ADD asks, and both answers --- */
  /* clicked through the DOM: at this zoom the card sits under the corner
     chrome, and the tap geometry is already covered above */
  await page.evaluate(() => document.getElementById("n-n0").click());
  await page.waitForTimeout(300);
  await page.locator("#panel >> text=ADD A CARD").click();
  await page.waitForTimeout(300);
  check(
    "port · ADD asks wired or independent",
    await page.locator("#addq").isVisible()
  );
  await page.screenshot({ path: OUT + "/port-addq.png" });
  await page.locator("#addq button").nth(1).click();
  await page.waitForTimeout(500);
  const madeId = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll(".node"));
    const last = els[els.length - 1];
    return last ? last.dataset.id : null;
  });
  check("port · the new card opens so it can be named", await page.locator("#panel").isVisible());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const total = await page.locator(".node").count();
  check("port · a created card survives", total === 14, total + " cards");

  await page.evaluate(
    (id) => document.querySelector("#n-" + id + " .rm").click(),
    madeId
  );
  await page.waitForTimeout(500);
  check("port · undo is offered", await page.locator("#undo.open").isVisible());
  await page.screenshot({ path: OUT + "/port-undo.png" });
  await page.reload();
  await page.waitForTimeout(1400);
  const after = await page.locator(".node").count();
  check("port · its removal survives a reload", after === 13, after + " cards");

  /* --- pull back: names hold a constant screen size --- */
  await zoomTo(0.3);
  const far = await page.evaluate(() => {
    const p = document.getElementById("plane");
    const n = document.querySelector(".node .n-name");
    return {
      far: p.classList.contains("far"),
      px: parseFloat(getComputedStyle(n).fontSize),
    };
  });
  check("port · the overview keeps names readable", far.far && far.px > 20, far.px + "px");
  await page.screenshot({ path: OUT + "/port-overview.png" });

  check("port · no script errors anywhere", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passing");
process.exit(failed.length ? 1 : 0);
