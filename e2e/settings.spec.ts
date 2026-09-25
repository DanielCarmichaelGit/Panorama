import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Opens a Picker the way a keyboard user does: focus its trigger and press Enter. The Pickers on
 * Settings are plain (not searchable), so focus stays on the trigger, where type-ahead works.
 */
async function openPicker(page: Page, trigger: Locator) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Waits for the row Enter will act on; see ticket-model.spec.ts for why this is a wait and not a race. */
async function expectHighlighted(option: Locator) {
  await expect(option).toHaveClass(/highlighted/);
}

/**
 * The Settings row (a list item on the tab's single list surface) named exactly `name`. Matched
 * on the row's name element rather than its whole text, since a lane row also mentions the
 * evidence it requires ("Needs Eval score to enter" would otherwise match a search for Eval).
 */
function row(page: Page, list: string, name: string): Locator {
  return page.getByRole("list", { name: list }).locator(".settings-row").filter({ has: page.locator(".row-name", { hasText: new RegExp(`^${name}$`) }) });
}

test("the settings lifecycle: an evidence type, a lane that requires it, the gate it makes, and the in-use rules", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByLabel("Repeat password").fill("a-long-test-password");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Studio");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("No agents connected yet")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("tab", { name: "Fields" })).toHaveAttribute("aria-selected", "true");

  // Evidence types: a human-only sign-off of the design, its kind chosen by keyboard alone
  // (Enter opens the plain Picker, type-ahead jumps to the match, Enter chooses it).
  await page.getByRole("tab", { name: "Evidence types" }).click();
  await page.getByRole("button", { name: "Add evidence type" }).click();
  const newType = page.getByRole("form", { name: "New evidence type" });
  await newType.getByLabel("Name", { exact: true }).fill("Design review");
  const kindTrigger = newType.getByRole("button", { name: "Kind", exact: true });
  await openPicker(page, kindTrigger);
  await page.keyboard.type("H");
  await expectHighlighted(page.getByRole("option", { name: "Human sign-off" }));
  await page.keyboard.press("Enter");
  await expect(kindTrigger).toHaveText(/Human sign-off/);
  await expect(kindTrigger).toBeFocused();
  await newType.getByLabel("Human only").check();
  await newType.getByRole("button", { name: "Save" }).click();
  const reviewRow = row(page, "Evidence types", "Design review");
  await expect(reviewRow).toBeVisible();
  await expect(reviewRow.getByText("human_signoff")).toBeVisible();
  await expect(reviewRow.getByText("Human only")).toBeVisible();
  // Nothing requires it yet, so it can still be deleted.
  await expect(reviewRow.getByRole("button", { name: "Delete" })).toBeEnabled();

  // Lanes: a Design lane, lilac, flagging a human on entry. A new lane lands just before the
  // first done lane, so it starts between Ready for Production and Done.
  await page.getByRole("tab", { name: "Lanes" }).click();
  const laneRows = page.getByRole("list", { name: "Lanes" }).locator(".settings-row");
  await expect(laneRows).toHaveCount(6);
  await page.getByRole("button", { name: "Add lane" }).click();
  const newLane = page.getByRole("form", { name: "New lane" });
  await newLane.getByLabel("Name", { exact: true }).fill("Design");
  await newLane.getByRole("button", { name: "Lilac" }).click();
  await expect(newLane.getByRole("button", { name: "Lilac" })).toHaveAttribute("aria-pressed", "true");
  await newLane.getByLabel("Needs human on entry").check();
  await newLane.getByRole("button", { name: "Save" }).click();
  await expect(newLane).toBeHidden();
  await expect(laneRows).toHaveCount(7);
  await expect(laneRows.nth(5)).toContainText("Design");
  await expect(laneRows.nth(5).getByText("Needs human on entry")).toBeVisible();
  await expect(laneRows.nth(6)).toContainText("Done");

  // Move it up once: it now sits between Eval and Ready for Production.
  await row(page, "Lanes", "Design").getByRole("button", { name: "Move up" }).click();
  await expect(laneRows.nth(4)).toContainText("Design");
  await expect(laneRows.nth(5)).toContainText("Ready for Production");

  // Edit it to require Design review, with a description of what the evidence should show.
  const designRow = row(page, "Lanes", "Design");
  await designRow.getByRole("button", { name: "Edit" }).click();
  const editLane = page.getByRole("form", { name: "Edit Design" });
  await editLane.getByRole("button", { name: "Add requirement" }).click();
  const typeTrigger = editLane.getByRole("button", { name: "Evidence type", exact: true });
  await openPicker(page, typeTrigger);
  await page.keyboard.type("D");
  await expectHighlighted(page.getByRole("option", { name: "Design review" }));
  await page.keyboard.press("Enter");
  await expect(typeTrigger).toHaveText(/Design review/);
  await editLane.getByLabel("What it should show").fill("A signed note from the designer");
  await editLane.getByRole("button", { name: "Save" }).click();
  await expect(editLane).toBeHidden();
  await expect(designRow.getByText("Needs Design review to enter")).toBeVisible();

  // Fields: a required text field. The key is suggested from the name; the row shows Required.
  await page.getByRole("tab", { name: "Fields" }).click();
  await page.getByRole("button", { name: "Add field" }).click();
  const newField = page.getByRole("form", { name: "New field" });
  await newField.getByLabel("Name", { exact: true }).fill("Brief");
  await expect(newField.getByLabel("Key")).toHaveValue("brief");
  await newField.getByLabel("Required").check();
  await newField.getByRole("button", { name: "Save" }).click();
  const briefRow = row(page, "Fields", "Brief");
  await expect(briefRow).toBeVisible();
  await expect(briefRow.getByText("brief", { exact: true })).toBeVisible();
  await expect(briefRow.getByText("Required")).toBeVisible();

  // Board: a ticket, walked to the lane before Design. The panel's checklist for Design names
  // the review and what it should show, and the Lane picker refuses Design with the same name.
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "New ticket" }).click();
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  await dialog.getByLabel("Title").fill("Homepage hero");
  await dialog.getByLabel("Brief").fill("Three variants by Friday");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "STUDIO-1" });
  await expect(panel).toBeVisible();

  const laneTrigger = panel.getByRole("button", { name: "Lane", exact: true });
  await laneTrigger.click();
  await page.getByRole("option", { name: "Eval", exact: true }).click();
  await expect(laneTrigger).toHaveText(/Eval/);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await expect(panel.getByRole("heading", { name: "To enter Design" })).toBeVisible();
  await expect(panel.getByText("Design review, 0 of 1")).toBeVisible();
  await expect(panel.getByText("A signed note from the designer")).toBeVisible();

  await laneTrigger.click();
  const designOption = page.getByRole("option", { name: "Design", exact: true });
  await expect(designOption).toBeDisabled();
  await expect(designOption).toHaveAttribute("title", "Design (needs Design review)");
  // A disabled option is not actionable, so the click has to be forced through to show that
  // choosing it anyway moves nothing.
  await designOption.click({ force: true });
  await expect(laneTrigger).toHaveText(/Eval/);
  await laneTrigger.focus();
  await page.keyboard.press("Escape");
  await expect(laneTrigger).toHaveAttribute("aria-expanded", "false");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();

  // Evidence types: Design review is in use now, so Delete is disabled and says by what.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Evidence types" }).click();
  const reviewDelete = row(page, "Evidence types", "Design review").getByRole("button", { name: "Delete" });
  await expect(reviewDelete).toBeDisabled();
  await expect(reviewDelete).toHaveAttribute("title", "Remove it from Design first");

  // Lanes: the lane holding the ticket cannot go, the only done lane cannot go, and an empty
  // lane added for the purpose can.
  await page.getByRole("tab", { name: "Lanes" }).click();
  const evalDelete = row(page, "Lanes", "Eval").getByRole("button", { name: "Delete" });
  await expect(evalDelete).toBeDisabled();
  await expect(evalDelete).toHaveAttribute("title", "Move its 1 ticket first");
  const doneDelete = row(page, "Lanes", "Done").getByRole("button", { name: "Delete" });
  await expect(doneDelete).toBeDisabled();
  await expect(doneDelete).toHaveAttribute("title", "Add another done lane first");

  await page.getByRole("button", { name: "Add lane" }).click();
  await page.getByRole("form", { name: "New lane" }).getByLabel("Name", { exact: true }).fill("Scratch");
  await page.getByRole("form", { name: "New lane" }).getByRole("button", { name: "Save" }).click();
  const scratchRow = row(page, "Lanes", "Scratch");
  await expect(scratchRow).toBeVisible();
  await expect(laneRows).toHaveCount(8);
  await scratchRow.getByRole("button", { name: "Delete" }).click();
  await expect(scratchRow.getByText("Delete Scratch?")).toBeVisible();
  await scratchRow.getByRole("button", { name: "Delete" }).click();
  await expect(scratchRow).toHaveCount(0);
  await expect(laneRows).toHaveCount(7);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
