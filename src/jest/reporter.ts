import { getConfig, resetConfig } from '../config';
import { generateApiDocs } from '../build/build-spec';
import { clearPartialMarker } from '../build/incremental';
import { getApiDocUrl } from '../serve/paths';

function printDocsReady(hits: number, operations: number): void {
  try {
    resetConfig();
    getConfig(true);
    const url = getApiDocUrl();
    const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
    const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

    console.log('');
    console.log(`  ${bold('API docs ready')}`);
    console.log(`  ${dim('│')} ${green('✔')} ${cyan(url)} ${dim(`(${hits} hits · ${operations} ops)`)}`);
    console.log(`  ${dim('│')} ${dim('served when NODE_ENV is dev/test/staging')}`);
    console.log('');
    console.log(`  ${bold('Next')}`);
    console.log(`  ${cyan('$')} ${bold('pnpm start:dev')}`);
    console.log(`    ${dim(`open ${url}`)}`);
    console.log('');
  } catch {
    console.log(`\nDAxTA: API docs ready (${hits} hits · ${operations} ops)\n`);
  }
}

type JestGlobalConfig = {
  testPathPattern?: string;
  testNamePattern?: string;
  nonFlagArgs?: string[];
  shard?: unknown;
  onlyChanged?: boolean;
  onlyFailures?: boolean;
};

function detectMergeMode(globalConfig?: JestGlobalConfig): 'none' | 'suite' | 'case' {
  if (!globalConfig) return 'none';
  if (globalConfig.testNamePattern) return 'case';
  if (
    globalConfig.testPathPattern ||
    (Array.isArray(globalConfig.nonFlagArgs) && globalConfig.nonFlagArgs.length > 0) ||
    globalConfig.shard ||
    globalConfig.onlyChanged ||
    globalConfig.onlyFailures
  ) {
    return 'suite';
  }
  return 'none';
}

/**
 * Jest reporter — only generates API docs when the full run completes.
 * During the run we only record hits (superagent hook + flush); no mid-run rebuilds.
 */
class DaxtaJestReporter {
  private readonly mergeMode: 'none' | 'suite' | 'case';

  constructor(globalConfig?: JestGlobalConfig) {
    this.mergeMode = detectMergeMode(globalConfig);
  }

  /** Stamp the run before workers start so this run's docs only reflect this run's traffic. */
  onRunStart(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const recorder = require('../recorder') as {
        clearWorkerHits: () => void;
        startRun: (opts?: { mergeMode?: 'none' | 'suite' | 'case' }) => string;
      };
      recorder.clearWorkerHits();
      recorder.startRun({ mergeMode: this.mergeMode });
    } catch {
      // never fail the test run
    }
  }

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
          clearWorkers?: boolean;
        }) => { skipped?: boolean; hits?: number; operations?: number } | null;
      };

      const result = rebuildFromDisk({ silent: true, force: true, html: true, clearWorkers: true });
      if (result && !result.skipped) {
        printDocsReady(result.hits ?? 0, result.operations ?? 0);
        return;
      }

      const build = generateApiDocs({ silent: true, html: true });
      clearPartialMarker();
      if (!build.skipped) printDocsReady(build.hits, build.operations);
    } catch {
      // never fail the test run
    } finally {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../recorder') as { clearRunMarker: () => void }).clearRunMarker();
      } catch {
        // ignore
      }
    }
  }
}

export = DaxtaJestReporter;
