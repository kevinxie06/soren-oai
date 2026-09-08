import { test, expect } from "@playwright/test";

test("study setup validates ranges and separates review from execution", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/lab/experiments")).json();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Launch a new experiment." }),
  ).toBeVisible();
  await expect(page.getByLabel("Task package", { exact: true })).toHaveValue(
    "stitch",
  );
  await expect(page.getByLabel("Purpose", { exact: true })).toHaveValue(
    "evaluate",
  );
  await page.locator(".study-settings summary").click();
  await page.getByLabel("Wound gap minimum", { exact: true }).fill("9");
  await page.getByLabel("Wound gap maximum", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "Generate experiment plan", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("minimum ≤ maximum");
  await page.getByLabel("Wound gap minimum", { exact: true }).fill("7");
  await page.getByLabel("Wound gap maximum", { exact: true }).fill("8");
  await page
    .getByRole("button", { name: "Generate experiment plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review your experiment." }),
  ).toBeVisible();
  await expect(page.locator(".review-coverage")).toContainText("7–8 mm");
  await expect(page.locator(".study-evidence")).toContainText(
    "Physical calibration is not established",
  );
  await expect(page.locator(".study-review-stats")).toContainText("48");
  expect(
    (await (await request.get("/api/lab/experiments")).json()).length,
  ).toBe(before.length);
  await page.getByRole("button", { name: "Edit study", exact: true }).click();
  await expect(
    page.getByLabel("Wound gap maximum", { exact: true }),
  ).toHaveValue("8");
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
    page.getByRole("heading", {
      name: "Object lifting & placement",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".review-coverage")).toContainText(
    "Object orientation",
  );
  await expect(page.locator(".review-coverage")).not.toContainText("Wound gap");
});
