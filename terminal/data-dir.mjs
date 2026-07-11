#!/usr/bin/env node
/**
 * Resolve T-0 data directory.
 *
 * Canonical: ~/.t-0
 * Legacy (auto-migrated once, first match wins when modern missing):
 *   ~/.mission-control
 *   ~/.grok-mission-control
 *
 * Preference after migrate:
 *   1. MC_DATA_DIR if set and not a known legacy path
 *   2. ~/.t-0
 */

import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODERN_DATA_DIR_NAME = ".t-0";
/** @deprecated use LEGACY_DATA_DIR_NAMES */
export const LEGACY_DATA_DIR_NAME = ".mission-control";
export const LEGACY_DATA_DIR_NAMES = [".mission-control", ".grok-mission-control"];

export function modernDataDir(home = process.env.HOME || homedir()) {
  return join(home, MODERN_DATA_DIR_NAME);
}

export function legacyDataDir(home = process.env.HOME || homedir()) {
  return join(home, LEGACY_DATA_DIR_NAME);
}

export function legacyDataDirs(home = process.env.HOME || homedir()) {
  return LEGACY_DATA_DIR_NAMES.map((name) => join(home, name));
}

/**
 * One-shot rename first existing legacy → modern when modern is missing.
 * @returns {{ migrated: boolean, from?: string, to?: string, error?: string }}
 */
export function migrateDataDir(home = process.env.HOME || homedir()) {
  const modern = modernDataDir(home);
  if (existsSync(modern)) {
    return { migrated: false };
  }

  for (const legacy of legacyDataDirs(home)) {
    if (!existsSync(legacy)) continue;
    try {
      renameSync(legacy, modern);
      return { migrated: true, from: legacy, to: modern };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { migrated: false, from: legacy, to: modern, error: message };
    }
  }

  return { migrated: false };
}

function isLegacyPath(path, home) {
  const normalized = path.replace(/\/$/, "");
  return legacyDataDirs(home).some((p) => p === normalized);
}

/**
 * Resolve the data directory, migrating legacy when needed.
 */
export function dataDir(home = process.env.HOME || homedir()) {
  const result = migrateDataDir(home);
  if (result.migrated) {
    console.log(`[t0] Migrated data dir: ${result.from} → ${result.to}`);
  } else if (result.error) {
    console.warn(
      `[t0] Could not migrate ${result.from} → ${result.to}: ${result.error}`,
    );
  }

  const modern = modernDataDir(home);

  if (process.env.MC_DATA_DIR) {
    const envPath = process.env.MC_DATA_DIR;
    // LaunchAgent / shells may still point at a legacy path after rename.
    if (isLegacyPath(envPath, home)) {
      return modern;
    }
    return envPath;
  }

  if (existsSync(modern)) return modern;
  for (const legacy of legacyDataDirs(home)) {
    if (existsSync(legacy)) return legacy;
  }
  return modern;
}
