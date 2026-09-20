/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { HillDrawingManager } from "../regions/HillDrawingManager.js";
import { ExtrudedPolygonPrimitiveWithHoles } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygon3d, Triangle3d, Quad3d } from "../geometry/3d/Polygon3d.js";
import { Delaunay } from "../geometry/d3-delaunay.js";
import { roundDecimals, cleanPolygonPoints } from "../geometry/util.js";

/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class HillPrimitive extends ExtrudedPolygonPrimitiveWithHoles {

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
    // Polygon3d base.
    const bottom = Polygon3d.fromPolygon(poly, opts.bottomZ);
    bottom.reverseOrientation();

    return [bottom, ...this.extrudeHillShape([poly], opts)];
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
   * @param {object} opts
   * @param {BézierCurve} opts.curve           Normalized, scaled curve data
   * @param {number} opts.topZ                 Maximum height of the hill; used to scale the curve
   * @param {number} opts.groundZ              "Ground elevation" for the hill; where the curve = 0;
   * @param {number} opts.floorZ               How far down the sides should reach to hit the base
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
   * @returns {(Polygon3d|Triangle3d|Quad3d)[]} Triangles forming the hillside plus a Polygon3d base and Quad3d sides.
   */
  static extrudeHillShape(polys, { curve, topZ, groundZ, floorZ, type = "linear" } = {}) {
    // Build the triangulation.
    const EPSILON = 1e-04; // Larger epsilon because these side will eventually be transformed to a smaller prototype.
    const lattice = this.hillLattice(polys, curve);
    const topMesh = this
      .triangulateHillLattice(lattice, polys, curve, topZ, groundZ, type)
      .filter(tri => {
        tri.points = cleanPolygonPoints(tri.points, EPSILON);
        return tri.points.length === 3;
      });

    // Build the sides.
    const sides = this._buildSidesFromLattice(topMesh, floorZ);
    return [...topMesh, ...sides];
  }

  /**
   * Build an extruded (along the z-axis) shape from a 3d polygon base, with a triangulated hill mesh as the top.
   * The base elevation represents the bottom of the hill.
   * Base normal should typically face down.
   * @param {string} id                           Id of the shape to create
   * @param {Polygon3d|Polygons3d} base           Base 3d polygon to use; sides will stretch down to this.
   * @param {object} opts
   * @param {number} opts.topZ                    Maximum height of the hill; used to scale the curve
   * @param {number} opts.groundZ                 "ground elevation" for the hill; where the curve = 0;
   *   Curve may dip below this point; used to scale the curve
   * @param {BézierCurve} curve                   Curve data from HillDrawingManager.hillEvaluationData
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]   How to evaluate the curve ridgeline when getting elevation
   * @param {object} ...opts                      Shape dimensions passed to canvasToPrototypeFaces
   * @returns {HillPrimitive}
   */
  static fromBasePolygon3d(id, base, { topZ, groundZ, curve, type = "linear", ...opts } = {}) {
    // Confirm base orientation is facing down.
    using ctr = base.centroid.clone();
    ctr.z += 1;
    if ( base.isFacing(ctr) ) base.reverseOrientation();

    const floorZ = base.polygons ? base.polygons[0].points[0].z : base.points[0].z;
    const polys = base.polygons ? base.toPolygon2d() : [base.toPolygon2d()];
    const hillShape = this.extrudeHillShape(polys, { curve, topZ, groundZ, floorZ, type });
    const faces = [base, ...hillShape];
    const protoFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, protoFaces);
  }

  /**
   * Extracts boundary edges from the triangulated top mesh to build sealed side walls.
   * Skips where the mesh edge matches the base elevation.
   * @param {Triangle3d[]} topTriangles    The culled hill mesh triangles
   * @param {number} bottomZ              Base elevation for the quads
   * @returns {(Quad3d|Triangle3d)[]} Array of side wall quads or occasionally triangles.
   */
  static _buildSidesFromLattice(topTriangles, bottomZ) {
    const edgeCounts = new Map();
    const edgeData = new Map();

    // Hash coordinates to fixed precision to avoid floating-point mismatch when matching eges.
    const hashPt = pt => `${roundDecimals(pt.x, 4)},${roundDecimals(pt.y,4)}`;
    const hashEdge = (a, b) => {
      const h1 = hashPt(a);
      const h2 = hashPt(b);

      // Sort keys alphanumerically to create a non-directional, unordered hash edge.
      return h1 < h2 ? `${h1}|${h2}` : `${h2}|${h1}`;
    }

    // Tally edge occurrences across all triangles.
    for ( const tri of topTriangles ) {
      for ( const edge of tri.iterateEdges() ) {
        const key = hashEdge(edge.a, edge.b);
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1); // Increment the edge count.
        if ( !edgeData.has(key) ) edgeData.set(key, edge); // For outward-facing winding later.
      }
    }

    // Build quads exclusively for unmatched boundary edges.
    // Because a Delaunay triangulation creates a continuous mesh where internal edges
    // are shared by exactly two triangles, you can extract the boundaries using a
    // standard half-edge counting algorithm. Any edge that belongs to only one triangle
    // is guaranteed to be a boundary—either the outer perimeter or the rim of an inner hole.
    const sideQuads = [];
    const EPSILON = 1e-04; // Larger epsilon because these side will eventually be transformed to a smaller prototype.
    for ( const [key, count] of edgeCounts.entries() ) {
      if ( count === 1 ) {
        const edge = edgeData.get(key);

        // Skip wall-building if the segment sits entirely flat on the base elevation.
        if ( edge.a.z.almostEqual(bottomZ) && edge.b.z.almostEqual(bottomZ) ) continue;

        // Build bottom points.
        const bottomA = edge.a.clone();
        const bottomB = edge.b.clone();
        bottomA.z = bottomZ;
        bottomB.z = bottomZ;

        // Construct Quad3d using outward-facing CCW winding:
        // TL (p1), TR (p2), BR (bottom p2), BL (bottom p1)
        const pts = cleanPolygonPoints([edge.b, edge.a, bottomA, bottomB], EPSILON);
        let side;
        switch ( pts.length ) {
          case 3: side = Triangle3d.from3Points(...pts); console.debug("HillPrimitive|Changed side to triangle."); break;
          case 4: side = Quad3d.from4Points(...pts); break;
          default: continue;
        }
        sideQuads.push(side);
      }
    }
    return sideQuads;
  }

  /**
   * Triangulate the points, cull holes/concavities by centroid, and adjust to elevation for the hill.
   * @param {PIXI.Point[]} ptsLattice
   * @param {BézierCurve} curve           Normalized, scaled curve data
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
   * @returns {Triangle3d[]}
   */
  static triangulateHillLattice(ptsLattice, polys, curve, topZ, bottomZ, type) {
    // Pass an accessor function b/c the points lattice is an array of objects, not array tuples ([x, y]).
    const delaunay = Delaunay.from(ptsLattice, pt => pt.x, pt => pt.y);
    const triangles = delaunay.triangles; // Array of indices pointing to our original array.

    // Construct the final triangles
    const n = triangles.length;

    // Create a Triangle3d from each Delaunay triangle, culling holes or concave exteriors.
    const zHeight = topZ - bottomZ;
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    using ctr2d = PIXI.Point.tmp;
    const ONE_THIRD = 1/3;
    const tris = [];
    let minPercent = Number.POSITIVE_INFINITY;
    let maxPercent = Number.NEGATIVE_INFINITY;

    for ( let i = 0; i < n; ) {
      const a2d = ptsLattice[triangles[i++]];
      const b2d = ptsLattice[triangles[i++]];
      const c2d = ptsLattice[triangles[i++]];

      // Cull triangles spanning across holes or concave exterior bounds.
      // a2d + b2d + c2d / 3 estimates the triangle center.
      a2d.add(b2d, ctr2d).add(c2d, ctr2d).multiplyScalar(ONE_THIRD, ctr2d);
      if ( !polygonsContainPoint(polys, ctr2d) ) continue;

      const percentA = HillDrawingManager._hillPercentHeightAtPoint(a2d, type, curve);
      const percentB = HillDrawingManager._hillPercentHeightAtPoint(b2d, type, curve);
      const percentC = HillDrawingManager._hillPercentHeightAtPoint(c2d, type, curve);

      minPercent = Math.min(minPercent, percentA, percentB, percentC);
      maxPercent = Math.max(maxPercent, percentA, percentB, percentC);

      const zA = bottomZ + (percentA * zHeight);
      const zB = bottomZ + (percentB * zHeight);
      const zC = bottomZ + (percentC * zHeight);

      a.set(a2d.x, a2d.y, zA);
      b.set(b2d.x, b2d.y, zB);
      c.set(c2d.x, c2d.y, zC);

      // Confirm orientation.
      const tri = Triangle3d.from3Points(a, b, c);
      if ( tri.plane.normal.z < 0 ) {
        tri.reverseOrientation(); // TODO: Does this ever occur?
        console.debug(`HillLattice|Flipped lattice triangle ${i} orientation`);
      }
      tris.push(tri);
    }
    console.debug(`HillLattice| percent hill: ${minPercent} – ${maxPercent}`);

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

    // Add corners, edges, inner lattice.
    const ptsLattice = [];
    using dir = PIXI.Point.tmp;
    using tmp = PIXI.Point.tmp;

    // Generate the lattice for both polygons and holes, in turn.
    polys.forEach(poly => {
      // Only generate the inner lattice for positive space.
      if ( poly.isPositive ) {
        const innerLattice = poly.pointsLattice(opts).filter(pt => polygonsContainPoint(polys, pt));
        ptsLattice.push(...innerLattice);
      }


      // Add corners and edges for all polygons.
      // This forces the delaunay mesh to stitch cleanly to the hole rims.
      // Corners.
      ptsLattice.push(...poly.iteratePoints())

      // Edges.
      for ( const edge of poly.iterateEdges() ) {
        const { a, b } = edge;

        // Use the same spacing.
        b.subtract(a, dir).normalize(dir);

        // Add until nearly reaching the other end. (Already added the corner points above.)
        const dist = PIXI.Point.distanceBetween(a, b) - (spacing * 0.5); // Don't run right up to corner
        for ( let d = spacing; d < dist; d += spacing ) ptsLattice.push(a.add(dir.multiplyScalar(d, tmp)));
      }
    });

    // Add linear points along the primary curve line, testing for containment.
    if ( polygonsContainPoint(polys, curve.left) ) ptsLattice.push(curve.left);
    if ( polygonsContainPoint(polys, curve.right) ) ptsLattice.push(curve.right);

    curve.right.subtract(curve.left, dir).normalize(dir);
    const dist = PIXI.Point.distanceBetween(curve.left, curve.right);
    for ( let d = spacing; d < dist; d += spacing ) {
      const pt = curve.left.add(dir.multiplyScalar(d, tmp));
      if ( polygonsContainPoint(polys, pt) ) ptsLattice.push(pt);
    }

    return ptsLattice;
  }

}

/**
 * Helper to test if multiple 2d polygons, some of which may be holes, contain a point.
 * @param {PIXI.Polygons[]} polys
 * @param {PIXI.Point} pt
 * @returns {boolean}
 */
function polygonsContainPoint(polys, pt) {
  let count = 0;
  for ( const poly of polys ) {
    const mult = poly.isPositive ? 1 : -1;
    count += (poly.contains(pt.x, pt.y) * mult);
  }
  return count > 0;
}

