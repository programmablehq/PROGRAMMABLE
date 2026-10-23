export async function settleSequentially<TInput, TOutput>(
  inputs: readonly TInput[],
  read: (input: TInput) => Promise<TOutput>,
): Promise<PromiseSettledResult<TOutput>[]> {
  const results: PromiseSettledResult<TOutput>[] = [];
  for (const input of inputs) {
    try {
      results.push({ status: "fulfilled", value: await read(input) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}
