import { rmSync } from 'node:fs';

/**
 * Start every run from an empty scratch state directory (HA_DATA_DIR).
 * Without this, snapshots imported by one run collide with the next and the
 * store disambiguates them, so an id assertion passes once and then drifts.
 */
export default function setup() {
  rmSync('data-test', { recursive: true, force: true });
}
