import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIRTY_TREE_ERROR = "ERRO: working tree suja, faça commit antes de buildar";

function runGit(args) {
  try {
    execFileSync("git", args, { cwd: rootDir, stdio: "pipe", encoding: "utf8" });
    return { ok: true, output: "" };
  } catch (error) {
    return {
      ok: false,
      status: typeof error?.status === "number" ? error.status : null,
      output: `${error?.stdout || ""}${error?.stderr || ""}`.trim(),
    };
  }
}

function failDirtyTree(details = "") {
  console.error(DIRTY_TREE_ERROR);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function ensureCleanDiff(args, label) {
  const result = runGit(args);
  if (result.ok) return;

  if (result.status === 1) {
    failDirtyTree(`[build-integrity] alterações detectadas em: ${label}`);
  }

  console.error(`[build-integrity] falha ao executar git ${args.join(" ")}`);
  if (result.output) {
    console.error(result.output);
  }
  process.exit(1);
}

function ensureNoUntrackedFiles() {
  const result = runGit(["ls-files", "--others", "--exclude-standard"]);
  if (!result.ok) {
    console.error("[build-integrity] falha ao verificar arquivos não rastreados");
    if (result.output) {
      console.error(result.output);
    }
    process.exit(1);
  }

  if (!result.output) return;
  failDirtyTree("[build-integrity] arquivos não rastreados detectados");
}

ensureCleanDiff(["diff", "--quiet"], "working tree");
ensureCleanDiff(["diff", "--cached", "--quiet"], "staging area");
ensureNoUntrackedFiles();

console.info("[build-integrity] árvore limpa confirmada");
