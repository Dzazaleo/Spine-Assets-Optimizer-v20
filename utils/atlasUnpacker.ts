
import { AtlasRegion, FileAsset } from '../types';
import { parseAtlas } from './atlasParser';

/**
 * Unpacks sprites from Spine atlas pages into individual image blobs.
 * Uses WebGL2 to perform cropping and rotation to ensure lossless extraction
 * and correct Premultiplied Alpha handling.
 */
export async function unpackAtlas(
  atlasContent: string, 
  images: Map<string, Blob>
): Promise<FileAsset[]> {
    // 1. Parse Atlas Data
    const regionsMap = parseAtlas(atlasContent); // Map<string, AtlasRegion>
    
    // Group regions by page to minimize texture uploads
    const regionsByPage = new Map<string, AtlasRegion[]>();
    regionsMap.forEach(region => {
        if (!regionsByPage.has(region.pageName)) {
            regionsByPage.set(region.pageName, []);
        }
        regionsByPage.get(region.pageName)!.push(region);
    });

    const outputAssets: FileAsset[] = [];

    // 2. Iterate Pages
    for (const [pageName, regions] of regionsByPage) {
        // Find blob (Loose matching to handle path differences)
        let blob = images.get(pageName);
        if (!blob) {
            const normalizedPage = pageName.toLowerCase();
            for (const [key, val] of images.entries()) {
                if (key.toLowerCase().endsWith(normalizedPage)) {
                    blob = val;
                    break;
                }
            }
        }
        
        if (!blob) {
            console.warn(`Atlas page not found: ${pageName}`);
            continue;
        }

        // 3. WebGL Processing per Page
        try {
            const extracted = await processAtlasPage(blob, regions);
            outputAssets.push(...extracted);
        } catch (e) {
            console.error(`Failed to process atlas page ${pageName}:`, e);
        }
    }
    
    return outputAssets;
}

/**
 * Processes a single atlas page using WebGL to extract all regions.
 */
async function processAtlasPage(pageBlob: Blob, regions: AtlasRegion[]): Promise<FileAsset[]> {
    // Load Source Image
    const img = await createImageBitmap(pageBlob, { 
        premultiplyAlpha: 'none', 
        colorSpaceConversion: 'none' 
    });
    
    const pageW = img.width;
    const pageH = img.height;

    // Setup WebGL
    const canvas = document.createElement('canvas');
    // Initialize with a default size, will resize per region
    canvas.width = 1; canvas.height = 1;
    
    const gl = canvas.getContext('webgl2', { 
        alpha: true, 
        premultipliedAlpha: false,
        preserveDrawingBuffer: true 
    }) as WebGL2RenderingContext;

    if (!gl) {
        img.close();
        throw new Error("WebGL2 not supported");
    }

    // Configure GL for raw pixel handling
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // Create & Upload Texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    // Shader Setup
    const program = createProgram(gl);
    gl.useProgram(program);

    const u_uvRect = gl.getUniformLocation(program, "u_uvRect");
    const u_rotated = gl.getUniformLocation(program, "u_rotated");
    const positionLoc = gl.getAttribLocation(program, "a_position");

    // Full Screen Quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
    ]), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const assets: FileAsset[] = [];

    // Extract Regions
    for (const region of regions) {
        // Calculate Destination Size
        // If rotated, w/h are swapped in the atlas relative to the original sprite
        const destW = region.rotated ? region.height : region.width;
        const destH = region.rotated ? region.width : region.height;

        canvas.width = destW;
        canvas.height = destH;
        gl.viewport(0, 0, destW, destH);

        // Calculate UVs (Normalized 0..1)
        // Texture(0,0) is Index 0 (Top-Left of Image due to UNPACK_FLIP_Y=false)
        // So Y grows downwards in texture space (v=0 is Top, v=1 is Bottom)
        const u_l = region.x / pageW;
        const u_r = (region.x + region.width) / pageW;
        const v_t = region.y / pageH; 
        const v_b = (region.y + region.height) / pageH;

        gl.uniform4f(u_uvRect, u_l, v_t, u_r, v_b);
        gl.uniform1i(u_rotated, region.rotated ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Export
        const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/png');
        });

        if (blob) {
            // Reconstruct a File object
            // Append .png if missing, though typically we might want to keep exact names.
            // Optimizer expects loose files to match attachment names.
            const fileName = region.name.endsWith('.png') ? region.name : `${region.name}.png`;
            
            assets.push({
                file: new File([blob], fileName, { type: 'image/png' }),
                path: fileName,
                width: destW,
                height: destH
            });
        }
    }

    // Cleanup
    gl.deleteTexture(texture);
    gl.deleteBuffer(buf);
    gl.deleteProgram(program);
    img.close();
    
    // Force context loss to cleanup memory
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    return assets;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        
        // Rect: Left, Top, Right, Bottom
        uniform vec4 u_uvRect;
        uniform bool u_rotated;

        void main() {
            vec2 p = a_position; // -1 to 1
            gl_Position = vec4(p, 0.0, 1.0);
            
            // Convert to 0..1
            // p.y=-1(Bottom) -> 0. p.y=1(Top) -> 1.
            // p.x=-1(Left) -> 0.   p.x=1(Right) -> 1.
            vec2 uv_interp = p * 0.5 + 0.5;

            float u_l = u_uvRect.x;
            float v_t = u_uvRect.y;
            float u_r = u_uvRect.z;
            float v_b = u_uvRect.w;

            if (!u_rotated) {
                // Standard Mapping
                // Canvas Top (1) -> Source Top (v_t)
                // Canvas Bot (0) -> Source Bot (v_b)
                // Remember: Texture(0,0) is Top-Left of image in our setup.
                // So v=0 is Top. v=1 is Bottom.
                // Wait. Canvas Y is 0 at Bottom.
                // We want Canvas Bottom to have Image Bottom.
                // So at interp.y=0 (Bottom), we want v_b.
                // At interp.y=1 (Top), we want v_t.
                
                v_uv.x = mix(u_l, u_r, uv_interp.x);
                v_uv.y = mix(v_b, v_t, uv_interp.y);
            } else {
                // Rotated Mapping (Spine 90 CCW Stored -> 90 CW Restore)
                // Logical Top -> Source Left
                // Logical Bot -> Source Right
                // Logical Left -> Source Bottom
                // Logical Right -> Source Top
                
                // Canvas Top (interp.y=1) -> Source Left (u_l)
                // Canvas Bot (interp.y=0) -> Source Right (u_r)
                
                // Canvas Left (interp.x=0) -> Source Bottom (v_b)
                // Canvas Right (interp.x=1) -> Source Top (v_t)

                v_uv.x = mix(u_r, u_l, uv_interp.y);
                v_uv.y = mix(v_b, v_t, uv_interp.x);
            }
        }
    `;

    const fsSource = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_texture;

        void main() {
            gl_FragColor = texture2D(u_texture, v_uv);
        }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(vs) || "VS Error");
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(fs) || "FS Error");
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    
    return prog;
}
