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
import { CombinedGeometricPrimitive } from "../geometry/placeable_geometry/CombinedGeometricPrimitive.js";
import { RegionGeometry } from "../geometry/placeable_geometry/RegionGeometry.js";
import { EmptyGeometricPrimitive } from "../geometry/placeable_geometry/EmptyGeometricPrimitive.js";


// LibGeometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { gridUnitsToPixels } from "../geometry/util.js";
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
    // Base shapes and top shapes should not require any model-specific transforms;
    // everything is handled by the world matrix.
    // Accordingly, reset the model matrix to the identity matrix.
    baseShape.setPosition({ x: 0, y: 0, z: 0 });
    baseShape.setRotation({ x: 0, y: 0, z: 0 });
    baseShape.setScale({ x: 1, y: 1, z: 1 });
    baseShape.setAnchor({ x: 0, y: 0, z: 0 });

    topShape.setPosition({ x: 0, y: 0, z: 0 });
    topShape.setRotation({ x: 0, y: 0, z: 0 });
    topShape.setScale({ x: 1, y: 1, z: 1 });
    topShape.setAnchor({ x: 0, y: 0, z: 0 });

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
    [`flags.${MODULE_ID}.${FLAGS.REGION.PLATEAU_ELEVATION}`, "plateauElevation"],

    // Ramps
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.FLOOR}`, "terrainBottom"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.DIRECTION}`, "rampDirection"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.RAMP.STEP_SIZE}`, "steps"],

    // Hills
    [`flags.${MODULE_ID}.${FLAGS.REGION.HILL.CURVE}`, "hill"],
    [`flags.${MODULE_ID}.${FLAGS.REGION.HILL.TYPE}`, "hill"],
  ]);


  get hasBaseShape() {
    // Any terrain with a base height has a base shape.
    const baseElev = this.baseElevationZ;
    return (baseElev.topZ - baseElev.bottomZ).strictlyGreaterThan(0); // height > 0.
  }

  get hasTerrainShape() {
    // Plateaus and non-terrain do not have top shapes.
    const regionD = this.placeableDocument;
    if ( !this.constructor.isElevated(regionD)
      || this.constructor.isPlateau(regionD) ) return false;

    // If the user sets the top and bottom equal, no top terrain.
    const terrainElev = this.terrainElevationZ;
    return (terrainElev.topZ - terrainElev.bottomZ).strictlyGreaterThan(0); // height > 0.
  }

  /**
   * Instantiate the correct primitive shape based on constraints and type.
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holeShapes
   * @param {string} id
   * @param {GeometricPrimitive}
   */
  _instantiateShape(regionShape, holeShapes, id) {
    const baseShape = super._instantiateShape(regionShape, holeShapes, id);
    if ( baseShape instanceof EmptyGeometricPrimitive ) return baseShape;

    if ( this.hasTerrainShape ) {
      try {
      const regionD = this.placeableDocument;
      let opts = this._shapeDimensions(regionShape);

      // Set the base shape dimensions; needed so we can build the top on the base dimensions.
      // See _updateShapeDimensions.
      baseShape.setPosition(opts.center);
      baseShape.setRotation(opts.angles);
      baseShape.setScale(opts.dims);
      baseShape.setAnchor(opts.anchors);

      const terrainElev = this.terrainElevationZ;
      opts.bottomZ = terrainElev.bottomZ;
      opts.topZ = terrainElev.topZ;

      // Build the terrain for only this specific region shape's polygons.
      const terrainBase = baseShape.faces[0].clone(); // Top of the base is bottom of the terrain shape.
      terrainBase.reverseOrientation();

      let terrainShape;
      if ( this.constructor.isRamp(regionD) ) {
        opts = { ...opts, ...this.#rampParameters };
        terrainShape = RampPrimitive.fromBasePolygon3d(id, terrainBase, opts);
      }

      else if ( this.constructor.isSteps(regionD) ) {
        // So the steps are facing the correct way, rotate the base shape so steps run along the x axis from low to high.
        let rotTerrainBase = terrainBase;
        if ( this.#stepParameters.rampDir ) {
          rotTerrainBase = terrainBase.transform(this.#stepParameters.M);

          // Modify the rotation to account for the temporary rotation when building the prototype faces in StepsPrimitive.
          opts.angles.z -= this.#stepParameters.rampDir;
        }

        // Build the steps.
        opts = { ...opts, ...this.#stepParameters };
        terrainShape = StepsPrimitive.fromBasePolygon3d(id, rotTerrainBase, opts);
      }

      else if ( this.constructor.isHill(regionD) ) {
         opts = { ...opts, ...this.#hillParameters };
         opts.groundZ = this.constructor.rampFloor(regionD);
         terrainShape = HillPrimitive.fromBasePolygon3d(id, terrainBase, opts);
      }

      if ( this.hasBaseShape ) return CombinedTerrainPrimitive.create(id, baseShape, terrainShape);
      else return terrainShape;

      } catch ( err ) { console.error(err); } // Fall to the base shape option.
    }

    if ( this.hasBaseShape ) return baseShape;
    return new EmptyGeometricPrimitive(id);
  }

  // Cache terrain data that is based on the entire region shape.
  #rampParameters = { plane: null };

  #hillParameters = { curve: null, type: "linear" };

  #stepParameters = { stepWidth: 1, stepHeight: 1, planks: [], M: null, rampDir: null };

  _updateRampData() {
    this.#rampParameters.plane = this._calculateRampPlane(this.regionPolygons);
  }

  _updateStepsData() {
    // Construct planks based on the entire region shape.
    const res = this.#stepDimensions(this.regionPolygons);
    this.#stepParameters.stepWidth = res.stepWidth;
    this.#stepParameters.stepHeight = res.stepHeight;
    this.#stepParameters.M = res.M;
    this.#stepParameters.rampDir = res.rampDir;
    this.#stepParameters.planks = StepsPrimitive.verticalPlanks(res.rotatedPolygons, res.stepWidth);
  }

  _updateHillData() {
    const regionD = this.placeableDocument;
    this.#hillParameters.curve = HillDrawingManager.hillEvaluationData(regionD);
    this.#hillParameters.type = this.constructor.hillType(regionD);
  }

  createShapes() {
    const regionD = this.placeableDocument;
    if ( this.regionShapes.length !== 0 ) {
      if ( this.constructor.isSteps(regionD) ) this._updateStepsData();
      else if ( this.constructor.isRamp(regionD) ) this._updateRampData();
      else if ( this.constructor.isHill(regionD) ) this._updateHillData();
    }
    return super.createShapes();
  }

  #stepDimensions(polygons) {
    const regionD = this.placeableDocument;
    const totalStepHeight = this.constructor.totalStepHeight(regionD) || 1;
    const numSteps = this.constructor.numSteps(regionD) || 1;
    const stepHeight = totalStepHeight / numSteps;
    const rampDir = Math.toRadians(this.constructor.rampDirection(regionD));
    let M;
    let rotatedPolygons = polygons;
    if ( rampDir !== 0 ) {
      // Rotate the polygons based on ramp direction.
      const center = polygons[0].center;
      const txMat = Matrix.translation(center, { d3: false });
      const rotMat = Matrix.rotationZ(-rampDir, { d3: false });
      const txMatInv = Matrix.translation(center.multiplyScalar(-1), { d3: false });

      // Rotate the polygons.
      M = txMat.multiply3x3(rotMat).multiply3x3(txMatInv);
      rotatedPolygons = [];
      for ( const poly of regionD.polygons ) rotatedPolygons.push(poly.transform(M));
    }

    // Find the x bounds of the new rotated polygons.
    const xs = [];
    polygons.forEach(poly => poly.iteratePoints().forEach(pt => xs.push(pt.x)))
    const xMinMax = Math.minMax(...xs);
    const shapeLength = (xMinMax.max - xMinMax.min);
    const stepWidth = (shapeLength / numSteps) || 1;

    return { numSteps, stepWidth, stepHeight, M, rampDir, rotatedPolygons };
  }

  // ----- NOTE: Updating ----- //

  _update() {
    // Terrain type updated: rebuild terrain shape.
    // Ramp floor updated: rebuild terrain + base if ramp/steps/hill
    // Ramp direction updated: update ramp data or steps data; rebuild terrain shape if steps or ramp.
    // Steps updated: update steps data; rebuild terrain shape if steps
    // Hill updated: update hill data; rebuild terrain shape if hill
    // Plateau elevation updated: rebuild terrain + base if ramp/steps/hill; adjust dimensions if plateau

    // Update cached terrain-specific data.
    if ( this.activeUpdates.has("hill") ) this._updateHillData();
    if ( this.activeUpdates.has("rampDirection") ) { this._updateRampData(); this._updateStepsData(); }
    else if ( this.activeUpdates.has("steps") ) this._updateStepsData();


    // Evaluate if terrain parameter changes necessitate a full rebuild.
    const regionD = this.placeableDocument;
    const needsRebuild = this.activeUpdates.has("terrainType")
      || (this.activeUpdates.has("rampDirection") && this.constructor.isElevated(regionD) && !this.constructor.isPlateau(regionD))
      || (this.activeUpdates.has("steps") && this.constructor.isSteps(regionD))
      || (this.activeUpdates.has('hill') && this.constructor.isHill(regionD));
    if ( needsRebuild ) this.activeUpdates.add("shapes"); // Force RegionGeometry to trigger _updateShapes().

    super._update();
  }

  /**
   * Generates a deterministic signature of properties that dictate shape geometry construction.
   * Extends the RegionGeometry method to include terrain-specific checks.
   *
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holes
   * @returns {string}
   */
  _getStructuralSignature(regionShape, holes = []) {
    const baseSignature = super._getStructuralSignature(regionShape, holes);
    if ( baseSignature === "empty" ) return baseSignature;

    const regionD = this.placeableDocument;

    // Append the primary terrain algorithm.
    const parts = [baseSignature, `terrainType:${this.constructor.algorithm(regionD)}`]

    // Append properties that structurally alter the top geometry.
    if ( this.constructor.isElevated(regionD) ) {
      parts.push(`plateauElev:${this.constructor.terrainTop(regionD)}`)
      if ( !this.constructor.isPlateau(regionD) ) {
        parts.push(`terrainBottom:${this.constructor.terrainBottom(regionD)}`);
        if ( this.constructor.isSteps(regionD) ) {
          parts.push(`stepSize:${this.constructor.rampStepSize(regionD)}`);
        } else if ( this.constructor.isRamp(regionD) || this.constructor.isSteps(regionD) ) {
          parts.push(`rampDir:${this.constructor.rampDirection(regionD)}`);
        } else if ( this.constructor.isHill(regionD) ) {
          parts.push(`hillType:${this.constructor.hillType(regionD)}`);
          parts.push(`hillCurve:${this.constructor.hillData(regionD).join(",")}`);
        }
      }
    }

    return parts.join("|");
  }

  // ----- NOTE: Ramps ----- //

  /**
   * Determine the min/max point of the ramp along the center point.
   * @param {PIXI.Polygon[]} polygons
   * @returns {PIXI.Point[]}
   */
  _calculateRampPlane(polygons) {
    const topZ = this.constructor.terrainTop(this.placeableDocument);
    const rampFloor = this.constructor.terrainBottom(this.placeableDocument);
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
  static isElevated(regionD) { return this.isPlateau(regionD) || this.isRampType(regionD) || this.isHill(regionD); }

  /** @type {boolean} */
  static isPlateau(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.PLATEAU };

  static isRampType(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) === FLAGS.REGION.TERRAIN.CHOICES.RAMP }

  /** @type {boolean} */
  static isRamp(regionD) { return this.isRampType(regionD) && this.rampStepSize(regionD) === 0; };

  /** @type {boolean} */
  static isSteps(regionD) { return this.isRampType(regionD) && this.rampStepSize(regionD) !== 0; }

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
    const floor = this.rampFloor(regionD);

    // If the hill goes negative, it dips below the ramp floor.
    if ( this.hillHasNegativeElevation(regionD) ) {
      // Scale the min and max to -1 to 1.
      const { min, max } = this.hillMinMaxElevation(regionD);
      const maxHeight = Math.max(Math.abs(min), Math.abs(max)) || 1;

      const scaledMin = min / maxHeight;
      const scaledMax = max / maxHeight;

      const positiveHeight = this.terrainTop(regionD) - floor;
      return Math.floor(floor + (positiveHeight * scaledMin));
    } else floor;
  }

  /** @type {object{ min:{number}, max:{number} }} */
  static hillMinMaxElevation(regionD) {
    const curve = HillDrawingManager._unadjustedHillData(regionD);
    return HillDrawingManager.curveMinMaxHeight(curve);
  }

  static hillData(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE) || DEFAULT_FLAGS.REGION[FLAGS.REGION.HILL.CURVE] }

  /** @type {number} */
  static terrainTop(regionD) {
    return gridUnitsToPixels(regionD.getFlag(MODULE_ID, FLAGS.REGION.PLATEAU_ELEVATION)
      || DEFAULT_FLAGS.REGION[FLAGS.REGION.PLATEAU_ELEVATION]);
  }

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
    return gridUnitsToPixels(regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.FLOOR)
      || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.FLOOR]);
  }

  /** @type {number} */
  static rampDirection(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.DIRECTION) || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.DIRECTION]; }

  /** @type {number} */
  static rampStepSize(regionD) {
    return gridUnitsToPixels(regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.STEP_SIZE)
      || DEFAULT_FLAGS.REGION[FLAGS.REGION.RAMP.STEP_SIZE]);
  }

  /** @type {FLAGS.REGION.CHOICES} */
  static algorithm(regionD) {
    return regionD.getFlag(MODULE_ID, FLAGS.REGION.TERRAIN.TYPE) || FLAGS.REGION.TERRAIN.CHOICES.NONE;
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
   * Equivalent to baseElevationZ except that it avoids 0-height
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    const baseElev = this.baseElevationZ;
    if ( baseElev.topZ <= baseElev.bottomZ ) baseElev.bottomZ -= 1;
    return baseElev;
  }

  /**
   * Top and bottom of the non-terrain portion of the region shape, forming the base.
   * Might be 0 height.
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get baseElevationZ() {
    const regionD = this.placeableDocument;
    const elev = super.elevationZ;
    if ( !this.constructor.isElevated(regionD) ) return elev;

    // If plateau, can simply adjust the region top to the plateau top. Region shape is otherwise unaffected.
    if ( this.constructor.isPlateau(regionD) ) {
      elev.topZ = this.constructor.terrainTop(regionD);
      return elev;
    }

    // Return the elevation for the bottom of the region to the base (of the ramp, steps, or hill).
    elev.topZ = this.constructor.terrainBottom(regionD);
    return elev;
  }

  /**
   * Top and bottom of the non-terrain terrain of the region shape, forming the top.
   * Might be 0 height. Plateaus and non-elevated terrain always return 0 height (top of base).
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get terrainElevationZ() {
    const regionD = this.placeableDocument;
    const elev = super.elevationZ;
    if ( !this.constructor.isElevated(regionD) || this.constructor.isPlateau(regionD)  ) {
      elev.bottomZ = elev.topZ;
      return elev;
    }

    // Return the elevation from top of base to top of terrain.
    return {
      topZ: this.constructor.terrainTop(regionD),
      bottomZ: this.constructor.terrainBottom(regionD),
    };
  }
}

export class TerrainGeometryManager extends RegionGeometryManager {
  /** @type {PlaceableGeometry} */
  static geometryClass = TerrainGeometry;
}