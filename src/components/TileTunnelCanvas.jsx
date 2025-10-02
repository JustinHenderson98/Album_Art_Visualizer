import React, { useEffect, useRef } from "react";

/** WebGL shader-based tunnel tile (Pi-friendly)
 *  - POT-resizes image to 512×512
 *  - No mipmaps, LINEAR + CLAMP_TO_EDGE
 *  - antialias:false, DPR=1
 */
export default function TileTunnelCanvas({
  imageUrl,
  layers = 12,
  rotStep = Math.PI / 320,
  rotSpeed = 1.0,
  growth = 1.12,
  alpha0 = 1.0,
  alphaFalloff = 0.84,
  frontFactor = 0.55,
  biasX = 0.0,
  biasY = 0.0,
  vignette = 0.35,
  potSize = 512,
  className = "",
  style,
}) {
  const canvasRef = useRef(null);
  const stopRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return;

    const vsSrc = `
      attribute vec2 aPos;
      varying vec2 vUV;
      void main(){
        vUV = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;
    const fsSrc = `
      precision mediump float;
      varying vec2 vUV;
      uniform sampler2D uTex;
      uniform float uTime;
      uniform int   uLayers;
      uniform float uRotStep, uRotSpeed, uGrowth, uAlpha0, uAlphaFalloff, uFrontFactor, uVignette;
      uniform vec2  uBias, uRes;

      vec2 rot2(vec2 p, float a){
        float c=cos(a), s=sin(a);
        return mat2(c,-s,s,c) * (p-0.5) + 0.5;
      }
      vec2 scl(vec2 p, float s){ return (p-0.5)/s + 0.5; }
      vec4 sTex(vec2 uv){ return texture2D(uTex, clamp(uv, 0.001, 0.999)); }

      void main(){
        float front = uFrontFactor * min(uRes.x,uRes.y) / max(uRes.x,uRes.y);
        vec2 bias = uBias * 0.02;

        vec4 col = vec4(0.0);
        float acc = 0.0;

        vec2 uv0 = scl(vUV + bias, front);
        vec4 c0 = sTex(uv0);
        col += c0 * uAlpha0; acc += uAlpha0;

        const int MAX_LAYERS = 16;
        for (int i=1; i<MAX_LAYERS; i++){
          if (i >= uLayers) break;
          float a = float(i) * uRotStep + uTime * uRotSpeed * 0.6;
          float sz = front * pow(uGrowth, float(i));
          float al = uAlpha0 * pow(uAlphaFalloff, float(i));
          vec2 uv = scl(rot2(vUV + bias, a), sz);
          col += sTex(uv) * al;
          acc += al;
        }
        col /= max(acc, 1e-4);

        vec2 p = vUV - 0.5;
        float r = length(p) * 1.5;
        float vig = 1.0 - smoothstep(0.6, 1.0, r);
        col.rgb *= mix(1.0, vig, uVignette);

        gl_FragColor = col;
      }`;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
      return s;
    };
    const link = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program link failed");
      return p;
    };

    const prog = link(compile(gl.VERTEX_SHADER, vsSrc), compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.useProgram(prog);

    // geometry
    const verts = new Float32Array([ -1,-1, 1,-1, -1,1, 1,1 ]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // uniforms
    const U = n => gl.getUniformLocation(prog, n);
    const u = {
      uTex: U("uTex"), uTime: U("uTime"), uLayers: U("uLayers"), uRotStep: U("uRotStep"), uRotSpeed: U("uRotSpeed"),
      uGrowth: U("uGrowth"), uAlpha0: U("uAlpha0"), uAlphaFalloff: U("uAlphaFalloff"), uFrontFactor: U("uFrontFactor"),
      uBias: U("uBias"), uRes: U("uRes"), uVignette: U("uVignette")
    };
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uLayers, Math.min(layers, 16));
    gl.uniform1f(u.uRotStep, rotStep);
    gl.uniform1f(u.uRotSpeed, rotSpeed);
    gl.uniform1f(u.uGrowth, growth);
    gl.uniform1f(u.uAlpha0, alpha0);
    gl.uniform1f(u.uAlphaFalloff, alphaFalloff);
    gl.uniform1f(u.uFrontFactor, frontFactor);
    gl.uniform2f(u.uBias, biasX, biasY);
    gl.uniform1f(u.uVignette, vignette);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // load + POT resize
    let tex = null;
    const loadPOT = () => new Promise((resolve, reject) => {
      if (!imageUrl) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const s = potSize|0;
        const off = document.createElement("canvas");
        off.width = off.height = s;
        const ctx = off.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, s, s);
        resolve(off);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });

    const setupTexture = (source) => {
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      if (source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        // solid black placeholder
        const tmp = new Uint8Array([0,0,0,255]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1,1,0, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    const resize = () => {
      const dpr = 1; // Pi: keep 1
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(u.uRes, w, h);
      }
    };

    let raf;
    const t0 = performance.now();
    const frame = (t) => {
      if (stopRef.current) return;
      resize();
      gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.uTime, (t - t0) * 0.001);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    };

    (async () => {
      try {
        const pot = await loadPOT();
        setupTexture(pot);
      } catch (e) {
        console.warn("Tile image failed, using placeholder:", e);
        setupTexture(null);
      }
      resize();
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      stopRef.current = true;
      cancelAnimationFrame(raf);
      if (tex) gl.deleteTexture(tex);
      gl.deleteProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, layers, rotStep, rotSpeed, growth, alpha0, alphaFalloff, frontFactor, biasX, biasY, vignette, potSize]);

  return <canvas ref={canvasRef} className={`block w-full h-full bg-black ${className}`} style={style} />;
}
