import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "client", "dist");
const assetsRoot = path.join(distRoot, "assets");
const indexHtmlPath = path.join(distRoot, "index.html");
const cacheBustStamp =
  process.env.EURO_FRONT_CACHE_BUST ||
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, contents) {
  fs.writeFileSync(filePath, contents);
}

function replaceAllLiteral(source, search, replacement) {
  if (search === replacement || !source.includes(search)) {
    return source;
  }
  return source.split(search).join(replacement);
}

function renameAssetBasenameAndRewriteReferences(currentBaseName, nextBaseName) {
  if (currentBaseName === nextBaseName) return;

  const currentPath = path.join(assetsRoot, currentBaseName);
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Arquivo esperado ausente para cache bust: ${currentBaseName}`);
  }

  const nextPath = path.join(assetsRoot, nextBaseName);
  fs.renameSync(currentPath, nextPath);

  const targets = [indexHtmlPath];
  for (const entry of fs.readdirSync(assetsRoot)) {
    if (!/\.(js|css|html)$/i.test(entry)) continue;
    targets.push(path.join(assetsRoot, entry));
  }

  for (const targetPath of targets) {
    if (!fs.existsSync(targetPath)) continue;
    const original = read(targetPath);
    const updated = replaceAllLiteral(original, currentBaseName, nextBaseName);
    if (updated !== original) {
      write(targetPath, updated);
    }
  }
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`assets ausente: ${assetsRoot}`);
  }
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`index.html ausente: ${indexHtmlPath}`);
  }

  const assetNames = fs
    .readdirSync(assetsRoot)
    .filter((entry) => /\.(js|css)$/i.test(entry))
    .sort((left, right) => {
      if (left.startsWith("index-")) return 1;
      if (right.startsWith("index-")) return -1;
      return left.localeCompare(right);
    });

  for (const assetName of assetNames) {
    if (assetName.includes(`-${cacheBustStamp}.`)) continue;
    const nextBaseName = assetName.replace(/(\.[^.]+)$/, `-${cacheBustStamp}$1`);
    renameAssetBasenameAndRewriteReferences(assetName, nextBaseName);
  }

  process.stdout.write(`OK: assets 00h22 cache-bust aplicados (${cacheBustStamp})\n`);
}

main();
