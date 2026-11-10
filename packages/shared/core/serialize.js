// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Runs async jobs one at a time, in order. A failed job doesn't block later ones.

/** @returns {(job: () => Promise<any>) => Promise<any>} a queue; each call returns its job's promise */
export function createSerializer() {
  let chain = Promise.resolve();
  return (job) => {
    chain = chain.catch(() => {}).then(job);
    return chain;
  };
}
