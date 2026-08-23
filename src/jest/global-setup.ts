import { clearWorkerHits } from '../recorder';
import { runTitleCheck } from '../cli/titles';
import { printNamingFindings, scanTestNaming } from '../titles/scan';
import { c } from '../cli/ui';

export default async function daxtaGlobalSetup(): Promise<void> {
  clearWorkerHits();
  try {
    if (process.env.DAXTA_TITLE_CHECK === 'off') return;
    const strict = process.env.DAXTA_TITLE_CHECK === 'strict';
    const ci = Boolean(process.env.CI);
    const canAsk = Boolean(process.stdin.isTTY) && !ci && process.env.DAXTA_TITLE_CHECK !== 'warn';

    if (canAsk) {
      const code = await runTitleCheck({ strict });
      if (strict && code) {
        throw new Error('DAxTA: test naming off format. Fix with the prompts or `daxta titles`.');
      }
      return;
    }

    const report = scanTestNaming(process.cwd());
    if (!report.titles.length && !report.cases.length) return;
    printNamingFindings(report, c);
    if (strict) {
      throw new Error(
        'DAxTA: test naming off format. Run `daxta titles` or set DAXTA_TITLE_CHECK=off.',
      );
    }
  } catch (error) {
    if (process.env.DAXTA_TITLE_CHECK === 'strict') throw error;
  }
}
