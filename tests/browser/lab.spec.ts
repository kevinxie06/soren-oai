import { test, expect } from "@playwright/test";
import type { Experiment, ExperimentDetail } from "../../lib/types";

test("workspace starts with a prompt and preserves environment navigation on reload and back", async ({
  page,
  request,
}) => {
  const experiments = (await (
    await request.get("/api/lab/experiments")
  ).json()) as Experiment[];
  const experiment = experiments.find(
    (item) => item.plan?.scenarios.length === 16,
  );
  test.skip(!experiment, "A generated experiment is required.");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Launch a new experiment." }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Research question", { exact: true }),
  ).toHaveValue(/starting policy/);
  await expect(
    page.getByRole("button", { name: "Generate experiment plan", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Launch experiment", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".scenario-card")).toHaveCount(0);
  await page.goto("/?experiment=" + experiment!.id);
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  await page.getByRole("button", { name: /Scenario 16:/ }).click();
  await expect(
    page.getByRole("heading", { name: "Environment parameters" }),
  ).toBeVisible();
  await expect(page.locator(".scenario-card")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reward function" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open simulation", exact: true })
    .first()
    .click();
  await expect(page.locator(".inspection")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Environment parameters" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  await page
    .getByRole("button", { name: "New experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Launch a new experiment." }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("real baseline and candidate suite, playback, telemetry, reload, and mobile layout", async ({
  page,
  request,
}) => {
  const experiments = (await (
    await request.get("/api/lab/experiments")
  ).json()) as Experiment[];
  let selected: ExperimentDetail | undefined;
  for (const e of experiments) {
    const detail = (await (
      await request.get("/api/lab/experiments/" + e.id)
    ).json()) as ExperimentDetail;
    if (
      detail.experiment.task !== "lifting" &&
      detail.jobs.some(
        (j) => j.kind === "candidate" && j.status === "completed",
      )
    ) {
      selected = detail;
      break;
    }
  }
  expect(
    selected,
    "Complete one real baseline, RL train, and candidate evaluation before this acceptance test.",
  ).toBeTruthy();
  const detail = selected!;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.goto("/?experiment=" + detail.experiment.id);
  await expect(
    page.getByRole("heading", { name: "Environment suite", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  await expect(page.locator(".suite-summary")).toContainText("successful");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".scenario-image img")).every(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    ),
  );
  await page.getByRole("button", { name: /Scenario 16:/ }).click();
  await expect(
    page.getByRole("heading", { name: "Environment parameters" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reward function" }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open simulation", exact: true })
    .first()
    .click();
  await expect(page.locator(".inspection")).toContainText("SCENARIO 16");
  await page
    .getByRole("button", { name: "Original simulation", exact: true })
    .click();
  const video = page.locator("video");
  await video.evaluate(async (el: HTMLVideoElement) => {
    await el.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video")!.currentTime > 0.2,
  );
  await video.evaluate((el: HTMLVideoElement) => el.pause());
  await page.getByRole("slider", { name: "Simulation time" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".measurements")).not.toContainText("0.000 N");
  const run = detail.runs.find((r) => r.controller === "baseline" && r.video)!;
  const range = await request.get("/api/lab/artifacts/" + run.video, {
    headers: { Range: "bytes=0-63" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(64);
  await page
    .getByRole("button", { name: "All environments", exact: true })
    .click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".scenario-table tbody tr")).toHaveCount(16);
  for (const button of await page
    .getByRole("button", { name: "Original simulation", exact: true })
    .all())
    await button.click();
  await expect(page.locator("video")).toHaveCount(2);
  await page.getByRole("button", { name: "Play both", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("video")).every(
      (v) => v.currentTime > 0.2,
    ),
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("button", { name: "Rewards & training", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start RL training", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Candidate checkpoint saved")).toBeVisible();
  const checkpointLink = page.getByRole("link", {
    name: "Download checkpoint",
  });
  const checkpoint = await request.get(
    (await checkpointLink.getAttribute("href"))!,
  );
  expect(checkpoint.status()).toBe(200);
  expect((await checkpoint.body()).subarray(0, 2).toString()).toBe("PK");
  await page.getByLabel("Action smoothness", { exact: true }).fill("0.02");
  await page.reload();
  await expect(page.locator("h1")).toHaveText(detail.experiment.title);
  await page.getByRole("button", { name: /Environments/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".lab/acceptance-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.screenshot({
    path: ".lab/acceptance-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);

  // Refinement must not combine repeated evaluations of different candidates.
  const child = await request.post("/api/lab/experiments", {
    data: {
      prompt: detail.experiment.prompt,
      source: "template",
      parent_id: detail.experiment.id,
      feedback: "Focus on wider gaps within the supported simulator bounds.",
    },
  });
  expect(child.status()).toBe(201);
  const childId = (await child.json()).experiment.id;
  const childDetail = (await (
    await request.get("/api/lab/experiments/" + childId)
  ).json()) as ExperimentDetail;
  const feedback = JSON.parse(String(childDetail.jobs[0].data.feedback));
  expect(feedback.measured_development_results).toHaveLength(16);
  for (const scenario of feedback.measured_development_results) {
    for (const result of scenario.results) {
      const latest = detail.jobs.find(
        (j) => j.kind === result.controller && j.status === "completed",
      )!;
      expect(result.evaluation_job_id).toBe(latest.id);
      expect(result.episodes).toBe(latest.data.episodes);
    }
  }
});

test("task creation, budget validation, conflicting jobs, and cancellation are real API operations", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New experiment", exact: true })
    .click();
  await page
    .getByLabel("Research question", { exact: true })
    .fill(
      "Test needle transfer and closure across wider wound gaps and greater stiffness.",
    );
  await page
    .getByRole("button", { name: "Generate experiment plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review your experiment." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Launch experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Environment suite", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const id = new URL(page.url()).searchParams.get("experiment")!;
  const invalid = await request.post("/api/lab/experiments/" + id + "/jobs", {
    data: { kind: "baseline", episodes: 999 },
  });
  expect(invalid.status()).toBe(400);
  const trainEarly = await request.post(
    "/api/lab/experiments/" + id + "/jobs",
    { data: { kind: "train", steps: 1024 } },
  );
  expect(trainEarly.status()).toBe(409);
  await page.getByLabel("Episodes per scenario").selectOption("10");
  await page
    .getByRole("button", { name: "Evaluate baseline", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  const conflict = await request.post("/api/lab/experiments/" + id + "/jobs", {
    data: { kind: "baseline" },
  });
  expect(conflict.status()).toBe(409);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-meta").first()).toContainText(
    "cancelled",
  );
  const unauthorized = await request.post("/api/lab/worker/claim", {
    data: { id: "untrusted" },
  });
  expect(unauthorized.status()).toBe(401);
});

test("object lifting task generates native scenes, evaluates its policy, and keeps task-specific evidence", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "New experiment", exact: true })
    .click();
  await page
    .getByLabel("Task package", { exact: true })
    .selectOption("lifting");
  await expect(
    page.getByLabel("Research question", { exact: true }),
  ).toHaveValue(/clear the cavity/);
  await page
    .getByRole("button", { name: "Generate experiment plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review your experiment." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Launch experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Environment suite", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  await expect(page.locator(".experiment-header")).toContainText(
    "OBJECT LIFTING & PLACEMENT",
  );
  await page.getByRole("button", { name: /Scenario 1:/ }).click();
  await expect(page.locator(".detail-specifications")).toContainText(
    "Object orientation",
  );
  await expect(page.locator(".detail-specifications")).not.toContainText(
    "Wound gap",
  );
  await page
    .getByRole("button", { name: "All environments", exact: true })
    .click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".scenario-image img")).every(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    ),
  );
  const id = new URL(page.url()).searchParams.get("experiment")!;
  await page.getByLabel("Episodes per scenario").selectOption("1");
  await page
    .getByRole("button", { name: "Evaluate baseline", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const d = (await (
          await request.get("/api/lab/experiments/" + id)
        ).json()) as ExperimentDetail;
        return d.jobs.find((j) => j.kind === "baseline")?.status;
      },
      { timeout: 90000 },
    )
    .toBe("completed");
  await page.reload();
  await expect(page.locator(".suite-summary")).toContainText("rim clearances");
  await page.getByRole("button", { name: /Scenario 16:/ }).click();
  await page
    .getByRole("button", { name: "Open simulation", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Original simulation", exact: true })
    .click();
  await expect(page.locator(".measurements")).toContainText("Placement error");
  await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video")!.currentTime > 0.2,
  );
  await page.getByRole("slider", { name: "Simulation time" }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("img", {
      name: "Measured object height and placement error over time",
    }),
  ).toBeVisible();
  const detail = (await (
    await request.get("/api/lab/experiments/" + id)
  ).json()) as ExperimentDetail;
  const baseline = detail.jobs.find((j) => j.kind === "baseline")!;
  expect(baseline.result?.episodes).toBe(16);
  expect(baseline.result?.mean_placement_error_mm).toEqual(expect.any(Number));
  expect(baseline.result).not.toHaveProperty("mean_gap_mm");
  const manifest = await (
    await request.get("/api/lab/artifacts/" + detail.runs[0].manifest)
  ).json();
  expect(manifest.task).toBe("lifting");
  expect(manifest.action_names).toHaveLength(4);
  expect(manifest.observation_names).toHaveLength(32);
  await page
    .getByRole("button", { name: "All environments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rewards & training", exact: true })
    .click();
  await expect(
    page.getByLabel("Placement progress", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Closure progress", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".fixed-criteria")).toContainText("cavity rim");
  const bad = await request.post("/api/lab/experiments/" + id + "/jobs", {
    data: {
      kind: "train",
      reward: {
        completion: 20,
        milestones: 2,
        closure: 3,
        smoothness: 0.01,
        failure: 10,
      },
    },
  });
  expect(bad.status()).toBe(400);
  const mismatch = await request.post("/api/lab/experiments", {
    data: {
      prompt: "Improve lifting",
      source: "template",
      task: "stitch",
      parent_id: id,
    },
  });
  expect(mismatch.status()).toBe(400);
  const childResponse = await request.post("/api/lab/experiments", {
    data: { prompt: "Improve lifting", source: "template", parent_id: id },
  });
  expect(childResponse.status()).toBe(409);
  expect((await childResponse.json()).error).toMatch(/reviewed study/);
  await page.reload();
  await page.getByRole("button", { name: /Environments/ }).click();
  await expect(page.locator(".scenario-card")).toHaveCount(16);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".lab/lifting-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.screenshot({ path: ".lab/lifting-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
