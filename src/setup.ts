import { flushAndRebuild } from './build/incremental';
import { getConfig } from './config';
import { flush, install } from './recorder';

install();

declare const afterAll: (fn: () => void) => void;

afterAll(() => {
  if (getConfig().writeMode === 'incremental') {
    flushAndRebuild({ silent: true, html: true });
    return;
  }
  flush();
});
