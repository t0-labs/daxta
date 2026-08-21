import { clearPartialMarker } from '../build/incremental';
import { buildDaxtaSpec } from '../build/build-spec';

/**
 * Optional jest globalTeardown — silent build only.
 * Docs ready is printed by the Jest reporter so we don't own the test process.
 */
export default async function daxtaGlobalTeardown(): Promise<void> {
  try {
    buildDaxtaSpec({ silent: true, html: true });
    clearPartialMarker();
  } catch {
    // never fail teardown
  }
}
