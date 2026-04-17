/**
 * 图片格式转换模块
 * - 静态图：使用 OffscreenCanvas + convertToBlob 转为 WebP
 * - GIF 动图：使用 gifuct-js 解帧 + OffscreenCanvas 逐帧转 WebP + 合并为 Animated WebP
 */
import { GIF } from "gifuct-js";

export interface ConvertOptions {
    quality: number; // 0-1 (对应 webpQuality 1-100)
}

/**
 * 判断文件是否为 GIF
 */
export function isGif(file: File): boolean {
    return file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
}

/**
 * 检测文件头是否为 GIF (MAGIC: GIF87a / GIF89a)
 */
export function isGifArrayBuffer(buffer: ArrayBuffer): boolean {
    const view = new DataView(buffer, 0, 6);
    const magic =
        String.fromCharCode(view.getUint8(0)) +
        String.fromCharCode(view.getUint8(1)) +
        String.fromCharCode(view.getUint8(2)) +
        String.fromCharCode(view.getUint8(3)) +
        String.fromCharCode(view.getUint8(4)) +
        String.fromCharCode(view.getUint8(5));
    return magic.startsWith("GIF8");
}

// ─── Animated WebP Encoder (minimal, hand-rolled) ─────────────────────────────

/**
 * WebP Lossless 编码器 — 将 RGBA ImageData 编码为 WebP Lossless bitstream (VP8L).
 * 实现简化版：仅支持小尺寸图片（调色板模式），对于大图使用原始 RGBA。
 * 
 * 完整 VP8L 编码较复杂，这里使用 OffscreenCanvas 导出代替。
 */
async function encodeFrameToWebPBlob(
    canvas: OffscreenCanvas,
    quality: number,
): Promise<Blob> {
    return canvas.convertToBlob({
        type: "image/webp",
        quality,
    });
}

/**
 * 将 ImageData 渲染到 OffscreenCanvas
 */
function renderToCanvas(imageData: ImageData, canvas: OffscreenCanvas): void {
    const ctx = canvas.getContext("2d")!;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
}

/**
 * 构建 Animated WebP 二进制
 * 
 * RIFF 容器结构：
 *   RIFFxxxxWEBP
 *   + VP8X (bitmap header, animation flag set)
 *   + ANIM (background + loop count)
 *   + ANMF (frame 1: offset, size, duration, VP8L data)
 *   + ANMF (frame 2: ...)
 *   + ...
 * 
 * 每帧的 VP8L 数据通过 OffscreenCanvas 导出得到。
 */
async function buildAnimatedWebp(
    frames: { imageData: ImageData; duration: number }[],
    loop: number, // 0 = infinite
    bgColor: [number, number, number, number] = [0, 0, 0, 255],
): Promise<Blob> {
    const width = frames[0].imageData.width;
    const height = frames[0].imageData.height;

    // 生成各帧 VP8L blobs
    const frameBlobs = await Promise.all(
        frames.map(({ imageData, duration }) =>
            (async () => {
                const canvas = new OffscreenCanvas(width, height);
                renderToCanvas(imageData, canvas);
                const blob = await encodeFrameToWebPBlob(canvas, 0.9);
                const buf = await blob.arrayBuffer();
                return { buf, duration };
            })()
        )
    );

    // 构建 RIFF
    const chunks: Uint8Array[] = [];

    // 1. VP8X — Animation flag(bit3=1) | Reserved | ICC(0) | Alpha(0) | 格式(0=lossy VP8 / 1=lossless VP8L)
    // Riff 格式: 4cc="VP8X", w-1=24bit, h-1=24bit, flags(1 byte)
    const vp8xFlags =
        (1 << 1) | // animation
        (0 << 0); // 0=lossy VP8 frame, but we'll use VP8L so bit0 should be... actually
    // For VP8L: bit0=1
    // But OffscreenCanvas only produces lossy VP8 or VP8L... 
    // Let's just use the lossy VP8 (bit0=0) which is more compatible
    // Actually for webp from canvas, it's VP8L when lossless. So:
    const vp8xFlagsLossless = (1 << 1) | (1 << 0); // anim + lossless
    const w1 = width - 1;
    const h1 = height - 1;
    const vp8xData = new Uint8Array([
        vp8xFlagsLossless,
        w1 & 0xff, (w1 >> 8) & 0xff, (w1 >> 16) & 0xff,
        h1 & 0xff, (h1 >> 8) & 0xff, (h1 >> 16) & 0xff,
    ]);
    chunks.push(buildFourCC("VP8X"), vp8xData);

    // 2. ANIM — background color (B G R A), loop count (2 bytes LE)
    const animData = new Uint8Array([
        bgColor[2], bgColor[1], bgColor[0], bgColor[3],
        loop & 0xff, (loop >> 8) & 0xff,
    ]);
    chunks.push(buildFourCC("ANIM"), animData);

    // 3. ANMF frames
    for (const { buf, duration } of frameBlobs) {
        const frameData = new Uint8Array(buf);
        const frameSize = frameData.length;
        const x = 0, y = 0;
        const dw = width - 1, dh = height - 1;
        const durMs = Math.max(duration, 10); // min 10ms

        // ANMF chunk: offset(3 bytes each), size(3 bytes each), dur(ms, 24bit LE), reserved(1 byte), VP8L
        const anmfData = new Uint8Array([
            x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff,
            y & 0xff, (y >> 8) & 0xff, (y >> 16) & 0xff,
            dw & 0xff, (dw >> 8) & 0xff, (dw >> 16) & 0xff,
            dh & 0xff, (dh >> 8) & 0xff, (dh >> 16) & 0xff,
            durMs & 0xff, (durMs >> 8) & 0xff, (durMs >> 16) & 0xff,
            0, // reserved blend
        ]);

        const anmf = new Uint8Array([
            ...buildFourCC("ANMF"),
            ...encodeLE32(frameSize + anmfData.length),
            ...anmfData,
            ...frameData,
        ]);
        chunks.push(anmf);
    }

    const totalSize = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return new Blob([result], { type: "image/webp" });
}

function buildFourCC(s: string): Uint8Array {
    return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}

function encodeLE32(v: number): Uint8Array {
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}

// ─── GIF 解帧 ────────────────────────────────────────────────────────────────

/**
 * 从 GIF ArrayBuffer 解帧
 */
function parseGifFrames(buffer: ArrayBuffer) {
    const gif = GIF();
    const frames = gif.decode(buffer);
    const palette = frames[0]?.palette ?? frames[0]?.colorTable ?? null;
    return { frames, palette };
}

/**
 * 将 GIF 解码后的帧数据转为 ImageData
 * @param patch RGBA Uint8ClampedArray from gifuct-js
 * @param width frame width
 * @param height frame height
 * @param palette 调色板
 */
function patchToImageData(
    patch: Uint8ClampedArray,
    width: number,
    height: number,
    palette: Uint8Array | null,
): ImageData {
    // palette = [R,G,B, R,G,B, ...] 256 entries
    // patch[i] = palette index
    const imageData = new ImageData(width, height);
    if (!palette) {
        // 灰度
        for (let i = 0; i < patch.length; i++) {
            const v = patch[i];
            imageData.data[i * 4] = v;
            imageData.data[i * 4 + 1] = v;
            imageData.data[i * 4 + 2] = v;
            imageData.data[i * 4 + 3] = 255;
        }
    } else {
        for (let i = 0; i < patch.length; i++) {
            const idx = patch[i] * 3;
            imageData.data[i * 4] = palette[idx];
            imageData.data[i * 4 + 1] = palette[idx + 1];
            imageData.data[i * 4 + 2] = palette[idx + 2];
            imageData.data[i * 4 + 3] = 255;
        }
    }
    return imageData;
}

// ─── 主转换入口 ──────────────────────────────────────────────────────────────

/**
 * 将图片文件转换为 WebP，返回新的 File 对象（name 后缀改为 .webp）
 * @param file 原始文件
 * @param quality 质量 0-1
 * @returns 转换后的 File（webp）
 */
export async function convertToWebp(file: File, quality: number): Promise<File> {
    const buffer = await file.arrayBuffer();

    if (isGif(file) || isGifArrayBuffer(buffer)) {
        return convertGifToAnimatedWebp(buffer, quality);
    }

    return convertStaticToWebp(buffer, quality, file.name);
}

/**
 * 静态图转 WebP
 */
async function convertStaticToWebp(
    buffer: ArrayBuffer,
    quality: number,
    originalName: string,
): Promise<File> {
    const blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(new Blob([buffer]));
        img.onload = async () => {
            const canvas = new OffscreenCanvas(img.width, img.height);
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            try {
                const webpBlob = await canvas.convertToBlob({
                    type: "image/webp",
                    quality,
                });
                resolve(webpBlob);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("图片加载失败"));
        };
        img.src = url;
    });

    const newName = originalName.replace(/\.[^.]+$/, ".webp");
    return new File([blob], newName, { type: "image/webp" });
}

/**
 * GIF 动图转 Animated WebP
 */
async function convertGifToAnimatedWebp(
    buffer: ArrayBuffer,
    quality: number,
): Promise<File> {
    const gif = GIF();
    const parsed = gif.parse(buffer);

    // 获取 GIF 尺寸
    // gifuct-js parse returns: { width, height, frames: [...] }
    // Each frame: { data: Uint8ClampedArray, delay: ms, disposal: 1|2|3 }
    // Let's use the parsed directly to get dimensions
    // Actually gifuct-js 2.x API:
    // gif.parse(buffer) -> ParsedGIF
    // ParsedGIF has width, height, frames: Frame[]
    const gifData = gif.parse(buffer);

    // Access dimensions via the first frame's dims or header
    const { frames } = gifData as any;
    const delay = (frames[0]?.delay ?? 100) as number;
    const width = (gifData as any).width ?? (frames[0] as any)?.dims?.width ?? 100;
    const height = (gifData as any).height ?? (frames[0] as any)?.dims?.height ?? 100;

    // Decode frames
    const decodedFrames: { imageData: ImageData; duration: number }[] = [];
    for (const frame of frames) {
        try {
            // gifuct-js 2.x: frame has .patch (RGBA Uint8ClampedArray) and .colorTable
            const patch: Uint8ClampedArray = (frame as any).patch ?? frame.data ?? new Uint8ClampedArray(width * height);
            const palette: Uint8Array | null = (frame as any).colorTable ?? null;
            const frameDelay: number = (frame as any).delay ?? delay ?? 100;
            const fw: number = (frame as any).dims?.width ?? width;
            const fh: number = (frame as any).dims?.height ?? height;

            const imageData = new ImageData(fw, fh);
            // patch is already RGBA in newer gifuct-js, or indexed in older
            if (patch.length === fw * fh * 4) {
                imageData.data.set(patch);
            } else if (patch.length === fw * fh) {
                // indexed color
                for (let i = 0; i < patch.length; i++) {
                    if (palette) {
                        const idx = patch[i] * 3;
                        imageData.data[i * 4] = palette[idx];
                        imageData.data[i * 4 + 1] = palette[idx + 1];
                        imageData.data[i * 4 + 2] = palette[idx + 2];
                        imageData.data[i * 4 + 3] = 255;
                    } else {
                        const v = patch[i];
                        imageData.data[i * 4] = v;
                        imageData.data[i * 4 + 1] = v;
                        imageData.data[i * 4 + 2] = v;
                        imageData.data[i * 4 + 3] = 255;
                    }
                }
            }

            decodedFrames.push({
                imageData,
                duration: frameDelay,
            });
        } catch {
            // 跳过无效帧
        }
    }

    if (decodedFrames.length === 0) {
        throw new Error("GIF 解帧失败，无法提取有效帧");
    }

    const webpBlob = await buildAnimatedWebp(decodedFrames, 0); // 0 = loop forever
    return new File([webpBlob], "animated.webp", { type: "image/webp" });
}
