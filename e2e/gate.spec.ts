import { expect, test } from "@playwright/test";

test("gates refuse a move without evidence, then allow one with it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByLabel("Repeat password").fill("a-long-test-password");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Gatekeeper");
  await page.getByRole("button", { name: "Create project" }).click();
  // No agent ever connects in this test, so the Queue leads with connecting one rather than
  // the connected-but-idle "Nothing needs you" (Task 12's presence-first home).
  await expect(page.getByText("No agents connected yet")).toBeVisible();

  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByLabel("Title").fill("Ship the release notes");
  await page.getByRole("button", { name: "Create" }).click();

  const panel = page.getByRole("dialog", { name: /^GATEKEEPER-/ });
  await expect(panel).toBeVisible();

  const laneTrigger = page.getByRole("button", { name: "Lane", exact: true });
  await laneTrigger.click();
  const doneOption = page.getByRole("option", { name: "Done" });
  await expect(doneOption).toHaveAttribute("title", /Human sign-off/);
  await expect(doneOption).toBeDisabled();
  await page.keyboard.press("Escape"); // close the popover before it can cover anything below it

  await page.getByRole("button", { name: "Add evidence" }).click();
  const addEvidence = page.getByRole("dialog", { name: "Add evidence" });
  await addEvidence.getByRole("button", { name: "Type" }).click();
  // The Picker's popover portals to the end of <body>, outside the dialog's own DOM subtree.
  await page.getByRole("option", { name: "Human sign-off" }).click();
  await addEvidence.getByRole("button", { name: "Attach" }).click();
  await expect(addEvidence).toBeHidden();

  await laneTrigger.click();
  await expect(page.getByRole("option", { name: "Done" })).toBeEnabled();
  await page.getByRole("option", { name: "Done" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("link", { name: "Board" }).click();
  const doneLane = page.locator("section.lane").filter({ has: page.getByRole("heading", { name: "Done" }) });
  await expect(doneLane.getByText("Ship the release notes")).toBeVisible();

  await doneLane.getByText("Ship the release notes").click();
  await page.getByRole("textbox", { name: "Comment" }).click();
  await page.keyboard.type("# Signed off");
  // The visible "Comment" button's disabled state is computed once per Composer render and
  // does not re-evaluate on every keystroke (TipTap's useEditor defaults to
  // shouldRerenderOnTransaction: false), so it can still read as disabled here even though the
  // editor itself is not empty. Ctrl+Enter is the composer's other, always-live way to submit:
  // it reads editor.isEmpty fresh at submit time rather than through that stale render.
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".thread").getByRole("heading", { level: 1, name: "Signed off" })).toBeVisible();
});
