/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ExtrudedPolygonPrimitiveWithHoles } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
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
    const steps = this.createSteps(polys, { stepHeight, stepWidth, bottomZ, planks })

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
    const steps = this.createSteps(polys, { stepHeight, stepWidth, bottomZ, planks });

    return [bottom3d, ...steps];
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
   * @returns {(Polygon3d|Quad3d)[]}
   */
  static createSteps(polys, { stepHeight = 1, stepWidth = 1, bottomZ = 0, planks } = {}) {
    planks ??= this.verticalPlanks(polys, stepWidth);
    const out = [];
    const floorZ = bottomZ; // Save the starting bottom to extend back later.

    // From west side, steps rise up.
    // Start with a vertical, followed by horizontal.
    // Build the step planks. Horizontal Polygons3d and vertical Quad3d.

    for ( const { x, plank } of planks ) {
      for ( const poly of plank ) {
        const isHole = !poly.isPositive;

        // For testing—confirm orientation.
        const ctr = poly.center;
        const ctr3d = Point3d.tmp.set(ctr.x, ctr.y, bottomZ + (stepHeight * 0.5));

        // Vertical
        // Determine the minimum and maximum y along the west edge of the plank.
        if ( !isHole ) {
          const verticalRiser = this.#buildVerticalRiser(poly, stepHeight, bottomZ, x, ctr3d);
          if ( verticalRiser ) out.push(verticalRiser);
        }

        // Sides
        // Quad straight at the edges of the plank.
        out.push(...this.#buildStepSides(poly, bottomZ, floorZ, stepHeight, ctr3d));
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
      const isHole = !poly.isPositive;
      if ( isHole ) continue;

      // For testing—confirm orientation.
      const ctr = poly.center;
      const ctr3d = Point3d.tmp.set(ctr.x, ctr.y, bottomZ + (stepHeight * 0.5));
      out.push(...this.#buildBackFace(poly, bottomZ, floorZ, x, ctr3d));
    }

    return out;
  }

  /**
   * Build a vertical riser (west-facing step)
   * @param {PIXI.Polygon} poly     The plank polygon that defines this riser
   * @param {Point3d} ctr3d         Center, for testing orientation
   * @returns {Quad3d|null} The vertical riser, or null if the y distance is too small.
   */
  static #buildVerticalRiser(poly, stepHeight, bottomZ, x, ctr3d) {
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

    if ( !minY.almostEqual(maxY) ) {
      const verticalQuad = Quad3d.from4Points(
        { x: minX, y: minY, z: bottomZ + stepHeight },
        { x: minX, y: minY, z: bottomZ },
        { x: minX, y: maxY, z: bottomZ },
        { x: minX, y: maxY, z: bottomZ + stepHeight },
      );
      if ( verticalQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Vertical quad facing wrong way.");
      return verticalQuad;
    }
    return null;
  }

  /**
   * Build the sides of a step.
   * @param {PIXI.Polygon} poly     The plank polygon that defines this step
   * @param {Point3d} ctr3d         Center, for testing orientation
   * @returns {Quad3d[]|null} The sides of the step
   */
  static #buildStepSides(poly, bottomZ, floorZ, stepHeight, ctr3d) {
    // Quad straight at the edges of the plank.
    // Edges are segments that do not share the same x value.
    const out = [];
    for ( const edge of poly.iterateEdges() ) {
      const { a, b } = edge;
      if ( a.x.almostEqual(b.x) ) continue;
      const sideQuad = Quad3d.from4Points(
        { x: a.x, y: a.y, z: bottomZ + stepHeight },  // TL or TR
        { x: b.x, y: b.y, z: bottomZ + stepHeight },  // TR or TL
        { x: b.x, y: b.y, z: floorZ },                // BR or BL
        { x: a.x, y: a.y, z: floorZ },                // BL or BR
      )

      // Testing: Confirm orientation
      if ( sideQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Side quad facing wrong way.");

      out.push(sideQuad);
    }
    return out;
  }

  /**
   * Build the back face of the step
   * @param {PIXI.Polygon} poly     The plank polygon that defines the last step
   * @param {Point3d} ctr3d         Center, for testing orientation
   * @returns {Quad3d[]|null} The back polygons that make up the step
   */
  static #buildBackFace(poly, bottomZ, floorZ, x, ctr3d) {
    const out = [];
    for ( const edge of poly.iterateEdges() ) {
      const { a, b } = edge;
      if ( a.x.almostEqual(b.x) && a.x > x ) {
        const backQuad = Quad3d.from4Points(
          { x: a.x, y: a.y, z: bottomZ }, // Top of the final step.
          { x: b.x, y: b.y, z: bottomZ }, // Top of the final step.
          { x: b.x, y: b.y, z: floorZ },  // Extend to the floor.
          { x: a.x, y: a.y, z: floorZ },  // Extend to the floor.
        )

        if ( a.y > b.y ) backQuad.reverseOrientation();

        // Testing: Confirm orientation
        if ( backQuad.isFacing(ctr3d) ) console.warn("Steps#createSteps|Back quad facing wrong way.");

        out.push(backQuad);
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
