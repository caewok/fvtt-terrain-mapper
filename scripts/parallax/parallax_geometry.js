/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { GeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";

/* Parallax geometry for terrain regions and elevated tiles.

Pipeline:
  Geometry source (heights + footprint)      Texture source (colors)
    RegionGeometrySource   (terrain faces)     BackgroundTextureSource (scene background)
    TileQuadGeometrySource (flat tile quad)    TileTextureSource       (tile art, alpha cutout)
        \                                         /
         --> ParallaxGeometryBuilder  flat arrays: x, y, h, uv (top texture), uv2 (background); sorted low-to-high
         --> ParallaxMesh             PIXI.Mesh; vertex shader scales xy about the camera center by a capped perspective factor

Scenarios:
  1. Background only:        new ParallaxRegionMesh(regionD)
  2a. Tile at an elevation:  new ParallaxTileMesh(tileD)                       (flat quad, alpha cutout, no walls)
  2b. Tile art on a region:  new ParallaxRegionMesh(regionD, { tileD })        (ramp/steps/hill heights, tile colors)

Region and tile meshes share one shader; only the sources differ.
*/

// ----- NOTE: UV mapping ----- //

/**
 * World (scene px) --> uv of the scene background.
 * @returns {function(number, number): number[]}
 */
function backgroundUVFn() {
  const rect = canvas.dimensions.sceneRect;
  return (x, y) => [(x - rect.x) / rect.width, (y - rect.y) / rect.height];
}

/**
 * World (scene px) --> uv of a tile's texture, through the tile's inverse transform.
 * Handles position, size, rotation (about center) and mirroring (texture.scaleX/Y < 0).
 * Does not handle texture fit/anchor/offset or sprite-sheet frames.
 * @param {TileDocument} tileD
 * @returns {function(number, number): number[]}
 */
function tileUVFn(tileD) {
  const { x, y, width, height } = tileD;
  const rot = Math.toRadians(tileD.rotation ?? 0);
  const cx = x + (width * 0.5);
  const cy = y + (height * 0.5);
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const flipU = (tileD.texture?.scaleX ?? 1) < 0;
  const flipV = (tileD.texture?.scaleY ?? 1) < 0;
  return (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    const lx = (dx * cos) - (dy * sin);
    const ly = (dx * sin) + (dy * cos);
    let u = (lx / width) + 0.5;
    let v = (ly / height) + 0.5;
    if ( flipU ) u = 1 - u;
    if ( flipV ) v = 1 - v;
    return [u, v];
  };
}

// ----- NOTE: Builder ----- //

export class ParallaxGeometryBuilder {

  /** Faces with normal.z above this are treated as "top" surfaces. Below -this are bottoms (dropped). */
  static NZ_EPS = 1e-3;

  /** Triangles lower than this (pixels above ground) contribute nothing visible. */
  static MIN_HEIGHT = 0.5;

  /** How far outside a wall (in grid squares) to sample the background for the wall strip. */
  static WALL_UV_INSET = 0.12;

  /**
   * @typedef {object} ParallaxData
   * @prop {Float32Array} positions   x, y, h per vertex (3 floats); h is pixels above groundZ
   * @prop {Float32Array} uvs         Top-texture uv per vertex (2 floats)
   * @prop {Float32Array} uvs2        Background uv per vertex (2 floats); walls are inset toward the ground outside them
   * @prop {Float32Array} normals     Flat per-triangle normal per vertex (3 floats). nz > 0 marks a top.
   * @prop {number} vertexCount
   * @prop {number} maxHeight         Highest h in the mesh, pixels
   */

  /**
   * Ground reference: the height at which parallax shift is zero.
   * Regions with an infinite bottom are stored at +/-1e6 (see PlaceableGeometry.finiteElevation),
   * so everything is clamped to this.
   * @returns {number} Pixels
   */
  static defaultGroundZ() {
    const floor = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    return Number.isFinite(floor) ? floor : 0;
  }

  /**
   * Build parallax data from a region's geometry.
   * @param {RegionGeometry|TerrainGeometry} geom
   * @param {object} [opts]
   * @param {number} [opts.groundZ]      Elevation (pixels) treated as height 0
   * @param {number} [opts.maxHeight]    Clamp for h, pixels (guards against huge regions/elevations)
   * @param {function} [opts.uvFn]       (x, y) --> [u, v] for the top texture. Default: scene background.
   * @param {function} [opts.bgUvFn]     (x, y) --> [u, v] for the background (used by walls). Default: scene background.
   * @returns {ParallaxData|null} Null if nothing to draw (e.g., terrain at ground level)
   */
  static build(geom, { groundZ, maxHeight = Number.POSITIVE_INFINITY, uvFn, bgUvFn } = {}) {
    groundZ ??= this.defaultGroundZ();
    const faces = [...geom.iterateFaces()];
    if ( !faces.length ) return null;

    // World-space vertices for every face; flat, un-indexed triangles unless condense() indexed them.
    const vo = GeometricPrimitive.generateVerticesForFaces(faces);
    const tris = this.#readTriangles(vo);
    if ( !tris.length ) return null;

    const { NZ_EPS, MIN_HEIGHT } = this;
    const kept = [];
    for ( const t of tris ) {
      // Triangle normal from positions (independent of how the vertex object stores normals).
      const ux = t.bx - t.ax; const uy = t.by - t.ay; const uz = t.bz - t.az;
      const vx = t.cx - t.ax; const vy = t.cy - t.ay; const vz = t.cz - t.az;

      // Canvas is left-handed (x right, y down, z up toward the camera). The library winds faces
      // counterclockwise as seen from outside, with a top at +z, so use (v x u), not (u x v).
      let nx = (uz * vy) - (uy * vz);
      let ny = (ux * vz) - (uz * vx);
      let nz = (uy * vx) - (ux * vy);

      const len = Math.hypot(nx, ny, nz);
      if ( len < 1e-9 ) continue; // Degenerate.
      nx /= len; ny /= len; nz /= len;
      if ( nz < -NZ_EPS ) continue; // Bottom faces are never seen from above.

      const isTop = nz > NZ_EPS;
      if ( !isTop ) { // Vertical wall: keep only the horizontal part of the normal.
        const h = Math.hypot(nx, ny);
        if ( h < 1e-9 ) continue;
        nx /= h; ny /= h; nz = 0;
      }

      const hA = clamp(t.az - groundZ, 0, maxHeight);
      const hB = clamp(t.bz - groundZ, 0, maxHeight);
      const hC = clamp(t.cz - groundZ, 0, maxHeight);
      const hMax = Math.max(hA, hB, hC);
      if ( hMax < MIN_HEIGHT ) continue; // At ground level: nothing moves.

      // Sort key is the MAX height. (Average height let a wall triangle sort beneath the lower tread beside it.)
      kept.push({ t, nx, ny, nz, hA, hB, hC, isTop, key: hMax });
    }
    if ( !kept.length ) return null;
    return this.#pack(kept, uvFn ?? backgroundUVFn(), bgUvFn ?? backgroundUVFn());
  }

  /**
   * Build parallax data for a flat quad at a constant height. A constant-height quad has one scale
   * for all its vertices, so two triangles are exact; no subdivision needed.
   * @param {{x: number, y: number}[]} corners   Top-left, top-right, bottom-right, bottom-left (clockwise on screen)
   * @param {number} h                           Pixels above ground
   * @param {object} [opts]
   * @param {function} [opts.uvFn]               (x, y) --> [u, v] for the top texture
   * @param {function} [opts.bgUvFn]
   * @returns {ParallaxData|null}
   */
  static buildQuad(corners, h, { uvFn, bgUvFn } = {}) {
    if ( !(h >= this.MIN_HEIGHT) ) return null;
    const [tl, tr, br, bl] = corners;
    // Winding gives +z by the same (v x u) convention used in build().
    const mk = (a, b, c) => ({
      t: { ax: a.x, ay: a.y, az: h, bx: b.x, by: b.y, bz: h, cx: c.x, cy: c.y, cz: h },
      nx: 0, ny: 0, nz: 1, hA: h, hB: h, hC: h, isTop: true, key: h
    });
    const kept = [mk(tl, br, tr), mk(tl, bl, br)];
    return this.#pack(kept, uvFn ?? backgroundUVFn(), bgUvFn ?? backgroundUVFn());
  }

  /**
   * Sort and flatten kept triangles into typed arrays.
   * @param {object[]} kept
   * @param {function} uvFn
   * @param {function} bgUvFn
   * @returns {ParallaxData}
   */
  static #pack(kept, uvFn, bgUvFn) {
    // Painter's order, low to high: higher treads/ridges cover lower ones.
    // At equal key, walls first so the top that caps them draws over.
    kept.sort((a, b) => (a.key - b.key) || (a.isTop - b.isTop));

    const n = kept.length * 3;
    const positions = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const uvs2 = new Float32Array(n * 2);
    const normals = new Float32Array(n * 3);
    let maxH = 0;
    let p = 0; let u = 0; let q = 0;
    const wallInset = canvas.grid.size * this.WALL_UV_INSET;
    for ( const k of kept ) {
      const { t } = k;
      const verts = [[t.ax, t.ay, k.hA], [t.bx, t.by, k.hB], [t.cx, t.cy, k.hC]];

      // Wall normals point away from the material (into the hole for hole walls).
      // Walls sample the BACKGROUND just outside the wall, instead of the platform edge,
      // turning the exposed wall strip into a low-contrast ground/shadow streak, not a smeared border.
      const inset = k.isTop ? 0 : wallInset;
      for ( const [x, y, h] of verts ) {
        positions[p++] = x; positions[p++] = y; positions[p++] = h;
        const [tu, tv] = uvFn(x, y);
        const [bu, bv] = bgUvFn(x + (k.nx * inset), y + (k.ny * inset));
        uvs[u] = tu; uvs[u + 1] = tv;
        uvs2[u] = bu; uvs2[u + 1] = bv;
        u += 2;
        normals[q++] = k.nx; normals[q++] = k.ny; normals[q++] = k.nz;
        if ( h > maxH ) maxH = h;
      }
    }
    return { positions, uvs, uvs2, normals, vertexCount: n, maxHeight: maxH };
  }

  /**
   * Read triangles from a VertexObject.
   * ASSUMPTION: interleaved layout is position(3) [+ normal(3)] [+ uv(2)], matching
   * generateVerticesForFaces (hasNormals = true, hasUVs = HAS_UVs = false). Adjust STRIDE if VertexObject differs.
   * @param {VertexObject} vo
   * @returns {object[]} Triangles as {ax, ay, az, bx, ...}
   */
  static #readTriangles(vo) {
    const v = vo.vertices;
    if ( !v?.length ) return [];
    const stride = 3 + (vo.hasNormals ? 3 : 0) + (vo.hasUVs ? 2 : 0);
    const idx = vo.indices;
    const nTris = idx?.length ? Math.floor(idx.length / 3) : Math.floor(v.length / stride / 3);
    const out = new Array(nTris);
    const at = i => idx?.length ? idx[i] * stride : i * stride;
    for ( let i = 0; i < nTris; i += 1 ) {
      const a = at(i * 3); const b = at((i * 3) + 1); const c = at((i * 3) + 2);
      out[i] = {
        ax: v[a], ay: v[a + 1], az: v[a + 2],
        bx: v[b], by: v[b + 1], bz: v[b + 2],
        cx: v[c], cy: v[c + 1], cz: v[c + 2],
      };
    }
    return out;
  }
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }


// ----- NOTE: Texture sources ----- //

/*
Texture source interface:
  version  {string}                     Changes when the texture or its mapping changes
  resolve() {PIXI.Texture|null}
  uvFn()    {function(x, y): [u, v]}
*/

/** Scene background as the top texture (scenario 1). */
export class BackgroundTextureSource {

  get version() { return canvas.scene?.background?.src ?? ""; }

  /**
   * TODO: confirm for v14 levels (per-level backgrounds, background offset/scale).
   * @returns {PIXI.Texture|null}
   */
  resolve() { return this.constructor.resolveTexture(); }

  uvFn() { return backgroundUVFn(); }

  static resolveTexture() {
    const bg = canvas.primary?.background;
    if ( bg?.texture ) return bg.texture;
    const src = canvas.scene?.background?.src;
    return src ? PIXI.Texture.from(src) : null;
  }
}

/**
 * Show or hide a tile's own (undisplaced) mesh.
 * ASSUMPTION: the placeable's mesh is tileD.object.mesh and Foundry does not reset `renderable` on refresh.
 * @param {TileDocument} tileD
 * @param {boolean} renderable
 */
function setTileRenderable(tileD, renderable) {
  const mesh = tileD?.object?.mesh;
  if ( mesh ) mesh.renderable = renderable;
}

/**
 * A tile's art as the top texture (scenario 2). Transparent pixels are discarded by the shader.
 * With hideOriginal, the tile's own mesh is hidden while the parallax mesh exists, so the undisplaced
 * copy does not show beneath the shifted one.
 */
export class TileTextureSource {

  /** @type {TileDocument} */
  tileD;

  /** @type {boolean} */
  hideOriginal = false;

  constructor(tileD, { hideOriginal = false } = {}) {
    this.tileD = tileD;
    this.hideOriginal = hideOriginal;
  }

  /** Called by ParallaxMesh when it creates its mesh, and again on every refresh (cheap; re-asserts the hide). */
  attach() { if ( this.hideOriginal ) setTileRenderable(this.tileD, false); }

  /** Called by ParallaxMesh when it destroys its mesh. Restores the tile. */
  detach() { if ( this.hideOriginal ) setTileRenderable(this.tileD, true); }

  get version() {
    const { x, y, width, height, rotation, texture } = this.tileD;
    return [texture?.src, texture?.scaleX, texture?.scaleY, x, y, width, height, rotation, this.hideOriginal].join("|");
  }

  resolve() {
    const placeableTexture = this.tileD.object?.texture;
    if ( placeableTexture ) return placeableTexture;
    const src = this.tileD.texture?.src;
    return src ? PIXI.Texture.from(src) : null;
  }

  uvFn() { return tileUVFn(this.tileD); }
}


// ----- NOTE: Geometry sources ----- //

/*
Geometry source interface:
  version   {*|null}      Changes when geometry changes; null if there is nothing to draw
  elevation {number}      Scene units; used for the mesh's draw order against tokens
  build({uvFn, bgUvFn})   {ParallaxData|null}
  attach(), detach()      Optional hooks when a mesh is created/destroyed
*/

/** Region faces (plateau, ramp, steps, hill, holes, rings, cones). */
export class RegionGeometrySource {

  /** @type {RegionDocument} */
  regionD;

  constructor(regionD) { this.regionD = regionD; }

  /** @type {TerrainGeometry|null} */
  get geometry() {
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.regions.geomForDocument(this.regionD) ?? null;
  }

  get version() { return this.geometry?.updateCount ?? null; }

  /** Bottom of the region, so tokens standing on it draw above the mesh. */
  get elevation() {
    const bottom = this.regionD.elevation?.bottom;
    return Number.isFinite(bottom) ? bottom : 0;
  }

  build({ uvFn, bgUvFn } = {}) {
    const geom = this.geometry;
    return geom ? ParallaxGeometryBuilder.build(geom, { uvFn, bgUvFn }) : null;
  }
}

/** A single tile at a constant elevation: one quad. */
export class TileQuadGeometrySource {

  /** @type {TileDocument} */
  tileD;

  /** @type {boolean} Hide the tile's own (undisplaced) mesh while the parallax mesh is drawn. */
  hideOriginal = true;

  constructor(tileD, { hideOriginal = true } = {}) {
    this.tileD = tileD;
    this.hideOriginal = hideOriginal;
  }

  /** Tile elevation in scene units. ASSUMPTION: TileDocument#elevation; adjust if v14 levels move it. */
  get elevation() { return this.tileD.elevation ?? 0; }

  /** Pixels above ground. */
  get heightPx() {
    const px = this.elevation * canvas.dimensions.distancePixels;
    return px - ParallaxGeometryBuilder.defaultGroundZ();
  }

  get version() {
    const { x, y, width, height, rotation } = this.tileD;
    return [x, y, width, height, rotation, this.elevation].join("|");
  }

  /** Corners TL, TR, BR, BL after rotation about the tile center. */
  get corners() {
    const { x, y, width, height } = this.tileD;
    const rot = Math.toRadians(this.tileD.rotation ?? 0);
    const cos = Math.cos(rot); const sin = Math.sin(rot);
    const cx = x + (width * 0.5); const cy = y + (height * 0.5);
    const hw = width * 0.5; const hh = height * 0.5;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
      x: cx + ((lx * cos) - (ly * sin)),
      y: cy + ((lx * sin) + (ly * cos))
    }));
  }

  build({ uvFn, bgUvFn } = {}) {
    return ParallaxGeometryBuilder.buildQuad(this.corners, this.heightPx, { uvFn, bgUvFn });
  }

  // ASSUMPTION: the placeable's mesh is tileD.object.mesh and Foundry does not reset `renderable` on refresh.
  attach() { if ( this.hideOriginal ) this.#setOriginalRenderable(false); }

  detach() { if ( this.hideOriginal ) this.#setOriginalRenderable(true); }

  #setOriginalRenderable(value) {
    const mesh = this.tileD.object?.mesh;
    if ( mesh ) mesh.renderable = value;
  }
}


// ----- NOTE: Shader ----- //

const VERT = `
precision highp float;
attribute vec3 aPosition;   // x, y (scene px), h (px above ground)
attribute vec2 aUV;         // Top texture
attribute vec2 aUV2;        // Background (walls)
attribute vec3 aNormal;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uCenter;       // Camera center, scene coords (canvas.stage.pivot)
uniform float uCamH;        // Virtual camera height above ground, px. Scale ~ 1 + h / uCamH for small h.
uniform float uMaxScale;    // Cap on the scale, so tall terrain far from center cannot blow up.
varying vec2 vUV;
varying vec2 vUV2;
varying float vFacing;
varying float vSide;
varying float vH;
void main() {
  // True perspective scale about the view center, capped.
  float s = min(uCamH / max(uCamH - aPosition.z, 0.05 * uCamH), uMaxScale);
  vec2 p = uCenter + (aPosition.xy - uCenter) * s;
  vec3 pos = projectionMatrix * translationMatrix * vec3(p, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  vUV = aUV;
  vUV2 = aUV2;
  vH = aPosition.z;

  // Walls are visible only if the camera (above uCenter) is on the wall's normal side.
  // n . (c - p) is constant along a vertical planar wall, so it is safe to interpolate.
  vSide = aNormal.z > 0.001 ? 0.0 : 1.0;
  vFacing = vSide > 0.5 ? dot(aNormal.xy, uCenter - aPosition.xy) : 1.0;
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
varying vec2 vUV2;
varying float vFacing;
varying float vSide;
varying float vH;
uniform sampler2D uTex;     // Top texture: background (scenario 1) or tile art (scenario 2)
uniform sampler2D uBg;      // Scene background, for ground-sampled walls
uniform float uWallMode;    // 0 none, 1 ground (sample uBg outside the wall), 2 stretch the top texture
uniform float uAlphaCutoff; // Fragments with texture alpha below this are discarded (tile silhouettes)
uniform float uSideShade;   // 0..1 multiplier for walls at the ground contact
uniform float uFadePx;      // Height (px) over which the wall shade fades from uSideShade up to 1
uniform float uAlpha;
void main() {
  if ( vFacing <= 0.0 ) discard;
  bool isWall = vSide > 0.5;
  if ( isWall && uWallMode < 0.5 ) discard;

  vec4 c = (isWall && uWallMode < 1.5) ? texture2D(uBg, vUV2) : texture2D(uTex, vUV);
  if ( c.a < uAlphaCutoff ) discard;

  // Contact shadow: walls are darkest where they meet the ground and lighten toward the edge.
  float wall = mix(uSideShade, 1.0, smoothstep(0.0, uFadePx, vH));
  float shade = mix(1.0, wall, vSide);
  gl_FragColor = vec4(c.rgb * shade, c.a) * uAlpha;
}`;

const WALL_MODES = { none: 0, ground: 1, texture: 2 };


// ----- NOTE: Per-frame camera center (shared by every mesh class) ----- //

/** @type {Set<ParallaxMesh>} Instances that currently own a mesh. */
const ACTIVE = new Set();
let tickFn = null;

/** Update every active mesh's view center from the current camera. Covers pan, zoom, resize, initial load. */
function tick() {
  const { x, y } = canvas.stage.pivot;
  for ( const pm of ACTIVE ) pm.setCenter(x, y);
}

function register(pm) {
  ACTIVE.add(pm);
  if ( tickFn ) return;
  tickFn = tick;
  canvas.app.ticker.add(tickFn, undefined, PIXI.UPDATE_PRIORITY.HIGH); // Before the render pass.
}

function unregister(pm) {
  ACTIVE.delete(pm);
  if ( ACTIVE.size || !tickFn ) return;
  canvas.app.ticker.remove(tickFn);
  tickFn = null;
}


// ----- NOTE: Mesh wrapper ----- //

/**
 * One parallax mesh for any combination of geometry source and texture source.
 * Rebuilds when either source's version changes.
 */
export class ParallaxMesh {

  /** @type {object} */
  geometrySource;

  /** @type {object} */
  textureSource;

  /** @type {PIXI.Mesh|null} */
  mesh = null;

  /**
   * Strength, as approximate fractional scale growth per grid square of height (small heights).
   * Converted to a virtual camera height: camH = gridSize / strength.
   * The video reference showed about 1.08x at the platform top.
   * @type {number}
   */
  strength = 0.05;

  /** @type {number} Maximum scale, e.g. 1.15 = elevated art grows at most 15%. */
  maxScale = 1.15;

  /** @type {"none"|"ground"|"texture"} */
  wallMode = "ground";

  /** @type {number} Texture alpha below this is discarded. */
  alphaCutoff = 0.01;

  /** Draw order within the parent; sort breaks ties at equal elevation. */
  sort = 0;

  #gVersion = null;

  #tVersion = null;

  /**
   * @param {object} geometrySource
   * @param {object} textureSource
   * @param {object} [opts]
   * @param {number} [opts.strength]
   * @param {number} [opts.sideShade]     Wall brightness at the ground contact
   * @param {number} [opts.alpha]
   * @param {number} [opts.maxScale]
   * @param {"none"|"ground"|"texture"} [opts.wallMode]
   *   none: no walls (tile silhouettes); ground: background just outside the wall; texture: stretch the top texture
   * @param {number} [opts.alphaCutoff]
   * @param {number} [opts.sort]
   */
  constructor(geometrySource, textureSource,
    { strength = 0.05, sideShade = 0.6, alpha = 1, maxScale = 1.15, wallMode = "ground", alphaCutoff = 0.01, sort = 0 } = {}) {
    this.geometrySource = geometrySource;
    this.textureSource = textureSource;
    this.strength = strength;
    this.sideShade = sideShade;
    this.alpha = alpha;
    this.maxScale = maxScale;
    this.wallMode = wallMode;
    this.alphaCutoff = alphaCutoff;
    this.sort = sort;
  }

  /**
   * Rebuild if either source changed since last time. Cheap when unchanged.
   * @param {PIXI.Container} parent    Where to add the mesh (e.g., canvas.primary)
   * @returns {boolean} True if rebuilt
   */
  refresh(parent) {
    // Foundry may have re-shown the tile since the last refresh; hide it again.
    if ( this.mesh ) this.textureSource.attach?.();

    const gv = this.geometrySource.version;
    if ( gv == null ) { this.destroy(); return false; }
    const tv = this.textureSource.version;
    if ( this.mesh && gv === this.#gVersion && tv === this.#tVersion ) return false;
    this.#gVersion = gv;
    this.#tVersion = tv;

    const data = this.geometrySource.build({
      uvFn: this.textureSource.uvFn(),
      bgUvFn: backgroundUVFn()
    });
    if ( !data ) { this.destroy(); return true; }

    const texture = this.textureSource.resolve();
    if ( !texture ) { this.destroy(); return true; }
    const bgTexture = BackgroundTextureSource.resolveTexture() ?? texture;

    const meshGeom = new PIXI.Geometry()
      .addAttribute("aPosition", data.positions, 3)
      .addAttribute("aUV", data.uvs, 2)
      .addAttribute("aUV2", data.uvs2, 2)
      .addAttribute("aNormal", data.normals, 3);

    if ( this.mesh ) {
      // Replace geometry, keep shader (and its shared uniforms).
      const old = this.mesh.geometry;
      this.mesh.geometry = meshGeom;
      old.destroy();
    } else {
      const shader = PIXI.Shader.from(VERT, FRAG, {
        uTex: texture,
        uBg: bgTexture,
        uCenter: [0, 0],
        uCamH: 1e6,
        uMaxScale: this.maxScale,
        uWallMode: WALL_MODES[this.wallMode] ?? 1,
        uAlphaCutoff: this.alphaCutoff,
        uSideShade: this.sideShade,
        uFadePx: canvas.grid.size * 0.5,
        uAlpha: this.alpha,
      });
      this.mesh = new PIXI.Mesh(meshGeom, shader);
      parent.addChild(this.mesh);
      this.geometrySource.attach?.();
      this.textureSource.attach?.();
      register(this);
    }
    const u = this.mesh.shader.uniforms;
    u.uTex = texture;
    u.uBg = bgTexture;
    u.uWallMode = WALL_MODES[this.wallMode] ?? 1;
    u.uAlphaCutoff = this.alphaCutoff;

    // Draw order against tokens and other primary-group children.
    // ASSUMPTION: the v14 primary group sorts children by their `elevation` then `sort` properties.
    this.mesh.elevation = this.geometrySource.elevation ?? 0;
    this.mesh.sort = this.sort;
    if ( parent.sortDirty !== undefined ) parent.sortDirty = true;

    this.setStrength(this.strength);
    this.setCenter(canvas.stage.pivot.x, canvas.stage.pivot.y);
    return true;
  }

  setStrength(strength) {
    this.strength = strength;
    if ( !this.mesh ) return;
    const u = this.mesh.shader.uniforms;
    u.uCamH = canvas.grid.size / Math.max(strength, 1e-6);
    u.uMaxScale = this.maxScale;
    u.uFadePx = canvas.grid.size * 0.5;
  }

  /** Updated automatically every frame while a mesh exists; can also be called directly. */
  setCenter(x, y) {
    if ( this.mesh ) this.mesh.shader.uniforms.uCenter = [x, y];
  }

  destroy() {
    unregister(this);
    if ( !this.mesh ) return;
    this.geometrySource.detach?.();
    this.textureSource.detach?.();
    this.mesh.parent?.removeChild(this.mesh);
    this.mesh.destroy({ children: true });
    this.mesh = null;
  }
}


// ----- NOTE: Convenience wrappers ----- //

/**
 * Parallax mesh for a terrain region.
 * Scenario 1: samples the scene background.
 * Scenario 2b: pass { tileD } to take the colors from a tile instead (heights still come from the region).
 */
export class ParallaxRegionMesh extends ParallaxMesh {

  /** @type {RegionDocument} */
  regionD;

  /**
   * @param {RegionDocument} regionD
   * @param {object} [opts]               Same as ParallaxMesh
   * @param {TileDocument} [opts.tileD]   Use this tile's art for the top; transparent pixels are cut out
   * @param {boolean} [opts.hideOriginal=true]  Hide the tile's undisplaced mesh while this is shown.
   *   Set false when one large tile is shared by several regions (hiding it would hide the ground art).
   */
  constructor(regionD, { tileD, hideOriginal = true, ...opts } = {}) {
    const textureSource = tileD ? new TileTextureSource(tileD, { hideOriginal }) : new BackgroundTextureSource();
    super(new RegionGeometrySource(regionD), textureSource, opts);
    this.regionD = regionD;
  }

  /** @type {TerrainGeometry|null} */
  get geometry() { return this.geometrySource.geometry; }
}

/**
 * Parallax mesh for a single tile at its own elevation (flat quad, alpha cutout, no walls).
 */
export class ParallaxTileMesh extends ParallaxMesh {

  /** @type {TileDocument} */
  tileD;

  /**
   * @param {TileDocument} tileD
   * @param {object} [opts]                    Same as ParallaxMesh
   * @param {boolean} [opts.hideOriginal=true] Hide the tile's undisplaced mesh while this is shown
   */
  constructor(tileD, { hideOriginal = true, wallMode = "none", ...opts } = {}) {
    super(new TileQuadGeometrySource(tileD, { hideOriginal }), new TileTextureSource(tileD), { wallMode, ...opts });
    this.tileD = tileD;
  }
}
