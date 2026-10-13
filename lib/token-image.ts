export const TOKEN_IMAGE_OUTPUT_SIZE = 1_000;
export const MAX_TOKEN_IMAGE_SOURCE_BYTES = 20_000_000;
export const MAX_TOKEN_IMAGE_UPLOAD_BYTES = 1_000_000;
export const PROGRAMMABLE_TOKEN_IMAGE_HOST =
  "k2uoipt9wchjtz3h.public.blob.vercel-storage.com";
export const PROGRAMMABLE_TOKEN_IMAGE_STORE_ID = "store_k2uoiPT9WCHJtz3H";

export type TokenImageUploadResponse = Readonly<Record<string, unknown>>;

const acceptedTokenImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const TOKEN_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export function canOptimizeTokenImage(source: string) {
  return source.startsWith("/") && !source.startsWith("//");
}

export function isProgrammableTokenImageUrl(source: string) {
  try {
    const url = new URL(source);
    return (
      url.protocol === "https:" &&
      url.hostname === PROGRAMMABLE_TOKEN_IMAGE_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith("/token-images/") &&
      url.pathname.endsWith(".webp")
    );
  } catch {
    return false;
  }
}

export function getProgrammableTokenImageAssetName(source: string) {
  if (!isProgrammableTokenImageUrl(source)) return "";
  try {
    const pathname = new URL(source).pathname;
    const assetName = pathname.slice("/token-images/".length);
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.webp$/.test(assetName)
      ? assetName
      : "";
  } catch {
    return "";
  }
}

export function getTokenCardImageSource(source: string) {
  const assetName = getProgrammableTokenImageAssetName(source);
  return assetName
    ? `/api/token-image-proxy/${encodeURIComponent(assetName)}`
    : source;
}

export function applyTokenImageFallback(
  image: HTMLImageElement,
  fallbackSource: string,
) {
  if (image.dataset.tokenImageFallback === "true") return false;
  image.dataset.tokenImageFallback = "true";
  image.alt = "";
  image.removeAttribute("srcset");
  image.src = fallbackSource;
  return true;
}

export function getTokenImageFileError(file: Pick<File, "size" | "type"> & Partial<Pick<File, "name">>) {
  const type = file.type.toLowerCase();
  // Mobile file providers sometimes omit MIME metadata. The image decoder still
  // validates the contents before we produce the WebP checked by the server.
  const knownExtension = /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name ?? "");
  if (!acceptedTokenImageTypes.has(type) && !((!type || type === "application/octet-stream") && knownExtension)) {
    return "Choose a JPG, PNG, WebP or HEIC image";
  }
  if (file.size === 0) return "Choose a non-empty image";
  if (file.size > MAX_TOKEN_IMAGE_SOURCE_BYTES) {
    return "Choose an image smaller than 20 MB";
  }
  return "";
}

export async function readTokenImageUploadResponse(
  response: Response,
): Promise<TokenImageUploadResponse | null> {
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase();
  if (response.redirected || contentType !== "application/json") return null;

  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as TokenImageUploadResponse
      : null;
  } catch {
    return null;
  }
}

export function loadPhoto(source: string, isHeic = false) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    const fail = () => reject(new Error(isHeic
      ? "This browser cannot open this HEIC photo. Choose a JPG or PNG copy."
      : "The image could not be opened. Choose another photo."));
    const timer = window.setTimeout(() => {
      image.onload = image.onerror = null;
      image.src = "";
      fail();
    }, 20_000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); fail(); };
    image.src = source;
  });
}

export async function canvasToWebp(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const native = await new Promise<Blob | null>(resolve => {
    const timer = window.setTimeout(() => resolve(null), 5_000);
    try {
      canvas.toBlob(blob => { clearTimeout(timer); resolve(blob); }, "image/webp", 0.84);
    } catch { clearTimeout(timer); resolve(null); }
  });
  // Safari may silently return PNG for an unsupported canvas encoder. Never
  // relabel those bytes: image receipts bind the actual uploaded WebP digest.
  if (native?.type === "image/webp" && native.size <= MAX_TOKEN_IMAGE_UPLOAD_BYTES) return native;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      import("./token-image-webp").then(({ encodeTokenImageWebp }) =>
        encodeTokenImageWebp(context.getImageData(0, 0, canvas.width, canvas.height))),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Image preparation timed out. Please try again.")), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function prepareTokenImage(file: File) {
  const fileError = getTokenImageFileError(file);
  if (fileError) throw new Error(fileError);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadPhoto(objectUrl, /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name));
    if (image.naturalWidth * image.naturalHeight > 60_000_000) {
      throw new Error("Choose a photo smaller than 60 megapixels");
    }
    if (image.naturalWidth < 256 || image.naturalHeight < 256) {
      throw new Error("Choose an image at least 256 × 256 pixels");
    }

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = TOKEN_IMAGE_OUTPUT_SIZE;
    canvas.height = TOKEN_IMAGE_OUTPUT_SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      TOKEN_IMAGE_OUTPUT_SIZE,
      TOKEN_IMAGE_OUTPUT_SIZE,
    );

    const blob = await canvasToWebp(canvas, context);
    if (blob.size > MAX_TOKEN_IMAGE_UPLOAD_BYTES) {
      throw new Error("The prepared image is still too large");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
