import { clearPartialMarker } from '../build/incremental';
import { generateApiDocs } from '../build/build-spec';

/**
 * Optional jest globalTeardown — silent generate only.
 * API docs ready is printed by the Jest reporter so we don't own the test process.
 */
export default async function daxtaGlobalTeardown(): Promise<void> {
  try {
    generateApiDocs({ silent: true, html: true });
    clearPartialMarker();
  } catch {
    // never fail teardown
  }
}
