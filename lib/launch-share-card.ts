import { launchShareChain, type LaunchShareData } from "./launch-share";

const loadImage = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const img = new Image();
  const timeout = window.setTimeout(() => resolve(null), 5000);
  img.onload = () => { window.clearTimeout(timeout); resolve(img); };
  img.onerror = () => { window.clearTimeout(timeout); resolve(null); };
  img.src = src;
});

function lines(context: CanvasRenderingContext2D, text: string, width: number, count: number) {
  const words = text.split(/\s+/), result: string[] = []; let line = "";
  for (const word of words) {
    if (line && context.measureText(`${line} ${word}`).width > width) { result.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  const selected = result.slice(0, count);
  for (let i = 0; i < selected.length; i++) {
    const truncated = i === count - 1 && result.length > count;
    const chars = Array.from(selected[i]);
    if (truncated || context.measureText(selected[i]).width > width) {
      while (chars.length && context.measureText(chars.join("") + "…").width > width) chars.pop();
      selected[i] = chars.join("").trimEnd() + "…";
    }
  }
  return selected;
}

/** Only same-origin brand art and server-validated raster data enter this canvas. */
export async function renderLaunchShareCard(data: LaunchShareData): Promise<Blob> {
  await document.fonts.ready;
  const [logo, brand] = await Promise.all([
    data.imageDataUrl ? loadImage(data.imageDataUrl) : Promise.resolve(null),
    loadImage("/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"),
  ]);
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Image creation is unavailable in this browser.");
  const font = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = "#141515"; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = "#1e2020"; ctx.beginPath(); ctx.roundRect(24, 24, 1152, 582, 32); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1; ctx.stroke();
  if (brand) ctx.drawImage(brand, 64, 59, 30, 40);
  ctx.fillStyle = "#eeeae2"; ctx.font = `500 24px ${font}`;
  ctx.fillText("Programmable", brand ? 108 : 64, 89);
  ctx.font = `400 23px ${font}`; ctx.fillStyle = "#b3b6b4"; ctx.textAlign = "right";
  ctx.fillText(launchShareChain(data.chainId), 1136, 89); ctx.textAlign = "left";

  ctx.save(); ctx.beginPath(); ctx.roundRect(64, 166, 152, 152, 30); ctx.clip();
  ctx.fillStyle = "#343737"; ctx.fillRect(64, 166, 152, 152);
  if (logo) {
    const ratio = Math.max(152 / logo.naturalWidth, 152 / logo.naturalHeight);
    const w = logo.naturalWidth * ratio, h = logo.naturalHeight * ratio;
    ctx.drawImage(logo, 64 + (152 - w) / 2, 166 + (152 - h) / 2, w, h);
  } else {
    ctx.font = `600 58px ${font}`; ctx.fillStyle = "#eeeae2"; ctx.textAlign = "center";
    ctx.fillText(Array.from(data.symbol || data.name).slice(0, 2).join("").toUpperCase(), 140, 264); ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.font = `500 64px ${font}`; ctx.fillStyle = "#eeeae2";
  const nameLines = lines(ctx, data.name, 876, 2);
  nameLines.forEach((line, index) => ctx.fillText(line, 252, 218 + index * 72));
  ctx.font = `400 27px ${font}`; ctx.fillStyle = "#b3b6b4";
  if (data.symbol) ctx.fillText(data.symbol, 254, nameLines.length > 1 ? 334 : 266);
  ctx.fillStyle = "#eeeae2"; ctx.font = `500 34px ${font}`;
  ctx.fillText("Live on Programmable", 64, 405);
  if (data.description) { ctx.fillStyle = "#b3b6b4"; ctx.font = `400 22px ${font}`;
    lines(ctx, data.description, 1040, 2).forEach((line, index) => ctx.fillText(line, 64, 448 + index * 29));
  }
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.beginPath(); ctx.moveTo(64, 515); ctx.lineTo(1136, 515); ctx.stroke();
  ctx.fillStyle = "#b3b6b4"; ctx.font = '400 16px monospace';
  ctx.fillText(data.href.replace(/^https:\/\//, ""), 64, 560);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The image could not be saved.")), "image/png"));
}
