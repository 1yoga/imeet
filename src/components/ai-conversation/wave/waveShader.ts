import type { ConversationStatus } from '@/features/conversation/types';

/**
 * Волна iMeet: SkSL-шейдер (Skia), считается на GPU для каждого пикселя.
 *
 * Слои: два полупрозрачных «эха» на заднем плане и передний гребень со столбиками,
 * светящейся кромкой, отражением под базовой линией и искрами над пиками.
 * Форма — пять «формант» (гауссовых холмов), которые дрейфуют и дышат во времени;
 * громкость микрофона и речь агента раскачивают их по-слоговому.
 *
 * Математика выверена numpy-прототипом (tools/wave-proto.py). Внутри шейдера только ASCII: так надёжнее для компилятора SkSL — меняйте их вместе.
 */
export const waveShaderSource = `
uniform float2 uRes;     // canvas size, dp
uniform float uPx;       // dp per screen pixel
uniform float uTime;     // seconds, speed depends on state
uniform float uEnergy;   // base height of the state
uniform float uLevel;    // user loudness 0..1
uniform float uSpeak;    // agent speaking 0..1
uniform float uThink;    // agent thinking 0..1, running cyan highlight
uniform float uDim;      // dimming (error) 0..1
// Formants (center, width, height), computed once per frame on the UI thread.
// uF* front crest, uG* echo 1, uH* echo 2.
uniform float3 uF0;
uniform float3 uF1;
uniform float3 uF2;
uniform float3 uF3;
uniform float3 uF4;
uniform float3 uG0;
uniform float3 uG1;
uniform float3 uG2;
uniform float3 uG3;
uniform float3 uG4;
uniform float3 uH0;
uniform float3 uH1;
uniform float3 uH2;
uniform float3 uH3;
uniform float3 uH4;

const float BASE = 0.6;
const float MAXH = 0.5;
const float PITCH = 5.4; // bar pitch, dp

float hash1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

float bump(float u, float3 f) {
  float d = (u - f.x) / f.y;
  return f.z * exp(-d * d);
}

float shape(float u, float t, float seed, float3 f0, float3 f1, float3 f2, float3 f3, float3 f4) {
  float h = bump(u, f0) + bump(u, f1) + bump(u, f2) + bump(u, f3) + bump(u, f4);
  float ripple = 0.035 * sin(u * 46.0 - t * (1.6 + 1.2 * uLevel) + seed * 5.0);
  return h * (1.0 + ripple);
}

// Crest height in canvas units; soft compression keeps peaks when loud.
float crest(float sh, float scale, float amp, float env) {
  float hn = amp * scale * 0.8 * sh;
  hn = min(hn / (1.0 + 0.45 * hn) * 0.95, 1.0);
  return MAXH * hn * env;
}

half4 main(float2 pos) {
  float x = pos.x / uRes.x;
  float py = pos.y / uRes.y;
  float t = uTime;
  float u = (x - 0.055) / 0.89;
  float inside = step(0.0, u) * step(u, 1.0);
  float env = inside * pow(sin(3.14159265 * clamp(u, 0.0, 1.0)), 1.5);
  float aa = uPx / uRes.y * 1.2;
  float activity = clamp(uLevel + uSpeak * 0.7, 0.0, 1.0);
  float edge = smoothstep(0.0, 0.06, env);

  float scanX = 0.5 + 0.47 * sin(t * 1.7);
  float scanD = (x - scanX) / 0.07;
  float scan = uThink * exp(-scanD * scanD);
  float amp = uEnergy + uLevel * 0.6 + uSpeak * 0.25 + scan * 0.6;

  float3 deep = mix(float3(0.16, 0.10, 0.75), float3(0.32, 0.08, 0.70), uSpeak * 0.8);
  float3 violet = mix(float3(0.42, 0.30, 1.0), float3(0.70, 0.30, 1.0), uSpeak * 0.8);
  float3 lilac = float3(0.78, 0.66, 1.0);
  float3 pink = float3(1.0, 0.78, 0.95);
  float3 col = float3(0.0);

  // Back echoes: soft body and rim only.
  for (int k = 0; k < 2; k++) {
    float seed = k == 0 ? 2.6 : 1.3;
    float scale = k == 0 ? 1.12 : 0.92;
    float strength = k == 0 ? 0.35 : 0.55;
    float3 c = k == 0 ? deep * 1.6 : violet;
    float sh = k == 0
      ? shape(u, t * (0.92 + 0.06 * seed), seed, uH0, uH1, uH2, uH3, uH4)
      : shape(u, t * (0.92 + 0.06 * seed), seed, uG0, uG1, uG2, uG3, uG4);
    float hgt = crest(sh, scale, amp, env);
    float top = BASE - hgt - 0.004 * env;
    float below = smoothstep(top - aa, top + aa, py) * (1.0 - smoothstep(BASE - aa, BASE + aa, py));
    float depth = clamp((py - top) / max(hgt, 0.001), 0.0, 1.0);
    float dist = abs(py - top) * uRes.y;
    float body = below * 0.22 * pow(1.0 - depth, 1.5);
    float rim = (exp(-dist / 1.3) * 0.7 + 0.2 * exp(-dist / 8.0)) * edge;
    col += c * (body + rim) * strength;
  }

  // Front crest.
  float bx = fract(pos.x / PITCH);
  float barId = floor(pos.x / PITCH);
  float bar = 1.0 - smoothstep(0.16, 0.16 + 1.2 * uPx / PITCH, abs(bx - 0.5));

  float hgt = crest(shape(u, t * 0.92, 0.0, uF0, uF1, uF2, uF3, uF4), 1.0, amp, env);
  float top = BASE - hgt - 0.004 * env;
  float rel = hgt / MAXH;
  float below = smoothstep(top - aa, top + aa, py) * (1.0 - smoothstep(BASE - aa, BASE + aa, py));
  float depth = clamp((py - top) / max(hgt, 0.001), 0.0, 1.0);
  float dist = abs(py - top) * uRes.y;

  float3 fillCol = mix(violet, deep, depth);
  fillCol = mix(fillCol, lilac, clamp(1.0 - depth * 3.0, 0.0, 1.0) * rel * 0.7);
  float body = below * (0.16 + 0.84 * bar) * (1.0 - 0.45 * depth);
  col += fillCol * body;

  float rh = hgt * 0.62;
  float reflIn = smoothstep(BASE - aa, BASE + aa, py) * (1.0 - smoothstep(BASE + rh - aa, BASE + rh + aa, py));
  float rdepth = clamp((py - BASE) / max(rh, 0.001), 0.0, 1.0);
  col += violet * reflIn * bar * (1.0 - rdepth) * (1.0 - rdepth) * 0.4;

  float3 rimCol = mix(lilac, pink, smoothstep(0.35, 0.9, rel));
  float rim = (exp(-dist / 1.0) * 1.1 + 0.32 * exp(-dist / 6.0) + 0.1 * exp(-dist / 22.0)) * edge;
  col += rimCol * rim;

  // Sparks leave the crest above some bars.
  float r = hash1(barId);
  float life = fract(t * (0.35 + 0.4 * r) + r * 7.0);
  float yp = top - life * (0.25 + 0.2 * r);
  float dy = (py - yp) * uRes.y;
  float dx = (bx - 0.5) * PITCH + sin(life * 6.0 + r * 30.0) * 1.2;
  float spark = step(0.72, r) * exp(-(dx * dx + dy * dy) / 2.6) * pow(1.0 - life, 1.5)
              * (0.15 + 0.85 * activity) * smoothstep(0.05, 0.3, env);
  col += pink * spark * 2.2;

  // Baseline.
  float bl = exp(-abs(py - BASE) * uRes.y / 0.8) * smoothstep(0.0, 0.05, env + 0.02 * inside);
  col += float3(0.5, 0.45, 1.0) * bl * 0.5;

  // Thinking: cyan tint around the running highlight.
  float lum = (col.r + col.g + col.b) / 3.0;
  col = mix(col, lum * float3(0.35, 0.85, 1.0) * 2.2, clamp(scan, 0.0, 1.0) * 0.85);

  col *= 1.0 - 0.55 * uDim;
  col = 1.0 - exp(-col * 1.2);
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return half4(half3(col), half(a));
}
`;

const centers = [0.2, 0.35, 0.5, 0.66, 0.81];
const widths = [0.07, 0.065, 0.1, 0.075, 0.065];
const heights = [0.42, 0.55, 1.0, 0.68, 0.5];

/**
 * Форманты слоя в момент t: [центр, ширина, высота] ×5. Зависят только от времени,
 * поэтому считаются раз в кадр (worklet), а не для каждого пикселя.
 */
export function waveFormants(
  t: number,
  seed: number,
  level: number,
  speak: number,
  /** Спектр голоса агента: 5 полос 0..1, от низких частот к высоким. */
  agentBands: number[],
  /** 1 — волна агента следует его реальному звуку, 0 — ритм речи без звука (нет доступа к выходу). */
  agentReal: number,
): number[][] {
  'worklet';
  const lt = t * (0.92 + 0.06 * seed);
  const out: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const c = centers[i] + 0.03 * Math.sin(lt * (0.45 + 0.13 * i) + seed * 2.1 + i * 1.7);
    const osc = 0.5 + 0.5 * Math.sin(lt * (1.1 + 0.37 * i + seed * 0.3) + i * 2.3 + seed);
    // Голос пользователя: медленный слоговой ритм, холмы перекатываются, а не дрожат.
    const syl = 0.5 + 0.5 * Math.sin(lt * (3.2 + 0.8 * i) + seed * 3.0) * Math.sin(lt * (1.2 + 0.35 * i) + i);
    // Голос агента: каждая форманта следует своей полосе спектра (низкие слева, высокие справа);
    // без доступа к звуку — прежний живой ритм речи.
    const rhythm = 0.2 + 1.0 * (0.5 + 0.5 * Math.sin(lt * (7.0 + 1.9 * i) + seed * 3.0) * Math.sin(lt * (2.3 + 0.7 * i) + i));
    const agent = rhythm + (0.15 + 2.0 * agentBands[i] - rhythm) * agentReal;
    const a = heights[i] * (0.62 + 0.38 * osc) * (1 + level * (0.5 + 1.1 * syl) + speak * agent);
    const w = widths[i] * (1 + 0.25 * Math.sin(lt * 0.7 + i + seed));
    out.push([c, w, a]);
  }
  return out;
}

/** Зерна слоёв: передний гребень и два эха — как в шейдере. */
export const layerSeeds = { front: 0, echo1: 1.3, echo2: 2.6 } as const;

export interface WaveMotion {
  energy: number;
  think: number;
  speak: number;
  dim: number;
  /** Скорость течения времени в шейдере. */
  speed: number;
  /** Реагирует ли волна на громкость микрофона. */
  hearsUser: boolean;
}

export const waveMotion: Record<ConversationStatus, WaveMotion> = {
  idle: { energy: 0.6, think: 0, speak: 0, dim: 0, speed: 0.55, hearsUser: false },
  preparing: { energy: 0.45, think: 0.6, speak: 0, dim: 0.15, speed: 0.8, hearsUser: false },
  listening: { energy: 0.8, think: 0, speak: 0, dim: 0, speed: 0.85, hearsUser: true },
  'user-speaking': { energy: 0.85, think: 0, speak: 0, dim: 0, speed: 0.7, hearsUser: true },
  recognizing: { energy: 0.5, think: 1, speak: 0, dim: 0, speed: 1.1, hearsUser: false },
  thinking: { energy: 0.45, think: 1, speak: 0, dim: 0, speed: 1.1, hearsUser: false },
  speaking: { energy: 0.8, think: 0, speak: 1, dim: 0, speed: 1.2, hearsUser: false },
  error: { energy: 0.35, think: 0, speak: 0, dim: 1, speed: 0.4, hearsUser: false },
};
