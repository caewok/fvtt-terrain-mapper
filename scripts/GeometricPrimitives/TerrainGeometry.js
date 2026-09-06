/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, DEFAULT_FLAGS } from "../const.js";
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
import { gridUnitsToPixels, almostLessThan } from "../geometry/util.js";
import { Matrix } from "../geometry/Matrix.js";
import { Plane } from "../geometry/3d/Plane.js";
import { RegionGeometryManager } from "../geometry/placeable_tracking/CanvasGeometryManager.js";

/* Shape options

None: Use the base shape
Plateau: Use the base shape.
Ramp: Base shape + Ramp
Steps: Base shape + steps
Hill: Base shape + hill

*/

// ----- NOTE: Terrain combined geometry shape classes ----- //

/**
 * Base shape + ramp
 */
class CombinedTerrainPrimitive extends CombinedGeometricPrimitive {

  /**
   * @param {string} id
   * @param {GeometricPrimitive} baseShape
   * @param {GeometricPrimitive} hillShape
   * @returns {CombinedHillPrimitive}
   */
  static create(id, baseShape, topShape) {
    const combinedShape = CombinedGeometricPrimitive.create(id);
    combinedShape.addShape(baseShape);
    combinedShape.addShape(topShape);
    return combinedShape;
  }
}


export class TerrainGeometry extends RegionGeometry {

  static UPDATE_KEY_MAP = new Map([
    ...super.UPDATE_KEY_MAP,
    [`flags.${MODULE_ID}.${FLAGS.REGION.TERRAIN.TYPE}`, "terrainType"], // Triggers rebuild of the shape.
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
   * Return the shape class for a given region shape type.
   * May also be dependent on the region (e.g., plateaus, steps, etc.)
   * @param {number} shapeIdx      Index of the shape
   */
  shapeClass(shapeIdx) {
    const { hasBaseShape, hasTerrainShape } = this;
    if ( hasBaseShape && hasTerrainShape ) return CombinedTerrainPrimitive;
    if ( hasBaseShape ) return super.shapeClass(shapeIdx);
    if ( hasTerrainShape ) return this.terrainShapeClass;

    console.debug(`TerrainGeometry|No class for shape ${shapeIdx}`);
    return Array; // Empty array class for no shape.
  }

  /**
   * Return the terrain shape class for a given region shape index.
   * @param {number} shapeIdx      Index of the shape
   */
  get terrainShapeClass() {
    const regionD = this.placeableDocument;
    if ( this.constructor.isRamp(regionD) ) return RampPrimitive;
    if ( this.constructor.isSteps(regionD) ) return StepsPrimitive;
    if ( this.constructor.isHill(regionD) ) return HillPrimitive;
    return null;
  }

  /**
   * Construct a primitive shape using the polygons for the entire region.
   * @returns {GeometricPrimitive|null}
   */
  _buildEntireRegionShapes() {
    console.debug(`TerrainGeometry|_buildEntireRegionShapes ${this.placeableDocument.name} (${this.placeableId})`);
    const { hasBaseShape, hasTerrainShape } = this;
    let baseShape;
    let terrainShape;
    if ( hasBaseShape ) baseShape = super._buildEntireRegionShapes();
    if ( hasTerrainShape ) terrainShape = this._buildTerrainShapeFromPolygons(0, this.regionPolygons);
    if ( baseShape && terrainShape ) return CombinedTerrainPrimitive.create(baseShape, terrainShape);
    else if ( baseShape ) return baseShape;
    else if ( terrainShape ) return terrainShape;
    return null;
  }

  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive|null}
   */
  _buildRegionShape(shapeIdx) {
    console.debug(`TerrainGeometry|_buildRegionShape ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const { hasBaseShape, hasTerrainShape } = this;
    let baseShape;
    let terrainShape;
    if ( hasBaseShape ) baseShape = super._buildEntireRegionShapes();
    if ( hasTerrainShape ) terrainShape = this._buildTerrainShapeFromPolygons(shapeIdx, this.regionPolygons);
    if ( baseShape && terrainShape ) return CombinedTerrainPrimitive.create(baseShape, terrainShape);
    else if ( baseShape ) return baseShape;
    else if ( terrainShape ) return terrainShape;
    return null;
  }

  get hasBaseShape() {
    // Any terrain with a base height has a base shape.
    const baseElev = this.elevationZ;
    const zHeight = baseElev.topZ - baseElev.bottomZ;
    return !almostLessThan(zHeight, 0);
  }

  get hasTerrainShape() {
    // Plateaus and non-terrain do not have top shapes.
    const regionD = this.placeableDocument;
    if ( !this.constructor.isElevated(regionD)
      || this.constructor.isPlateau(regionD) ) return false;

    // If the user sets the top and bottom equal, no top terrain.
    const baseElev = this.elevationZ;
    const topElev = this.plateauElevation(regionD);
    const zHeight = topElev - baseElev.topZ;
    return !almostLessThan(zHeight, 0);
  }

  /**
   * The base shape, if any, should stretch from the region elevation bottom to the base of the ramp/steps.
   * For hills, it should stretch from the region elevation bottom to the bottom of the hill.
   * @param {number} shapeIdx
   * @returns {GeometricPrimitive|null} Null if there should not be a base shape for this region shape.
   */
  _buildBaseShape(shapeIdx) {
    console.debug(`TerrainGeometry|_buildBaseShape ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    return super._buildRegionShape(shapeIdx);
  }

  /**
   * The terrain shape, if any.
   * Plateaus do not have distinct terrain shapes.
   * Ramps/steps/hills may not have distinct terrain shapes if the terrain is squashed to 0 height.
   * @param {number} shapeIdx
   * @returns {GeometricPrimitive|null} Null if there should not be a terrain shape for this region shape.
   */
  _buildTerrainShape(shapeIdx) {
    console.debug(`TerrainGeometry|_buildTerrainShape ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    // TODO: Handle single and per-polygon ramps, steps, hills.
    //       Let the user define in the shape config.
    const id = this._shapeId(shapeIdx);
    const regionShape = this.regionShapes[shapeIdx];
    let topShape;
    const opts = this._shapeDimensions(regionShape);
    const regionD = this.placeableDocument;
    const baseElev = this.elevationZ;

    if ( this.constructor.isSteps(regionD) ) {
      const bottomZ = baseElev.topZ;
      const { stepWidth, stepHeight, M, rotatedPolygons } = this.#stepDimensions(this.regionPolygons);

      // Construct planks based on the entire region shape.
      const planks = StepsPrimitive.verticalPlanks(rotatedPolygons, stepWidth);

      // Build the steps for only this specific region shape's polygons.
      const rotatedRegionShapePolys = M ? regionShape.polygons.map(p => p.transform(M)) : regionShape.polygons;
      topShape = StepsPrimitive.fromPolygons(id, rotatedRegionShapePolys, { bottomZ, stepWidth, stepHeight, planks, Minv: M.invert(), ...opts })

    } else if ( this.constructor.isRamp(regionD) ) {
      // Define ramp plane based on the entire region.
      opts.plane = this._calculateRampPlane(this.regionPolygons);

      // Build the ramp for only this specific region shape's polygons.
      opts.bottomZ = baseElev.topZ;
      opts.topZ = gridUnitsToPixels(this.constructor.terrainTop(this.placeableDocument));
      topShape = RampPrimitive.fromPolygons(id, regionShape.polygons, opts);

    } else if ( this.constructor.isHill(regionD) ) {
      // Define hill based on the entire region.
      opts.curve = HillDrawingManager.hillEvaluationData(regionD);
      opts.type = this.constructor.hillType(regionD);

      // Build hill shape for only this specific region shape's polygons.
      opts.bottomZ = baseElev.topZ;
      opts.topZ = gridUnitsToPixels(this.constructor.terrainTop(this.placeableDocument));
      topShape = HillPrimitive.fromPolygons(id, regionShape.polygons, opts);
    }
    topShape.initialize();
    return topShape;
  }

  #stepDimensions(polygons) {
    const regionD = this.placeableDocument;
    const totalStepHeight = gridUnitsToPixels(this.constructor.rampStepSize(regionD));
    const numSteps = this.constructor.numSteps(regionD);
    const stepHeight = totalStepHeight / numSteps;
    const rampDir = Math.toRadians(this.constructor.rampDirection(regionD));
    let M;
    let rotatedPolygons = polygons;
    if ( rampDir !== 0 ) {
      // Rotate the polygons based on ramp direction.
      const center = polygons[0].center;
      const txMat = Matrix.translation(center, { d3: false });
      const rotMat = Matrix.rotationZ(-rampDir, { d3: false });

      // Rotate the polygons.
      M = txMat.multiply3x3(rotMat);
      rotatedPolygons = [];
      for ( const poly of regionD.polygons ) rotatedPolygons.push(poly.transform(M));
    }

    // Find the x bounds of the new rotated polygons.
    const xs = [];
    polygons.forEach(poly => poly.iteratePoints().forEach(pt => xs.push(pt.x)))
    const xMinMax = Math.minMax(...xs);
    const shapeLength = (xMinMax.max - xMinMax.min);
    const stepWidth = shapeLength / numSteps;

    return { numSteps, stepWidth, stepHeight, M, rotatedPolygons };
  }

  // ----- NOTE: Updating ----- //

  /**
   * For a given shape index and change set, does this shape need to be rebuilt entirely?
   * @param {number} shapeIdx
   * @param {Set<string>} changeKeys   Change key set
   * @returns {boolean}
   */
  rebuildNeeded(shape, regionShape, changes) {
    const { hasBaseShape, hasTerrainShape } = this;
    if ( hasBaseShape && hasTerrainShape ) return !(shape instanceof CombinedTerrainPrimitive);
    if ( hasBaseShape ) return super.rebuildNeeded(shape, regionShape, changes);
    if ( hasTerrainShape ) return !(shape instanceof this.terrainShapeClass);
  }

  /**
   * Returns true if the base shape does not match the expected class.
   * If no base shape, returns false.
   * @param {number} shapeIdx
   * @param {Set<string>} changeKeys   Change key set
   * @returns {boolean}
   */
  baseRebuildNeeded(shape, regionShape, changes) {
    const { hasBaseShape, hasTerrainShape } = this;
    if ( !hasBaseShape ) return false;

    // Check the class of the base shape.
    const baseShape = hasTerrainShape ? shape.shapes[0] : shape;
    return super.rebuildNeeded(baseShape, regionShape, changes);
  }

  terrainRebuildNeeded(shape) {
    const hasTerrainShape = this.hasTerrainShape;
    if ( !hasTerrainShape ) return false;

    // Did the terrain type or other key terrain parameters change?
    const regionD = this.placeableDocument;
    if ( this.activeUpdates.has("terrainType")
      || this.activeUpdates.has("rampDirection")
      || (this.activeUpdates.has("steps") && this.constructor.isSteps(regionD))
      || (this.activeUpdates.has("hill") && this.constructor.isHill(regionD)) ) return true;

    // Check the class of the terrain shape.
    let terrainShape = hasTerrainShape ? shape.shapes[0] : shape;
    return  !(terrainShape instanceof this.terrainShapeClass);
  }

  _updateShape(shapeIdx, changes) {
    console.debug(`TerrainGeometry|_updateShape ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const shape = this.shapes[shapeIdx];
    const regionShape = this.regionShapes[shapeIdx];

    if ( shape instanceof CombinedTerrainPrimitive ) {
      if ( this.baseRebuildNeeded(shape, regionShape, changes) ) shape.replaceShape(super._buildRegionShape(shapeIdx), 0);
      if ( this.terrainRebuildNeeded(shape, regionShape, changes) ) shape.replaceShape(super._buildTerrainShape(shapeIdx), 1);
    }

    super._updateShape(shapeIdx, changes);
  }



  // ----- NOTE: Ramps ----- //

  /**
   * Determine the min/max point of the ramp along the center point.
   * @param {PIXI.Polygon[]} polygons
   * @returns {PIXI.Point[]}
   */
  _calculateRampPlane(polygons) {
    const topZ = gridUnitsToPixels(this.constructor.terrainTop(this.placeableDocument));
    const rampFloor = gridUnitsToPixels(this.constructor.terrainBottom(this.placeableDocument));
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
    if ( this.isHill(regionD) ) return this.hillHasNegativeElevation(regionD);
    else if ( SceneElevationHandler.sceneFloor > Math.min(this.terrainBottom(regionD), this.terrainTop(regionD)) ) return true;
    return false;
  }

  /**
   * If the hill dips below the ramp floor, returns true. Error to call this on a non-hill.
   * @type {boolean}
   */
  static hillHasNegativeElevation(regionD) {
    const curve = HillDrawingManager._unadjustedHillData(regionD);
    const out = curve.cp1.y > 0 || curve.cp2.y > 0 || curve.end.y > 0;
    Object.values(curve).forEach(pt => pt.release());
    return out;
  }

  /** @type {boolean} */
  static isHill(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.HILL; }

  static hillType(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.HILL.TYPE) || DEFAULT_FLAGS.REGION[FLAGS.REGION.HILL.TYPE]; }

  /** @type {number} */
  static hillFloor(regionD) {
    if ( this.hillHasNegativeElevation(regionD) ) {
      const curve = HillDrawingManager.scaledHillData(regionD);
      const { min } = HillDrawingManager.curveMinMaxHeight(curve);
      Object.values(curve).forEach(pt => pt.release());
      return min;
    } else return this.rampFloor(regionD);
  }

  /** @type {object{ min:{number}, max:{number} }} */
  static hillMinMaxElevation(regionD) {
    const curve = HillDrawingManager.scaledHillData(regionD);
    return HillDrawingManager.curveMinMaxHeight(curve);
  }

  /** @type {number} */
  static terrainTop(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.PLATEAU_ELEVATION) || DEFAULT_FLAGS.REGION[FLAGS.REGION.PLATEAU_ELEVATION]; }

  /** @type {number} */
  static plateauElevation(regionD) {
    console.debug("TerrainGeometry|plateauElevation is now terrainTop.");
    return this.terrainTop(regionD);
  }

  /** @type {number} */
  static terrainBottom(regionD) {
    if ( this.isHill(regionD) ) return this.hillFloor(regionD);
    return this.rampFloor(regionD);
  }

  /** @type {number} */
  static rampFloor(regionD) {
    return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.FLOOR) || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.FLOOR];
  }

  /** @type {number} */
  static rampDirection(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.DIRECTION) || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.DIRECTION]; }

  /** @type {number} */
  static rampStepSize(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.STEP_SIZE) || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.STEP_SIZE]; }

  /** @type {FLAGS.REGION.CHOICES} */
  static algorithm(regionD) {
    return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) || FLAGS.REGION.TERRAIN.CHOICES.PLATEAU;
  }

  /** @type {number} */
  static totalStepHeight(regionD) {
    return this.terrainTop(regionD) - this.terrainBottom(regionD);
  }

  /** @type {number} */
  static numSteps(regionD) {
    if ( !this.isSteps(regionD) ) return 0;
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
    if ( this.constructor.isPlateau(this.placeableDocument) ) res.topZ = gridUnitsToPixels(this.constructor.terrainTop(this.placeableDocument));

    // Otherwise, return the elevation for the bottom of the region to the base (of the ramp, steps, or hill).
    // This height may be 0.
    else res.topZ = gridUnitsToPixels(this.constructor.terrainBottom(this.placeableDocument));
    if ( res.topZ < res.bottomZ ) res.topZ = res.bottomZ;
    return res;
  }
}

export class TerrainGeometryManager extends RegionGeometryManager {
  /** @type {PlaceableGeometry} */
  static geometryClass = TerrainGeometry;
}