#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const root = process.cwd();
const releaseBinary = join(
  root,
  "terminal/launcher-ratatui/target/release/mc",
);
const installDir = join(process.env.HOME || root, ".grok-mission-control", "bin");
const installedBinary = join(installDir, "mc");

const rustc = spawnSync("rustup", ["which", "rustc"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if (rustc.status !== 0) {
  process.exit(rustc.status || 1);
}

const toolchainBin = dirname(rustc.stdout.trim());
const env = {
  ...process.env,
  PATH: `${toolchainBin}:${process.env.PATH || ""}`,
};

const build = spawnSync(
  "rustup",
  [
    "run",
    "stable",
    "cargo",
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    "terminal/launcher-ratatui/Cargo.toml",
  ],
  {
    env,
    stdio: "inherit",
  },
);

if (build.status !== 0) {
  process.exit(build.status || 1);
}

mkdirSync(installDir, { recursive: true });
copyFileSync(releaseBinary, installedBinary);
chmodSync(installedBinary, 0o755);

console.log(`[terminal] Installed Ratatui launcher to ${installedBinary}`);
