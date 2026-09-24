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
import { RegionGeometry } from "../geometry/placeable_geometry/RegionGeometry.js";
import { EmptyGeometricPrimitive } from "../geometry/placeable_geometry/EmptyGeometricPrimitive.js";

// LibGeometry
import { Polygon3d, Polygons3d } from "../geometry/3d/Polygon3d.js";
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
   * Determine the base polygon for the given region shape.
   * Used to construct the terrain shape.
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holeShapes
   * @returns {Polygon3d|null} The shape, in canvas coordinates, or null if no valid shape.
   */
  _basePolygon3dForRegionShape(regionShape, holeShapes) {
    if ( regionShape.hole || regionShape.isEmpty ) return null;

    const bottomZ = this.elevationZ.bottomZ;
    let res = { solids: [], holes: [ ]};

    // 1. Wall Restricted.
    if ( this.isWallRestricted
      && this.constructor.shapeIsWallRestricted(regionShape, this.placeableDocument) ) {
      res = this._wallRestrictedPolygonsForRegionShape(regionShape, holeShapes);
    }

    // 2. Grid constrained
    else if ( this.constructor.shapeIsGridConstrained(regionShape) ) {
      res = this._gridConstrainedPolygonsForRegionShape(regionShape, holeShapes);
    }

    // 3. Otherwise contains holes. Use base PIXI geometric shapes where possible.
    else if ( holeShapes.length ) {
      res = this._polygonsWithHolesForRegionShape(regionShape, holeShapes);
    }

    // 4. Base primitive types. See shape.constructor.TYPES
    else {
      const polys = this._shapeToPIXI(regionShape);
      res.solids.push(polys[0]);
      if ( polys[1] ) res.holes.push(polys[1]); // For rings.
    }

    if ( !res.solids.length ) return null;
    if ( res.holes.length || res.solids.length > 1 ) {
      const holes = new Set();
      const polys = [...res.solids, ...res.holes];
      for ( let i = res.solids.length, n = polys.length; i < n; i += 1 ) holes.add(i);
      return Polygons3d.fromPIXIShapes(polys, { z: bottomZ, holes });
    }
    else return Polygon3d.fromPIXIShape(res.solids[0], { z: bottomZ });
  }

  /**
   * Instantiate the correct primitive shape based on constraints and type.
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holeShapes
   * @param {string} id
   * @returns {GeometricPrimitive}
   */
  _instantiateShape(regionShape, holeShapes, id) {
    const regionD = this.placeableDocument;
    const TERRAIN_TYPES = this.constructor.TERRAIN_TYPES;
    const terrainType = this.constructor.terrainType(regionD);
    if ( terrainType === TERRAIN_TYPES.NONE
      || terrainType === TERRAIN_TYPES.PLATEAU ) return super._instantiateShape(regionShape, holeShapes, id);

    const terrainBase = this._basePolygon3dForRegionShape(regionShape, holeShapes);
    if ( !terrainBase ) return super._instantiateShape(regionShape, holeShapes, id);

    let opts = this._shapeDimensions(regionShape);
    switch ( terrainType ) {
      case TERRAIN_TYPES.RAMP: {
        opts = { ...opts, ...this.#rampParameters };
        return RampPrimitive.fromBasePolygon3d(id, terrainBase, opts);
      }
      case TERRAIN_TYPES.STEPS: {
        // So the steps are facing the correct way, rotate the base shape so steps run along the x axis from low to high.
        let rotTerrainBase = terrainBase;
        if ( this.#stepParameters.rampDir ) {
          rotTerrainBase = terrainBase.transform(this.#stepParameters.M);

          // Modify the rotation to account for the temporary rotation when building the prototype faces in StepsPrimitive.
          opts.angles.z -= this.#stepParameters.rampDir;
        }

        // Build the steps.
        opts = { ...opts, ...this.#stepParameters };
        return StepsPrimitive.fromBasePolygon3d(id, rotTerrainBase, opts);
      }
      case TERRAIN_TYPES.HILL: {
        opts = { ...opts, ...this.#hillParameters };
        opts.groundZ = this.constructor.hillGroundElevation(regionD);
        return HillPrimitive.fromBasePolygon3d(id, terrainBase, opts);
      }

      default: return new EmptyGeometricPrimitive(id);
    }
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
      const TERRAIN_TYPES = this.constructor.TERRAIN_TYPES;
      switch ( this.constructor.terrainType(regionD) ) {
        case TERRAIN_TYPES.STEPS: this._updateStepsData(); break;
        case TERRAIN_TYPES.RAMP: this._updateRampData(); break;
        case TERRAIN_TYPES.HILL: this._updateHillData(); break;
      }
    }
    return super.createShapes();
  }

  #stepDimensions(polygons) {
    const regionD = this.placeableDocument;
    const totalStepHeight = this.constructor.zHeight(regionD) || 1;
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
    const parts = [baseSignature];
    const TERRAIN_TYPES = this.constructor.TERRAIN_TYPES
    switch ( this.constructor.terrainType(regionD) ) {
      case TERRAIN_TYPES.NONE:
      case TERRAIN_TYPES.PLATEAU: return baseSignature;

      // Append properties that structurally alter the terrain geometry.
      case TERRAIN_TYPES.RAMP:
        parts.push(`rampDir:${this.constructor.rampDirection(regionD)}`);
        break;
      case TERRAIN_TYPES.STEPS:
        parts.push(`rampDir:${this.constructor.rampDirection(regionD)}`);
        parts.push(`stepSize:${this.constructor.stepSize(regionD)}`);
        break;
      case TERRAIN_TYPES.HILL:
        parts.push(`rampDir:${this.constructor.rampDirection(regionD)}`);
        parts.push(`hillType:${this.constructor.hillType(regionD)}`);
        parts.push(`hillCurve:${this.constructor.hillData(regionD).join(",")}`);
        break;
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
    const regionD = this.placeableDocument
    const bottomZ = this.elevationZ.bottomZ;
    const rise = this.constructor.zHeight(regionD);
    const rampDir = this.constructor.rampDirection(regionD);

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
    const low3d = Point3d.tmp.set(minPoint.x, minPoint.y, bottomZ);
    // const high3d = Point3d.tmp.set(maxPoint.x, maxPoint.y, topZ);

    // Calculate 3d normal vector.
    const run = maxProj - minProj;

    // Normalized 3d normal vector pointing orthogonally "up" from the ramp surface.
    const len = Math.hypot(rise, run);
    return new Plane(low3d, {
      x: (-dir.x * rise) / len,
      y: (-dir.y * rise) / len,
      z: run / len,
    });
  }


  // ----- NOTE: Static properties for terrains ----- //

  /** @type {enum<string>} */
  static TERRAIN_TYPES = {
    NONE: "none",
    PLATEAU: `${MODULE_ID}.plateauTerrain`,
    RAMP: `${MODULE_ID}.rampTerrain`,
    STEPS:`${MODULE_ID}.stepsTerrain`,
    HILL: `${MODULE_ID}.hillTerrain`,
  };

  /** @type {Set<TERRAIN_TYPES>} */
  static ELEVATED_TYPES = new Set([
      this.TERRAIN_TYPES.PLATEAU,
      this.TERRAIN_TYPES.RAMP,
      this.TERRAIN_TYPES.STEPS,
      this.TERRAIN_TYPES.HILL,
    ]);

  /**
   * @param {RegionDocument} regionD
   * @returns {boolean}
   */
  static isElevated(regionD) {
    const ELEVATED_TYPES = this.ELEVATED_TYPES;
    return regionD.behaviors.some(b => !b.disabled && ELEVATED_TYPES.has(b.type))
  }

  /** @type {enum<string>} */
  static terrainType(regionD) {
    const ELEVATED_TYPES = this.ELEVATED_TYPES;
    for ( const b of regionD.behaviors ) {
      if ( b.disabled ) continue;
      if ( ELEVATED_TYPES.has(b.type) ) return b.type;
    }
    return "none";
  }

  /** @type {boolean} */
  static isPlateau(regionD) {
    const plateauType = this.TERRAIN_TYPES.PLATEAU;
    return regionD.behaviors.some(b => !b.disabled && b.type === plateauType);
  };

  static isRamp(regionD) {
    const rampType = this.TERRAIN_TYPES.RAMP;
    return regionD.behaviors.some(b => !b.disabled && b.type === rampType);
  }

  /** @type {boolean} */
  static isSteps(regionD) {
    const stepsType = this.TERRAIN_TYPES.STEPS;
    return regionD.behaviors.some(b => !b.disabled && b.type === stepsType);
  }

  /** @type {boolean} */
  static isHill(regionD) {
    const hillType = this.TERRAIN_TYPES.HILL;
    return regionD.behaviors.some(b => !b.disabled && b.type === hillType);
  }

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


  /**
   * The hill ground elevation is the point at which the hill is 0 along the curve.
   * For a positive-only curve, this is the region bottom.
   * For a negative-only curve, this is the region top.
   * For a mixed curve, this is between the top and bottom.
   * @type {number}
   */
  static hillGroundElevation(regionD) {
    const { bottomZ, topZ } = regionD;
    const { min, max } = this.hillMinMaxElevation(regionD);
    if ( min >= 0 ) return bottomZ;
    if ( max < 0 ) return topZ;

    // Hill is a mix of negative and positive.
    const maxHeight = Math.max(Math.abs(min), Math.abs(max)) || 1;
    const scaledMin = min / maxHeight;
    const positiveHeight = topZ - bottomZ;
    return Math.floor(bottomZ + (positiveHeight * scaledMin))
  }

  /** @type {object{ min:{number}, max:{number} }} */
  static hillMinMaxElevation(regionD) {
    const curve = HillDrawingManager._unadjustedHillData(regionD);
    return HillDrawingManager.curveMinMaxHeight(curve);
  }

  static hillData(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE) || DEFAULT_FLAGS.REGION[FLAGS.REGION.HILL.CURVE] }

  /** @type {number} */
  static rampDirection(regionD) {
    const rampType = this.TERRAIN_TYPES.RAMP;
    const stepsType = this.TERRAIN_TYPES.STEPS;
    const rampB = regionD.behaviors.find(b => !b.disabled && (b.type === rampType || b.type === stepsType));
    if ( !rampB ) return 0;
    return rampB.system.direction;
  }

  /** @type {number} */
  static stepSize(regionD) {
    const rampType = this.TERRAIN_TYPES.RAMP;
    const rampB = regionD.behaviors.find(b => !b.disabled && b.type === rampType);
    if ( !rampB ) return 0;
    return gridUnitsToPixels(rampB.system.stepSize);
  }

  /** @type {number} */
  static totalStepHeight(regionD) {
    return this.terrainTop(regionD) - this.terrainBottom(regionD);
  }

  /** @type {number} */
  static numSteps(regionD) {
    if ( !this.isSteps(regionD) ) return 0;
    return Math.ceil(this.zHeight(regionD) / this.stepSize(regionD));
  }
}

export class TerrainGeometryManager extends RegionGeometryManager {
  /** @type {PlaceableGeometry} */
  static geometryClass = TerrainGeometry;
}