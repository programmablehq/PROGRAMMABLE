import { canvasToWebp, loadPhoto } from "../token-image";
import {
  getAvatarDimensionsError,
  getAvatarFileError,
  isSafeAvatarDataUrl,
} from "./local-profile";

const avatarOutputSize = 512;
const bannerMaximumDimension = 1800;

async function canvasDataUrl(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const blob = await canvasToWebp(canvas, context);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be prepared"));
    reader.readAsDataURL(blob);
  });
}

export async function prepareAvatarImage(file: File) {
  const fileError = getAvatarFileError(file);
  if (fileError) throw new Error(fileError);

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadPhoto(objectUrl, /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name));
    const dimensionsError = getAvatarDimensionsError(
      image.naturalWidth,
      image.naturalHeight,
    );
    if (dimensionsError) throw new Error(dimensionsError);

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = avatarOutputSize;
    canvas.height = avatarOutputSize;

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
      avatarOutputSize,
      avatarOutputSize,
    );

    const dataUrl = await canvasDataUrl(canvas, context);
    if (!isSafeAvatarDataUrl(dataUrl)) {
      throw new Error("The prepared image is too large to store");
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareProfileBannerImage(file: File) {
  const fileError = getAvatarFileError(file);
  if (fileError) throw new Error(fileError);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadPhoto(objectUrl, /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name));
    const dimensionsError = getAvatarDimensionsError(
      image.naturalWidth,
      image.naturalHeight,
    );
    if (dimensionsError) throw new Error(dimensionsError);

    const scale = Math.min(
      1,
      bannerMaximumDimension /
        Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = await canvasDataUrl(canvas, context);
    if (!isSafeAvatarDataUrl(dataUrl)) {
      throw new Error("The prepared banner is too large to store");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
