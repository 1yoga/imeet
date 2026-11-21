/**
 * Фон с глянцевыми «каплями» (Figma, раздел «Анимация» 73:517): переливающаяся сиренево-розовая
 * жидкость с синими боками в правом верхнем и левом нижнем углах, медленно плывёт и перетекает.
 * Метаболы: поле Σ r²/d², общая «высота» h = 1 − 1/поле даёт нормаль — капли сливаются в одну массу.
 * Под карточкой края мягче и прозрачнее (как сквозь матовое стекло).
 * Прототип для подбора: tools/blob-proto.py. Внутри шейдера только ASCII.
 */
export const blobShaderSource = `
uniform float2 uRes;   // canvas size, dp
uniform float uTime;
uniform float3 uB0;    // blobs: center (in canvas widths), radius
uniform float3 uB1;
uniform float3 uB2;
uniform float3 uB3;
uniform float3 uB4;
uniform float3 uB5;
uniform float4 uCard;  // card rect: x, y, w, h (dp)
uniform float uCardR;  // card corner radius (dp)

float cardSdf(float2 p) {
  float2 c = uCard.xy + uCard.zw * 0.5;
  float2 q = abs(p - c) - (uCard.zw * 0.5 - uCardR);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCardR;
}

void addBlob(float2 p, float3 b, inout float field, inout float2 grad) {
  float2 d = p - b.xy;
  float d2 = dot(d, d) + 0.0001;
  float f = b.z * b.z / d2;
  field += f;
  grad += -2.0 * f * d / d2;
}

half4 main(float2 pos) {
  float2 p = pos / uRes.x;
  float field = 0.0;
  float2 grad = float2(0.0);
  addBlob(p, uB0, field, grad);
  addBlob(p, uB1, field, grad);
  addBlob(p, uB2, field, grad);
  addBlob(p, uB3, field, grad);
  addBlob(p, uB4, field, grad);
  addBlob(p, uB5, field, grad);

  float inside = 1.0 - smoothstep(-6.0, 6.0, cardSdf(pos));
  float soft = mix(0.06, 0.45, inside);
  float body = smoothstep(1.0 - soft, 1.0 + soft, field);
  if (body < 0.002) return half4(0.0);

  float f2 = max(field, 0.001);
  f2 *= f2;
  float2 h = grad / f2 * 0.35;
  float inv = 1.0 / sqrt(dot(h, h) + 1.0);
  float3 n = float3(-h * inv, inv);

  float3 center = float3(0.88, 0.84, 1.0);
  float3 pink = float3(0.96, 0.76, 0.97);
  float3 violet = float3(0.58, 0.52, 1.0);
  float3 deep = float3(0.34, 0.26, 0.96);
  float shimmer = 0.5 + 0.5 * sin(5.0 * n.x + 3.0 * n.y + 0.5 * uTime);
  float3 col = mix(deep, violet, smoothstep(0.0, 0.35, n.z));
  col = mix(col, mix(pink, center, shimmer), smoothstep(0.35, 0.85, n.z));

  float3 light = float3(-0.45, -0.55, 0.70);
  float diff = clamp(dot(n, light), 0.0, 1.0);
  col *= 0.72 + 0.4 * diff;
  col += pow(diff, 12.0) * 0.35;
  float fres = pow(1.0 - n.z, 4.0);
  col = mix(col, float3(0.92, 0.86, 1.0), fres * 0.6);

  float a = body * mix(1.0, 0.55, inside);
  col = clamp(col, 0.0, 1.0);
  return half4(half3(col * a), half(a));
}
`;

const clusters = [
  // справа сверху: cx, cy (доли ширины / высоты), радиус (доля ширины), скорость, фаза
  [0.88, 0.07, 0.2, 0.35, 0.0],
  [0.7, 0.03, 0.13, 0.5, 1.7],
  [0.98, 0.2, 0.12, 0.42, 3.1],
  // слева снизу
  [0.06, 0.86, 0.17, 0.38, 0.6],
  [0.2, 0.97, 0.15, 0.47, 2.2],
  [-0.03, 0.74, 0.1, 0.55, 4.0],
] as const;

/** Капли в момент t: [x, y, r] в долях ширины холста. */
export function blobPositions(t: number, aspect: number): number[][] {
  'worklet';
  const out: number[][] = [];
  for (let i = 0; i < clusters.length; i++) {
    const [cx, cy, r, sp, ph] = clusters[i];
    const wobble = i < 3 ? 1.3 : 1.2;
    out.push([
      cx + (i < 3 ? 0.06 : 0.05) * Math.sin(t * sp + ph),
      (cy + (i < 3 ? 0.035 : 0.03) * Math.cos(t * sp * wobble + ph)) * aspect,
      r * (1 + 0.12 * Math.sin(t * (i < 3 ? 0.9 : 0.8) + ph)),
    ]);
  }
  return out;
}
