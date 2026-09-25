import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Opens a Picker the way a keyboard user does: focus its trigger and press Enter. A searchable
 * Picker then moves focus into its search input; a plain one keeps it on the trigger, where
 * type-ahead works.
 */
async function openPicker(page: Page, trigger: Locator) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/**
 * Waits for the row Enter will act on. The Picker settles its highlight during render, so Enter
 * right after typing already lands on the first match; this wait is what a keyboard user does
 * anyway (read the highlight, then press) and it documents which row each Enter is aimed at.
 */
async function expectHighlighted(option: Locator) {
  await expect(option).toHaveClass(/highlighted/);
}

test("a ticket through the full dialog: required field, arc, tags, dependency, panel, and board filters", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByLabel("Repeat password").fill("a-long-test-password");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Modeller");
  await page.getByRole("button", { name: "Create project" }).click();
  // No agent connects in this test, so the Queue leads with connecting one.
  await expect(page.getByText("No agents connected yet")).toBeVisible();

  // Settings: a required text field, then an arc. The Fields tab is the default one.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("tab", { name: "Fields" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Customer");
  await expect(page.getByLabel("Key")).toHaveValue("customer");
  await page.getByLabel("Required").check();
  await page.getByRole("button", { name: "Save" }).click();
  const customerRow = page.locator(".settings-row", { hasText: "Customer" });
  await expect(customerRow).toBeVisible();
  await expect(customerRow.getByText("Required")).toBeVisible();

  await page.getByRole("tab", { name: "Arcs" }).click();
  await page.getByRole("button", { name: "Add arc" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Launch");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".settings-row", { hasText: "Launch" })).toBeVisible();

  // A first ticket for the second one to depend on, created through the same dialog from the
  // Board. The required field applies to it too.
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "New ticket" }).click();
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  await dialog.getByLabel("Title").fill("Land the retry schema");
  await dialog.getByLabel("Customer").fill("Acme");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const helperPanel = page.getByRole("dialog", { name: "MODELLER-1" });
  await expect(helperPanel).toBeVisible();
  await helperPanel.getByRole("button", { name: "Close" }).click();
  await expect(helperPanel).toBeHidden();

  // The ticket under test. Create stays disabled while a required field is empty, and Ctrl+Enter
  // names what is missing instead of creating.
  await page.getByRole("button", { name: "New ticket" }).click();
  const createButton = dialog.getByRole("button", { name: "Create", exact: true });
  await expect(createButton).toBeDisabled();
  await page.keyboard.press("Control+Enter");
  await expect(dialog.getByText("Missing required fields: Title, Customer")).toBeVisible();
  await dialog.getByLabel("Title").fill("Ship the launch banner");
  await expect(dialog.getByText("Missing required fields: Customer")).toBeVisible();
  await expect(createButton).toBeDisabled();

  // Arc, by keyboard alone: Enter opens and focuses the search, typing narrows the list, the
  // arrow steps past the Clear row onto the match, Enter chooses it and returns focus.
  const epicTrigger = dialog.getByRole("button", { name: "Arc", exact: true });
  await openPicker(page, epicTrigger);
  const epicSearch = page.getByRole("combobox", { name: "Search Arc" });
  await expect(epicSearch).toBeFocused();
  await epicSearch.pressSequentially("Laun");
  await expectHighlighted(page.getByRole("option", { name: "Clear" }));
  await page.keyboard.press("ArrowDown");
  await expectHighlighted(page.getByRole("option", { name: "Launch" }));
  await page.keyboard.press("Enter");
  await expect(epicTrigger).toHaveText(/Launch/);
  await expect(epicTrigger).toBeFocused();

  // Two tags created inline through the Tags Picker's "Create" row, each by keyboard.
  const tagsTrigger = dialog.getByRole("button", { name: "Tags", exact: true });
  for (const name of ["frontend", "urgent"]) {
    await openPicker(page, tagsTrigger);
    await page.getByRole("combobox", { name: "Search Tags" }).pressSequentially(name);
    await expectHighlighted(page.getByRole("option", { name: `Create '${name}'` }));
    await page.keyboard.press("Enter");
    await expect(tagsTrigger).toContainText(name);
    await expect(tagsTrigger).toBeFocused();
  }

  // The dependency: search by key, Enter picks it, Escape closes the multi Picker.
  const blockedByTrigger = dialog.getByRole("button", { name: "Blocked by", exact: true });
  await openPicker(page, blockedByTrigger);
  await page.getByRole("combobox", { name: "Search Blocked by" }).pressSequentially("MODELLER-1");
  const helperOption = page.getByRole("option", { name: /MODELLER-1/ });
  await expectHighlighted(helperOption);
  await page.keyboard.press("Enter");
  await expect(helperOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(blockedByTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(blockedByTrigger).toContainText("MODELLER-1");
  await expect(dialog).toBeVisible(); // Escape closed the Picker, not the dialog under it

  await dialog.getByLabel("Customer").fill("Acme");
  await expect(dialog.getByText(/Missing required fields/)).toHaveCount(0);
  await expect(createButton).toBeEnabled();
  await createButton.click();

  // The panel shows everything the dialog set.
  const panel = page.getByRole("dialog", { name: "MODELLER-2" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Arc", exact: true })).toHaveText(/Launch/);
  const panelTags = panel.getByRole("button", { name: "Tags", exact: true });
  await expect(panelTags).toContainText("frontend");
  await expect(panelTags).toContainText("urgent");
  await expect(panel.getByLabel("Customer")).toHaveValue("Acme");
  await expect(panel.getByRole("button", { name: "Blocked by", exact: true })).toContainText("MODELLER-1");
  await expect(panel.getByText("Needs fields")).toHaveCount(0);

  // Bring the ticket to the lane before Done with the evidence Done itself asks for, so the one
  // thing still standing between it and Done is the blocker.
  async function attachEvidence(typeName: string) {
    await panel.getByRole("button", { name: "Add evidence" }).click();
    const addEvidence = page.getByRole("dialog", { name: "Add evidence" });
    await addEvidence.getByRole("button", { name: "Type" }).click();
    // The Picker's popover portals outside the dialog's own DOM subtree.
    await page.getByRole("option", { name: typeName }).click();
    await addEvidence.getByRole("button", { name: "Attach" }).click();
    await expect(addEvidence).toBeHidden();
  }
  await attachEvidence("Eval score");
  await attachEvidence("Human sign-off");

  const laneTrigger = panel.getByRole("button", { name: "Lane", exact: true });
  await laneTrigger.click();
  await page.getByRole("option", { name: "Ready for Production" }).click();
  await expect(laneTrigger).toHaveText(/Ready for Production/);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // The checklist for Done lists the blocker, and the panel refuses the move, naming it.
  await expect(panel.getByText("Blocked by MODELLER-1")).toBeVisible();
  await laneTrigger.click();
  const doneOption = page.getByRole("option", { name: "Done" });
  await expect(doneOption).toBeDisabled();
  await expect(doneOption).toHaveAttribute("title", "Done (needs Blocked by MODELLER-1)");
  // A disabled option is not actionable, so the click has to be forced through to show that
  // choosing it anyway moves nothing.
  await doneOption.click({ force: true });
  await expect(laneTrigger).toHaveText(/Ready for Production/);
  // The forced click on a non-focusable row left focus on the body; Escape from the trigger
  // closes just the popover rather than the whole panel underneath it.
  await laneTrigger.focus();
  await page.keyboard.press("Escape");
  await expect(laneTrigger).toHaveAttribute("aria-expanded", "false");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();

  // Board filters: by arc through the URL, then by one tag, then cleared.
  const board = page.locator(".board");
  const boardHead = page.locator(".board-head");
  const main = board.getByText("Ship the launch banner");
  const helper = board.getByText("Land the retry schema");
  await expect(main).toBeVisible();
  await expect(helper).toBeVisible();
  // Closing the panel hands focus back to the ticket's card a tick later; let that land before
  // taking focus elsewhere, or the type-ahead below goes to the card instead of the Picker.
  await expect(board.getByRole("link", { name: /Ship the launch banner/ })).toBeFocused();

  const epicFilter = boardHead.getByRole("button", { name: "Arc", exact: true });
  await openPicker(page, epicFilter);
  await page.keyboard.type("L"); // type-ahead on a plain Picker
  await expectHighlighted(page.getByRole("option", { name: "Launch" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]epic=/);
  await expect(epicFilter).toHaveText(/Launch/);
  await expect(main).toBeVisible();
  await expect(helper).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/epic=/);
  await expect(helper).toBeVisible();

  const tagFilter = boardHead.getByRole("button", { name: "Tags", exact: true });
  await tagFilter.click();
  await page.getByRole("option", { name: "urgent" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/[?&]tag=/);
  await expect(main).toBeVisible();
  await expect(helper).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/tag=/);
  await expect(main).toBeVisible();
  await expect(helper).toBeVisible();
});
