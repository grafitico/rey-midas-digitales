// One-off image optimization: shrink oversized PNG source assets into
// web-sized WebP (and a small favicon + social card). Run with: node scripts/optimize-images.js
import sharp from "sharp";
import { statSync } from "node:fs";

const A = "assets/";
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + " KB";
const BRAND_BG = { r: 10, g: 10, b: 20, alpha: 1 };

async function run() {
  // Logo: displayed at max ~420px (.logo) — 840px covers retina for every use.
  await sharp(A + "logo.png")
    .resize({ width: 840, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(A + "logo.webp");

  // Favicon: tiny square PNG.
  await sharp(A + "logo.png")
    .resize({ width: 64, height: 64, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(A + "favicon.png");

  // Social card (og/twitter): 1200x630 JPG, logo centered on brand background.
  const logoForOg = await sharp(A + "logo.png")
    .resize({ width: 900, withoutEnlargement: true })
    .toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: BRAND_BG } })
    .composite([{ input: logoForOg, gravity: "center" }])
    .jpeg({ quality: 82 })
    .toFile(A + "og-image.jpg");

  // Banners: displayed at max 540px tall / full width — 1600px wide is plenty.
  for (const n of ["banner-1", "banner-2", "banner-3"]) {
    await sharp(A + n + ".png")
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(A + n + ".webp");
  }

  console.log("Done:");
  for (const f of ["logo.webp", "favicon.png", "og-image.jpg", "banner-1.webp", "banner-2.webp", "banner-3.webp"]) {
    console.log("  " + f.padEnd(16), kb(A + f));
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
