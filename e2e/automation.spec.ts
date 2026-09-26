import { spawn } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { humanHarness } from "./human";

const BASE = "http://127.0.0.1:4414";
const PASSWORD = "a-long-test-password";

/** Waits for the row Enter will act on; see ticket-model.spec.ts for why this is a wait and not a race. */
async function expectHighlighted(option: Locator) {
  await expect(option).toHaveClass(/highlighted/);
}

/**
 * Chooses an option in the plain Picker that already has focus: Enter opens it, type-ahead
 * jumps to the first label starting with what is typed, Enter takes it. Focus comes back to
 * the trigger, where Tab carries on to the next control inside the node.
 */
async function choose(page: Page, trigger: Locator, typed: string, option: string) {
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.type(typed);
  await expectHighlighted(page.getByRole("option", { name: option, exact: true }));
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText(new RegExp(option));
  await expect(trigger).toBeFocused();
}

/**
 * Gives a node the keyboard. React Flow keeps a node hidden until it has measured it, and a
 * hidden element ignores focus, so the wait comes first.
 */
async function focusNode(page: Page, node: Locator) {
  await expect(node).toBeVisible();
  // The canvas fits the view and hands focus around for a moment after a node arrives, so the
  // focus is retried until it holds.
  await expect(async () => {
    await node.focus();
    await expect(node).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test("the owner's pipeline rule, drawn by keyboard, runs on the demo agent's ticket", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Pipeline");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("No agents connected yet")).toBeVisible();
  const human = await humanHarness(BASE, PASSWORD);

  // Automations by keyboard, then a new rule: a draft with one event node in the middle.
  await page.keyboard.press("g");
  await page.keyboard.press("m");
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
  await page.getByRole("button", { name: "New rule" }).first().click();
  await expect(page.getByRole("region", { name: "New rule" })).toBeVisible();
  await page.getByLabel("Rule name").fill("Pipeline");

  const canvas = page.getByRole("application", { name: "Rule canvas" });
  const node = (kind: "event" | "condition" | "action") => canvas.locator(`.react-flow__node:has(.rnode-${kind})`);

  // The When node: Enter on the node opens its first Picker; the event's own Pickers follow by Tab.
  await focusNode(page, node("event"));
  await page.keyboard.press("Enter");
  const eventTrigger = node("event").getByRole("button", { name: "Event", exact: true });
  await expect(eventTrigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.type("A ticket m");
  await expectHighlighted(page.getByRole("option", { name: "A ticket moves" }));
  await page.keyboard.press("Enter");
  await expect(eventTrigger).toHaveText(/A ticket moves/);
  await page.keyboard.press("Tab"); // From lane, left as any
  await page.keyboard.press("Tab"); // To lane
  await choose(page, node("event").getByRole("button", { name: "To lane", exact: true }), "Ev", "Eval");
  await page.keyboard.press("Escape");
  await expect(node("event")).toBeFocused();
  await expect(node("event").locator(".rnode-title")).toHaveText("A ticket moves to Eval");

  // c adds an If node wired from the event; a adds a Then node wired from that condition.
  await page.keyboard.press("c");
  await expect(node("condition")).toHaveCount(1);
  await expect(node("condition")).toBeFocused();
  await page.keyboard.press("a");
  await expect(node("action")).toHaveCount(1);
  await expect(node("action")).toBeFocused();
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(2);

  // The Then node: the Action Picker is searchable, so typing filters and Enter takes the match.
  await page.keyboard.press("Enter");
  const actionTrigger = node("action").getByRole("button", { name: "Action", exact: true });
  await expect(actionTrigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.type("Move to lane");
  await expectHighlighted(page.getByRole("option", { name: "Move to lane", exact: true }));
  await page.keyboard.press("Enter");
  await expect(actionTrigger).toHaveText(/Move to lane/);
  await page.keyboard.press("Tab");
  await choose(page, node("action").getByRole("button", { name: "Lane", exact: true }), "Ready for P", "Ready for Production");
  await page.keyboard.press("Escape");
  await expect(node("action")).toBeFocused();
  await expect(node("action").locator(".rnode-title")).toHaveText("Move to Ready for Production");

  // A drawing the engine cannot run is refused with the node named: with the If node gone the
  // Then node hangs off nothing. Space selects the focused node; Delete removes the selection.
  await focusNode(page, node("condition"));
  await page.keyboard.press(" ");
  await page.keyboard.press("Delete");
  await expect(node("condition")).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("The then node (Move to Ready for Production) is not connected to the event.");
  await expect(node("action").locator(".rnode")).toHaveClass(/has-error/);
  await expect(page).toHaveURL(/\/automations\/new$/);

  // Undo brings the If node and both edges back, then its Pickers are filled in the same way.
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await expect(node("condition")).toHaveCount(1);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(2);
  await focusNode(page, node("condition"));
  await page.keyboard.press("Enter");
  const checkTrigger = node("condition").getByRole("button", { name: "Check", exact: true });
  await expect(checkTrigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.type("Ev");
  await expectHighlighted(page.getByRole("option", { name: "Evidence", exact: true }));
  await page.keyboard.press("Enter");
  await expect(checkTrigger).toHaveText(/Evidence/);
  await page.keyboard.press("Tab");
  await choose(page, node("condition").getByRole("button", { name: "Evidence type", exact: true }), "Eval", "Eval score");
  await page.keyboard.press("Tab");
  await choose(page, node("condition").getByRole("button", { name: "Result", exact: true }), "P", "Passed");
  await page.keyboard.press("Tab");
  await choose(page, node("condition").getByRole("button", { name: "Operator", exact: true }), "is p", "is present");
  await page.keyboard.press("Escape");
  await expect(node("condition")).toBeFocused();
  await expect(node("condition").locator(".rnode-title")).toHaveText("Evidence Eval score passed");

  // Saving a draft lands on the saved rule's own address (the editor remounts under it, so
  // the "Saved." bar is not the thing to wait for); the list shows it enabled.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[^/]+$/);
  await expect(page.getByRole("region", { name: "Pipeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  const ruleUrl = page.url();
  const ruleId = ruleUrl.slice(ruleUrl.lastIndexOf("/") + 1);
  await expect(page.getByRole("switch", { name: "Pipeline enabled" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("list", { name: "Runs" })).toContainText("This rule has not fired yet.");

  // The demo agent over MCP, with the owner's stream open to see the rule fire. The agent
  // moves its ticket into Eval with a passing eval score on it; the rule takes it from there.
  const stream = await human.openStream();
  const agent = spawn("pnpm", ["demo:agent"], {
    env: { ...process.env, BOOMERANG_URL: BASE, AGENT_NAME: "e2e-agent" },
    stdio: "inherit",
  });
  const exited = new Promise<number>((r) => agent.on("exit", (c) => r(c ?? 1)));

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("e2e-agent")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  expect(await exited).toBe(0);

  // The chain log: the fire is an event of its own, and the move it made names its cause.
  const fired = await stream.waitFor((e) => e.type === "rule.fired");
  stream.close();
  expect(fired.payload).toMatchObject({ ruleId, outcome: "applied", causedBy: { ruleId, runId: expect.any(String), eventSeq: expect.any(Number) } });
  const lanes = (await human.call("GET", `/api/v1/projects/${fired.payload.projectId}/lanes`)).json as { id: string; name: string }[];
  const readyForProduction = lanes.find((l) => l.name === "Ready for Production")!.id;
  const moved = stream.events.find((e) => e.type === "ticket.moved" && e.payload.to === readyForProduction);
  expect(moved?.payload.causedBy).toMatchObject({ ruleId, runId: fired.payload.runId });
  expect(stream.events.some((e) => e.type === "ticket.flag_set" && e.payload.flag === "needs_human" && e.payload.id === fired.payload.ticketId)).toBe(true);

  // The Queue: the ticket flagged for a human, and the week's figures with the demo agent's
  // cost report as an estimate, tilde first and the price date on hover.
  await page.getByRole("link", { name: "Queue" }).click();
  const row = page.getByRole("link", { name: /Demo: wire outbox retries/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs human")).toBeVisible();
  const cost = page.locator(".figures .figure .mono[title]").filter({ hasText: /^~\$/ });
  await expect(cost).toHaveText(/^~\$\d/);
  await expect(cost).toHaveAttribute("title", /Estimate/);

  // The Board: the ticket ended in Ready for Production, by the rule, not the agent.
  await page.getByRole("link", { name: "Board" }).click();
  const lane = page.locator("section.lane").filter({ has: page.getByRole("heading", { name: "Ready for Production" }) });
  await expect(lane.getByText("Demo: wire outbox retries")).toBeVisible();

  // The run log shows the applied run. Test on ticket lights every node without writing:
  // the chain head is the same before and after.
  await page.getByRole("link", { name: "Automations" }).click();
  await page.getByRole("list", { name: "Rules" }).getByRole("button", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(ruleUrl);
  await expect(page.getByRole("list", { name: "Runs" }).locator(".chip", { hasText: "Applied" })).toHaveCount(1);
  const before = (await human.call("GET", "/api/v1/chain/verify")).json;
  expect(before.ok).toBe(true);
  await page.getByRole("button", { name: "Test on ticket" }).click();
  await expect(page.getByRole("combobox", { name: "Search Ticket to test on" })).toBeFocused();
  await page.keyboard.type("wire");
  await expectHighlighted(page.getByRole("option", { name: /Demo: wire outbox retries/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Matched PIPELINE-1. Nothing was written.");
  await expect(page.getByRole("status")).toContainText("Would move to Ready for Production");
  await expect(canvas.locator(".rnode.is-lit")).toHaveCount(3);
  const after = (await human.call("GET", "/api/v1/chain/verify")).json;
  expect(after.seq).toBe(before.seq);
  expect(after.head).toBe(before.head);
});
