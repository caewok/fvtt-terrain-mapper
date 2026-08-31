/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { StepsPrimitive } from "./Steps.js";
import { RampPrimitive } from "./Ramp.js";
import { HillPrimitive } from "./Hill.js";
import { HillDrawingManager } from "../regions/HillDrawingManager.js";
import { SceneElevationHandler } from "../regions/RegionElevationHandler.js";

// Geometry
import { CombinedGeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";
import { RegionGeometry } from "../geometry/placeable_geometry/RegionGeometry.js";

// LibGeometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { gridUnitsToPixels } from "../geometry/util.js";
import { Matrix } from "../geometry/Matrix.js";
import { Plane } from "../geometry/3d/Plane.js";
import { RegionGeometryManager } from "../geometry/placeable_tracking/CanvasGeometryManager.js";

/* Shape options

Plateau shape: Use the base shape.


*/


export class TerrainGeometry extends RegionGeometry {

  static UPDATE_KEY_MAP = new Map([
    ...super.UPDATE_KEY_MAP,
    [`flags.${MODULE_ID}.${FLAGS.REGION.TERRAIN.TYPE}`, "type"], // Triggers rebuild of the shape.
    [`flags.${MODULE_ID}.${FLAGS.REGION.PLATEAU_ELEVATION}`, "elevation"],

    // Ramps
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.FLOOR}`, "elevation"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.DIRECTION}`, "rampDirection"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.STEP_SIZE}`, "steps"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.SPLIT_POLYGONS}`, "terrainPolygons"],

    // Hills
    [`flags.${MODULE_ID}.${FLAGS.REGION.HILL.CURVE}`, "hill"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.HILL.TYPE}`, "hill"],
  ]);


  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive|null}
   */
  _buildRegionShape(shapeIdx) {
    const regionD = this.placeableDocument;

    if ( !this.constructor.isElevated(regionD)
      || this.constructor.isPlateau(regionD) ) return super._buildRegionShape(shapeIdx);

    let baseShape;
    const baseElev = this.elevationZ;
    if ( (baseElev.topZ - baseElev.bottomZ) ) baseShape = super._buildRegionShape(shapeIdx);

    let topShape = this._buildTerrainShape(shapeIdx);
    if ( !baseShape ) return topShape;

    /*
    // Combine top and bottom shapes
    // Zero out the model matrices so that updating can work as with a normal single region shape.
    const regionShape = this.regionShapes[shapeIdx];
    const shapeDims = this._shapeDimensions(regionShape);

    // Zero out base
    const baseCenter = baseShape.modelMatrix.translation.subtract(shapeDims.center);
    const baseAngles = baseShape.modelMatrix.rotation.subtract(shapeDims.angles);
    const baseDims = baseShape.modelMatrix.scale.divide(shapeDims.dims);
    baseShape.modelMatrix.translation = baseCenter;
    baseShape.modelMatrix.rotation = baseAngles;
    baseShape.modelMatrix.scale = baseDims;

    // Zero out top shape.
    const topCenter = topShape.modelMatrix.translation.subtract(shapeDims.center);
    const topAngles = topShape.modelMatrix.rotation.subtract(shapeDims.angles);
    const topDims = topShape.modelMatrix.scale.divide(shapeDims.dims);
    topShape.modelMatrix.translation = baseCenter;
    topShape.modelMatrix.rotation = baseAngles;
    topShape.modelMatrix.scale = baseDims;

    // Move the top shape to be on top of the bottom shape.
    */



    const id = `${this._shapeId(shapeIdx)}_combined`;
    const combinedShape = CombinedGeometricPrimitive.create(id);
    combinedShape.addShape(baseShape);
    combinedShape.addShape(topShape);
    return combinedShape;

    // return topShape;
  }


  _buildTerrainShape(shapeIdx) {
    const baseElev = this.elevationZ;
    // TODO: Handle single and per-polygon ramps, steps, hills.
    //       Let the user define in the shape config.
    const id = this._shapeId(shapeIdx);
    const regionShape = this.regionShapes[shapeIdx];
    const polys = regionShape.polygons;
    let topShape;
    const opts = this._shapeDimensions(regionShape);
    const regionD = this.placeableDocument;

    if ( this.constructor.isRamp(regionD) ) {
      opts.plane = this.calculateSingleRampPlane();
      opts.bottomZ = baseElev.topZ;
      opts.topZ = gridUnitsToPixels(this.constructor.plateauElevation(this.placeableDocument));
      topShape = RampPrimitive.fromPolygons(id, polys, opts);

    } else if ( this.constructor.isSteps(regionD) ) {
      const bottomZ = baseElev.topZ
      const totalStepHeight = gridUnitsToPixels(this.constructor.rampStepSize(regionD));
      const numSteps = this.constructor.numSteps(regionD);
      const stepHeight = totalStepHeight / numSteps;


      // const [aPt, bPt] = this._calculatePolygonRampPoints(polys);
      // const stepWidth = PIXI.Point.distanceBetween(aPt, bPt) / numSteps;

      // Rotate the polygons based on ramp direction.
      const rampDir = Math.toRadians(this.constructor.rampDirection(regionD));
      if ( rampDir !== 0 ) {
        const polygons = regionD.polygons;
        const center = this.aabb.center;
        const txMat = Matrix.translation(center, { d3: false });
        const rotMat = Matrix.rotationZ(-rampDir, { d3: false });

        // Rotate the polygons.
        const M = txMat.multiply4x4(rotMat);
        const rotPolys = [];
        for ( const poly of polygons ) rotPolys.push(poly.transform(M));

        // Find the x bounds of the new rotated polygons.
        const xs = [];
        rotPolys.forEach(poly => poly.iteratePoints().forEach(pt => xs.push(pt.x)))
        const xMinMax = Math.minMax(...xs);
        const stepWidth = (xMinMax.max - xMinMax.min) / numSteps;

        // Construct the steps.
        const steps = StepsPrimitive.fromPolygons(id, rotPolys, { bottomZ, stepWidth, stepHeight, ...opts })
        topShape = steps;

      } else {
        const stepWidth = this.aabb.width / numSteps;
        const steps = StepsPrimitive.fromPolygons(id, regionD.polygons, { bottomZ, stepWidth, stepHeight, ...opts })
        topShape = steps;
      }

    } else if ( this.constructor.isHill(regionD) ) {
      const curve = HillDrawingManager.scaledHillData(regionD);
      const opts = {
        type: this.constructor.hillType(regionD),
        elevationZ: baseElev.topZ,
      };
      topShape = HillPrimitive.fromPolygons(id, polys, curve, opts)
    }
    topShape.initialize();
    return topShape;
  }

  // ----- NOTE: Updating ----- //


  _updateShape(shape, regionShape, changes) {
    // The combined shape shares the model matrix between underlying shapes, so it is sufficient to update it.
    super._updateShape(shape, regionShape, changes);

    // If no terrain or plateau, we are done.
    const regionD = this.placeableDocument;
    if ( !this.constructor.isElevated(regionD)
        || this.constructor.isPlateau(regionD) ) return;

    /*
    // Ramps, steps, hills can all be rotated. This requires a rebuild of the top shape, because
    // its relationship to the base shape changes.
    // If step size changes, requires rebuild.
    // If hill changes, requires rebuild.
    const requiresRebuild = this.activeUpdates.has("rampDirection")
      || (this.activeUpdates.has("steps") && this.constructor.isSteps(regionD))
      || (this.activeUpdates.has("hill") && this.constructor.isHill(regionD));
    if ( requiresRebuild ) {
      const shapeIdx = this.regionShapes.indexOf(regionShape);
      if ( !~shapeIdx ) {
        console.error(`${this.constructor.name}#_updateShape|Shape index not found.`);
      }
      const topShape = this._buildTerrainShape(shapeIdx);

      // Replace the top shape.
      if ( shape instanceof CombinedGeometricPrimitive ) shape.shapes[1] = topShape;
      else this.shapes[shapeIdx] = topShape;
    }
    */
  }

  // ----- NOTE: Ramps ----- //

  /**
   * Calculate the plane of a ramp, for case where polygons are not split.
   * Steps should be defined such that the top of each step hits this plane.
   * @returns {Plane}
   */
  calculateSingleRampPlane() {
    const polys = this.regionShapes.flatMap(shape => shape.polygons);
    return this._calculateRampPlane(polys);
  }

  /**
   * Calculate the planes of a ramp, for case where polygons are split.
   * Steps should be defined such that the top of each step hits this plane.
   * @returns {Plane[]}
   */
  calculateMultiPolygonRampPlanes() {
    return this.regionShapes.map(shape => this._calculateRampPlane(shape.polygons))
  }

  /**
   * Determine the min/max point of the ramp along the center point.
   * @param {PIXI.Polygon[]} polygons
   * @returns {PIXI.Point[]}
   */
  _calculateRampPlane(polygons) {
    const topZ = gridUnitsToPixels(this.constructor.plateauElevation(this.placeableDocument));
    const rampFloor = gridUnitsToPixels(this.constructor.rampFloor(this.placeableDocument));
    const rampDir = this.constructor.rampDirection(this.placeableDocument);

    // Calculate the lowest and highest points on the plane.
		// 0º is due south (0, 1), 90º is due west (1, 0)
		const rad = Math.normalizeRadians(Math.toRadians(rampDir + 90));
		using dir = PIXI.Point.tmp.set(Math.sin(rad), Math.cos(rad));

    // Find extreme outer points along the direction vector across all vertices.
    // Project polygon vertices along the direction vector, avoiding line-intersection overhead.
    let minProj = Number.POSITIVE_INFINITY;
    let maxProj = Number.NEGATIVE_INFINITY;
    let minPoint;
    let maxPoint;
    for ( const poly of polygons ) {
      for ( const pt of poly.iteratePoints() ) {
        // Scalar projection along the ramp direction vector.
        const proj = pt.dot(dir);
        if ( proj < minProj ) {
          minProj = proj;
          minPoint = pt;
        }
        if ( proj > maxProj ) {
          maxProj = proj;
          maxPoint = pt;
        }
      }
    }

    if ( !(minPoint && maxPoint) || minProj === maxProj ) throw new Error("Ramp direction does not span a valid polygon area.");

    // Define 3d low and high points.
    const low3d = Point3d.tmp.set(minPoint.x, minPoint.y, rampFloor);
    // const high3d = Point3d.tmp.set(maxPoint.x, maxPoint.y, topZ);

    // Calculate 3d normal vector.
    const run = maxProj - minProj;
    const rise = topZ - rampFloor;

    // Normalized 3d normal vector pointing orthogonally "up" from the ramp surface.
    const len = Math.hypot(rise, run);
    return new Plane(low3d, {
      x: (-dir.x * rise) / len,
      y: (-dir.y * rise) / len,
      z: run / len,
    });
  }

  // ----- NOTE: Static properties for terrains ----- //

  /**
   * @param {RegionDocument} regionD
   * @returns {boolean}
   */
  static isElevated(regionD) { return this.isPlateau(regionD) || this.isRamp(regionD) || this.isHill(regionD); }

  /** @type {boolean} */
  static isPlateau(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.PLATEAU };

  /** @type {boolean} */
  static isRamp(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.RAMP };

  /** @type {boolean} */
  static isSteps(regionD) { return this.isRamp(regionD) && this.rampStepSize(regionD) !== 0; }

  /** @type {boolean} */
  static isBelowGround(regionD) {
    if ( this.isHill(regionD) ) {
      // The stored normalized curve has start --> end goes from 0,0 to x,0.
      // As such, cp1 and cp2 define top and bottom points, and end
      // But y axis is inverted in Foundry, so look for high values.
      const curve = this.hillManager(regionD).hillData();
      const out = curve.cp1.y > 0 || curve.cp2.y > 0 || curve.end.y > 0;
      Object.values(curve).forEach(pt => pt.release());
      return out;
    } else if ( SceneElevationHandler.sceneFloor > Math.min(this.rampFloor(regionD), this.plateauElevation(regionD)) ) return true;
    return false;
  }

  /** @type {boolean} */
  static isHill(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.HILL; }

  static hillType(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.HILL.TYPE) || FLAGS.REGION.HILL.CHOICES.LINEAR; }

  /** @type {number} */
  static plateauElevation(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.PLATEAU_ELEVATION) || 0; }

  /** @type {number} */
  static rampFloor(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.FLOOR) || 0; }

  /** @type {number} */
  static rampDirection(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.DIRECTION) || 0; }

  /** @type {number} */
  static rampStepSize(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.STEP_SIZE) || 0; }

  /** @type {boolean} */
  static splitPolygons(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.SPLIT_POLYGONS); }

  /** @type {FLAGS.REGION.CHOICES} */
  static algorithm(regionD) {
    return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) || FLAGS.REGION.TERRAIN.CHOICES.PLATEAU;
  }

  /** @type {number} */
  static totalStepHeight(regionD) {
    return this.plateauElevation(regionD) - this.rampFloor(regionD);
  }

  /** @type {number} */
  static numSteps(regionD) {
    if ( !this.isSteps ) return 0;
    return Math.ceil(this.totalStepHeight(regionD) / this.rampStepSize(regionD));
  }


  /**
   * Top and bottom elevation of the base of the region.
   * Might be 0 height.
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    const res = super.elevationZ;
    if ( !this.constructor.isElevated(this.placeableDocument) ) return res;

    // If plateau, can simply adjust the region top to the plateau top. Region shape is otherwise unaffected.
    if ( this.constructor.isPlateau(this.placeableDocument) ) res.topZ = gridUnitsToPixels(this.constructor.plateauElevation(this.placeableDocument));

    // Otherwise, return the elevation for the bottom of the region to the base (of the ramp, steps, or hill).
    // This height may be 0.
    else res.topZ = gridUnitsToPixels(this.constructor.rampFloor(this.placeableDocument));
    if ( res.topZ < res.bottomZ ) res.topZ = res.bottomZ;
    return res;
  }
}

export class TerrainGeometryManager extends RegionGeometryManager {
  /** @type {PlaceableGeometry} */
  static geometryClass = TerrainGeometry;
}