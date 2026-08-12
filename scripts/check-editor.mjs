/**
 * Browser check for the editor's layer alignment.
 *
 * The editor draws coloured text and line numbers *behind* a transparent
 * textarea. Whether those layers sit exactly under the caret is a rendering
 * property: no amount of reading the source proves it, and `npm test` has no
 * browser. This does, when Playwright happens to be available.
 *
 * It exists because a real bug got through: the layers were kept in step by
 * setting their `scrollTop`, which the browser clamps to each element's own
 * `scrollHeight - clientHeight`. A classic scrollbar - the kind Windows draws,
 * which takes up layout space, unlike the overlay scrollbars headless Linux
 * uses - makes the textarea's client box shorter than the layers'. The textarea
 * could then scroll ~15px further than they could follow, and near the bottom
 * of a long file the caret sat most of a line away from its own text.
 *
 * So the check runs twice: once as headless Linux renders it, and once with the
 * textarea deliberately shortened to reproduce the Windows geometry.
 *
 *   npm run check:editor
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('· Playwright is not installed - skipping the editor rendering check.');
  process.exit(0);
}

/** The bundled Chromium this environment provides, if there is one. */
function browserPath() {
  for (const candidate of ['/opt/pw-browsers/chromium', process.env.PULSEIR_CHROMIUM]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

let browser;
try {
  browser = await chromium.launch({ executablePath: browserPath() });
} catch (error) {
  console.log(`· No usable Chromium - skipping the editor rendering check.\n  ${error.message.split('\n')[0]}`);
  process.exit(0);
}

/** Anything above this is a real misalignment; below it is sub-pixel rounding. */
const TOLERANCE = 0.5;

const url = `file://${path.join(repoRoot, 'web/index.html')}`;
let failures = 0;

for (const shrink of [0, 15]) {
  const label = shrink === 0 ? 'overlay scrollbars' : 'classic scrollbars (Windows)';
  const page = await browser.newPage({ viewport: { width: 700, height: 680 } });
  page.on('dialog', dialog => dialog.accept('check'));
  page.on('pageerror', error => {
    console.error(`✗ ${label}: page threw ${error.message}`);
    failures++;
  });

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForTimeout(300);

  // A multi-file model with lines long enough to scroll in both directions.
  await page.selectOption('#example', { index: 8 });
  await page.waitForTimeout(500);
  await page.click('.filetab:has-text("hardware.yaml")').catch(() => {});
  await page.waitForTimeout(300);

  // Reproduce a scrollbar that consumes layout space from the textarea only.
  if (shrink) await page.addStyleTag({ content: `#source { height: calc(100% - ${shrink}px); }` });
  await page.waitForTimeout(200);

  const worst = await page.evaluate(() => {
    const ta = document.getElementById('source');
    const gutter = document.getElementById('gutter');
    const code = document.getElementById('highlight-code');
    const lines = document.getElementById('gutter-lines');
    const cs = getComputedStyle(ta);
    const lineHeight = parseFloat(cs.lineHeight);
    const padTop = parseFloat(cs.paddingTop);
    const offset = el => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { x: m.e, y: m.f };
    };

    let worst = { drift: 0, at: 0, what: 'none' };
    const note = (drift, at, what) => {
      if (Math.abs(drift) > Math.abs(worst.drift)) worst = { drift, at, what };
    };

    // Every corner of the scroll range, the bottom especially.
    for (const wantY of [0, 1, 100, 337, 1e6]) {
      for (const wantX of [0, 1e6]) {
        ta.scrollTop = wantY;
        ta.scrollLeft = wantX;
        ta.dispatchEvent(new Event('scroll'));

        const { scrollTop, scrollLeft } = ta;
        note(offset(code).y + scrollTop, scrollTop, 'colour layer vertical');
        note(offset(code).x + scrollLeft, scrollTop, 'colour layer horizontal');
        note(offset(lines).y + scrollTop, scrollTop, 'gutter vertical');

        // The gutter must not follow horizontally: numbers stay put.
        note(offset(lines).x, scrollTop, 'gutter moved sideways');

        // And line 10 must render where the caret would put it.
        const expected = ta.getBoundingClientRect().top + padTop + 9 * lineHeight - scrollTop;
        const actual = gutter.querySelectorAll('.ln')[9]?.getBoundingClientRect().top;
        if (actual !== undefined) note(actual - expected, scrollTop, 'rendered line 10');
      }
    }
    return worst;
  });

  const drift = Math.round(worst.drift * 100) / 100;
  if (Math.abs(drift) > TOLERANCE) {
    console.error(`✗ ${label}: ${worst.what} is off by ${drift}px at scrollTop ${worst.at}`);
    failures++;
  } else {
    console.log(`✓ ${label}: layers stay within ${Math.abs(drift)}px of the caret`);
  }

  await page.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\n❌ the editor's layers drift from the text`);
  process.exit(1);
}

console.log('\n✨ Editor rendering check passed!');
