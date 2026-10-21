/** Drain ready groups first, then await only the groups still being scanned.
 * A failure stops that chain, while the other chain can still be claimed. */
export async function runClaimQueue<T>(groups: T[], actions: {
  scanning: (group: T) => boolean;
  wait: (group: T) => Promise<unknown>;
  eligible: (group: T) => boolean;
  chain: (group: T) => number;
  claim: (group: T) => Promise<unknown>;
  failed: (group: T) => boolean;
}) {
  const remaining = [...groups], blocked = new Set<number>();
  while (remaining.length) {
    let index = remaining.findIndex(group => !actions.scanning(group));
    if (index < 0) {
      await Promise.race(remaining.map(group => actions.wait(group)));
      continue;
    }
    const group = remaining.splice(index, 1)[0]!;
    if (!blocked.has(actions.chain(group)) && actions.eligible(group)) {
      await actions.claim(group);
      if (actions.failed(group)) blocked.add(actions.chain(group));
    }
  }
}
