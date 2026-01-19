import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const pagesDir = path.join(rootDir, "client", "src", "pages");
const extensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const forbiddenPattern = /<h1\b/i;

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
      return;
    }
    if (extensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  });

  return files;
}

const files = collectFiles(pagesDir);
const violations = [];

files.forEach((file) => {
  const contents = fs.readFileSync(file, "utf8");
  if (forbiddenPattern.test(contents)) {
    violations.push(path.relative(rootDir, file));
  }
});

if (violations.length) {
  console.error("Found <h1> tags in pages. Use PageHeader instead:");
  violations.forEach((file) => {
    console.error(`- ${file}`);
  });
  process.exit(1);
}

console.log("Page header check passed: no <h1> tags found in pages.");
