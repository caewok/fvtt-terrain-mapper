/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ExtrudedPolygonPrimitiveWithHoles } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Polygons3d, Quad3d } from "../geometry/3d/Polygon3d.js";

/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class StepsPrimitive extends ExtrudedPolygonPrimitiveWithHoles {

  /**
   * Build an extruded steps shape (top face is steps) from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]          Top elevation
   * @param {number} [opts.bottomZ]       Bottom elevation
   * @param {number} [opts.stepWidth=1]   Width of a step
   * @param {number} [opts.stepHeight=1]  Height of a step
   * @returns {RampPrimitive}
   */
  // static fromPolygon(id, poly, { stepWidth = 1, stepHeight = 1, topZ, bottomZ }) // Uses the parent class.

  /**
   * Build an extruded steps shape (top face is steps) for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} polys       2d polygons to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]          Top elevation
   * @param {number} [opts.bottomZ]       Bottom elevation
   * @param {number} [opts.stepWidth=1]   Width of a step
   * @param {number} [opts.stepHeight=1]  Height of a step
   * @returns {ExtrudedPolygonPrimitive}
   */
  // static fromPolygons(id, polys, { stepWidth = 1, stepHeight = 1, topZ, bottomZ }) // Uses the parent class.


  /**
   * Helper to create a 3d extruded shape from a polygon, with a top and bottom polygon
   * shapes and vertical sides.
   * @param {PIXI.Polygon} poly       Polygon shape to use for top and bottom faces.
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides.
   */
  static _facesFromPolygon(poly, opts) {
    return this.createStepsFromPolygons2d([poly], opts);
  }

  static fromBasePolygon3d(id, base, { stepHeight = 1, stepWidth = 1, planks, ...opts } = {}) {
    // Confirm base orientation is facing down.
    using ctr = base.centroid.clone();
    ctr.z += 1;
    if ( base.isFacing(ctr) ) base.reverseOrientation();

    // Extract the base 2d polygons (presumes a flat base, so simply drop z).
    const polys = base.polygons ? base.toPolygon2d() : [base.toPolygon2d()];

    // Build the steps
    const bottomZ = base.polygons ? base.polygons[0].points[0].z : base.points[0].z;
    planks ??= this.verticalPlanks(polys, stepWidth);
    const steps = this.createSteps(polys, planks, { stepHeight, stepWidth, bottomZ })

    // Transform to prototype shape using provided model.
    const faces = [base, ...steps];
    const protoFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, protoFaces);
  }

  /**
   * Create steps running along the y axis.
   * Starts with vertical plank, followed by horizontal plank
   * @param {PIXI.Polygon[]} polys
   * @param {object} opts
   * - @prop {number} [stepWidth=1]     Width of each step
   * - @prop {number} [stepHeight=1]    Height of each step
   * - @prop {number} [bottomZ=0]       The base elevation of the steps
   * - @prop {Planks} [planks]          Output from verticalPlanks method
   * @returns {Polygon3d[]} Polygons3d, Quad3d.
   */
  static createStepsFromPolygons2d(polys, { stepHeight = 1, stepWidth = 1, bottomZ = 0, planks } = {}) {
    // Build the bottom.
    const bottom3d = Polygons3d.fromPolygons(polys, bottomZ);
    bottom3d.reverseOrientation(); // Face bottom down.

    // Build the steps.
    planks ??= this.verticalPlanks(polys, stepWidth);
    const steps = this.createSteps(polys, planks, { stepHeight, stepWidth, bottomZ });

    return [bottom3d, ...steps];
  }

  /**
   * Create steps running along the y axis.
   * Starts with vertical plank, followed by horizontal plank.
   *
   * Every plank-strip edge is classified as it's built:
   *   - Hole edges are always exposed straight down to the floor.
   *   - Non-vertical (non-x-const) edges are always the shape's true boundary
   *     (Clipper's strip-clipping never introduces new non-vertical edges), so they
   *     are always exposed straight down to the floor -- these are the "outer edges."
   *   - Vertical (x-const) edges are tested against the ORIGINAL, unsliced polygon
   *     set on both sides. If material genuinely continues on both sides, the edge is
   *     purely an artifact of slicing the shape into planks -- a short riser is built
   *     instead, connecting this step down to the next lower one.
   *     If material exists on at most one side, it's a true boundary (a notch, or the
   *     west/east end of the shape) and gets the full-height treatment instead.
   * All the resulting wall pieces are combined at the end via
   * Polygons3d.combineCoplanar, so a run of same-plane pieces (e.g. a flat stretch of
   * outer wall spanning several planks) becomes a single object rather than many
   * small quads.
   * @param {PIXI.Polygon[]} polys    The ORIGINAL, unsliced 2d polygons for this base
   *                                  (holes should have `.isHole` set, or use
   *                                  clockwise/negative winding).
   * @param {Planks} planks           Output from verticalPlanks(polys, stepWidth).
   * @param {object} opts
   * - @prop {number} [stepWidth=1]     Width of each step
   * - @prop {number} [stepHeight=1]    Height of each step
   * - @prop {number} [bottomZ=0]       The base elevation of the steps
   * @returns {(Polygon3d|Polygons3d)[]}
   */
  static createSteps(polys, planks, { stepHeight = 1, stepWidth = 1, bottomZ = 0 } = {}) {
    const out = [];
    const wallPieces = [];
    const floorZ = bottomZ;

    // Small nudge, scaled to the step width, used to test for material just off
    // either side of a vertical edge without landing exactly on the boundary.
    const NUDGE = stepWidth / 1000;

    for ( const { x: stripMinX, plank } of planks ) {
      const stepTop = bottomZ + stepHeight; // Top of this row's tread.

      for ( const poly of plank ) {
        const isHole = !poly.isPositive;

        for ( const edge of poly.iterateEdges() ) {
          const { a, b } = edge;

          if ( isHole ) {
            // Every hole edge is exposed to the floor for this row.
            wallPieces.push(this.#buildWallQuad(a, b, floorZ, stepTop));
            continue;
          }

          if ( !a.x.almostEqual(b.x) ) {
            // Outer edges go to the floor (full height).
            // (Clipper only introduces new edges along the strip's vertical sides.)
            wallPieces.push(this.#buildWallQuad(a, b, floorZ, stepTop));
            continue;
          }

          // Vertical (x-const) edge: May be an outer edge (full height) or slicing artifact (step height).
          const edgeX = a.x;
          const midY = (a.y + b.y) * 0.5;
          const hasWest = this.#pointInPolys(polys, edgeX - NUDGE, midY);
          const hasEast = this.#pointInPolys(polys, edgeX + NUDGE, midY);
          if ( hasWest && hasEast ) {
            // Riser, not a full wall. Build only once, from the plank's own west edge so it is
            // not duplicated by the neighboring (lower, west) plank's east edge.
            if ( edgeX.almostEqual(stripMinX) ) wallPieces.push(this.#buildWallQuad(a, b, bottomZ, stepTop));
            // Else this is the current plank's east edge. The next plank to the
            // east will build this same riser from its own west-edge pass, using
            // its own (higher) bottomZ/stepTop -- skip here to avoid a duplicate.

          // True outer bounds using full height. Notch, or west/east end of the shape.
          } else wallPieces.push(this.#buildWallQuad(a, b, floorZ, stepTop))
        }
      }

      // Move up one step.
      bottomZ += stepHeight;

      // Tread: the horizontal cap at the top of this step/plank row.
      // Polygons3d.fromPolygons derives isHole per-piece from orientation, so any
      // hole passing through this row is correctly left open in the tread.
      if ( plank.length ) out.push(Polygons3d.fromPolygons(plank, bottomZ));
    }

    // Weld same-plane wall pieces into as few objects as possible.
    out.push(...Polygons3d.combineCoplanar(wallPieces));
    return out;
  }

  /**
   * Build a single vertical wall quad along a 2d edge, from zBottom to zTop.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {number} zBottom
   * @param {number} zTop
   * @returns {Quad3d}
   */
  static #buildWallQuad(a, b, zBottom, zTop) {
    return Quad3d.from4Points(
      { x: a.x, y: a.y, z: zTop },
      { x: b.x, y: b.y, z: zTop },
      { x: b.x, y: b.y, z: zBottom },
      { x: a.x, y: a.y, z: zBottom },
    );
  }

  /**
   * Hole-aware point-in-shape test against a flat array of 2d polygons.
   * Mirrors the winding-count approach used by Polygons3d#interiorPoint.
   * @param {PIXI.Polygon[]} polys
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  static #pointInPolys(polys, x, y) {
    let count = 0;
    for ( const poly of polys ) {
      const isHole = poly.isHole ?? !poly.isPositive;
      if ( poly.contains(x, y) ) count += isHole ? -1 : 1;
    }
    return count > 0;
  }

  /**
   * @typedef {Plank[]} Planks
   */

  /**
   * @typedef {object} Plank
   * @prop {number} x               The x value of the plank start
   * @prop {PIXI.Polygon[]} plank   PIXI.Polygons representing the plank
   */

  /**
   * Create vertical polygon planks for an array of 2d polygons.
   * Essentially stripes the polygon along the y-axis.
   * @param {PIXI.Polygon[]} polys
   * @param {number} [plankWidth=1]
   * @returns {Planks}
   */
  static verticalPlanks(polys, plankWidth = 1) {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const paths = ClipperPaths.fromPolygons(polys);
    const aabb = AABB2d.union(polys.map(poly => AABB2d.fromPolygon(poly)));

    // Iterate over the bounding box horizontally by plankWidth.
    const rect = new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      plankWidth,
      aabb.max.y - aabb.min.y,
    );
    const rectClipper = ClipperPaths.fromPolygons([rect.toPolygon()]);
    const scale = rectClipper.scalingFactor
    const path = rectClipper.paths[0];
    const clipperXShift = Math.round(scale * plankWidth)
    const planks = [];
    for ( let x = aabb.min.x; x < aabb.max.x; x += plankWidth ) {
      // Intersect the plank rectangle with the clipper paths.
      planks.push({
        x,
        plank: paths.intersectPaths(rectClipper).toPolygons(),
      });

      // Shift the rectangle to the new x.
      // Do this manually by modifying the Clipper object for performance.
      path[0].X += clipperXShift;  // TL
      path[1].X += clipperXShift;  // TR
      path[2].X += clipperXShift;  // BR
      path[3].X += clipperXShift;  // BL
    }
    return planks;
  }
}
