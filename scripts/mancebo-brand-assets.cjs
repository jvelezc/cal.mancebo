const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const process = require("node:process");
const root = path.resolve(__dirname, "../apps/web/public");
const check = process.argv.includes("--check");
const assetHash = (name, bytes) =>
  crypto
    .createHash("sha256")
    .update(name.endsWith(".svg") ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes)
    .digest("hex");
const wordmark =
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="32" viewBox="0 0 180 32"><text x="0" y="26" fill="#111827" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700">Mancebo.ai</text></svg>\n';
const icon = fs.readFileSync(path.join(root, "mancebo-icon.svg"));
const aliases = [
  "calcom-logo-white-word.svg",
  "cal-logo-word-black.svg",
  "cal-logo-word-dark.svg",
  "cal-logo-word.svg",
];
const icons = {
  "favicon-16x16.png": 16,
  "favicon-32x32.png": 32,
  "apple-touch-icon.png": 180,
  "mstile-150x150.png": 150,
  "android-chrome-192x192.png": 192,
  "android-chrome-256x256.png": 256,
};
const manifestPath = path.join(root, "mancebo-brand-assets.json");
async function main() {
  if (check) {
    const receipt = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (receipt.brand !== "Mancebo.ai") throw Error("Unexpected brand");
    for (const [name, item] of Object.entries(receipt.assets)) {
      const bytes = fs.readFileSync(path.join(root, name));
      if (assetHash(name, bytes) !== item.sha256) throw Error("Brand asset changed: " + name);
    }
    for (const name of aliases)
      if (fs.readFileSync(path.join(root, name), "utf8").replaceAll("\r\n", "\n") !== wordmark)
        throw Error("Unexpected wordmark: " + name);
    for (const [name, size] of Object.entries(icons)) {
      const meta = await sharp(path.join(root, name)).metadata();
      if (meta.width !== size || meta.height !== size) throw Error("Invalid icon dimensions: " + name);
    }
    console.log("PASS ManceboBrandAssetIntegrity; ManceboWordmarks; AllApplicationIconSizes");
    return;
  }
  const assets = new Set(["mancebo-icon.svg"]);
  function write(name, bytes) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), bytes);
    assets.add(name);
  }
  for (const name of aliases) write(name, wordmark);
  for (const name of ["cal-com-icon.svg", "cal-com-icon-white.svg"]) write(name, icon);
  for (const [name, size] of Object.entries(icons))
    write(name, await sharp(icon).resize(size, size).png().toBuffer());
  write("emails/logo.png", await sharp(Buffer.from(wordmark)).png().toBuffer());
  write("emails/CalLogo@2x.png", await sharp(Buffer.from(wordmark)).resize(360, 64).png().toBuffer());
  const png = fs.readFileSync(path.join(root, "favicon-32x32.png"));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  write("favicon.ico", Buffer.concat([header, png]));
  const social =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#fff"/><text x="100" y="300" font-family="Arial,Helvetica,sans-serif" font-size="96" font-weight="700" fill="#1D4ED8">Mancebo.ai</text><text x="105" y="390" font-family="Arial,Helvetica,sans-serif" font-size="44" fill="#334155">Appointments</text></svg>';
  write("og-image.png", await sharp(Buffer.from(social)).png().toBuffer());
  const receipt = { brand: "Mancebo.ai", assets: {} };
  for (const name of [...assets].sort())
    receipt.assets[name] = {
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, name)))
        .digest("hex"),
    };
  fs.writeFileSync(manifestPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log("Generated Mancebo.ai wordmarks, application icons and email/social images.");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
