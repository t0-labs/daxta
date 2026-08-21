import { clearWorkerHits } from '../recorder';

export default async function daxtaGlobalSetup(): Promise<void> {
  clearWorkerHits();
}
