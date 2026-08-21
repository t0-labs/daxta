import { getConfig, resetConfig } from '../config';
import { buildDaxtaSpec } from '../build/build-spec';
import { clearPartialMarker } from '../build/incremental';
import { getDocsBasePath } from '../serve/paths';

function printDocsReady(hits: number, operations: number): void {
  try {
    resetConfig();
    const config = getConfig(true);
    const docsBase = getDocsBasePath();
    const url = `${config.baseUrl.replace(/\/$/, '')}${docsBase}`;
    const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
    const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

    console.log('');
    console.log(`  ${bold('Docs ready')}`);
    console.log(`  ${dim('│')} ${green('✔')} ${cyan(url)} ${dim(`(${hits} hits · ${operations} ops)`)}`);
    console.log(`  ${dim('│')} ${dim('DAXTA_DOCS=true')} required on app start`);
    console.log('');
    console.log(`  ${bold('Next')}`);
    console.log(`  ${cyan('$')} ${bold('DAXTA_DOCS=true pnpm start:dev')}`);
    console.log(`    ${dim(`open ${url}`)}`);
    console.log('');
  } catch {
    console.log(`\nDAxTA docs ready (${hits} hits · ${operations} ops)\n`);
  }
}

/**
 * Jest reporter — only builds OpenAPI/HTML when the full run completes.
 * During the run we only record hits (superagent hook + flush); no mid-run rebuilds.
 */
class DaxtaJestReporter {
  onRunComplete(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('reflect-metadata');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rebuildFromDisk } = require('../build/incremental') as {
        rebuildFromDisk: (opts: {
          silent?: boolean;
          force?: boolean;
          html?: boolean;
        }) => { skipped?: boolean; hits?: number; operations?: number } | null;
      };

      const result = rebuildFromDisk({ silent: true, force: true, html: true });
      if (result && !result.skipped) {
        printDocsReady(result.hits ?? 0, result.operations ?? 0);
        return;
      }

      const build = buildDaxtaSpec({ silent: true, html: true });
      clearPartialMarker();
      if (!build.skipped) printDocsReady(build.hits, build.operations);
    } catch {
      // never fail the test run
    }
  }
}

export = DaxtaJestReporter;
