#!/usr/bin/env node
/**
 * Resolve T-0 / mission-control data directory.
 *
 * Canonical path: ~/.mission-control
 * Legacy path:    ~/.grok-mission-control (auto-migrated once)
 *
 * Preference after migrate:
 *   1. MC_DATA_DIR if set and not the legacy path (legacy env → modern after migrate)
 *   2. ~/.mission-control
 */

import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODERN_DATA_DIR_NAME = ".mission-control";
export const LEGACY_DATA_DIR_NAME = ".grok-mission-control";

export function modernDataDir(home = process.env.HOME || homedir()) {
  return join(home, MODERN_DATA_DIR_NAME);
}

export function legacyDataDir(home = process.env.HOME || homedir()) {
  return join(home, LEGACY_DATA_DIR_NAME);
}

/**
 * One-shot rename legacy → modern when modern is missing.
 * Safe if both exist (no-op, keeps modern) or neither exists.
 * @returns {{ migrated: boolean, from?: string, to?: string, error?: string }}
 */
export function migrateDataDir(home = process.env.HOME || homedir()) {
  const modern = modernDataDir(home);
  const legacy = legacyDataDir(home);

  if (existsSync(modern) || !existsSync(legacy)) {
    return { migrated: false };
  }

  try {
    renameSync(legacy, modern);
    return { migrated: true, from: legacy, to: modern };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { migrated: false, from: legacy, to: modern, error: message };
  }
}

/**
 * Resolve the data directory, migrating legacy when needed.
 * Call this at process start (pty broker, HTML server, build install).
 */
export function dataDir(home = process.env.HOME || homedir()) {
  const result = migrateDataDir(home);
  if (result.migrated) {
    console.log(`[mc] Migrated data dir: ${result.from} → ${result.to}`);
  } else if (result.error) {
    console.warn(
      `[mc] Could not migrate ${result.from} → ${result.to}: ${result.error}`,
    );
  }

  const modern = modernDataDir(home);
  const legacy = legacyDataDir(home);

  if (process.env.MC_DATA_DIR) {
    const envPath = process.env.MC_DATA_DIR;
    // LaunchAgent / shells may still point at the old path after rename.
    if (envPath === legacy || envPath === `${legacy}/`) {
      return modern;
    }
    return envPath;
  }

  // Prefer modern always; only fall back to leftover legacy if rename failed.
  if (existsSync(modern)) return modern;
  if (existsSync(legacy)) return legacy;
  return modern;
}
