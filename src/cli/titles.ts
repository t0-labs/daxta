import { isHumanOperationTitle } from '../catalog/test-title';
import { isValidItCase } from '../catalog/it-case';
import {
  applyItCase,
  applyTitle,
  printNamingFindings,
  scanTestNaming,
  type ItFinding,
  type TitleFinding,
} from '../titles/scan';
import { banner, c, confirmPrompt, readlineAsk, selectMenu } from './ui';

type PickResult = string | 'skip' | 'skip-all' | 'all' | null;

async function pickFromSuggestions(
  finding: { file: string; line: number; column: number; raw: string; suggestions: string[] },
  extra: string,
  validate: (value: string) => boolean,
): Promise<PickResult> {
  const suggestions = finding.suggestions;
  const options = [
    ...suggestions.map((name, index) => ({
      value: name,
      label: name,
      badge: index === 0 ? 'recommended' : undefined,
      hint: index === 0 ? `${finding.file}:${finding.line}` : undefined,
    })),
    ...(suggestions.length
      ? [{ value: '__all__', label: 'Apply all remaining auto-fixes', hint: 'Accept recommended names for the rest' }]
      : []),
    { value: '__custom__', label: 'Custom title', hint: 'Type your own text' },
    { value: '__skip__', label: 'Skip this one' },
    { value: '__skip_all__', label: 'Skip all remaining' },
  ];

  const choice = await selectMenu<string>({
    title: `${finding.file}:${finding.line}`,
    subtitle: `${finding.raw}${extra ? ` · ${extra}` : ''}`,
    options,
  });

  if (choice === '__all__') return 'all';
  if (choice === '__skip__') return 'skip';
  if (choice === '__skip_all__') return 'skip-all';
  if (choice === '__custom__') {
    const custom = await readlineAsk(`  ${c.dim('text')} ${c.ice('›')} `);
    if (!validate(custom)) {
      console.log(`  ${c.gold('!')} does not match the format — skipped`);
      return 'skip';
    }
    return custom;
  }
  return choice;
}

function writeTitle(cwd: string, finding: TitleFinding): boolean {
  if (!finding.auto) return false;
  const name = finding.suggestions[0];
  if (!name || !isHumanOperationTitle(name)) return false;
  return applyTitle(cwd, finding, name);
}

function writeIt(cwd: string, finding: ItFinding): boolean {
  if (!finding.auto) return false;
  const name = finding.suggestions[0];
  if (!name || !isValidItCase(name)) return false;
  return applyItCase(cwd, finding, name);
}

function applyAllRecommended(
  cwd: string,
  titles: TitleFinding[],
  cases: ItFinding[],
  fromTitleIndex: number,
  fromCaseIndex: number,
): { written: number; skipped: number; pending: TitleFinding[] } {
  let written = 0;
  let skipped = 0;
  const pending: TitleFinding[] = [];
  for (let i = fromTitleIndex; i < titles.length; i += 1) {
    if (!titles[i].auto || !titles[i].suggestions[0]) {
      pending.push(titles[i]);
      continue;
    }
    if (writeTitle(cwd, titles[i])) {
      console.log(`  ${c.mint('✔')} ${titles[i].suggestions[0]}  ${c.dim(titles[i].file + ':' + titles[i].line)}`);
      written += 1;
    } else skipped += 1;
  }
  const caseStart = fromTitleIndex < titles.length ? 0 : fromCaseIndex;
  for (let i = caseStart; i < cases.length; i += 1) {
    if (!cases[i].auto || !cases[i].suggestions[0]) {
      skipped += 1;
      continue;
    }
    if (writeIt(cwd, cases[i])) {
      console.log(`  ${c.mint('✔')} ${cases[i].suggestions[0]}  ${c.dim(cases[i].file + ':' + cases[i].line)}`);
      written += 1;
    } else skipped += 1;
  }
  return { written, skipped, pending };
}

export async function runTitleCheck(options: {
  cwd?: string;
  checkOnly?: boolean;
  yes?: boolean;
  apply?: boolean;
  strict?: boolean;
}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const report = scanTestNaming(cwd);
  const total = report.titles.length + report.cases.length;

  if (!total) {
    if (!options.checkOnly) {
      banner('Test naming', 'titles + it() cases');
      console.log(`  ${c.mint('✔')} nothing to fix`);
      console.log('');
    }
    return 0;
  }

  const applyAll = Boolean(options.apply);
  if (applyAll) {
    banner('Test naming', 'applying recommended titles + it() names');
    const result = applyAllRecommended(cwd, report.titles, report.cases, 0, 0);
    console.log('');
    console.log(`  ${c.mint('✔')} ${result.written} updated  ${c.dim(`${result.skipped} skipped`)}`);
    if (result.pending.length) {
      console.log('');
      console.log(
        `  ${c.gold('!')} ${c.bold(`${result.pending.length} title(s) have no auto suggestion`)} ${c.dim('--yes does not invent names')}`,
      );
      for (const item of result.pending) {
        console.log(`    ${c.ice(item.file)}${c.dim(`:${item.line}`)}  ${c.dim(item.path + ' [' + item.method + ']')}`);
      }
      console.log(`  ${c.dim('Set those with')} ${c.ice('daxta titles')} ${c.dim('→ c (custom)')}`);
      console.log('');
    }
    const leftover = result.skipped + result.pending.length;
    return leftover > 0 && options.strict ? 1 : leftover > 0 ? 1 : 0;
  }

  if (options.checkOnly || options.yes || !process.stdin.isTTY) {
    printNamingFindings(report, c);
    return options.strict ? 1 : 0;
  }

  banner('Test naming', 'describe + it() → API docs labels');
  console.log(`  ${c.dim('describe')}  Create Mock Tbs — POST /v1/admin/mock-tbs`);
  console.log(`           ${c.dim('→ operation title in sidebar')}`);
  console.log(`  ${c.dim('it()')}       creates mock tbs when cyprus payload shape`);
  console.log(`           ${c.dim('→ scenario clause (when-clause; keeps pre-when field context when needed)')}`);
  console.log(`  ${c.dim('label')}     201 — Create Mock Tbs — cyprus payload shape`);
  console.log(`           ${c.dim('→')} ${c.ice('exampleLabelStyle')} ${c.dim('in')} ${c.ice('daxta tree')} ${c.dim('· change with')} ${c.ice('2')} ${c.dim('for short labels')}`);
  const autoCount =
    report.titles.filter((t) => t.auto && t.suggestions[0]).length +
    report.cases.filter((k) => k.auto && k.suggestions[0]).length;

  const shouldOptimize = await confirmPrompt({
    title: `Found ${total} test naming issue(s) — optimize now?`,
    hint: `${report.titles.length} describe · ${report.cases.length} it() (${autoCount} auto-fixable)`,
    defaultYes: true,
  });

  if (!shouldOptimize) {
    console.log(`  ${c.dim('skipped')} ${c.ice('daxta titles')} ${c.dim('anytime')}`);
    console.log('');
    return 0;
  }

  if (autoCount > 0) {
    const result = applyAllRecommended(cwd, report.titles, report.cases, 0, 0);
    console.log('');
    console.log(`  ${c.mint('✔')} ${result.written} updated  ${c.dim(`${result.skipped} skipped`)}`);
    if (result.pending.length) {
      const reviewPending = await confirmPrompt({
        title: `${result.pending.length} title(s) need a custom name — review now?`,
        defaultYes: false,
      });
      if (reviewPending) {
        for (const pending of result.pending) {
          const customChoice = await pickFromSuggestions(
            pending,
            `docs would show ${pending.path} — custom title required`,
            isHumanOperationTitle,
          );
          if (customChoice === 'skip-all') break;
          if (customChoice && customChoice !== 'skip' && customChoice !== 'all') {
            if (applyTitle(cwd, pending, customChoice)) {
              console.log(`  ${c.mint('✔')} ${customChoice}`);
            }
          }
        }
      }
    }
    console.log('');
    return 0;
  }

  let written = 0;
  let skipped = 0;

  for (let i = 0; i < report.titles.length; i += 1) {
    const finding = report.titles[i];
    const choice = await pickFromSuggestions(finding, `API docs would show ${finding.path}`, isHumanOperationTitle);
    if (choice === 'all') {
      const rest = applyAllRecommended(cwd, report.titles, report.cases, i, 0);
      written += rest.written;
      skipped += rest.skipped;
      for (const pending of rest.pending) {
        const customChoice = await pickFromSuggestions(
          pending,
          `docs would show ${pending.path} — custom title required`,
          isHumanOperationTitle,
        );
        if (customChoice === 'skip-all') {
          skipped += rest.pending.length;
          console.log(`  ${c.dim('skipped remaining')}`);
          console.log('');
          console.log(`  ${c.mint('✔')} ${written} updated  ${c.dim(`${skipped} skipped`)}`);
          console.log('');
          return options.strict && skipped > 0 ? 1 : 0;
        }
        if (!customChoice || customChoice === 'skip' || customChoice === 'all') {
          skipped += 1;
          continue;
        }
        if (applyTitle(cwd, pending, customChoice)) {
          console.log(`  ${c.mint('✔')} ${customChoice}`);
          written += 1;
        } else skipped += 1;
      }
      console.log('');
      console.log(`  ${c.mint('✔')} ${written} updated  ${c.dim(`${skipped} skipped`)}`);
      console.log('');
      return options.strict && skipped > 0 ? 1 : 0;
    }
    if (choice === 'skip-all') {
      skipped += report.titles.length - i + report.cases.length;
      console.log(`  ${c.dim('skipped remaining')}`);
      console.log('');
      console.log(`  ${c.mint('✔')} ${written} updated  ${c.dim(`${skipped} skipped`)}`);
      console.log('');
      return options.strict && skipped > 0 ? 1 : 0;
    }
    if (!choice || choice === 'skip') {
      skipped += 1;
      continue;
    }
    if (applyTitle(cwd, finding, choice)) {
      console.log(`  ${c.mint('✔')} ${choice}`);
      written += 1;
    } else {
      console.log(`  ${c.gold('!')} could not rewrite that line — skipped`);
      skipped += 1;
    }
  }

  for (let i = 0; i < report.cases.length; i += 1) {
    const finding = report.cases[i];
    const choice = await pickFromSuggestions(
      finding,
      finding.section ? `section ${finding.section}` : 'it() example name',
      isValidItCase,
    );
    if (choice === 'all') {
      const rest = applyAllRecommended(cwd, [], report.cases, 0, i);
      written += rest.written;
      skipped += rest.skipped;
      break;
    }
    if (choice === 'skip-all') {
      skipped += report.cases.length - i;
      console.log(`  ${c.dim('skipped remaining')}`);
      break;
    }
    if (!choice || choice === 'skip') {
      skipped += 1;
      continue;
    }
    if (applyItCase(cwd, finding, choice)) {
      console.log(`  ${c.mint('✔')} ${choice}`);
      written += 1;
    } else {
      console.log(`  ${c.gold('!')} could not rewrite that line — skipped`);
      skipped += 1;
    }
  }

  console.log('');
  console.log(`  ${c.mint('✔')} ${written} updated  ${c.dim(`${skipped} skipped`)}`);
  console.log('');
  return options.strict && skipped > 0 ? 1 : 0;
}
