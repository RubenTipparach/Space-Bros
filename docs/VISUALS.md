# Visuals — rendering research

Reference doc for the visual overhaul. Captures the techniques,
references, and code sketches behind the star / planet / nebula /
galaxy choices. When we touch a shader, re-read this first.

User picks locked in (see [`DECISIONS.md ADR-016..018`](./DECISIONS.md)):

- **Stars → B**: LOD system. Upgraded billboards at galaxy scale, swap to
  procedural shader-sphere with corona when the camera zooms to a system.
- **Planets → E**: full procedural. Noise-based surface + atmosphere
  (fresnel rim + scattering-ish approximation) + cloud layer + night lights
  on habitable biomes.
- **Nebula → E**: skybox shader (fbm-of-fbm domain-warped noise) +
  instanced starfield + per-cluster foreground nebula billboards.

## 1. Stars

### 1.1 Far-LOD: upgraded billboard (galaxy + sector + cluster views)

Current `Stars.tsx` uses a `ShaderMaterial` with `THREE.Points`. Upgrade
path from the research:

- **Temperature → RGB** via piecewise black-body approximation (see
  [Procedural star rendering, Ben Podgursky](https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/)).
  Better than our current spectral-class lookup because it's continuous.
- **Star spikes** in the fragment shader: add 4 or 6 narrow high-intensity
  rays in addition to the round core. Done with `max(horiz, vert, diag)`
  of distance-to-axis shaping.
- **Chromatic aberration** by sampling slightly offset RGB channels —
  sells the "bright point light" feel.
- **HDR bloom** in post (Three.js has `UnrealBloomPass`); blooming the
  upgraded billboard is what really pushes it from "pixels" to "deep
  field photo."

Reference: `Stars.tsx` fragment shader is already circular with additive
blending — add spikes + aberration to its fragment program, keep the
single draw call.

### 1.2 Near-LOD: procedural shader sphere (system view)

When the camera is zoomed to a single star, swap the billboard for a
3D sphere with:

- **Multi-octave simplex noise** for convection granulation on the
  surface (~4 octaves is enough — see bpodgursky).
- **Sunspots** via a second lower-frequency noise, clamped with `max(0, n)`.
- **Bright flares** via a third high-frequency layer.
- **Corona** rendered as a separate billboard _around_ the sphere,
  sized proportional to distance (caps out at a max so it doesn't eat
  the screen). Same billboard also serves as raycast target so clicking
  near the star still picks it.

Switch logic: within the scene, compare camera distance to star — below
~10 units the star uses the `ShaderSphereStar` component; otherwise
the billboard path renders it as part of the instanced points.

References:
- [bpodgursky — Procedural star rendering with three.js](https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/)
- [THRASTRO shaders (FirmamentShader + custom)](https://github.com/THRASTRO/thrastro-shaders)

### 1.3 Sketch (near-LOD surface)

```glsl
// simplified — real shader layers 3 noise functions like bpodgursky
float granulation = snoise3d(p * 4.0) * 0.5
                  + snoise3d(p * 8.0) * 0.25
                  + snoise3d(p * 16.0) * 0.125;

float sunspots   = max(0.0, snoise3d(p * 2.0) - 0.3);
float flares     = pow(max(0.0, snoise3d(p * 12.0)), 4.0);

float t          = baseTemp + granulation * 200.0 - sunspots * 800.0 + flares * 400.0;
vec3  color      = tempToRGB(t);           // piecewise
gl_FragColor = vec4(color, 1.0);
```

## 2. Planets — full procedural

The reference stack is split across a few sources that combine cleanly:

- **Surface sphere** with a per-fragment procedural color (ridge/perlin
  noise tinted by biome palette) — [prolearner/procedural-planet](https://github.com/prolearner/procedural-planet)
  shows triplanar texturing but we'll start with pure procedural color.
- **Atmosphere shell** — a larger `THREE.SphereGeometry`, `side:
  BackSide`, `AdditiveBlending`, fragment shader that rims the planet
  in a biome-specific tint ([Stemkoski atmosphere approach](https://stemkoski.github.io/Three.js/Atmosphere.html),
  updated in [Make Your Own Earth in Three.js](https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e)).
- **Clouds** — a second sphere just above the surface, `MeshStandardMaterial`
  or a custom shader with noise-based opacity + slow rotation.
- **Night lights** — emissive channel masked by dot(normal, light), so
  city lights only show on the dark hemisphere. Habitable / ocean / jungle
  biomes get this; other biomes don't.
- **Physically-accurate option (later)**: [@takram/three-atmosphere](https://www.npmjs.com/package/@takram/three-atmosphere)
  is a production Rayleigh/Mie precomputed scattering implementation.
  Overkill now; flag for when we want to sell a single "hero" planet.

### 2.1 Atmosphere shader — known-good

Straight from the Stemkoski / CodePen / Franky pattern (works on any
planet, cheap, looks great):

```glsl
// Atmosphere sphere — rendered with BackSide + AdditiveBlending
// sits at ~1.05× the planet radius.
varying vec3 vNormal;
varying vec3 eyeVector;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal  = normalize(normalMatrix * normal);
  eyeVector = normalize(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
```

```glsl
// Fragment
varying vec3 vNormal;
varying vec3 eyeVector;
uniform vec3  uAtmoColor;     // biome tint
uniform float uOpacity;       // 0.6 for habitable, 0.2 for tundra, etc.
uniform float uPowFactor;     // 3.0 tight, 8.0 soft

void main() {
  float dotP   = dot(vNormal, eyeVector);
  float rim    = pow(dotP, uPowFactor);
  gl_FragColor = vec4(uAtmoColor, uOpacity) * rim;
}
```

On the **planet surface shader**, add the rim-glow as an additive term
so atmosphere bleeds into the surface at grazing angles:

```glsl
float rim = 1.4 - dot(normal, viewDir);   // 1.4 boosts the effect
surface.rgb += uAtmoColor * pow(rim, 5.0);
```

### 2.2 Biome palette

Each biome picks a surface-color gradient and an atmosphere tint:

| Biome      | Surface base     | Surface detail   | Atmosphere     |
| ---------- | ---------------- | ---------------- | -------------- |
| earthlike  | ocean blue       | green + tan      | pale blue      |
| jungle     | deep green       | dark green       | teal-green     |
| ocean      | deep blue        | lighter blue     | pale cyan      |
| desert     | tan              | dark rust        | yellow-orange  |
| tundra     | off-white + grey | blue-grey ice    | pale cyan-grey |
| ice        | white / cyan     | pale grey        | white          |
| rocky      | grey-brown       | dark grey        | thin grey      |
| molten     | black            | orange / red     | red            |
| gas        | cream / tan bands| darker bands     | tan            |
| toxic      | sickly green     | purple veins     | pale green     |

Each encoded as `uSurfacePrimary`, `uSurfaceSecondary`, `uAtmoColor`
uniforms; the fragment shader picks between primary and secondary based
on noise.

## 3. Nebula background

### 3.1 Core technique: fbm-of-fbm (domain warping)

Inigo Quilez's trick: layer fractal Brownian motion, then **warp its
input by another fbm**, producing wispy, cloud-like patterns that
aren't grid-aligned. [Book of Shaders §13 — Fractal Brownian Motion](https://thebookofshaders.com/13/) covers it in detail.

```glsl
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * snoise(p);
    p  = p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

float nebula(vec3 dir) {
  vec2 p = dir.xy * 3.0 + dir.z;     // cheap 3D-ish parameterization
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 4.0 * q), fbm(p + 4.0 * q + vec2(1.7, 9.2)));
  return fbm(p + 4.0 * r);
}
```

### 3.2 Layers on the skybox

On a huge inverted sphere (`side: BackSide`, depth-write off, first
thing drawn):

1. **Base gradient** — dark purple → black, biased by `dir.y` so the
   galactic plane has a warmer tint.
2. **Layer 1 nebula** — slow, large-scale fbm-of-fbm, multiplied into a
   sector-themed hue (Core = gold, Orion = teal, Perseus = magenta, etc.).
3. **Layer 2 detail** — higher-frequency fbm thresholded, tinted cooler
   for depth cues.
4. **Star points** — the threshold trick from [Starry Shader for Sky Sphere](https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578):

   ```glsl
   float cs = pow(abs(cnoise(vPos * 200.0)), 1.0 / starDensity);
   float stars = smoothstep(0.88, 0.92, cs);
   color += vec3(1.0) * stars;
   ```

All of it is purely procedural and **seeded by galaxy seed** so the
same universe has the same background every session.

### 3.3 Cluster-nebula foreground billboards

Distinct translucent sprite planes placed at each cluster's center,
oriented to face the camera, tinted by the cluster's dominant star
class. Adds parallax and a sense of "you are inside something." ~20
planes total is free. Generated with a radial fbm fragment shader to
avoid hard edges.

## 4. Galaxy spiral generator

Direct from the Three.js Journey Galaxy Generator + open-source clones
([alvarosabu](https://github.com/alvarosabu/threejs-galaxy-generator),
[MRGRAVITY817](https://github.com/MRGRAVITY817/threejs-spiral-galaxy),
[NukhbaAhmad](https://github.com/NukhbaAhmad/StarsGalaxy),
[lucas-tulio](https://github.com/lucas-tulio/spiral-galaxy)).

Parameters (our defaults in brackets):

- `count` — total stars [~15 000]
- `radius` — max distance from center [~500 ly]
- `branches` — spiral arm count [4; 2 major + 2 minor]
- `spin` — how tightly arms wrap [1.2]
- `randomness` — perpendicular jitter [0.3]
- `randomnessPower` — concentrates stars near the arm spine [3]
- `insideColor` — core tint [`#ff6030` — hot orange]
- `outsideColor` — rim tint [`#1b3984` — cool blue]

Per-star calculation:

```ts
const radius = Math.pow(Math.random(), randomnessPower) * maxRadius;
const branchAngle = (i % branches) / branches * Math.PI * 2;
const spinAngle = radius * spin;

// perpendicular randomness, scaled down near center and up near rim
const rx = Math.pow(Math.random(), randomnessPower) * randomness * radius
         * (Math.random() < 0.5 ? 1 : -1);
const ry = Math.pow(Math.random(), randomnessPower) * randomness * radius
         * (Math.random() < 0.5 ? 1 : -1) * 0.3;   // flatten vertically
const rz = Math.pow(Math.random(), randomnessPower) * randomness * radius
         * (Math.random() < 0.5 ? 1 : -1);

const x = Math.cos(branchAngle + spinAngle) * radius + rx;
const y = ry;
const z = Math.sin(branchAngle + spinAngle) * radius + rz;
```

Color: `insideColor.clone().lerp(outsideColor, radius / maxRadius)`.

Both "2 major + 2 minor arms" and "4 symmetric" work — we'll use 2
major at full weight + 2 minor at 0.5 weight, combined by an index
bias.

## 5. Sectors + clusters

### 5.1 Sector names (seeded dictionary)

Pick 6 sectors per galaxy seed by combining **proper noun** +
**descriptor**. The full generator sits in `packages/shared/src/sectors.ts`.

```ts
const PROPER = [
  "Orion", "Perseus", "Cygnus", "Draco", "Lyra", "Aquila",
  "Corvus", "Scutum", "Norma", "Carina", "Vela", "Auriga",
  "Hydra", "Pavo", "Sagitta", "Eridanus",
];
const DESCRIPTOR = [
  "Reach", "Belt", "Arm", "Frontier", "Veil", "Expanse",
  "Wake", "Tide", "Shard", "Ember", "Halo", "Reef",
  "Gyre", "Spur", "Rim", "Hollow",
];
// six sectors → six `${PROPER[i]} ${DESCRIPTOR[j]}` pairs picked from the
// seeded RNG; sector prefix code is first 3 letters of the proper noun.
```

Sample output (seed "space-bros-prime"):
`Orion Reach (ORN)` · `Perseus Belt (PRS)` · `Cygnus Void/Veil (CYG)` ·
`Draco Shard (DRC)` · `Lyra Tide (LYR)` · `Aquila Hollow (AQL)`.

Each sector owns an angular wedge of the spiral (6 wedges × 60°), plus
the **Core** sector for the innermost radius — so technically 6 outer
sectors + 1 Core = 7 selectable regions.

### 5.2 Cluster naming + grid

Each sector subdivides into a **5 × 5 radial grid** (letter = angular
sub-wedge A..E, number = radial band 1..5). Clusters are placed in
spatial clumps at specific grid cells.

```
{sectorPrefix}-{gridCell}-{fancyName}
  ORN-B3-Kestrel
  PRS-A1-Orpheus
  DRC-E5-Halcyon
```

Fancy names (seeded dictionary):

```ts
const FANCY = [
  "Kestrel", "Orpheus", "Maelstrom", "Halcyon", "Prometheus", "Icarus",
  "Sable", "Zephyr", "Solstice", "Vortex", "Nimbus", "Hyperion",
  "Tethys", "Thule", "Pandora", "Argus", "Basilisk", "Cassiopeia",
];
```

Target count: ~3–4 clusters per sector × 7 sectors ≈ **20 clusters**
total (user's ask). Each cluster is a spatial Gaussian-ish cloud of
400–1200 stars within its (sector, gridCell) cell.

Display format: **"Kestrel Cluster (ORN-B3)"** — fancy name in front,
code in parens so breadcrumb stays legible.

## 6. Where this lives in the repo

Proposed after V-1 lands:

```
packages/shared/src/
  galaxy.ts          existing — extend with spiral-gen, sector assignment
  sectors.ts         NEW — seeded dictionary + generator
  clusters.ts        NEW — cluster placement + naming

apps/web/app/galaxy/
  Stars.tsx          upgrade shader (spikes, aberration, HDR-prep)
  StarSphere.tsx     NEW — near-LOD procedural shader sphere
  NebulaSky.tsx      NEW — skybox + fbm-of-fbm
  ClusterNebula.tsx  NEW — per-cluster billboards
  SectorOverlay.tsx  NEW — sector labels + wedges in galaxy view
  CameraRig.tsx      NEW — lerp between zoom-level targets
  Planet3D.tsx       NEW — procedural planet (surface + atmo + clouds + lights)
```

## 7. Known gotchas

- **noUncheckedIndexedAccess** is on — every dictionary pick needs a
  non-null assertion or a safe-fallback. We learned this one already.
- **Raycast precision on billboards** is touchy at galaxy scale. When
  the camera is 2000 units out, hit-thresholds need to scale with
  camera distance.
- **fbm on mobile GPUs** — watch octave count. 6 is fine on desktop;
  mobile should cap at 4 with a uniform so we can dial it.
- **Bloom post-processing** costs a framebuffer round-trip; test on
  mobile before committing.
- **Per-sector star gating** — when a cluster is selected, the _other_
  clusters' stars should render (so the galaxy is visible), but only
  the selected cluster's stars are raycast-active. Filter raycast, not
  the draw.

## 8. Sources

- [bpodgursky — Procedural star rendering with three.js and WebGL shaders](https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/)
- [THRASTRO shaders — astronomical Three.js shaders](https://github.com/THRASTRO/thrastro-shaders)
- [Three.js forum — Starry shader for sky sphere](https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578)
- [Three.js Journey — Galaxy Generator lesson (paid)](https://threejs-journey.com/lessons/galaxy-generator)
- [threejsdemos.com — Galaxy Generator demo](https://threejsdemos.com/demos/particles/galaxy)
- [alvarosabu/threejs-galaxy-generator](https://github.com/alvarosabu/threejs-galaxy-generator)
- [MRGRAVITY817/threejs-spiral-galaxy](https://github.com/MRGRAVITY817/threejs-spiral-galaxy)
- [NukhbaAhmad/StarsGalaxy](https://github.com/NukhbaAhmad/StarsGalaxy)
- [lucas-tulio/spiral-galaxy](https://github.com/lucas-tulio/spiral-galaxy)
- [prolearner/procedural-planet](https://github.com/prolearner/procedural-planet)
- [Franky Hung — Make Your Own Earth in Three.js](https://franky-arkon-digital.medium.com/make-your-own-earth-in-three-js-8b875e281b1e)
- [Stemkoski — Atmosphere demo](https://stemkoski.github.io/Three.js/Atmosphere.html)
- [@takram/three-atmosphere — precomputed scattering (production)](https://www.npmjs.com/package/@takram/three-atmosphere)
- [Book of Shaders — Fractal Brownian Motion](https://thebookofshaders.com/13/)
- [Book of Shaders — Noise](https://thebookofshaders.com/11/)
- [stegu/webgl-noise — GLSL simplex/perlin/worley implementations](https://stegu.github.io/webgl-noise/webdemo/)
- [creativelifeform/three-nebula — particle-based nebula library](https://github.com/creativelifeform/three-nebula)
- [Red Stapler — Cool Nebula Background Effect with Three.js (particle approach)](https://redstapler.co/cool-nebula-background-effect-three-js/)
