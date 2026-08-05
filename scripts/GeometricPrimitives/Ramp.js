/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ModelGeometricPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygon3d, Polygons3d } from "../geometry/3d/Polygon3d.js";

/**
 * Ramp.
 * Use the model primitive b/c the base of the ramp is 1+ polygons, which can change.
 */
export class RampPrimitive extends ModelGeometricPrimitive {

  /**
   * Treating a set of polygons as a base, extrudes steps.
   * Polygons must be arranged such that the steps run from west to east.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} poly       2d polygons to use.
   * @param {Plane} plane
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, plane, opts) {
    const faces = rampFromPlane(polys, plane);
    return this.fromCanvasFaces(id, faces, opts);
  }
}

/**
 * Create a ramp from a plane crossing an array of polygons.
 * The bottom of the ramp will be the lowest intersection point.
 * (A horizontal plane will create a plateau or hole, although ExtrudedPolygonPrimitive would be simpler.)
 * @param {PIXI.Polygon[]} polys
 * @param {Plane} plane
 */
export function rampFromPlane(polys, plane) {
  // Project each point of the polygon onto the plane.
  using tmp = Point3d.tmp;
  using txPt = Point3d.tmp;
  const top = new Polygons3d();
  let minZ = Number.POSITIVE_INFINITY;
  for ( const poly of polys ) {
    const n = poly.points.length;
    const poly3d = new Polygon3d(n * 0.5);
    poly3d.plane.normal.copyFrom(plane.normal);
    poly3d.plane.point.copyFrom(plane.point);
    for ( let i = 0; i < n; i += 2 ) {
      const x = poly.points[i];
      const y = poly.points[i + 1]
      tmp.set(x, y, 0);
      plane.projectPointOnPlane(tmp, txPt);
      poly3d.points[i].copyFrom(txPt);
      minZ = Math.min(minZ, txPt.z);
    }
    top.polygons.push(poly3d);
  }

  // Build bottom.
  const bottom = Polygon3d.fromPolygons(polys, minZ);

  // Build sides.
  const sides = top
    .buildTopSides(minZ)

    // Confirm no degenerate sides with no height.
    .filter(side => {
      side.clean();
      return side.points.length > 3;
    });
  return [top, bottom, ...sides];
}