import { spawn } from "bun";

const processes = [
  spawn(["bun", "run", "dev:web"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
  spawn(["bun", "run", "dev:api"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const stop = () => {
  for (const process of processes) {
    process.kill();
  }
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await Promise.race(
  processes.map(async (process) => process.exited)
);
stop();
process.exit(exitCode);
