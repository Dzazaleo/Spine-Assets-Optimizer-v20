
import { GlobalAssetStat, OptimizationTask } from '../types';
import JSZip from 'jszip';

/**
 * Calculates which files need optimization based on aggregated global statistics.
 */
export function calculateOptimizationTargets(
  stats: GlobalAssetStat[], 
  loadedImages: Map<string, { width: number, height: number, sourceWidth?: number, sourceHeight?: number, file: File, originalPath: string }>,
  bufferPercentage: number = 0
): OptimizationTask[] {
  
  const statsMap = new Map<string, GlobalAssetStat>();
  stats.forEach(s => statsMap.set(s.lookupKey, s));

  const tasks: OptimizationTask[] = [];

  loadedImages.forEach((original, key) => {
    const stat = statsMap.get(key);
    if (!stat) return;
    
    const physicalW = original.sourceWidth ?? original.width;
    const physicalH = original.sourceHeight ?? original.height;

    let calculatedW: number;
    let calculatedH: number;
    
    if (stat.isOverridden) {
        calculatedW = stat.maxRenderWidth;
        calculatedH = stat.maxRenderHeight;
    } else {
        const bufferMultiplier = 1 + (bufferPercentage / 100);
        calculatedW = Math.ceil(stat.maxRenderWidth * bufferMultiplier);
        calculatedH = Math.ceil(stat.maxRenderHeight * bufferMultiplier);
    }

    let targetW = Math.min(calculatedW, physicalW);
    let targetH = Math.min(calculatedH, physicalH);
    
    targetW = Math.max(1, targetW);
    targetH = Math.max(1, targetH);
    
    const isResize = targetW !== physicalW || targetH !== physicalH;
    const sourcePath = original.originalPath;
    const lastSlashIndex = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
    const lastDotIndex = sourcePath.lastIndexOf('.');
    
    let basePath = sourcePath;
    if (lastDotIndex > lastSlashIndex) {
        basePath = sourcePath.substring(0, lastDotIndex);
    }
        
    const outputFileName = `${basePath}.png`;

    tasks.push({
      fileName: outputFileName,
      relativePath: original.originalPath,
      originalWidth: physicalW,
      originalHeight: physicalH,
      targetWidth: targetW,
      targetHeight: targetH,
      blob: original.file,
      maxScaleUsed: Math.max(stat.maxScaleX, stat.maxScaleY),
      isResize: isResize,
      overridePercentage: stat.overridePercentage
    });
  });

  // Group 1 (Top): Assets being resized (isResize: true)
  // Group 2 (Bottom): Assets being saved as copies (isResize: false)
  // Sorted alphabetically by fileName within groups
  tasks.sort((a, b) => {
    if (a.isResize !== b.isResize) {
      return a.isResize ? -1 : 1;
    }
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
  });

  return tasks;
}

// 1. HELPER: Import Raw Bytes (Bypass Canvas 2D Color Management)
function getRawBytesViaWebGL(img: ImageBitmap, width: number, height: number): Uint8Array | null {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false }) as WebGL2RenderingContext;
  if (!gl) return null;

  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as unknown as TexImageSource);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const data = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  
  gl.deleteTexture(tex);
  gl.deleteFramebuffer(fb);
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  return data;
}

// 2. HELPER: Export Raw Bytes (Pass-Through with Y-Flip)
function exportBytesViaWebGL(data: Uint8ClampedArray, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false }) as WebGL2RenderingContext;
  if (!gl) return Promise.resolve(null);

  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, `
    attribute vec2 p;
    varying vec2 v;
    void main() {
        v = p * 0.5 + 0.5;
        v.y = 1.0 - v.y; // Flip Y
        gl_Position = vec4(p, 0, 1);
    }
  `);
  gl.compileShader(vs);
  
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, `
    precision mediump float;
    varying vec2 v;
    uniform sampler2D t;
    void main() {
        gl_FragColor = texture2D(t, v);
    }
  `);
  gl.compileShader(fs);

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  return new Promise(r => canvas.toBlob(b => {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      r(b);
  }, 'image/png'));
}

// 3. MAIN: Alpha-Aware Ultra-Fidelity Pipeline
export async function resizeImage(
    blob: Blob, 
    targetWidth: number, 
    targetHeight: number, 
    isSourcePremultiplied: boolean = true 
): Promise<Blob | null> {
    try {
        const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        
        // A. Import Raw
        const rawData = getRawBytesViaWebGL(img, img.width, img.height);
        if(!rawData) throw new Error("WebGL Import Failed");
        
        let floatSrc = new Float32Array(rawData);
        let srcW = img.width;
        let srcH = img.height;
        img.close();

        // B. AUTO-DETECT ALPHA TYPE
        // If we find pixels where RGB > Alpha, the image CANNOT be Premultiplied.
        // It is likely Straight Alpha with "Glow" data (e.g. A=0, R=255).
        // We must protect this data by NOT premultiplying it.
        let isStraightAlpha = !isSourcePremultiplied;
        
        // Scan a subset of pixels (stride 16 = every 4th pixel) to check for Straight Alpha evidence
        // We look for "Illegal PMA" values (Channel > Alpha)
        if (!isStraightAlpha) {
            for (let i = 0; i < floatSrc.length; i += 16) { 
                const a = floatSrc[i+3];
                // Tolerance of 2.0 to account for noise/compression artifacts
                if (floatSrc[i] > a + 2.0 || floatSrc[i+1] > a + 2.0 || floatSrc[i+2] > a + 2.0) {
                    isStraightAlpha = true;
                    break;
                }
            }
        }

        // C. Float32 Pyramid (Iterative 2x Downscale)
        // Independent Channel Averaging (Safe for both modes)
        while (srcW > targetWidth * 2 && srcH > targetHeight * 2) {
            const nextW = Math.floor(srcW / 2);
            const nextH = Math.floor(srcH / 2);
            const nextBuf = new Float32Array(nextW * nextH * 4);

            for (let y = 0; y < nextH; y++) {
                const row1 = (y * 2) * srcW * 4;
                const row2 = (y * 2 + 1) * srcW * 4;
                const dstRow = y * nextW * 4;
                for (let x = 0; x < nextW; x++) {
                    const col1 = x * 2 * 4;
                    const col2 = (x * 2 + 1) * 4;
                    const i1=row1+col1, i2=row1+col2, i3=row2+col1, i4=row2+col2;
                    
                    // Simple Box Filter (Average)
                    nextBuf[dstRow + x*4]     = (floatSrc[i1] + floatSrc[i2] + floatSrc[i3] + floatSrc[i4]) * 0.25;
                    nextBuf[dstRow + x*4 + 1] = (floatSrc[i1+1] + floatSrc[i2+1] + floatSrc[i3+1] + floatSrc[i4+1]) * 0.25;
                    nextBuf[dstRow + x*4 + 2] = (floatSrc[i1+2] + floatSrc[i2+2] + floatSrc[i3+2] + floatSrc[i4+2]) * 0.25;
                    nextBuf[dstRow + x*4 + 3] = (floatSrc[i1+3] + floatSrc[i2+3] + floatSrc[i3+3] + floatSrc[i4+3]) * 0.25;
                }
            }
            floatSrc = nextBuf; srcW = nextW; srcH = nextH;
        }

        // D. Lanczos3 Resampling
        const tmpBuffer = new Float32Array(targetWidth * srcH * 4);
        const finalData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

        const lanczos = (x: number) => {
            if (x === 0) return 1;
            if (Math.abs(x) >= 3) return 0;
            const px = Math.PI * x;
            return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
        };

        // Pass 1: Horizontal
        const ratioW = srcW / targetWidth;
        for (let x = 0; x < targetWidth; x++) {
            const center = (x + 0.5) * ratioW - 0.5;
            const centerInt = Math.floor(center);
            const weights = new Float32Array(6); const indices = new Int32Array(6);
            let weightSum = 0;
            for(let k=0; k<6; k++) {
                const w = lanczos(center - (centerInt - 2 + k));
                weights[k] = w; weightSum += w;
                indices[k] = Math.min(Math.max(centerInt - 2 + k, 0), srcW - 1);
            }
            if (weightSum !== 0) for(let k=0; k<6; k++) weights[k] /= weightSum;

            for (let y = 0; y < srcH; y++) {
                let r=0,g=0,b=0,a=0;
                const srcRow = y * srcW * 4;
                for(let k=0; k<6; k++) {
                    const w = weights[k]; const off = srcRow + indices[k]*4;
                    r+=floatSrc[off]*w; g+=floatSrc[off+1]*w; b+=floatSrc[off+2]*w; a+=floatSrc[off+3]*w;
                }
                const dstIdx = (y * targetWidth + x) * 4;
                tmpBuffer[dstIdx]=r; tmpBuffer[dstIdx+1]=g; tmpBuffer[dstIdx+2]=b; tmpBuffer[dstIdx+3]=a;
            }
        }

        // Pass 2: Vertical
        const ratioH = srcH / targetHeight;
        for (let y = 0; y < targetHeight; y++) {
             const center = (y + 0.5) * ratioH - 0.5;
             const centerInt = Math.floor(center);
             const weights = new Float32Array(6); const indices = new Int32Array(6);
             let weightSum = 0;
             for(let k=0; k<6; k++) {
                const w = lanczos(center - (centerInt - 2 + k));
                weights[k] = w; weightSum += w;
                indices[k] = Math.min(Math.max(centerInt - 2 + k, 0), srcH - 1);
             }
             if (weightSum !== 0) for(let k=0; k<6; k++) weights[k] /= weightSum;

             for (let x = 0; x < targetWidth; x++) {
                 let r=0,g=0,b=0,a=0;
                 for(let k=0; k<6; k++) {
                     const w = weights[k]; const off = (indices[k] * targetWidth + x) * 4;
                     r+=tmpBuffer[off]*w; g+=tmpBuffer[off+1]*w; b+=tmpBuffer[off+2]*w; a+=tmpBuffer[off+3]*w;
                 }
                 
                 const dstIdx = (y * targetWidth + x) * 4;

                 // E. ALPHA-AWARE POST-PROCESSING
                 let finalR = r; let finalG = g; let finalB = b;
                 
                 if (!isStraightAlpha) {
                     // WORKFLOW A (PMA): 
                     // Clamp RGB <= A. This fixes "Bicubic Ringing" / Halos in PMA.
                     finalR = Math.min(finalR, a);
                     finalG = Math.min(finalG, a);
                     finalB = Math.min(finalB, a);
                 } 
                 // WORKFLOW B (Straight / Additive):
                 // DO NOTHING. Preserves R > A (Glows).
                 // No Unpremultiply needed because we never Premultiplied.

                 // TPDF Dither (Triangular Noise)
                 const dither = Math.random() + Math.random() - 1.0;
                 
                 finalData[dstIdx]   = finalR + dither;
                 finalData[dstIdx+1] = finalG + dither;
                 finalData[dstIdx+2] = finalB + dither;
                 finalData[dstIdx+3] = a + dither;
             }
        }

        return await exportBytesViaWebGL(finalData, targetWidth, targetHeight);

    } catch(e) { console.error("Optimization Error:", e); return null; }
}

export async function generateOptimizedZip(
  tasks: OptimizationTask[], 
  onProgress: (current: number, total: number) => void,
  isSourcePremultiplied: boolean = true
): Promise<Blob> {
  const zip = new JSZip();
  const rootFolder = zip.folder("images_optimized");
  let completed = 0;

  for (const task of tasks) {
    if (!rootFolder) break;
    const zipEntryName = task.fileName;

    if (task.isResize) {
      const resizedBlob = await resizeImage(task.blob, task.targetWidth, task.targetHeight, isSourcePremultiplied);
      if (resizedBlob) {
        rootFolder.file(zipEntryName, resizedBlob);
      } else {
        rootFolder.file(zipEntryName, task.blob);
      }
    } else {
      rootFolder.file(zipEntryName, task.blob);
    }
    
    completed++;
    onProgress(completed, tasks.length);
  }

  return await zip.generateAsync({ type: "blob" });
}

// Expose detection logic for UI
export async function detectBatchAlphaMode(blob: Blob): Promise<string> {
    try {
        const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        // Reuse internal helper
        const rawData = getRawBytesViaWebGL(img, img.width, img.height);
        if(!rawData) return 'Premultiplied Alpha (PMA)'; 

        const f = new Float32Array(rawData);
        let isStraight = false;
        
        // Fast Scan (Stride 16)
        for(let i=0; i<f.length; i+=16) {
             const a = f[i+3];
             // Tolerance +2.0 for compression artifacts
             if(f[i] > a+2.0 || f[i+1] > a+2.0 || f[i+2] > a+2.0) {
                 isStraight = true;
                 break;
             }
        }
        img.close();
        return isStraight ? 'Straight Alpha' : 'Premultiplied Alpha (PMA)';
    } catch(e) { return 'Premultiplied Alpha (PMA)'; }
}
