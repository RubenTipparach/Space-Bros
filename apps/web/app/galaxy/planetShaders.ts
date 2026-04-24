import * as THREE from "three";
import type { Biome } from "@space-bros/shared";

/**
 * Procedural planet shader family. One ShaderMaterial per biome with
 * per-biome colour palette + feature flags. No external textures.
 *
 * Three layers per planet:
 *   1. Surface       — fbm-shaded base sphere
 *   2. Clouds        — slightly larger sphere with noise-alpha (habitable biomes)
 *   3. Atmosphere    — even larger BackSide+Additive shell with Fresnel rim
 *
 * Based on the Stemkoski / Franky / bpodgursky pattern (see VISUALS.md
 * §2), all inline — no textures to download, everything procedural.
 */

export interface BiomePalette {
  primary: string;    // base colour (ocean, sand, rock, gas base)
  secondary: string;  // mid-tone (land, mountains, band band)
  accent: string;     // highlights (snowcaps, peaks, lava flows)
  atmo: string;       // atmosphere rim tint
  atmoOpacity: number;
  atmoPower: number;  // higher = tighter rim
  clouds: boolean;
  nightLights: boolean;
  gasBands: boolean;
  /** 0 = no surface noise, 1 = full fbm. Lower for icy/molten worlds. */
  noiseScale: number;
}

export const BIOME_PALETTE: Record<Biome, BiomePalette> = {
  molten: {
    primary: "#1c0703", secondary: "#ff4018", accent: "#ffc23d",
    atmo: "#ff5a1a", atmoOpacity: 0.65, atmoPower: 3.2,
    clouds: false, nightLights: false, gasBands: false, noiseScale: 2.6,
  },
  rocky: {
    primary: "#8a7258", secondary: "#3d342a", accent: "#b9a484",
    atmo: "#a89986", atmoOpacity: 0.18, atmoPower: 5.0,
    clouds: false, nightLights: false, gasBands: false, noiseScale: 3.2,
  },
  desert: {
    primary: "#d6a85b", secondary: "#7e5a31", accent: "#ecd39f",
    atmo: "#e5c477", atmoOpacity: 0.35, atmoPower: 3.8,
    clouds: false, nightLights: false, gasBands: false, noiseScale: 2.8,
  },
  ocean: {
    primary: "#11365f", secondary: "#3679b9", accent: "#e5f3ff",
    atmo: "#8ec0ff", atmoOpacity: 0.55, atmoPower: 3.0,
    clouds: true, nightLights: false, gasBands: false, noiseScale: 2.2,
  },
  earthlike: {
    primary: "#1e4d82", secondary: "#4aa05a", accent: "#d3bb84",
    atmo: "#93caff", atmoOpacity: 0.6, atmoPower: 2.8,
    clouds: true, nightLights: true, gasBands: false, noiseScale: 2.2,
  },
  jungle: {
    primary: "#265432", secondary: "#72412b", accent: "#b9d68c",
    atmo: "#76dc94", atmoOpacity: 0.48, atmoPower: 3.0,
    clouds: true, nightLights: false, gasBands: false, noiseScale: 2.5,
  },
  tundra: {
    primary: "#5c748a", secondary: "#c3d1dd", accent: "#ffffff",
    atmo: "#cee2ff", atmoOpacity: 0.32, atmoPower: 4.0,
    clouds: true, nightLights: false, gasBands: false, noiseScale: 2.4,
  },
  ice: {
    primary: "#8fb7d8", secondary: "#d7eaff", accent: "#ffffff",
    atmo: "#e2efff", atmoOpacity: 0.22, atmoPower: 5.0,
    clouds: false, nightLights: false, gasBands: false, noiseScale: 2.8,
  },
  gas: {
    primary: "#8a5e38", secondary: "#c79864", accent: "#efd4a5",
    atmo: "#ffbb74", atmoOpacity: 0.45, atmoPower: 4.0,
    clouds: false, nightLights: false, gasBands: true, noiseScale: 1.6,
  },
  toxic: {
    primary: "#4b2a7c", secondary: "#7fa543", accent: "#d6ef7a",
    atmo: "#b3d655", atmoOpacity: 0.42, atmoPower: 3.4,
    clouds: true, nightLights: false, gasBands: false, noiseScale: 2.6,
  },
};

/** Simple deterministic 3D value noise + fbm. Inlined so every
 *  ShaderMaterial compiles self-contained. */
const NOISE_GLSL = /* glsl */ `
vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0));
  float n100 = dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0));
  float n110 = dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1));
  float n101 = dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1));
  float n111 = dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise3(p);
    p = p * 2.05 + vec3(7.13, 3.71, 1.97);
    a *= 0.5;
  }
  return v * 0.5 + 0.5;
}
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vLocalPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const PLANET_FRAG = /* glsl */ `
uniform vec3  uPrimary;
uniform vec3  uSecondary;
uniform vec3  uAccent;
uniform vec3  uAtmo;
uniform float uNoiseScale;
uniform float uGasBands;
uniform float uNightLights;
uniform vec3  uLightPos;   // world-space position of the star

varying vec3 vLocalPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${NOISE_GLSL}

void main() {
  vec3 sphereNormal = normalize(vLocalPos);
  vec3 p = sphereNormal * uNoiseScale;

  float n = fbm3(p);
  float detail = fbm3(p * 3.1 + vec3(11.0, 4.0, 2.0));

  vec3 surface = mix(uPrimary, uSecondary, smoothstep(0.38, 0.56, n));
  surface = mix(surface, uAccent, smoothstep(0.68, 0.86, n + detail * 0.25));

  // Gas giants: horizontal latitudinal bands modulated by noise.
  if (uGasBands > 0.5) {
    float lat = sphereNormal.y;
    float band = sin(lat * 9.0 + n * 1.8) * 0.5 + 0.5;
    surface = mix(surface * 0.82, surface * 1.1, smoothstep(0.3, 0.7, band));
  }

  // Lighting from the star.
  vec3 lightDir = normalize(uLightPos - vWorldPos);
  float lambert = max(0.0, dot(vWorldNormal, lightDir));
  // Small ambient so the dark side isn't pitch black.
  vec3 lit = surface * (0.12 + lambert * 0.95);

  // Emissive night-side lights for habitable worlds.
  if (uNightLights > 0.5) {
    float night = 1.0 - smoothstep(-0.02, 0.15, lambert);
    float clusters =
      smoothstep(0.62, 0.78, n) *
      smoothstep(0.58, 0.74, detail);
    lit += vec3(1.0, 0.82, 0.45) * clusters * night * 1.2;
  }

  // Subtle fresnel rim tinted by atmosphere colour, on the lit hemisphere.
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - max(0.0, dot(vWorldNormal, viewDir)), 3.5);
  lit += uAtmo * rim * 0.22;

  gl_FragColor = vec4(lit, 1.0);
}
`;

export function makePlanetMaterial(biome: Biome): THREE.ShaderMaterial {
  const p = BIOME_PALETTE[biome];
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uPrimary: { value: new THREE.Color(p.primary) },
      uSecondary: { value: new THREE.Color(p.secondary) },
      uAccent: { value: new THREE.Color(p.accent) },
      uAtmo: { value: new THREE.Color(p.atmo) },
      uNoiseScale: { value: p.noiseScale },
      uGasBands: { value: p.gasBands ? 1 : 0 },
      uNightLights: { value: p.nightLights ? 1 : 0 },
      uLightPos: { value: new THREE.Vector3() },
    },
  });
}

// ---- Atmosphere shell ----------------------------------------------------

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vEye;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vEye = normalize(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uPower;
uniform float uOpacity;

varying vec3 vNormal;
varying vec3 vEye;

void main() {
  float dotP = dot(vNormal, vEye);
  float rim = pow(max(0.0, dotP), uPower);
  gl_FragColor = vec4(uColor, uOpacity) * rim;
}
`;

export function makeAtmosphereMaterial(biome: Biome): THREE.ShaderMaterial {
  const p = BIOME_PALETTE[biome];
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(p.atmo) },
      uPower: { value: p.atmoPower },
      uOpacity: { value: p.atmoOpacity },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

// ---- Clouds shell --------------------------------------------------------

const CLOUDS_VERT = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vLocalPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CLOUDS_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3  uColor;
uniform vec3  uLightPos;

varying vec3 vLocalPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${NOISE_GLSL}

void main() {
  vec3 sphereNormal = normalize(vLocalPos);
  vec3 p = sphereNormal * 3.2 + vec3(uTime * 0.02, 0.0, uTime * 0.015);
  float n = fbm3(p);
  float alpha = smoothstep(0.52, 0.72, n);

  // Light the clouds with the same directional source as the surface,
  // so cloud tops pick up highlights on the sunlit side.
  vec3 lightDir = normalize(uLightPos - vWorldPos);
  float lit = 0.4 + 0.9 * max(0.0, dot(vWorldNormal, lightDir));

  gl_FragColor = vec4(uColor * lit, alpha * 0.85);
}
`;

export function makeCloudsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CLOUDS_VERT,
    fragmentShader: CLOUDS_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#ffffff") },
      uLightPos: { value: new THREE.Vector3() },
    },
    transparent: true,
    depthWrite: false,
  });
}

// ---- Sun ----------------------------------------------------------------

const SUN_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uTime;

varying vec3 vLocalPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${NOISE_GLSL}

void main() {
  vec3 p = normalize(vLocalPos) * 3.0;
  float t = uTime * 0.18;
  float granulation = fbm3(p + vec3(t, t * 0.7, -t * 0.4));
  float flares = fbm3(p * 2.1 + vec3(-t, t * 0.3, t));
  float brightness = 0.75 + granulation * 0.25 + pow(flares, 3.0) * 0.35;
  vec3 col = uColor * brightness;
  // Tiny hot-spot at the center of any fragment
  col += uColor * 0.25;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeSunMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: SUN_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
    },
    toneMapped: false,
  });
}
