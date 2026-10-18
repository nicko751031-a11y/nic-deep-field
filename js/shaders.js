// GLSL 著色器集合（WebGL2 / GLSL ES 3.00 由 three.js 自動轉換；此處用 GLSL1 寫法）
// 物理近似說明：
//  - 行星表面：Lambert 漫反射 + 柔和晨昏線 + 臨邊昏暗；地球另含夜間燈光、海面鏡面反射、雲層、大氣邊緣散射近似
//  - 大氣殼：沿視線穿過球殼的弦長近似光學厚度（單次散射近似，非完整 Rayleigh/Mie 積分）
//  - 星環：幾何薄盤，光學厚度貼圖；行星對環、環對行星的影子以幾何投影計算
//  - 太陽：程序雜訊米粒組織 + 臨邊昏暗（示意）

export const PLANET_VERT = /* glsl */`
  varying vec3 vWorldPos;   // 相對相機（浮動原點）
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vObjPos;
  varying vec3 vTangent; varying vec3 vBitangent;
  uniform float uUOffset;
  void main() {
    vUv = vec2(uv.x + uUOffset, uv.y); // 不用 fract，交給 RepeatWrapping，避免接縫線
    vObjPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec3 pn = normalize(position);
    vec3 t = normalize(vec3(-pn.z, 0.0, pn.x));
    vTangent = normalize(mat3(modelMatrix) * t);
    vBitangent = normalize(mat3(modelMatrix) * cross(pn, t));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// 共用：環影子（在行星著色器裡）
const RING_SHADOW_FN = /* glsl */`
  uniform float uHasRings;
  uniform sampler2D uRingMap;
  uniform float uRingInner, uRingOuter;
  uniform vec3 uRingNormal;   // 世界座標
  uniform vec3 uBodyCenter;   // 世界座標（相對相機）
  float ringShadow(vec3 p, vec3 sunDir) {
    if (uHasRings < 0.5) return 1.0;
    vec3 rel = p - uBodyCenter;
    float denom = dot(sunDir, uRingNormal);
    if (abs(denom) < 1e-4) return 1.0;
    float t = -dot(rel, uRingNormal) / denom;
    if (t <= 0.0) return 1.0;
    vec3 q = rel + sunDir * t;
    float r = length(q);
    if (r < uRingInner || r > uRingOuter) return 1.0;
    float a = texture2D(uRingMap, vec2((r - uRingInner) / (uRingOuter - uRingInner), 0.5)).a;
    return 1.0 - a * 0.92;
  }
`;

export const PLANET_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos; varying vec3 vNormal; varying vec2 vUv; varying vec3 vObjPos;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uSunDir;      // 世界座標，指向太陽
  uniform float uSunIntensity;
  uniform float uLimb;       // 臨邊昏暗強度（氣態行星較明顯）
  uniform float uDetail;     // 近距離程序細節強度
  uniform vec3 uAtmoColor; uniform float uAtmoStrength;
  ${RING_SHADOW_FN}
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(-vWorldPos);
    vec3 albedo = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uColor;
    // 近距離程序細節：只調變亮度（標示為程序細節，非真實地形）
    if (uDetail > 0.0) {
      float d = noise3(normalize(vObjPos) * 900.0) * 0.5 + noise3(normalize(vObjPos) * 3500.0) * 0.5;
      albedo *= 1.0 + (d - 0.5) * uDetail;
    }
    float ndl = dot(n, uSunDir);
    float diff = smoothstep(-0.03, 0.12, ndl) * max(ndl, 0.0) + 0.02 * smoothstep(-0.03, 0.12, ndl);
    float mu = max(dot(n, v), 0.0);
    float limb = mix(1.0, pow(mu, 0.45), uLimb);
    float sh = ringShadow(vWorldPos, uSunDir);
    vec3 col = albedo * diff * limb * sh * uSunIntensity;
    // 薄大氣的邊緣（火星／金星）：淡色邊緣光
    if (uAtmoStrength > 0.0) {
      float fres = pow(1.0 - mu, 3.0);
      float lit = smoothstep(-0.25, 0.35, ndl);
      col += uAtmoColor * fres * lit * uAtmoStrength * 0.6 * uSunIntensity;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const EARTH_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos; varying vec3 vNormal; varying vec2 vUv; varying vec3 vObjPos;
  varying vec3 vTangent; varying vec3 vBitangent;
  uniform sampler2D uDay, uNight, uBRC, uNormal;
  uniform vec3 uSunDir; uniform float uSunIntensity;
  uniform float uCloudShift;   // 雲層相對地表的經度位移（弧度換算到 uv）
  uniform float uDetail;
  uniform float uNightBoost;
  uniform vec3 uAtmoColor;
  uniform float uHasRings; // 不用，保持介面一致
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(-vWorldPos);
    // 法線貼圖（切線框架由球面參數推得）
    vec3 pn = normalize(vObjPos);
    vec3 nm = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    vec3 nWorld = normalize(n + (normalize(vTangent) * nm.x + normalize(vBitangent) * nm.y) * 0.35);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 brc = texture2D(uBRC, vUv).rgb;         // R 高度、G 粗糙度、B 雲
    vec3 night = texture2D(uNight, vUv).rgb;
    vec2 cuv = vec2(fract(vUv.x + uCloudShift), vUv.y);
    float clouds = texture2D(uBRC, cuv).b;
    float ocean = 1.0 - smoothstep(0.35, 0.7, brc.g); // 低粗糙度 = 水面
    if (uDetail > 0.0) {
      float d = noise3(pn * 1200.0) * 0.5 + noise3(pn * 5000.0) * 0.5;
      day *= 1.0 + (d - 0.5) * uDetail * (1.0 - ocean * 0.7);
    }
    float ndl = dot(nWorld, uSunDir);
    float ndl0 = dot(n, uSunDir);
    float dayF = smoothstep(-0.08, 0.18, ndl0);
    float diff = max(ndl, 0.0) * 0.92 + 0.08 * dayF;
    // 海面鏡面反射
    vec3 h = normalize(uSunDir + v);
    float spec = pow(max(dot(nWorld, h), 0.0), 140.0) * ocean * 0.45 * smoothstep(0.0, 0.1, ndl0);
    vec3 sunCol = vec3(1.0, 0.98, 0.95);
    // 雲影（沿太陽方向在 uv 上偏移取樣）
    vec2 shadowUv = cuv + vec2(-uSunDir.x, uSunDir.y) * 0.0025;
    float cloudShadow = 1.0 - 0.45 * texture2D(uBRC, shadowUv).b;
    vec3 surf = day * diff * cloudShadow + sunCol * spec;
    // 雲層：有厚度感的 Lambert，晨昏線附近偏橘
    float cloudLit = max(ndl0, 0.0) * 0.95 + 0.05 * dayF;
    vec3 twilight = vec3(1.0, 0.55, 0.25);
    float tw = exp(-pow(ndl0 / 0.10, 2.0)) * 0.6;
    vec3 cloudCol = mix(vec3(1.0), twilight, tw) * cloudLit;
    vec3 col = mix(surf, cloudCol, clamp(clouds * 1.15, 0.0, 1.0));
    // 夜間燈光（雲下減弱），晨昏線以外才顯現
    float nightF = 1.0 - smoothstep(-0.18, 0.0, ndl0);
    vec3 lights = night * nightF * uNightBoost * (1.0 - clouds * 0.75);
    col += lights;
    // 大氣：邊緣散射（藍）與晨昏線附近的橘紅
    float mu = max(dot(n, v), 0.0);
    float fres = pow(1.0 - mu, 2.5);
    float lit = smoothstep(-0.3, 0.3, ndl0);
    col += uAtmoColor * fres * lit * 0.55;
    col += twilight * exp(-pow(ndl0 / 0.14, 2.0)) * fres * 0.5;
    // 整體薄霧（高空看地面偏藍）
    col = mix(col, uAtmoColor * lit * 0.9, (1.0 - mu) * 0.08 * lit);
    gl_FragColor = vec4(col * uSunIntensity, 1.0);
  }
`;

// 大氣殼：以弦長近似的單次散射（FrontSide、加法混合）
export const ATMO_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
export const ATMO_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;
  uniform vec3 uCenter;        // 相對相機
  uniform float uRp, uRa;      // 行星半徑、大氣外緣半徑（渲染單位）
  uniform vec3 uSunDir; uniform vec3 uColor; uniform float uDensity; uniform float uSunIntensity;
  void main() {
    vec3 ro = vec3(0.0);
    vec3 rd = normalize(vWorldPos);
    vec3 oc = ro - uCenter;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - uRa * uRa;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    float t0 = -b - sq, t1 = -b + sq;
    t0 = max(t0, 0.0);
    // 被行星本體遮住的部分
    float cp = dot(oc, oc) - uRp * uRp;
    float dp = b * b - cp;
    if (dp > 0.0) { float tp = -b - sqrt(dp); if (tp > 0.0) t1 = min(t1, tp); }
    float chord = max(t1 - t0, 0.0);
    // 沿線取中點估計光照與高度
    vec3 mid = ro + rd * (0.5 * (t0 + t1));
    vec3 rel = mid - uCenter;
    float h = (length(rel) - uRp) / (uRa - uRp);
    vec3 nrm = normalize(rel);
    float lit = smoothstep(-0.35, 0.25, dot(nrm, uSunDir));
    float H = uRa - uRp;
    float dens = exp(-clamp(h, 0.0, 1.0) * 4.0) * uDensity;
    float od = 1.0 - exp(-chord / H * dens * 0.35);
    // 前向散射讓靠近太陽方向的邊緣更亮
    float fwd = pow(max(dot(rd, uSunDir), 0.0), 8.0) * 0.6;
    vec3 col = uColor * od * lit * (1.0 + fwd) * uSunIntensity;
    // 晨昏線附近偏紅（短波被散射掉）
    float ndl = dot(nrm, uSunDir);
    col = mix(col, col * vec3(1.6, 0.8, 0.45), exp(-pow(ndl / 0.18, 2.0)) * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const RING_VERT = /* glsl */`
  varying vec3 vWorldPos; varying vec3 vLocal;
  void main() { vLocal = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
export const RING_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos; varying vec3 vLocal;
  uniform sampler2D uRingMap; uniform float uInner, uOuter, uRp;
  uniform vec3 uSunDir; uniform vec3 uCenter; uniform vec3 uNormal; uniform float uSunIntensity; uniform float uFaint;
  void main() {
    float r = length(vLocal.xy);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    vec4 ring = texture2D(uRingMap, vec2(t, 0.5));
    if (ring.a < 0.003) discard;
    vec3 rel = vWorldPos - uCenter;
    // 行星對環的影子：環上點沿太陽方向的射線是否穿過行星
    float along = dot(rel, uSunDir);
    vec3 perp = rel - uSunDir * along;
    float shadow = 1.0;
    if (along < 0.0) { float d = length(perp); shadow = smoothstep(uRp * 0.985, uRp * 1.015, d); }
    float ndl = dot(uNormal, uSunDir);
    vec3 v = normalize(-vWorldPos);
    float sameSide = sign(dot(uNormal, v)) == sign(ndl) ? 1.0 : 0.0;
    // 受光面：反射；背光面：透射（薄環有一定透光，光學厚度高處較暗）
    float lit = abs(ndl);
    float bright = mix(lit * 0.45 * (1.0 - ring.a * 0.8) + 0.03, lit * 1.0, sameSide);
    // 反向散射增亮（相位角小時環更亮）
    float phase = pow(max(dot(v, uSunDir), 0.0), 2.0) * 0.25 + 1.0;
    vec3 col = ring.rgb * bright * shadow * phase * uSunIntensity;
    float alpha = ring.a * mix(1.0, 0.35, uFaint);
    gl_FragColor = vec4(col, alpha);
  }
`;

export const SUN_VERT = /* glsl */`
  varying vec3 vObj; varying vec3 vNormal; varying vec3 vWorldPos;
  void main() { vObj = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
export const SUN_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vObj; varying vec3 vNormal; varying vec3 vWorldPos;
  uniform float uTime; uniform float uIntensity;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise3(p); p = p * 2.03 + 11.0; a *= 0.5; } return s; }
  void main() {
    vec3 p = normalize(vObj);
    float g = fbm(p * 60.0 + uTime * 0.02) * 0.6 + fbm(p * 220.0 - uTime * 0.05) * 0.4;   // 米粒組織
    float spots = smoothstep(0.62, 0.72, fbm(p * 6.0 + 3.0)) * smoothstep(0.3, 0.9, fbm(p * 25.0 + 7.0)); // 偶發黑子（示意）
    float mu = max(dot(normalize(vNormal), normalize(-vWorldPos)), 0.0);
    float limb = 0.35 + 0.65 * pow(mu, 0.6); // 臨邊昏暗（可見光約 u≈0.6）
    vec3 base = vec3(1.0, 0.86, 0.62);
    vec3 col = base * (0.85 + 0.35 * g) * limb;
    col = mix(col, col * 0.25, spots * 0.9);
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

// 星點：依視星等決定大小與亮度，B−V 決定顏色
export const STAR_VERT = /* glsl */`
  attribute float aMag; attribute float aCi;
  varying float vAlpha; varying vec3 vColor;
  uniform float uPixelRatio; uniform float uExposure; uniform float uSizeScale;
  vec3 bvToRgb(float bv) {
    // Ballesteros 近似：B−V → 色溫，再近似黑體顏色
    float T = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
    T = clamp(T, 2000.0, 30000.0);
    float t = T / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.2929 * pow(t - 60.0, -0.1332), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.3900 * log(t) - 0.6318, 0.0, 1.0) : clamp(1.1298 * pow(t - 60.0, -0.0755), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432 * log(t - 10.0) - 1.1963, 0.0, 1.0));
    return vec3(r, g, b);
  }
  void main() {
    vColor = bvToRgb(aCi);
    float flux = pow(10.0, -0.4 * (aMag - 1.0)) * uExposure;  // 1 等星 = 1
    // 真實觀感：亮星看起來更大（光暈），暗星只剩 1 像素
    float size = clamp(1.2 + 1.9 * log2(1.0 + flux * 2.0), 1.0, 14.0) * uSizeScale;
    vAlpha = clamp(flux, 0.0, 1.0) * 0.95 + 0.05 * clamp(flux * 4.0, 0.0, 1.0);
    vAlpha *= smoothstep(0.0, 0.02, flux);
    gl_PointSize = size * uPixelRatio;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 強制投影到遠平面附近（方向性天體，不參與深度）
    gl_Position.z = gl_Position.w * 0.999999;
  }
`;
export const STAR_FRAG = /* glsl */`
  precision highp float;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float core = exp(-r * r * 9.0);
    float halo = exp(-r * 2.6) * 0.35;
    float a = (core + halo) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * a, a);
  }
`;

// 全天背景（Tycho 星圖，赤道座標等距圓柱投影；RA 在 u=0.5 為 0h、向右增加）
export const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  uniform mat4 uInvProj; uniform mat4 uInvView;
  void main() {
    // 取 NDC 深度 0.5 的點（不能用 1.0：遠平面 1e19 時反投影的 w 會變成 0，方向成為 NaN）
    vec4 clip = vec4(position.xy, 0.5, 1.0);
    vec4 view = uInvProj * clip;
    vDir = (uInvView * vec4(view.xyz / max(view.w, 1e-20), 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.999999, 1.0);
  }
`;
export const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform sampler2D uSky; uniform float uIntensity;
  const float OBL = 0.40909;  // 23.4393°
  void main() {
    vec3 d = normalize(vDir);
    // 世界(three) → 黃道：x=x, y_ecl=-z_three, z_ecl=y_three
    vec3 e = vec3(d.x, -d.z, d.y);
    // 黃道 → 赤道
    vec3 q = vec3(e.x, cos(OBL) * e.y - sin(OBL) * e.z, sin(OBL) * e.y + cos(OBL) * e.z);
    float ra = atan(q.y, q.x);            // -π..π
    float dec = asin(clamp(q.z, -1.0, 1.0));
    vec2 uv = vec2(0.5 + ra / 6.2831853, 0.5 - dec / 3.1415927);
    vec3 col = texture2D(uSky, uv).rgb;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

// 史瓦西黑洞：全螢幕光線追蹤（Binet 方程 u'' = -u + 1.5 u²，rs = 1）
export const BH_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uCamPos;        // 單位：rs
  uniform sampler2D uSky; uniform float uSkyIntensity;
  uniform float uDiskInner, uDiskOuter; uniform float uTime; uniform float uSteps; uniform float uDiskOn;
  uniform vec3 uDiskNormal;    // 吸積盤法線（世界座標）
  const float OBL = 0.40909;
  vec3 skyColor(vec3 d) {
    vec3 e = vec3(d.x, -d.z, d.y);
    vec3 q = vec3(e.x, cos(OBL) * e.y - sin(OBL) * e.z, sin(OBL) * e.y + cos(OBL) * e.z);
    float ra = atan(q.y, q.x); float dec = asin(clamp(q.z, -1.0, 1.0));
    return texture2D(uSky, vec2(0.5 + ra / 6.2831853, 0.5 - dec / 3.1415927)).rgb * uSkyIntensity;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
  // 吸積盤顏色（藝術化：溫度隨半徑下降，內緣偏白藍、外緣偏橘紅）＋ 近似都卜勒射束與重力紅移
  vec4 diskSample(vec3 p, vec3 rayDir) {
    float r = length(p);
    if (r < uDiskInner || r > uDiskOuter) return vec4(0.0);
    float phi = atan(p.z, p.x);
    float t = (r - uDiskInner) / (uDiskOuter - uDiskInner);
    // 克卜勒角速度 ∝ r^-1.5；內側轉得快，形成拉絲紋理
    float ang = phi - uTime * 0.6 * pow(r, -1.5) * 8.0;
    float n = noise2(vec2(ang * 3.0, r * 2.5)) * 0.6 + noise2(vec2(ang * 9.0, r * 7.0)) * 0.4;
    float ringy = 0.8 + 0.2 * sin(r * 6.0 + n * 3.0);
    float emis = pow(1.0 - t, 1.6) * (0.55 + 0.7 * n) * ringy;
    vec3 hot = vec3(1.0, 0.95, 0.9), warm = vec3(1.0, 0.55, 0.2);
    vec3 col = mix(hot, warm, pow(t, 0.6));
    // 都卜勒射束：盤面速度 β = sqrt(rs/(2 r))（圓軌道，rs=1 → β = sqrt(0.5/r)），觀察者方向為 -rayDir
    float beta = sqrt(0.5 / r);
    vec3 vel = normalize(cross(uDiskNormal, p)) * beta;
    float gamma = 1.0 / sqrt(max(1.0 - beta * beta, 1e-4));
    float gDop = 1.0 / (gamma * (1.0 - dot(vel, -rayDir)));
    float gGrav = sqrt(max(1.0 - 1.0 / r, 0.0));
    float g = gDop * gGrav;
    float boost = pow(g, 3.0);
    col = mix(col, vec3(0.6, 0.75, 1.0), clamp((g - 1.0) * 1.5, 0.0, 0.5));
    col = mix(col, vec3(1.0, 0.35, 0.15), clamp((1.0 - g) * 1.5, 0.0, 0.5));
    float alpha = clamp(emis * 1.4, 0.0, 1.0) * smoothstep(0.0, 0.08, t) * smoothstep(0.0, 0.15, 1.0 - t);
    return vec4(col * emis * boost * 2.2, alpha);
  }
  void main() {
    vec3 ro = uCamPos;
    vec3 rd = normalize(vDir);
    // 軌道平面基底
    vec3 er = normalize(ro);
    float r0 = length(ro);
    vec3 ephi = normalize(rd - er * dot(rd, er));
    if (length(rd - er * dot(rd, er)) < 1e-5) ephi = normalize(cross(er, vec3(0.0, 1.0, 0.0)));
    float u = 1.0 / r0;
    // du/dφ 初值：dr/dφ = -u'/u² ；由 rd 分量決定
    float cosA = dot(rd, er);            // 徑向分量
    float sinA = dot(rd, ephi);          // 橫向分量
    // 對於以 φ 為參數的軌道，r dφ/ds = sinA, dr/ds = cosA → dr/dφ = r cosA / sinA → u' = -cosA/(r sinA) * ...
    float du = -cosA / max(sinA, 1e-4) * u;
    float phi = 0.0;
    vec3 col = vec3(0.0); float trans = 1.0;
    vec3 prevP = ro;
    bool captured = false;
    int STEPS = int(uSteps);
    for (int i = 0; i < 1200; i++) {
      if (i >= STEPS) break;
      // 步長：遠處大步、近處小步
      float h = clamp(0.04 / max(u * 1.5, 0.25), 0.008, 0.07);
      // RK2 積分 u'' = -u + 1.5 u²
      float k1u = du, k1du = -u + 1.5 * u * u;
      float um = u + 0.5 * h * k1u, dum = du + 0.5 * h * k1du;
      float k2u = dum, k2du = -um + 1.5 * um * um;
      u += h * k2u; du += h * k2du; phi += h;
      if (u > 1.0) { captured = true; break; }         // 掉入事件視界
      float r = 1.0 / u;
      vec3 p = (er * cos(phi) + ephi * sin(phi)) * r;
      // 吸積盤：穿越盤面（法線方向符號改變）
      if (uDiskOn > 0.5) {
        float s0 = dot(prevP, uDiskNormal), s1 = dot(p, uDiskNormal);
        if (s0 * s1 < 0.0) {
          float f = s0 / (s0 - s1);
          vec3 hit = mix(prevP, p, f);
          vec4 ds = diskSample(hit, normalize(p - prevP));
          col += ds.rgb * ds.a * trans;
          trans *= (1.0 - ds.a);
          if (trans < 0.02) break;
        }
      }
      prevP = p;
      if ((r > 80.0 || u < 0.0) && du < 0.0) break;   // 已遠離（或 u 穿越 0 = 到達無窮遠）且正在往外走
    }
    if (!captured && trans > 0.02) {
      // 逃逸方向：以最後兩點的差決定
      vec3 outDir = normalize(prevP - (er * cos(phi - 0.05) + ephi * sin(phi - 0.05)) / max(u, 1e-6));
      // 若 u 很小 (遠離)，用解析方向近似：
      col += skyColor(outDir) * trans;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
