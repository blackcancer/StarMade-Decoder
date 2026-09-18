/**
 * @fileoverview Explicit opt-in for tests requiring a local StarMade installation.
 * Set STARMADE_TEST_DIR to enable these integration tests. Missing assets then
 * fail normally instead of being silently ignored.
 */
export const installationDir = process.env.STARMADE_TEST_DIR ?? '/srv/StarMade';
export const describeInstallation = process.env.STARMADE_TEST_DIR ? describe : describe.skip;
export const itInstallation = process.env.STARMADE_TEST_DIR ? it : it.skip;
