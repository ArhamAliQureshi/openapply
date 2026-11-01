import "server-only";
import { writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import sharp from "sharp";

// WebP's maximum dimension; very long forms are scaled down to fit.
const WEBP_MAX = 16_383;

/**
 * Full-page screenshot saved as WebP (about 60% smaller than PNG). All fillers use this so
 * screenshots stay small and consistent; `path` should end in .webp.
 */
export async function saveScreenshot(page: Page, path: string) {
  const png = await page.screenshot({ fullPage: true });
  let image = sharp(png);
  const { width = 0, height = 0 } = await image.metadata();
  if (width > WEBP_MAX || height > WEBP_MAX) image = image.resize(WEBP_MAX, WEBP_MAX, { fit: "inside" });
  await writeFile(path, await image.webp({ quality: 75 }).toBuffer());
}
