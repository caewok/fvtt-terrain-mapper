/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ExtrudedPolygonPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Polygons3d, Quad3d } from "../geometry/3d/Polygon3d.js";

/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class StepsPrimitive extends ExtrudedPolygonPrimitive {

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
    return this.createSteps([poly], opts);
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
  static createSteps(polys, { stepHeight = 1, stepWidth = 1, bottomZ = 0 } = {}) {
    const floorZ = bottomZ;
    const planks = this.verticalPlanks(polys, stepWidth);
    const out = [];

    // Build the bottom.
    const bottom3d = Polygons3d.fromPolygons(polys, bottomZ);
    bottom3d.reverseOrientation(); // Face bottom down.
    out.push(bottom3d);

    // From west side, steps rise up.
    // Start with a vertical, followed by horizontal.
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    using d = Point3d.tmp;

    // Build the step planks. Horizontal Polygons3d and vertical Quad3d.
    for ( const { x, plank } of planks ) {
      for ( const poly of plank ) {
        // For testing—confirm orientation.
        const ctr = poly.center;
        const ctr3d = Point3d.tmp.set(ctr.x, ctr.y, bottomZ + (stepHeight * 0.5));

        // Vertical
        // Determine the minimum and maximum y along the west edge of the plank.
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for ( const pt of poly.iteratePoints() ) {
          // If the point is on the current minimum X boundary.
          if ( pt.x.almostEqual(minX) ) {
            minY = Math.min(pt.y, minY);
            maxY = Math.max(pt.y, maxY);
          }

          // If a new minimum X is found (beyond floating point tolerance)
          else if ( pt.x < minX ) {
            minX = pt.x;
            minY = pt.y;
            maxY = pt.y;
          }
        }

        if ( !(isFinite(minX) && isFinite(minY) && isFinite(maxY)) ) console.error("GeometricPrimitive#createSteps|No finite x or y found for plank", { x, poly });

        // Skip drawing a vertical quad if the western edge is just a single point.
        // (minY === maxY) rather than a vertical flat edge.
        if ( !minY.almostEqual(maxY) ) {
          // Vertical quad facing west, using actual minX.
          const verticalQuad = Quad3d.from4Points(
            a.set(minX, minY, bottomZ + stepHeight),  // TL, looking east
            b.set(minX, minY, bottomZ), // BL
            c.set(minX, maxY, bottomZ), // BR
            d.set(minX, maxY, bottomZ + stepHeight), // TR
          )

          // Testing: Confirm orientation
          if ( verticalQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Vertical quad facing wrong way.");

          out.push(verticalQuad);
        }

        // Sides
        // Quad straight at the edges of the plank.
        // Edges are segments that do not share the same x value.
        for ( const edge of poly.iterateEdges() ) {
          const { a: edgeA, b: edgeB } = edge;
          if ( edgeA.x.almostEqual(edgeB.x) ) continue;
          const sideQuad = Quad3d.from4Points(
            a.set(edgeA.x, edgeA.y, bottomZ + stepHeight),  // TL or TR
            b.set(edgeB.x, edgeB.y, bottomZ + stepHeight),  // TR or TL
            c.set(edgeB.x, edgeB.y, floorZ),                // BR or BL
            d.set(edgeA.x, edgeA.y, floorZ),                // BL or BR
          )

          // Testing: Confirm orientation
          if ( sideQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Side quad facing wrong way.");

          out.push(sideQuad);
        }
      }

      // Move up to the top of the vertical step.
      bottomZ += stepHeight;

      // Back
      // The plank polygons are all at the same elevation.
      const poly3d = Polygons3d.fromPolygons(plank, bottomZ);
      out.push(poly3d);
    }

    // Build the back face.
    // Examine the last plank to locate the top and bottom of the final quad.
    const { x, plank } = planks.at(-1);
    for ( const poly of plank ) {
      // For testing—confirm orientation.
      const ctr = poly.center;
      const ctr3d = Point3d.tmp.set(ctr.x, ctr.y, bottomZ + (stepHeight * 0.5));

      for ( const edge of poly.iterateEdges() ) {
        const { a: edgeA, b: edgeB } = edge;
        if ( edgeA.x.almostEqual(edgeB.x) && edgeA.x > x ) {
          const backQuad = Quad3d.from4Points(
            a.set(edgeA.x, edgeA.y, bottomZ), // Top of the final step.
            b.set(edgeB.x, edgeB.y, bottomZ), // Top of the final step.
            c.set(edgeB.x, edgeB.y, floorZ),  // Extend to the floor.
            d.set(edgeA.x, edgeA.y, floorZ),  // Extend to the floor.
          )

          if ( edgeA.y > edgeB.y ) backQuad.reverseOrientation();

          // Testing: Confirm orientation
          if ( backQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Back quad facing wrong way.");

          out.push(backQuad);
        }
      }
    }
    return out;
  }

  /**
   * @typedef {Plank[]} Planks
   */

  /**
   * @typedef {object} Plank
   * @prop {number} x               The x value of the plank start
   * @prop {PIXI.Polygon[]} plank   PIXI.Polygons representing the plank

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

  // ----- NOTE: Debug ----- //

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  validateFacesOutward() {
    const faces = this.faces;
    if ( !faces || faces.length < 3 ) return false;

    // For steps, must use raycasting algorithm.
    // Start at face's center, offset slightly toward the plane's inverse normal vector.
    // Cast a ray in an arbitrary direction (e.g. +x).
    // If start is inside, a ray will cross the boundary an odd number of times.
    using rayDir = Point3d.tmp.set(1, 0, 0);
    using offset = Point3d.tmp;
    using startPoint = Point3d.tmp;
    const EPSILON = 1e-04; // Offset to avoid self-intersection.
    const isEven = n => (n & 1) === 0;
    for ( const face of faces ) {
      const centroid = face.centroid;
      const normal = face.plane.normal;
      normal.multiplyScalar(EPSILON, offset);

      // Offset the origin point slightly inward along the inverse normal vector.
      // If face normal is facing outward, moving in by -normal puts the point inside the mesh.
      centroid.subtract(offset, startPoint);

      // Count how many other faces this ray intersects.
      let intersectionCount = 0;
      for ( let otherFace of faces ) {
        if ( face === otherFace ) continue; // Skip testing against self.
        if ( face.intersectionT(startPoint, rayDir, { holesBlock: true }) !== null ) intersectionCount++;
      }

      // If start point was inside the mesh, the ray must intersect an odd number of faces.
      if ( isEven(intersectionCount) )  return false; // Faces inward.
    }
    return true;
  }
}
