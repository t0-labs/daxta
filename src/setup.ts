import { flush, install } from './recorder';

install();

declare const afterAll: (fn: () => void) => void;

afterAll(() => {
  flush();
});
