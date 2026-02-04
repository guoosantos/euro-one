import { test, expect } from "@playwright/test";

const USERNAME = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASS;

function pickDifferentOption(options, currentValue) {
  const filtered = options.filter((opt) => opt.value !== currentValue && opt.value !== undefined);
  if (!filtered.length) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

test("stress: switch tenant/mode without blank screen", async ({ page }) => {
  if (!USERNAME || !PASSWORD) {
    throw new Error("E2E_USER/E2E_PASS env vars are required to run this test.");
  }

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');

  const loginResult = await Promise.race([
    page.waitForURL("**/home", { timeout: 20_000 }).then(() => "ok"),
    page.waitForSelector(".border-red-500\\/40", { timeout: 20_000 }).then(() => "error"),
  ]);
  if (loginResult !== "ok") {
    const errorText = await page.locator(".border-red-500\\/40").textContent();
    throw new Error(`Login failed: ${errorText || "unknown error"}`);
  }
  await expect(page.locator("#root")).toBeVisible();

  const select = page.locator('[data-testid="tenant-switch"]');
  await expect(select).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < 50; i += 1) {
    await expect(select).toBeEnabled({ timeout: 10_000 });
    const currentValue = await select.inputValue();
    const options = await select.locator("option").evaluateAll((nodes) =>
      nodes
        .map((node) => ({ value: node.value, label: node.textContent || "" }))
        .filter((opt) => opt.value !== undefined),
    );
    const next = pickDifferentOption(options, currentValue);
    if (!next) break;
    await select.selectOption(next.value);

    await page.waitForTimeout(150);
    await expect(select).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator("text=Carregando sessão…")).toHaveCount(0, { timeout: 5_000 });
    await page.waitForFunction(() => {
      const root = document.querySelector("#root");
      return root && root.children.length > 0;
    }, null, { timeout: 5_000 });
  }

  expect(consoleErrors, `Console errors detected: ${consoleErrors.join(" | ")}`).toHaveLength(0);
});
