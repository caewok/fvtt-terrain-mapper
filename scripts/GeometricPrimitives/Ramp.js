/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ExtrudedPolygonPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygon3d, Polygons3d } from "../geometry/3d/Polygon3d.js";

/**
 * Ramp.
 * Use the model primitive b/c the base of the ramp is 1+ polygons, which can change.
 */
export class RampPrimitive extends ExtrudedPolygonPrimitive {

  /**
   * Build an extruded ramp shape (top moving up in z-axis) from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {object} [opts]
   * @param {Plane} [opts.plane]        The plane to use for the ramp
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {RampPrimitive}
   */
  // static fromPolygon(id, poly, { plane, topZ, bottomZ }) // Uses the parent class.

  /**
   * Build an extruded ramp shape (top moving up in z-axis) for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} polys       2d polygons to use.
   * @param {object} [opts]
   * @param {Plane} [opts.plane]        The plane to use for the ramp
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  // static fromPolygons(id, polys, { plane, topZ, bottomZ }) // Uses the parent class.


  // ----- NOTE: Factory helpers to construct faces ----- //

  /**
   * Build an extruded (along the z-axis) shape from a 2d polygon, with a planar ramp as the top.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {Plane} plane
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides
   */
  static _facesFromPolygon(poly, { plane, topZ, bottomZ } = {}) {
    const top = Polygon3d.fromPolygon(poly, topZ);
    return this._facesFromPolygon3d(top, plane, bottomZ);
  }

  /**
   * Build an extruded (along the z-axis) shape from a 2d polygon, with a planar ramp as the top.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {Plane} plane
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides
   */
  static _facesFromPolygon3d(top, plane, bottomZ) {
    const bottom = top.clone();
    bottom.setZ(bottomZ);
    bottom.reverseOrientation();

    // Re-project the top onto the plane.
    rampFromPlane(top, plane);

    return [top, bottom, ...top.buildTopSides(bottomZ)];
  }

}

/**
 * Create a ramp at an angle from the XY canvas (moving up the z-plane), projecting the
 * shape from a 3d polygon.
 * The bottom of the ramp will be the lowest intersection point.
 * (A horizontal plane will create a plateau or hole, although ExtrudedPolygonPrimitive would be simpler.)
 * @param {Polygon3d} poly3d
 * @param {Plane} plane
 * @returns The poly3d, modified in place.
 */
function rampFromPlane(poly3d, plane) {
  // Project each point of the polygon onto the plane.
  const top = new Polygons3d();
  for ( const pt of poly3d.iteratePoints() ) pt.z = plane.getZ(pt.x, pt.y);

  // Adjust the plane to exactly match.
  poly3d.plane.normal.copyFrom(plane.normal);

  return poly3d;
}