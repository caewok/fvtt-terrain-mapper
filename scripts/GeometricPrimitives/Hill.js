/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { HillDrawingManager } from "../regions/HillDrawingManager.js";
import { ExtrudedPolygonPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygons3d, Triangle3d, Quad3d } from "../geometry/3d/Polygon3d.js";
import { Delaunay } from "../geometry/d3-delaunay.js";

/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class HillPrimitive extends ExtrudedPolygonPrimitive {

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
    return this.extrudeHillShape([poly], opts);
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
   * @returns {(Polygon3d|Triangle3d|Quad3d)[]} Triangles forming the hillside plus a Polygon3d base and Quad3d sides.
   */
  static extrudeHillShape(polys, { curve, bottomZ, topZ, type = "linear" } = {}) {
    // Polygon3d base.
    const bottom = Polygons3d.fromPolygons(polys, bottomZ);
    bottom.reverseOrientation();
    const out = [bottom];

    // Build the triangulation.
    const lattice = this.hillLattice(polys, curve);
    out.push(...this.triangulateHillLattice(lattice, curve, topZ, bottomZ, type));

    // Build the sides.
    out.push(...this._buildSides(bottom, curve, topZ, bottomZ, type));

    return out;
  }

  /**
   * Extrude the perimeter edges of a base polygon up to the top Bézier mesh using quads.
   * Skips where the mesh edge matches the base elevation.
   * @param {Polygon3d} bottom      The bottom shape
   * @param {BézierCurve} curve           Normalized, scaled curve data
   * @param {number} [elevationZ=0]
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
   * @returns {Quad3d[]} Array of quads, if any.
   */
  static _buildSides(bottom, curve, topZ, bottomZ, type = "linear") {
    const zHeight = topZ - bottomZ;
    const sideQuads = [];
    for ( const basePoly of bottom.polygons ) {
      const ctr = basePoly.centroid;
      for ( const edge of basePoly.iterateEdges({ close: true }) ) {
        const { a: bottomA, b: bottomB } = edge;

        // Determine the top elevation for both vertices along the hill curve mesh.
        const percentA = HillDrawingManager._hillPercentHeightAtPoint(bottomA, type, curve);
        const percentB = HillDrawingManager._hillPercentHeightAtPoint(bottomB, type, curve);

        const zA = bottomZ + (percentA * zHeight);
        const zB = bottomZ + (percentB * zHeight);

        // Skip the quad if both top points are at the base elevation.
        if ( zA.almostEqual(bottomZ) && zB.almostEqual(bottomZ) ) continue;

        // Construct 4 points for the Quad3d wall segment.
        const topA = Point3d.tmp.set(bottomA.x, bottomA.y, zA);
        const topB = Point3d.tmp.set(bottomB.x, bottomB.y, zB);
        const quad = Quad3d.from4Points(topB, topA, bottomA, bottomB);

        // Ensure the normal faces outward.
        if ( quad.isFacing(ctr) ^ basePoly.isHole ) quad.reverseOrientation();
        sideQuads.push(quad);
      }
    }
    return sideQuads;
  }

  /**
   * Triangulate the points and adjust to elevation for the hill.
   * @param {PIXI.Point[]} ptsLattice
   * @param {BézierCurve} curve           Normalized, scaled curve data
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
   * @returns {Triangle3d[]}
   */
  static triangulateHillLattice(ptsLattice, curve, topZ, bottomZ, type) {
    // Pass an accessor function b/c the points lattice is an array of objects, not array tuples ([x, y]).
    const delaunay = Delaunay.from(ptsLattice, pt => pt.x, pt => pt.y);
    const triangles = delaunay.triangles; // Array of indices pointing to our original array.
    const n = triangles.length;
    const numTriangles = n / 3;

    // Construct the final triangles
    const zHeight = topZ - bottomZ;
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    const tris = Array(numTriangles);
    let j = 0;
    for ( let i = 0; i < n; ) {
      const a2d = ptsLattice[triangles[i++]];
      const b2d = ptsLattice[triangles[i++]];
      const c2d = ptsLattice[triangles[i++]];

      const percentA = HillDrawingManager._hillPercentHeightAtPoint(a2d, type, curve);
      const percentB = HillDrawingManager._hillPercentHeightAtPoint(b2d, type, curve);
      const percentC = HillDrawingManager._hillPercentHeightAtPoint(c2d, type, curve);

      const zA = bottomZ + (percentA * zHeight);
      const zB = bottomZ + (percentB * zHeight);
      const zC = bottomZ + (percentC * zHeight);

      a.set(a2d.x, a2d.y, zA);
      b.set(b2d.x, b2d.y, zB);
      c.set(c2d.x, c2d.y, zC);

      // a-b-c tends to build the triangles facing down. Reverse to face up, but check to be sure.
      const tri = Triangle3d.from3Points(c, b, a);
      if ( tri.plane.z < 0 ) tri.reverseOrientation();
      tris[j++] = tri;
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
  static hillLattice(polys, curve) {
    // Determine the points lattice for the polygon.
    const spacing = (CONFIG[MODULE_ID].meshSpacing || 0.5) * canvas.grid.size;
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
    if ( contains(curve.right) ) ptsLattice.push(curve.right);

    curve.right.subtract(curve.left, dir).normalize(dir);
    const dist = PIXI.Point.distanceBetween(curve.left, curve.right);
    for ( let d = spacing; d < dist; d += spacing ) {
      const pt = curve.left.add(dir.multiplyScalar(d, tmp));
      if ( contains(pt) ) ptsLattice.push(pt);
    }

    return ptsLattice;
  }


  // ----- NOTE: Debug ----- //

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
    /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  validateFacesOutward() {
    // The bottom of the hill should always face down.
    const ctr = this.faces[0].centroid.clone();
    ctr.z -= 1;
    if ( !this.faces[0].isFacing(ctr) ) return false;

    // Hill sides face away from the center point.
    ctr.z += 2;
    const sides = this.faces.filter(face => face.constructor._geoLibType === "Quad3d")
    for ( const side of sides ) {
      if ( side.isFacing(ctr) ) return false;
    }

    // Top of hill (slopes) never face fully away from the center, above the top elevation.
    ctr.z = this.aabb.max.z + 100;
    const tops = this.faces.filter(face => face.constructor._geoLibType === "Triangle3d")
    for ( const top of tops ) {
      if ( !top.isFacing(ctr) ) return false;
    }
    return true;
  }
}



