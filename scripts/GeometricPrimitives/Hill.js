/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ModelGeometricPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygons3d, Triangle3d } from "../geometry/3d/Polygon3d.js";
import * as Delaunay from "../geometry/d3-delaunay.js";


/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class HillPrimitive extends ModelGeometricPrimitive {

  /**
   * Treating a set of polygons as a base, extrudes a hill.
   * @param {string} id                   Identifier for this shape.
   * @param {PIXI.Polygon[]} polys        2d polygons to use.
   * @param {BézierCurve} curve           Normalized, scaled curve data
   * @param {object} [opts]
   * @param {"linear"|"symmetrical"|"ridge"} [opts.type="linear"]
   * @param {number} [elevationZ=0]
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, curve, { mgr, type = "linear", elevationZ = 0, ...opts } = {}) {
    const faces = extrudeHillShape(polys, curve, mgr, elevationZ, type);
    return this.fromCanvasFaces(id, faces, opts);
  }
}


/**
 * @typedef {BézierCurve}
 * @prop {PIXI.Point} start
 * @prop {PIXI.Point} cp1
 * @prop {PIXI.Point} cp2
 * @prop {PIXI.Point} end
 *
 * Optional orientation:
 * @prop {PIXI.Point} [left]      Where the hill starts on the 2d canvas.
 * @prop {PIXI.Point} [right]     Where the hill ends on the 2d canvas.
 */


/**
 * Extrude a curved shape from an array of polygons, representing a hill.
 * @param {PIXI.Polygon[]} polys        2d polygons to use for the base
 * @param {BézierCurve} curve           Normalized, scaled curve data
 * @param {number} [elevationZ=0]
 * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
 * @returns {(Polygon3d|Triangle3d)[]} Triangles forming the hillside plus a Polygon3d base
 */
function extrudeHillShape(polys, curve, mgr, elevationZ = 0, type = "linear") {

  // From hillZAtPoint.
  curve ??= mgr.hillData();
  const scaledCurve = this.constructor.duplicateCurve(curve);
  this.scaleCurveOrientation(scaledCurve);

  // Polygon3d base.
  const out = [Polygons3d.fromPolygons(polys, elevationZ)];

  // Build the triangulation.
  const lattice = hillLattice(polys, scaledCurve);
  out.push(...triangulateHillLattice(lattice, mgr, scaledCurve, type));

  // From hillZAtPoint.
  Object.values(curve).forEach(pt => pt.release());
  Object.values(scaledCurve).forEach(pt => pt.release());

  return out;
}

/**
 * Triangulate the points and adjust to elevation for the hill.
 * @param {PIXI.Point[]} ptsLattice
 * @param {BézierCurve} curve           Normalized, scaled curve data
 * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
 * @returns {Triangle3d[]}
 */
function triangulateHillLattice(ptsLattice, mgr, curve, type) {
  const delaunay = Delaunay.from(ptsLattice);
  const triangles = delaunay.triangles; // Array of indices pointing to our original array.
  const n = triangles.length;
  const numTriangles = n / 3;

  // Construct the final triangles
  using a = Point3d.tmp;
  using b = Point3d.tmp;
  using c = Point3d.tmp;
  const tris = Array(numTriangles);
  let j = 0;
  for ( let i = 0; i < n; ) {
    const a2d = ptsLattice[triangles[i++]];
    const b2d = ptsLattice[triangles[i++]];
    const c2d = ptsLattice[triangles[i++]];
    a.set(a2d.x, a2d.y, mgr._hillZAtPoint(a2d, type, curve, curve));
    b.set(b2d.x, b2d.y, mgr._hillZAtPoint(b2d, type, curve, curve));
    c.set(c2d.x, c2d.y, mgr._hillZAtPoint(c2d, type, curve, curve));
    tris[j++] = Triangle3d.from3Points(a, b, c);
  }

  return tris;
}

/**
 * Generate a lattice of 3d points that will cover the polygon(s) that are the base of the hill.
 * Adds points to cover the polygon edges, corners, and curve ridgeline.
 * @param {PIXI.Polygon[]} polys          2d polygons to use for the base
 * @param {BézierCurve} curve             Normalized, scaled curve data
 * @param {number} [baseElevation=0]      Base elevation, pixel units
 * @returns {PIXI.Point[]}
 */
function hillLattice(polys, curve) {
  // Determine the points lattice for the polygon.
  const spacing = (CONFIG[GEOMETRY_LIB_ID].CONFIG.meshSpacing || 0.5) * canvas.grid.size;
  const opts = { spacing, startAtEdge: false };

  const contains = pt => {
    let count = 0;
    for ( const poly of polys ) {
      const mult = poly.isPositive ? 1 : -1;
      count += (poly.contains(pt.x, pt.y) * mult);
    }
    return count > 0;
  }

  // Add corners, edges, inner lattice.
  const ptsLattice = [];
  using dir = PIXI.Point.tmp;
  using tmp = PIXI.Point.tmp;
  polys.forEach(poly => {
    if ( !poly.isPositive ) return; // Skip holes.

    // Inner lattice.
    const innerLattice = poly.pointsLattice(opts).filter(pt => contains(pt));
    ptsLattice.push(...innerLattice);

    // Corners.
    ptsLattice.push(...poly.iteratePoints())

    // Edges.
    for ( const edge of poly.iterateEdges() ) {
      const { a, b } = edge;

      // Use the same spacing.
      b.subtract(a, dir).normalize(dir);

      // Add until nearly reaching the other end.
      const dist = PIXI.Point.distanceBetween(a, b) - (spacing * 0.5); // Don't run right up to corner
      for ( let d = spacing; d < dist; d += spacing ) ptsLattice.push(a.add(dir.multiplyScalar(d, tmp)));
    }
  });

  // Add linear points along the primary curve line, testing for containment.
  if ( contains(curve.left) ) ptsLattice.push(curve.left);
  if ( contains(curve.right) ) ptsLattice.push(curve.left);

  curve.right.subtract(curve.left, dir).normalize(dir);
  const dist = PIXI.Point.distanceBetween(curve.left, curve.right);
  for ( let d = spacing; d < dist; d += spacing ) {
    const pt = curve.left.add(dir.multiplyScalar(d, tmp));
    if ( contains(pt) ) ptsLattice.push(pt);
  }

  return ptsLattice;
}
