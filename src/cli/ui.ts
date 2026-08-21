const isTTY = Boolean(process.stdout.isTTY);
const useColor = isTTY && !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0';

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function paint(code: string, text: string): string {
  if (!useColor) return text;
  return `${code}${text}${ansi.reset}`;
}

export const c = {
  bold: (t: string) => paint(ansi.bold, t),
  dim: (t: string) => paint(ansi.dim, t),
  cyan: (t: string) => paint(ansi.cyan, t),
  green: (t: string) => paint(ansi.green, t),
  yellow: (t: string) => paint(ansi.yellow, t),
  magenta: (t: string) => paint(ansi.magenta, t),
  red: (t: string) => paint(ansi.red, t),
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function banner(title: string, subtitle?: string): void {
  console.log('');
  console.log(`${c.cyan(c.bold('◆'))} ${c.bold(title)}${subtitle ? c.dim(`  ${subtitle}`) : ''}`);
  console.log(c.dim('─'.repeat(Math.min(56, Math.max(28, title.length + 10)))));
}

export type StepResult = string | { summary: string; details?: string[] } | void;

/**
 * Spinner while work runs → ✔ / ✖, optional detail lines, then a short pause to read.
 */
export async function step(
  label: string,
  work: () => StepResult | Promise<StepResult>,
  options: { paceMs?: number; spinner?: boolean } = {},
): Promise<void> {
  const paceMs = options.paceMs ?? 0;
  const useSpinner = options.spinner !== false && isTTY;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let timer: NodeJS.Timeout | undefined;

  if (useSpinner) {
    process.stdout.write(`  ${c.cyan(frames[0])} ${label}`);
    timer = setInterval(() => {
      i = (i + 1) % frames.length;
      process.stdout.write(`\r  ${c.cyan(frames[i])} ${label}`);
    }, 80);
  } else {
    console.log(`  ${c.cyan('▶')} ${label}`);
  }

  try {
    const result = await work();
    if (timer) clearInterval(timer);

    let summary = '';
    let details: string[] = [];
    if (typeof result === 'string') summary = result;
    else if (result && typeof result === 'object') {
      summary = result.summary;
      details = result.details ?? [];
    }

    const line = summary ? `${label}  ${c.dim(summary)}` : label;
    if (useSpinner) process.stdout.write(`\r  ${c.green('✔')} ${line}${' '.repeat(12)}\n`);
    else console.log(`  ${c.green('✔')} ${line}`);

    for (const d of details) {
      console.log(`      ${c.dim('→')} ${d}`);
    }

    if (paceMs > 0) await sleep(paceMs);
  } catch (error) {
    if (timer) clearInterval(timer);
    const msg = error instanceof Error ? error.message : String(error);
    if (useSpinner) process.stdout.write(`\r  ${c.red('✖')} ${label}  ${c.red(msg)}${' '.repeat(8)}\n`);
    else console.log(`  ${c.red('✖')} ${label}  ${msg}`);
    throw error;
  }
}

export function box(title: string, lines: string[]): void {
  console.log('');
  console.log(`  ${c.magenta(c.bold(title))}`);
  for (const line of lines) {
    console.log(`  ${c.dim('│')} ${line}`);
  }
  console.log('');
}

export function nextSteps(lines: Array<{ cmd: string; why: string }>): void {
  console.log(`  ${c.bold('Next')}`);
  for (const { cmd, why } of lines) {
    console.log(`  ${c.cyan('$')} ${c.bold(cmd)}`);
    console.log(`    ${c.dim(why)}`);
  }
  console.log('');
}
