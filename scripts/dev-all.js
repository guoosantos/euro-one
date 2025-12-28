import { spawn } from "child_process";

const processes = [];

const shutdown = (signal = "SIGINT") => {
  processes.forEach((child) => {
    if (child && !child.killed) {
      child.kill(signal);
    }
  });
};

const run = (name, args) => {
  const child = spawn("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (signal === "SIGINT") return;
    shutdown();
    const exitCode = typeof code === "number" ? code : 1;
    process.exit(exitCode);
  });

  processes.push(child);
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});

run("server", ["run", "dev:server"]);
run("client", ["run", "dev", "--workspace", "client"]);
