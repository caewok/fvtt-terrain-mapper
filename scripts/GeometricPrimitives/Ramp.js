/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ExtrudedPolygonPrimitiveWithHoles } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { Polygon3d, Polygons3d } from "../geometry/3d/Polygon3d.js";
import { Point3d } from "../geometry/3d/Point3d.js";

/**
 * Ramp.
 * Use the model primitive b/c the base of the ramp is 1+ polygons, which can change.
 */
export class RampPrimitive extends ExtrudedPolygonPrimitiveWithHoles {

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

    return [bottom, top, ...top.buildTopSides(bottomZ)]; // Match steps and hill, which have bottom followed by complex top.
  }

  /**
   * Build an extruded (along the z-axis) shape from a 3d polygon base, with a planar ramp as the top.
   * The base elevation represents the bottom of the ramp.
   * Base normal should typically face down.
   * @param {Polygon3d|Polygons3d} base          Base 3d polygon to use
   * @param {Plane} plane             The plane representing the ramp at the top
   * @param {number} topZ             The top elevation (highest ramp point)
   */
  static fromBasePolygon3d(id, base, { plane, ...opts } = {})  {
    // Confirm base orientation is facing down.
    using ctr = base.centroid.clone();
    ctr.z += 1;
    if ( base.isFacing(ctr) ) base.reverseOrientation();

    const top = base.clone();
    top.reverseOrientation();

    // Re-project the top onto the plane.
    rampFromPlane(top, plane);

    // Clean up the top values.
    if ( top.polygons ) top.polygons.forEach(poly => poly.points.forEach(pt => pt.roundDecimals(4)));
    else top.points.forEach(pt => pt.roundDecimals(4));

    const EPSILON = 1e-04; // Larger epsilon because these side will eventually be transformed to a smaller prototype.
    const bottomZ = opts.bottomZ;
    const faces = [base, top, ...top.buildTopSides(bottomZ, EPSILON)];
    const protoFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, protoFaces);
  }

  _testFacesOutward(faces) {
    if ( !faces || faces.length < 3 ) return false;

    // Test each face against the centroid.
    const centroid = this.constructor.calculateCentroid(faces);
    for ( const face of faces ) {
      if ( face.isFacing(centroid) ) return false;
    }
    return true;
  }

  // ----- NOTE: Elevation testing ------ //

  get rampFace() { return this.faces[1]; }

  get baseFace() { return this.faces[0]; }

  /**
   * Elevation at a canvas location.
   * @param {PIXI.Point} canvasLoc
   * @returns {number|null} Z-value in pixel units or null if not within the ramp.
   */
  elevationAtCanvasLocation(canvasLoc, { testContainment = true } = {}) {
    if ( testContainment ) {
      const poly = this.baseFace.toPolygon2d();
      if ( !poly.contains(canvasLoc.x, canvasLoc.y) ) return null;
    }
    return this.rampFace.plane.getZ(canvasLoc.x, canvasLoc.y);
  }

  get bottomZ() { return this.baseFace.plane.point.z; }

  get topZ() {
    let topZ = Number.NEGATIVE_INFINITY;
    this.faces.slice(1).forEach(f => {
      for ( const poly of f.polygons || [f] ) {
        topZ = Math.max(topZ, ...poly.points.map(pt => pt.z));
      }
    });
    return topZ;
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    // Build the cutaways with a mock topZ.
    const bottomZ = this.bottomZ;
    const topZ = bottomZ + 100;
    const cutaways = super.verticalSlice(start, end, { topZ, bottomZ });

    // Determine the actual ramp elevation for each cutaway top point.
    using canvasLoc = Point3d.tmp;
    const opts = { topZ: this.topZ, bottomZ, testContainment: false };
    for ( const cutaway of cutaways ) {
      for ( let i = 1, n = cutaway.points.length; i < n; i += 2 ) {
        const y = cutaway.points[i];
        if ( y !== topZ ) continue;
        const x = cutaway.points[i - 1];
        cutaway._from2d({ x, y }, canvasLoc);
        cutaway.points[i] = this.elevationAtCanvasLocation(canvasLoc, opts);
      }
    }

    return cutaways;
  }
}

/**
 * Create a ramp at an angle from the XY canvas (moving up the z-plane), projecting the
 * shape from a 3d polygon.
 * The bottom of the ramp will be the lowest intersection point.
 * (A horizontal plane will create a plateau or hole, although ExtrudedPolygonPrimitive would be simpler.)
 * @param {Polygon3d|Polygons3d} poly3d
 * @param {Plane} plane
 * @returns The poly3d, modified in place.
 */
function rampFromPlane(poly3d, plane) {
  // Project each point of the polygon onto the plane.
  if ( poly3d instanceof Polygons3d ){
    for ( const poly of poly3d.polygons ) {
       for ( const pt of poly.points) pt.z = plane.getZ(pt.x, pt.y);
    }
  } else {
    for ( const pt of poly3d.points ) pt.z = plane.getZ(pt.x, pt.y);
  }
  poly3d.clearCache();

  // Adjust the plane to exactly match.
  poly3d.plane = plane;

  return poly3d;
}

