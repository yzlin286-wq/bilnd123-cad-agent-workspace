#!/usr/bin/env node
import { spawn } from "node:child_process";

const baseChecks = [
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
];

const optionalStagingChecks = process.env.STAGING_BASE_URL
  ? [
      ["npm", ["run", "smoke:staging", "--", "--output", "outputs/smoke/latest.json"]],
      ["npm", ["run", "staging:protocol", "--", "--output", "outputs/protocol/latest.json"]],
    ]
  : [];

for (const [command, args] of [...baseChecks, ...optionalStagingChecks]) {
  await run(command, args);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: baseChecks.length + optionalStagingChecks.length,
      stagingChecks: optionalStagingChecks.length,
    },
    null,
    2,
  ),
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
      }
    });
  });
}

function spawnCommand(command, args) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
      stdio: "inherit",
      shell: false,
    });
  }
  return spawn(command, args, {
    stdio: "inherit",
    shell: false,
  });
}
