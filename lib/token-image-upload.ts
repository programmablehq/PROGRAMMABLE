export const TOKEN_IMAGE_UPLOAD_TIMEOUT_MS = 30_000;

/** Bound image requests and login reads, including transports that ignore cancellation. */
export function withTokenImageUploadDeadline<T>(upload: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  let rejectAborted: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error("The image upload timed out. Your image is kept. Try again.")), TOKEN_IMAGE_UPLOAD_TIMEOUT_MS);
  return Promise.race([
    Promise.resolve().then(() => { controller.signal.throwIfAborted(); return upload(controller.signal); }),
    aborted,
  ]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAborted);
  });
}
