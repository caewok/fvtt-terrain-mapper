/* globals
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
import { CubePrimitive, CylinderPrimitive } from "../geometry/placeable_geometry/InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { RegionGeometry } from "../geometry/placeable_geometry/RegionGeometry.js";

// LibGeometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { gridUnitsToPixels } from "../geometry/util.js";
import { Matrix } from "../geometry/Matrix.js";
import { Plane } from "../geometry/3d/Plane.js";
import { RegionGeometryManager } from "../geometry/placeable_tracking/CanvasGeometryManager.js";

export class TerrainGeometry extends RegionGeometry {

  static {
    // Add TM-specific flags.
    this.UPDATE_KEYS.properties.add(`flags.${MODULE_ID}.rampDirection`);
    this.UPDATE_KEYS.properties.add(`flags.${MODULE_ID}.splitPolygons`);
    this.UPDATE_KEYS.properties.add(`flags.${MODULE_ID}.elevationAlgorithm`);

    this.UPDATE_KEYS.elevation.add(`flags.${MODULE_ID}.plateauElevation`);
    this.UPDATE_KEYS.elevation.add(`flags.${MODULE_ID}.rampFloor`);
  }

  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive|null}
   */
  _buildRegionShape(levelSegmentIdx, shapeIdx) {
    const regionD = this.placeableDocument;

    if ( !this.constructor.isElevated(regionD)
      || this.constructor.isPlateau(regionD) ) return super._buildRegionShape(levelSegmentIdx, shapeIdx);

    const baseTopZ = this.constructor.rampFloor(regionD)
    const baseShape = super._buildRegionShape(levelSegmentIdx, shapeIdx, baseTopZ);

    // TODO: Handle single and per-polygon ramps, steps, hills.
    //       Let the user define in the shape config.
    const id = this._levelShapeId(levelSegmentIdx, shapeIdx);
    const regionShape = this.regionShapes[shapeIdx];
    const polys = regionShape.polygons;
    let topShape;
    const opts = this._polygonPrimitiveTransforms(regionShape, levelSegmentIdx);

    if ( this.constructor.isRamp(regionD) ) {
      const plane = this.calculateSingleRampPlane();
      topShape = RampPrimitive.fromPolygons(id, polys, plane, opts);

    } else if ( this.constructor.isSteps(regionD) ) {
      const bottomZ = gridUnitsToPixels(this.constructor.rampFloor(regionD));
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

      } else {
        const stepWidth = this.aabb.width / numSteps;
        const steps = StepsPrimitive.fromPolygons(id, regionD.polygons, { bottomZ, stepWidth, stepHeight, ...opts })
      }

    } else if ( this.constructor.isHill(regionD) ) {
      const curve = HillDrawingManager.scaledHillData(regionD);
      const opts = {
        type: this.constructor.hillType(regionD),
        elevationZ: gridUnitsToPixels(this.constructor.rampFloor(regionD)),
      };
      topShape = HillPrimitive.fromPolygons(id, polys, curve, opts)
    }

    const combinedShape = new CombinedGeometricPrimitive();
    combinedShape.addShape(baseShape);
    combinedShape.addShape(topShape);
    return combinedShape;
  }

  _buildBaseShape(levelSegmentIdx, shapeIdx) {
    const regionShape = this.regionShapes[shapeIdx];
    const id = this._levelShapeId(levelSegmentIdx, shapeIdx);
    let shape;
    if ( regionShape.gridBased ) {
      let zElev = this.elevationZ;
      zElev.topZ = gridUnitsToPixels(this.constructor.rampFloor(this.placeableDocument));

      const zDims = this.constructor.elevationZForSegment(levelSegmentIdx, zElev.topZ, zElev.bottomZ);
      shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, zDims);

    } else switch ( regionShape.type ) {
      // See shape.constructor.TYPES
      case "circle":
      case "ellipse": shape = new CylinderPrimitive(id); break;

      case "line":
      case "rectangle": shape = new CubePrimitive(id); break;

      case "emanation":
        // Use the polygon b/c corner radiuses can vary.
        // base.x, base.y, rotation, base.width (# grid spaces), base.height (# grid spaces), origin

      case "ring": /* eslint-disable-line no-fallthrough */
         // Use the polygon(s) b/c of the hole.
        // rotation, x, y, radius as width, origin

      case "polygon": /* eslint-disable-line no-fallthrough */
        // Obv. use the polygon.
        // rotation, although not user-set, origin

      case "cone": /* eslint-disable-line no-fallthrough */
        // Use the polygon b/c no unit cone shape b/c angle varies.
        // rotation, x, y, radius as width, origin


      case "grid": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      case "token": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      default: {  /* eslint-disable-line no-fallthrough */
        // Pass the center, rotation, and dimensions so a prototype can be created.
        const opts = this._polygonPrimitiveTransforms(regionShape, levelSegmentIdx);
        shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);
        opts.center.release();
        opts.dims.release();
        opts.angles.release();
      }
    }
    return shape;

  }

  // ----- NOTE: Ramps ----- //

  /**
   * Calculate the plane of a ramp, for case where polygons are not split.
   * Steps should be defined such that the top of each step hits this plane.
   * @returns {Plane}
   */
  calculateSingleRampPlane() {
    const polys = this.regionShapes.flatMap(shape => shape.polygons);
    return this._calculatePolygonRamp(polys);
  }

  /**
   * Calculate the planes of a ramp, for case where polygons are split.
   * Steps should be defined such that the top of each step hits this plane.
   * @returns {Plane[]}
   */
  calculateMultiPolygonRampPlanes() {
    return this.regionShapes.map(shape => this._calculatePolygonRamp(shape.polygons))
  }


  /**
   * Calculate the plane of a ramp for a single group of polygons of this region.
   * @param {PIXI.Polygon[]} polygons
   * @returns {Plane}
   */
  _calculatePolygonRamp(polygons) {
		const [a3d, b3d] = this._calculatePolygonRampPoints(polygons);

		// Construct the ramp plane. Normal should face up (toward part to cut away).
		// Find a perpendicular in 2d to the plane direction.
		const dir = b3d.subtract(a3d);
		using perpDir = Point3d.tmp.set(dir.y, -dir.x, 0); // Use y, -x so normal faces up.
		using c3d = b3d.add(perpDir);
		const p = Plane.fromPoints(a3d, b3d, c3d);
		a3d.release();
		b3d.release();
		return p;
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
   * Top and bottom elevation of a region.
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    const res = super.elevationZ;
    if ( !this.constructor.isElevated(this.placeableDocument) ) return res;
    res.topZ = gridUnitsToPixels(this.constructor.plateauElevation(this.placeableDocument));
    return res;
  }
}

export class TerrainGeometryManager extends RegionGeometryManager {
  /** @type {PlaceableGeometry} */
  static geometryClass = TerrainGeometry;
}