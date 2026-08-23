/**
 * Side-effect entry: `node -r @t0.labs/daxta/register`
 * Prefer injecting `apiDocs(app)` into main.ts via `daxta install`.
 */
import { apiDocs } from './serve/middleware';

type NestFactoryLike = {
  create: (...args: unknown[]) => Promise<{ use: (...handlers: unknown[]) => unknown }>;
  __daxtaPatched?: boolean;
};

function patchNestFactory(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require('@nestjs/core') as { NestFactory?: NestFactoryLike };
    const nestFactory = core.NestFactory;
    if (!nestFactory?.create || nestFactory.__daxtaPatched) return;
    nestFactory.__daxtaPatched = true;
    const originalCreate = nestFactory.create.bind(nestFactory);
    nestFactory.create = async (...args: unknown[]) => {
      const app = await originalCreate(...args);
      apiDocs(app);
      return app;
    };
  } catch {
    // @nestjs/core not available in this process
  }
}

patchNestFactory();
