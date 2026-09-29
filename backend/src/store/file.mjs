// Local development store: one JSON file. Writes are serialized in-process and
// carry a version number, like the DynamoDB store, so the app's retry logic is exercised locally.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { ConflictError } from './conflict.mjs';

export function fileStore(path) {
  let chain = Promise.resolve();
  const serialize = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  async function read() {
    try {
      const doc = JSON.parse(await readFile(path, 'utf8'));
      return { state: doc.state, version: doc.version };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  return {
    load: () => serialize(read),
    save: (state, expectedVersion) =>
      serialize(async () => {
        const current = await read();
        const currentVersion = current ? current.version : 0;
        if (currentVersion !== expectedVersion) {
          throw new ConflictError(`expected version ${expectedVersion}, found ${currentVersion}`);
        }
        const version = currentVersion + 1;
        const tmp = `${path}.tmp`;
        await writeFile(tmp, JSON.stringify({ version, state }, null, 2));
        await rename(tmp, path);
        return version;
      }),
  };
}
