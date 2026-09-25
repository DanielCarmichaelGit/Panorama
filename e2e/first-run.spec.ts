import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

test("first run, agent approval, clearing the queue", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByLabel("Repeat password").fill("a-long-test-password");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Panorama");
  await page.getByRole("button", { name: "Create project" }).click();
  // No agent has connected yet, so the Queue's empty state leads with connecting one rather
  // than the connected-but-idle "Nothing needs you" (Task 12's presence-first home).
  await expect(page.getByText("No agents connected yet")).toBeVisible();

  const agent = spawn("pnpm", ["demo:agent"], {
    env: { ...process.env, PANORAMA_URL: "http://127.0.0.1:4410", AGENT_NAME: "e2e-agent" },
    stdio: "inherit",
  });
  const exited = new Promise<number>((r) => agent.on("exit", (c) => r(c ?? 1)));

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("e2e-agent")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  expect(await exited).toBe(0);

  await page.getByRole("link", { name: "Queue" }).click();
  const row = page.getByRole("link", { name: /Demo: wire outbox retries/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs human")).toBeVisible();
  await expect(row.getByText("18,422 tok")).toBeVisible();
  await row.click();
  await page.getByRole("button", { name: "Clear needs human" }).click();
  await expect(page.getByText("Nothing needs you")).toBeVisible();

  if (!(await page.getByRole("dialog").isVisible().catch(() => false))) {
    await row.click();
  }
  await expect(page.getByRole("heading", { name: "Test run" })).toBeVisible();
  await expect(page.locator(".chip", { hasText: /^PASS/ })).toHaveCount(2);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Unlock" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("does not match");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("History intact")).toBeVisible();
});
