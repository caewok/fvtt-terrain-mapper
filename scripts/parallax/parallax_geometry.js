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

/* Parallax geometry for terrain regions.

Pipeline:
  TerrainGeometry (world-space faces, pixel units)
    --> ParallaxGeometryBuilder.build()   flat arrays: x, y, h (height above ground), uv, normal; sorted low-to-high
    --> ParallaxRegionMesh                PIXI.Mesh; vertex shader scales xy about the camera center by a capped perspective factor

Works unchanged for plateau, ramp, steps, hill, holes, rings, cones: it only reads the
faces that the primitives already expose, so no per-terrain-type code.
*/

// ----- NOTE: Builder ----- //

export class ParallaxGeometryBuilder {

  /** Faces with normal.z above this are treated as "top" surfaces. Below -this are bottoms (dropped). */
  static NZ_EPS = 1e-3;

  /** Triangles lower than this (pixels above ground) contribute nothing visible. */
  static MIN_HEIGHT = 0.5;

  /** How far outside a wall (in grid squares) to sample the texture for the wall strip. */
  static WALL_UV_INSET = 0.12;

  /**
   * @typedef {object} ParallaxData
   * @prop {Float32Array} positions   x, y, h per vertex (3 floats); h is pixels above groundZ
   * @prop {Float32Array} uvs         Scene-background uv per vertex (2 floats)
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
   * @returns {ParallaxData|null} Null if nothing to draw (e.g., terrain at ground level)
   */
  static build(geom, { groundZ, maxHeight = Number.POSITIVE_INFINITY } = {}) {
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

    // Painter's order, low to high: higher treads/ridges cover lower ones.
    // At equal key, walls first so the top that caps them draws over.
    kept.sort((a, b) => (a.key - b.key) || (a.isTop - b.isTop));

    // Flat per-triangle vertices.
    const n = kept.length * 3;
    const positions = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const normals = new Float32Array(n * 3);
    const rect = canvas.dimensions.sceneRect;
    let maxH = 0;
    let p = 0; let u = 0; let q = 0;
    const wallInset = canvas.grid.size * this.WALL_UV_INSET;
    for ( const k of kept ) {
      const { t } = k;
      const verts = [[t.ax, t.ay, k.hA], [t.bx, t.by, k.hB], [t.cx, t.cy, k.hC]];

      // Wall normals point away from the material (into the hole for hole walls).
      // Sampling the ground just outside the wall, instead of the platform edge,
      // turns the exposed wall strip into a low-contrast ground/shadow streak, not a smeared stone border.
      const inset = k.isTop ? 0 : wallInset;
      for ( const [x, y, h] of verts ) {
        positions[p++] = x; positions[p++] = y; positions[p++] = h;
        uvs[u++] = ((x + (k.nx * inset)) - rect.x) / rect.width;
        uvs[u++] = ((y + (k.ny * inset)) - rect.y) / rect.height;
        normals[q++] = k.nx; normals[q++] = k.ny; normals[q++] = k.nz;
        if ( h > maxH ) maxH = h;
      }
    }
    return { positions, uvs, normals, vertexCount: n, maxHeight: maxH };
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


// ----- NOTE: Shader ----- //

const VERT = `
precision highp float;
attribute vec3 aPosition;   // x, y (scene px), h (px above ground)
attribute vec2 aUV;
attribute vec3 aNormal;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uCenter;       // Camera center, scene coords (canvas.stage.pivot)
uniform float uCamH;        // Virtual camera height above ground, px. Scale ~ 1 + h / uCamH for small h.
uniform float uMaxScale;    // Cap on the scale, so tall terrain far from center cannot blow up.
varying vec2 vUV;
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
  vH = aPosition.z;

  // Walls are visible only if the camera (above uCenter) is on the wall's normal side.
  // n . (c - p) is constant along a vertical planar wall, so it is safe to interpolate.
  vSide = aNormal.z > 0.001 ? 0.0 : 1.0;
  vFacing = vSide > 0.5 ? dot(aNormal.xy, uCenter - aPosition.xy) : 1.0;
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
varying float vFacing;
varying float vSide;
varying float vH;
uniform sampler2D uTex;
uniform float uSideShade;   // 0..1 multiplier for walls at the ground contact
uniform float uFadePx;      // Height (px) over which the wall shade fades from uSideShade up to 1
uniform float uAlpha;
void main() {
  if ( vFacing <= 0.0 ) discard;
  vec4 c = texture2D(uTex, vUV);

  // Contact shadow: walls are darkest where they meet the ground and lighten toward the edge.
  float wall = mix(uSideShade, 1.0, smoothstep(0.0, uFadePx, vH));
  float shade = mix(1.0, wall, vSide);
  gl_FragColor = vec4(c.rgb * shade, c.a) * uAlpha;
}`;


// ----- NOTE: Mesh wrapper ----- //

/**
 * One parallax mesh per region. Rebuilds when the region's geometry changes.
 */
export class ParallaxRegionMesh {

  /** @type {RegionDocument} */
  regionD;

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
  maxScale = 1.1;

  #version = -1;

  constructor(regionD, { strength = 0.05, sideShade = 0.6, alpha = 1, maxScale = 1.15 } = {}) {
    this.regionD = regionD;
    this.strength = strength;
    this.sideShade = sideShade;
    this.alpha = alpha;
    this.maxScale = maxScale;
  }

  // ----- Per-frame camera center ----- //

  /** @type {Set<ParallaxRegionMesh>} Instances that currently own a mesh. */
  static #active = new Set();

  static #tickFn = null;

  /** Update every active mesh's view center from the current camera. Covers pan, zoom, resize, initial load. */
  static #tick() {
    const { x, y } = canvas.stage.pivot;
    for ( const pm of this.#active ) pm.setCenter(x, y);
  }

  static #register(pm) {
    this.#active.add(pm);
    if ( this.#tickFn ) return;
    this.#tickFn = () => this.#tick();
    canvas.app.ticker.add(this.#tickFn, undefined, PIXI.UPDATE_PRIORITY.HIGH); // Before the render pass.
  }

  static #unregister(pm) {
    this.#active.delete(pm);
    if ( this.#active.size || !this.#tickFn ) return;
    canvas.app.ticker.remove(this.#tickFn);
    this.#tickFn = null;
  }

  /** @type {TerrainGeometry|null} */
  get geometry() {
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.regions.geomForDocument(this.regionD) ?? null;
  }

  /**
   * Scene background texture sampled by the top and sides.
   * TODO: confirm for v14 levels (per-level backgrounds).
   * @returns {PIXI.Texture|null}
   */
  static resolveTexture() {
    const bg = canvas.primary?.background;
    if ( bg?.texture ) return bg.texture;
    const src = canvas.scene?.background?.src;
    return src ? PIXI.Texture.from(src) : null;
  }

  /**
   * Rebuild if the geometry changed since last time. Cheap when unchanged.
   * @param {PIXI.Container} parent    Where to add the mesh (e.g., canvas.primary)
   * @returns {boolean} True if rebuilt
   */
  refresh(parent) {
    const geom = this.geometry;
    if ( !geom ) { this.destroy(); return false; }
    if ( geom.updateCount === this.#version && this.mesh ) return false;
    this.#version = geom.updateCount;

    const data = ParallaxGeometryBuilder.build(geom);
    if ( !data ) { this.destroy(); return true; }

    const texture = this.constructor.resolveTexture();
    if ( !texture ) { this.destroy(); return true; }

    const meshGeom = new PIXI.Geometry()
      .addAttribute("aPosition", data.positions, 3)
      .addAttribute("aUV", data.uvs, 2)
      .addAttribute("aNormal", data.normals, 3);

    if ( this.mesh ) {
      // Replace geometry, keep shader (and its shared uniforms).
      const old = this.mesh.geometry;
      this.mesh.geometry = meshGeom;
      old.destroy();
    } else {
      const shader = PIXI.Shader.from(VERT, FRAG, {
        uTex: texture,
        uCenter: [0, 0],
        uCamH: 1e6,
        uMaxScale: this.maxScale,
        uSideShade: this.sideShade,
        uFadePx: canvas.grid.size * 0.5,
        uAlpha: this.alpha,
      });
      this.mesh = new PIXI.Mesh(meshGeom, shader);
      parent.addChild(this.mesh);
      this.constructor.#register(this);
    }
    this.mesh.shader.uniforms.uTex = texture;
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
    this.constructor.#unregister(this);
    if ( !this.mesh ) return;
    this.mesh.parent?.removeChild(this.mesh);
    this.mesh.destroy({ children: true });
    this.mesh = null;
  }
}
