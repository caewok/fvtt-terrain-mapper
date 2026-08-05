/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ModelGeometricPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Matrix } from "../geometry/Matrix.js";
import { Polygons3d, Quad3d } from "../geometry/3d/Polygon3d.js";

/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class StepsPrimitive extends ModelGeometricPrimitive {

  /**
   * Treating a set of polygons as a base, extrudes steps.
   * Polygons must be arranged such that the steps run from west to east.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} poly       2d polygons to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, { bottomZ = 0, stepWidth = 1, stepHeight = 1, ...opts } = {}) {
    const faces = createSteps(polys, { bottomZ, stepWidth, stepHeight });
    return this.fromCanvasFaces(id, faces, opts);
  }
}

/**
 * Create vertical polygon planks for an array of 2d polygons.
 * @param {PIXI.Polygon[]} polys
 * @param {number} [plankWidth=1]
 */
export function verticalPlanks(polys, plankWidth = 1) {
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
  const rectClipper = ClipperPaths.fromPolygon(rect.toPolygon());
  const txMat = Matrix.translation({ x: plankWidth, y: 0, z: 0 });

  const planks = [];

  for ( let x = aabb.min.x; x < aabb.max.x; x += plankWidth ) {
    // Intersect the plank rectangle with the clipper paths.
    planks.push({
      x,
      plank: paths.intersectPaths(rectClipper)
    });

    // Move bounding rectangle to next plank.
    // TODO: transform in place.
    rectClipper.transform(txMat, rectClipper);
  }
  return planks;
}

/**
 * Create steps running along the y axis.
 * Starts with vertical plank, followed by horizontal plank
 * @param {PIXI.Polygon[]} polys
 * @param {object} opts
 * - @prop {number} [plankWidth=1]
 * - @prop {number} [plankHeight=1]
 * - @prop {number} [bottomZ=0]
 * @returns {Polygon3d[]} Polygons3d, Quad3d.
 */
function createSteps(polys, { stepWidth = 1, stepHeight = 1, bottomZ = 0 } = {}) {
  const planks = verticalPlanks(polys, stepWidth);
  const out = [];

  // Build the bottom.
  const bottom3d = Polygons3d.fromPolygons(polys, bottomZ);
  out.push(bottom3d);

  // From west side, steps rise up.
  // Start with a vertical, followed by horizontal.
  using a = Point3d.tmp;
  using b = Point3d.tmp;
  using c = Point3d.tmp;
  using d = Point3d.tmp;

  // Build the step planks. Horizontal Polygons3d and vertical Quad3d.
  for ( const { x, plank } of planks ) {
    const polys = plank.toPolygons();

    // Vertical
    // Determine the minimum and maximum y along the west edge of the plank.
    // Build a vertical quad stretching from minimum to maximum y.
    for ( const poly of polys ) {
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for ( const pt of poly.iteratePoints() ) {
        if ( pt.x.almostEqual(x) ) {
          minY = Math.min(pt.y, minY);
          maxY = Math.max(pt.y, maxY);
        }
      }
      // Vertical quad facing west.
      const quad3d = Quad3d.from4Points(
        a.set(x, minY, bottomZ + stepHeight),  // TL, looking east
        b.set(x, minY, bottomZ), // BL
        c.set(x, maxY, bottomZ), // BR
        d.set(x, maxY, bottomZ + stepHeight), // TR
      )
      out.push(quad3d);

      // Sides
      // Quad straight at the edges of the plank.
      // Edges are segments that do not share the same x value.
      for ( const edge of poly.iterateEdges() ) {
        const { a, b } = edge;
        if ( a.x.almostEqual.b.x ) continue;
        const quad3d = Quad3d.from4Points(
          a.set(a.x, a.y, bottomZ + stepHeight),
          b.set(b.x, b.y, bottomZ + stepHeight),
          c.set(b.x, b.y, bottomZ),
          d.set(a.x, a.y, bottomZ),
        )
        out.push(quad3d);
      }
    }

    // Move up to the top of the vertical step.
    bottomZ += stepHeight;

    // Back
    // The plank polygons are all at the same elevation.
    const poly3d = Polygons3d.fromPolygons(polys, bottomZ);
    out.push(poly3d);
  }

  // Build the back face.
  // Examine the last plank to locate the top and bottom of the final quad.
  const { x, plank } = planks.at(-1);
  for ( const edge of plank.iterateEdges() ) {
    const { a, b } = edge;
    if ( a.x === b.x && a.x > x ) {
      const quad3d = Quad3d.from4Points(
        a.set(a.x, a.y, bottomZ + stepHeight),
        b.set(b.x, b.y, bottomZ + stepHeight),
        c.set(b.x, b.y, bottomZ),
        d.set(a.x, a.y, bottomZ),
      )
      out.push(quad3d);
      break;
    }
  }
  return out;
}