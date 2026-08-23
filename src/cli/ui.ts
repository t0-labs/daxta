import { createInterface } from 'readline';

const isTTY = Boolean(process.stdout.isTTY);
const useColor = isTTY && !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0';
const truecolor = useColor && Boolean(process.env.COLORTERM || process.env.TERM_PROGRAM);

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};

function paint(code: string, text: string): string {
  if (!useColor) return text;
  return `${code}${text}${ansi.reset}`;
}

function rgb(r: number, g: number, b: number, text: string): string {
  if (!useColor) return text;
  if (!truecolor) return paint(ansi.cyan, text);
  return `\x1b[38;2;${r};${g};${b}m${text}${ansi.reset}`;
}

/** Viewer-adjacent palette: ice, gold, mint, stone. */
export const tone = {
  ice: (t: string) => rgb(125, 211, 252, t),
  gold: (t: string) => rgb(232, 192, 122, t),
  mint: (t: string) => rgb(52, 211, 153, t),
  rose: (t: string) => rgb(251, 113, 133, t),
  mist: (t: string) => rgb(148, 163, 184, t),
  paper: (t: string) => rgb(248, 250, 252, t),
};

export const c = {
  bold: (t: string) => paint(ansi.bold, t),
  dim: (t: string) => paint(ansi.dim, t),
  cyan: (t: string) => paint(ansi.cyan, t),
  green: (t: string) => paint(ansi.green, t),
  yellow: (t: string) => paint(ansi.yellow, t),
  magenta: (t: string) => paint(ansi.magenta, t),
  red: (t: string) => paint(ansi.red, t),
  ice: tone.ice,
  gold: tone.gold,
  mint: tone.mint,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bar(done: number, total: number, width = 16): string {
  const n = Math.max(1, total);
  const filled = Math.round((done / n) * width);
  const on = '━'.repeat(Math.max(0, filled));
  const off = '─'.repeat(Math.max(0, width - filled));
  return `${tone.ice(on)}${c.dim(off)}`;
}

export function divider(width = 52): void {
  console.log(`  ${c.dim('─'.repeat(width))}`);
}

export function splash(options: { version: string; project: string; dryRun?: boolean }): void {
  const title = 'DAxTA';
  const tag = 'Tested behavior. Trusted API docs.';
  const meta = `v${options.version}  ·  ${options.project}${options.dryRun ? '  ·  dry-run' : ''}`;
  const inner = 50;
  const pad = (s: string) => s + ' '.repeat(Math.max(0, inner - s.length));
  const top = `  ${c.dim('╭' + '─'.repeat(inner + 2) + '╮')}`;
  const bot = `  ${c.dim('╰' + '─'.repeat(inner + 2) + '╯')}`;
  const row = (body: string) => `  ${c.dim('│')} ${body}${c.dim(' │')}`;
  console.log('');
  console.log(top);
  console.log(row(c.bold(tone.ice(pad(title)))));
  console.log(row(tone.mist(pad(tag))));
  console.log(row(c.dim(pad(meta))));
  console.log(bot);
  console.log('');
}

export function banner(title: string, subtitle?: string): void {
  console.log('');
  console.log(`  ${tone.ice('◆')}  ${c.bold(title)}${subtitle ? tone.mist(`   ${subtitle}`) : ''}`);
  divider(Math.min(52, Math.max(32, title.length + 12)));
}

export function phase(index: number, total: number, label: string, hint?: string): void {
  console.log('');
  const mark = String(index).padStart(2, '0');
  console.log(
    `  ${tone.gold(mark)}${c.dim(`/${String(total).padStart(2, '0')}`)}  ${bar(index, total)}  ${c.bold(label)}`,
  );
  if (hint) console.log(`           ${tone.mist(hint)}`);
  console.log('');
}

export function askLine(label: string, hint?: string): string {
  const q = `${tone.gold('?')}  ${c.bold(label)}${hint ? tone.mist(`  —  ${hint}`) : ''}`;
  return `  ${q}\n  ${tone.ice('›')} `;
}

export function readlineAsk(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export type StepResult = string | { summary: string; details?: string[] } | void;

export async function step(
  label: string,
  work: () => StepResult | Promise<StepResult>,
  options: { paceMs?: number; spinner?: boolean; n?: number; of?: number } = {},
): Promise<void> {
  const paceMs = options.paceMs ?? 0;
  const useSpinner = options.spinner !== false && isTTY;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let timer: NodeJS.Timeout | undefined;
  const prefix =
    options.n != null && options.of != null
      ? `${c.dim(String(options.n).padStart(2, ' ') + '/' + options.of)}  `
      : '    ';

  if (useSpinner) {
    process.stdout.write(`  ${prefix}${tone.ice(frames[0])}  ${label}`);
    timer = setInterval(() => {
      i = (i + 1) % frames.length;
      process.stdout.write(`\r  ${prefix}${tone.ice(frames[i])}  ${label}`);
    }, 70);
  } else {
    console.log(`  ${prefix}${tone.ice('▸')}  ${label}`);
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

    const line = summary ? `${label}  ${tone.mist(summary)}` : label;
    const ok = `${prefix}${tone.mint('✔')}  ${line}`;
    if (useSpinner) process.stdout.write(`\r  ${ok}${' '.repeat(16)}\n`);
    else console.log(`  ${ok}`);

    for (const d of details) {
      console.log(`        ${c.dim('·')} ${d}`);
    }

    if (paceMs > 0) await sleep(paceMs);
  } catch (error) {
    if (timer) clearInterval(timer);
    const msg = error instanceof Error ? error.message : String(error);
    const fail = `${prefix}${tone.rose('✖')}  ${label}  ${c.red(msg)}`;
    if (useSpinner) process.stdout.write(`\r  ${fail}${' '.repeat(8)}\n`);
    else console.log(`  ${fail}`);
    throw error;
  }
}

export function box(title: string, lines: string[]): void {
  const width = 58;
  console.log('');
  console.log(`  ${c.dim('╭' + '─'.repeat(width) + '╮')}`);
  console.log(`  ${c.dim('│')} ${c.bold(tone.mint(title.padEnd(width - 1)))}${c.dim('│')}`);
  console.log(`  ${c.dim('│' + ' '.repeat(width) + '│')}`);
  for (const line of lines) {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - 1 - visible.length);
    console.log(`  ${c.dim('│')} ${line}${' '.repeat(pad)}${c.dim('│')}`);
  }
  console.log(`  ${c.dim('╰' + '─'.repeat(width) + '╯')}`);
  console.log('');
}

export function nextSteps(lines: Array<{ cmd: string; why: string }>): void {
  console.log(`  ${c.bold(tone.ice('Next'))}`);
  console.log('');
  lines.forEach((item, index) => {
    console.log(`  ${tone.gold(String(index + 1) + '.')}  ${c.bold('$')} ${c.bold(item.cmd)}`);
    console.log(`      ${tone.mist(item.why)}`);
    console.log('');
  });
}
