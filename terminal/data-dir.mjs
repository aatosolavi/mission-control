#!/usr/bin/env node
/**
 * Resolve Mission Control data directory with legacy compat.
 *
 * Preference:
 *   1. MC_DATA_DIR
 *   2. ~/.mission-control if it exists
 *   3. ~/.grok-mission-control if it exists (legacy)
 *   4. ~/.mission-control (create on first write)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(home = process.env.HOME || homedir()) {
  if (process.env.MC_DATA_DIR) {
    return process.env.MC_DATA_DIR;
  }
  const modern = join(home, ".mission-control");
  const legacy = join(home, ".grok-mission-control");
  if (existsSync(modern)) return modern;
  if (existsSync(legacy)) return legacy;
  return modern;
}

export function legacyDataDir(home = process.env.HOME || homedir()) {
  return join(home, ".grok-mission-control");
}
