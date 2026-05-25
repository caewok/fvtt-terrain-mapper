/*
Vertical Raycast Stepper.
Shoot rays straight down from the "sky" at every step.

How the Algorithm Works
	1.	The Step Loop: We create a 2D line from start to end and advance along it by stepSize.
	2.	Surface Intersections: At each new X/Y coordinate, we shoot a ray straight down from a high altitude using SDF.findAllIntersections. This gives us a list of every surface's Z-elevation (the top of an obstacle, the ceiling of an overhang, the floor, etc.).
	3.	Collision Resolution:
•	If we step into empty air (SDF > 0): We fell off a ledge. We grab the highest surface Z that is below us. We insert a point at the cliff edge, then drop the Z coordinate straight down.
•	If we step into an obstacle (SDF <= 0): We hit a wall or ramp. We grab the lowest surface Z that is above us. This cleanly bypasses overhangs! If we hit a wall while standing under a balcony, popping to the first surface above us places us on top of the wall (or the balcony, passing straight through it).

*/


AABB2d = CONFIG.GeometryLib.lib.AABB2d
AABB3d = CONFIG.GeometryLib.lib.threeD.AABB3d
Draw = CONFIG.GeometryLib.lib.Draw
Matrix = CONFIG.GeometryLib.lib.Matrix
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Plane = CONFIG.GeometryLib.lib.threeD.Plane
SDF = CONFIG.GeometryLib.lib.sdf.SDF
SDFPlaceable = CONFIG.GeometryLib.lib.sdf.SDFPlaceable
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
Plane = CONFIG.GeometryLib.lib.threeD.Plane
PriorityQueue = CONFIG.GeometryLib.lib.PriorityQueue;
almostLessThan = CONFIG.GeometryLib.lib.utils.almostLessThan
SDFCombined = CONFIG.GeometryLib.lib.sdf.SDFCombined
SDFSmoothCombined = CONFIG.GeometryLib.lib.sdf.SDFSmoothCombined


class SceneFloorSDF extends SDFPlaceable {
  plane = new Plane();

  constructor(placeable) {
    super(placeable);
    this.plane.point.z = this.elevationZ;
  }

  _sdf2d() { return p => Number.POSITIVE_INFINITY; }

  _sdf3d() { return p => SDF.sdPlane(p, this.plane); }

  get elevationZ() { return this.placeable.flags.terrainmapper.backgroundElevation; }

  get aabb2d() {
    const aabb = new AABB3d();
    aabb.min.x = Number.NEGATIVE_INFINITY;
    aabb.min.y = Number.NEGATIVE_INFINITY;
    aabb.max.x = Number.POSITIVE_INFINITY;
    aabb.max.y = Number.POSITIVE_INFINITY;
    return aabb;
  }

  get aabb3d() {
    // Infinite X,Y with a defined elevation.
    const aabb = new AABB3d();
    aabb.min.x = Number.NEGATIVE_INFINITY;
    aabb.min.y = Number.NEGATIVE_INFINITY;
    aabb.max.x = Number.POSITIVE_INFINITY;
    aabb.max.y = Number.POSITIVE_INFINITY;
    aabb.min.z = this.elevationZ;
    aabb.max.z = this.elevationZ;
    return aabb;
  }

  ray3dIntersectionsT(rayOrigin, rayDirection) {
    if ( !rayDirection.z ) return [];
    return this.aabb3d.rayIntersectionsT(rayOrigin, rayDirection);
  }
}

// Flatten the 3d vertical path on to the canvas (tipping it), using origin point of 0,0.
function flattenVerticalPathPoints(points, start, end) {
  using dir = end.subtract(start);
  const segmentLength2d = PIXI.Point.distanceBetween(start, end);

  // Avoid division by 0.
  dir.x = segmentLength2d > 0 ? dir.x / segmentLength2d : 0;
  dir.y = segmentLength2d > 0 ? dir.y / segmentLength2d : 0;
  dir.z = 0;

  // Map each 3d point to its flattened 2d counterpart.
  using v = Point3d.tmp;
  return points.map(p => {
    // Vector from segment start to the current point in the XY plane.
    p.subtract(start, v);
    v.z = 0;

    // Dot product gives the linear distance along the line segment.
    const distanceAlongSegment = v.dot(dir);

    return PIXI.Point.tmp.set(
      distanceAlongSegment,
      -p.z, // Inverted so positive Z goes up on the 2d canvas.
    );
  });
}

// Translate and rotate the flattened points so they rise from the segment location on canvas.
function translateFlattenedPoints(points2d, start, end) {
  const dz = end.z - start.z;
  const segmentLength2d = PIXI.Point.distanceBetween(start, end);
  const theta = Math.atan2(dz, segmentLength2d); // Angle relative to horizontal ground.
  const mRot = Matrix.rotationZ(theta, false);
  const mTx = Matrix.translation(start.x, start.y);
  const M = mTx.multiply3x3(mRot);
  return points2d.map(pt => M.multiplyPoint2d(pt, pt));
}

/**
 * Add point to array of points.
 * Remove the preceding point if the previous 2 plus the newPt have two stationary axes.
 * Requires at least two points in the array.
 */

function addPoint(points, newPt) {
  deltaTmp1 = Point3d.tmp;
 deltaTmp2 = Point3d.tmp;

  newPt.subtract(points.at(-1), deltaTmp1);
  points.at(-1).subtract(points.at(-2), deltaTmp2);

  const xIsZero = deltaTmp1.x.almostEqual(0) && deltaTmp2.x.almostEqual(0);
  const yIsZero = deltaTmp1.y.almostEqual(0) && deltaTmp2.y.almostEqual(0);
  if ( (xIsZero && yIsZero) ) points.pop();
  else {
    const zIsZero = deltaTmp1.z.almostEqual(0) && deltaTmp2.z.almostEqual(0);
    if (zIsZero && (zIsZero || yIsZero)) points.pop();
  }
  points.push(newPt);
}

function traceSurfacePath(start, end, sceneSDF, stepSize = 1) {
  const surfaceEpsilon = 0.01;
  const surfaceEpsilon2 = surfaceEpsilon ** 2;
  const maxHeight = 10000; // Sufficiently high origin for downward raycasts
  const maxIterations = Math.ceil(Point3d.distanceBetween(start, end) * 2);
  const raymarchOpts = { surfaceEpsilon, maxDistance: maxHeight * 2, maxSteps: 1000 };

  const path = [start.clone(), start.clone()]; // Double it so addPoint has two points to start.
  using current = start.constructor.tmp.copyFrom(start);

  // Helper: Casts a ray from maxHeight to find all surface elevations at an XY point.
  // Strictly filter out interior boundaries, which may not be true SDFs.
  using verticalRayOrigin = Point3d.tmp.set(0, 0, maxHeight);
  using verticalRayDirection = Point3d.tmp.set(0, 0, -1);
  using testPt = Point3d.tmp;
  const getWalkableSurfaceAbove = currPt => {
    verticalRayOrigin.x = currPt.x;
    verticalRayOrigin.y = currPt.y;
    const hits = SDF.findAllIntersections(verticalRayOrigin, verticalRayDirection, sceneSDF, raymarchOpts)

    testPt.set(currPt.x, currPt.y, 0);
    let minValid = Number.POSITIVE_INFINITY;
    for ( const hit of hits ) {
      // Convert t-distances to z-elevations.
      const zValue = maxHeight - hit;

      // Surface is only wallkable if the space immediately above it is empty air.
      testPt.z = zValue + surfaceEpsilon;
      if ( zValue >= currPt.z - surfaceEpsilon && sceneSDF(testPt) > 0 ) minValid = Math.min(minValid, zValue);
    }
    if ( !isFinite(minValid) ) throw Error(`traceSurfacePath|Cannot locate floor or ceiling at {${currPt.x}, ${currPt.y}, ${currPt.z}}.`);
    return minValid;
  }

  // Helper: Z-correction when stepping.
  using liftPt = Point3d.tmp;
  using rayOrigin = Point3d.tmp;
  const zCorrection = (d2, currPt) => {
    // Knee-height probe to detect an invalid surface.
    // If space immediately above our feet is blocked (SDF < 0), we hit a wall.
    let isAnomaly = Math.abs(d2) > surfaceEpsilon2;
    let liftD2 = d2;

    if ( !isAnomaly ) {
      // We are technically on a surface (d2 === 0). Check space immediately above.
      liftPt.copyFrom(currPt);
      liftPt.z += surfaceEpsilon;
      liftD2 = sceneSDF(liftPt);

      // If space above is solid, we are in a flush vertical wall.
      isAnomaly = liftD2 < 0;
    }

    if ( isAnomaly ) {
      // Determine if we are blocked (need to pop up) or falling based on effective state.
      const effectiveD2 = (Math.abs(d2) > surfaceEpsilon2) ? d2 : liftD2;
      if ( effectiveD2 > 0 ) {
        // Falling: Stepped into empty air.
        // Raymarch downward from the exterior.
        const dropDist = SDF.raymarch(currPt, verticalRayDirection, sceneSDF, raymarchOpts);
        return dropDist !== null ? currPt.z - dropDist : currPt.z;
      } else {
        // Blocked: Stepped into an obstacle.
        // Unsafe to raymarch upwards from inside a boolean union sdf.
        // Instead, use more robust sky-drop to find closest valid surface above.
        return getWalkableSurfaceAbove(currPt);
      }
    }
    return currPt.z;
  }

  // Temporary objects used in the loop.
  using nextPt = Point3d.tmp;

  // Initial gravity drop (or pop-up if spawned inside an object).
  const startD2 = sceneSDF(current);
  current.z = zCorrection(startD2, current)
  addPoint(path, current.clone());

  // Precompute 2d trajectory.
  using stepVec = Point3d.tmp.set(end.x - current.x, end.y - current.y, 0);
  const totalDist2d = stepVec.magnitude();
  const numSteps = Math.floor(totalDist2d / stepSize);

  // Normalize and scale to stepSize length.
  if ( totalDist2d > 0 ) stepVec.normalize(stepVec).multiplyScalar(stepSize, stepVec);

  // Cap iterations to whichever is smaller to act as safety net.
  const loopLimit = Math.min(numSteps, maxIterations);
  let iterations = 0;

  while ( iterations++ < loopLimit ) {
    current.add(stepVec, nextPt);
    const d2 = sceneSDF(nextPt);

    // If not perfectly resting on a surface, calculate the Z correction.
    nextPt.z = zCorrection(d2, nextPt);

    // If it is a sheer drop or sheer wall, add the cliff-edge/base point before teleporting up.
    if ( Math.abs(nextPt.z - current.z) > stepSize ) addPoint(path, start.constructor.tmp.set(nextPt.x, nextPt.y, current.z));

    current.copyFrom(nextPt);
    addPoint(path, current.clone());
  }

  // Final step on to the target XY.
  const endPt = end.constructor.tmp.set(end.x, end.y, current.z);
  const endD2 = sceneSDF(endPt);
  endPt.z = zCorrection(endD2, endPt);
  if ( Math.abs(endPt.z - current.z) > stepSize ) addPoint(path, end.constructor.tmp.set(end.x, end.y, current.z));
  addPoint(path, endPt);
  return path;
}


/**
 * Traces a 3D path over SDF surfaces using gradient projection, adhering to overhangs.
 * Uses smooth union to facilite moves around sharp interior corners.
 * Detects edges and raymarches down (simulating gravity) to drop to floor benath.
 * @param {Point3d} start               Starting coordinate
 * @param {Point3d} end                 Target ending coordinate
 * @param {SDFPlaceable[]} obstacles    Array of sdf objects representing obstacles, including floor (squared distance)
 * @param {number} [stepSize=1]         Distance to move per iteration
 * @returns {Point3d[]}                 Array of path waypoints
 */
function traceGradientSurfacePath(start, end, obstacles, stepSize = 1) {
  const surfaceEpsilon = 0.01;
  const surfaceEpsilon2 = surfaceEpsilon ** 2;
  const smoothK = 4.0; // Smoothing radius to round out 90-degree internal corners
  const maxIterations = 5000;
  const samplingOffset = 1e-03;
  const stepSize2 = stepSize ** 1;
  const bigStep2 = (stepSize * 0.75) ** 2;
  using downDir = Point3d.tmp.set(0, 0, -1)

  // Helper: Evaluates the obstacles.
  const smoothSDFObj = new SDFSmoothCombined(obstacles);
  const smoothSDF = smoothSDFObj.sdf3d({ smoothK });

  const path = [start.clone()];
  using current = start.clone();
  using normal = downDir.multiplyScalar(-1)
  using gradientTestPoint = Point3d.tmp;
  using tmp = Point3d.tmp;

  // 2. Initial Drop (or Pop-out)
  let d2 = smoothSDF(current);
  if ( Math.abs(d2) > surfaceEpsilon2 ) {
    if ( d2 > 0 ) {
      // Spawned in the air, raymarch straight down
      const dropDist = SDF.raymarch(current, downDir, smoothSDF);
      current.z -= dropDist;
    } else {
      // Spawned inside an object, push out along the surface normal
      SDF.calculateGradient(smoothSDF, gradientTestPoint, samplingOffset, normal);
      current.add(normal.multiplyScalar(Math.abs(SDF.fromSquaredDistance(d2)), tmp), current);
    }
  }
  path.push(current.clone());


  // 3. The Crawl Loop
  using dir2d = end.subtract(current);
  dir2d.z = 0;
  let dist2d = dir2d.magnitude();
  let iterations = 0;

  using projectedDir = Point3d.tmp;
  using nextPt = start.constructor.tmp;

  while ( dist2d > stepSize2 && iterations++ < maxIterations ) {
    dir2d.normalize(dir2d);

    // Always test gradient from slightly above surface, b/c inside combined SDFs may have incorrect distances.
    current.add(normal, gradientTestPoint);

    // Get the surface normal pointing away from the obstacle/floor
    SDF.calculateGradient(smoothSDF, gradientTestPoint, samplingOffset, normal);

    // Project our 2D desired direction onto the 3D slope tangent
    SDF.projectDirectionOntoSlope(dir2d, normal, projectedDir);
    projectedDir.normalize(projectedDir);

    // Take a step along the tangent
    current.add(projectedDir.multiplyScalar(stepSize, projectedDir), nextPt);
    let nextD2 = smoothSDF(nextPt);

    // 4. Surface Correction & Ledge Detection
    if ( Math.abs(nextD2) > surfaceEpsilon2 ) {
      // Because we used smoothUnion, corners are rounded. If we suddenly step
      // significantly into the air, we didn't hit a corner—we fell off a cliff/overhang edge.
      if ( nextD2 > bigStep2 ) {
        // Fall straight down to the next surface
        const dropDist = SDF.raymarch(nextPt, downDir, smoothSDF);

        // Add the edge cliff-point before falling to keep the path connected properly
        path.push(nextPt.clone());
        nextPt.z -= dropDist;
      } else {
        // We are slightly floating or clipping due to normal curvature.
        // Snap back exactly onto the surface by moving along the normal.
        nextPt.add(normal, gradientTestPoint);
        SDF.calculateGradient(smoothSDF, gradientTestPoint, samplingOffset, normal);

        // If nextD is positive (air), this pulls us in. If negative (inside), it pushes us out.
        nextPt.subtract(normal.multiplyScalar(SDF.fromSquaredDistance(nextD2), tmp), nextPt);
      }
    }

    current.copyFrom(nextPt);
    path.push(current.clone());

    dir2d.set(end.x - current.x, end.y - current.y, 0);
    dist2d = dir2d.magnitude();
  }

  // 5. Final Step Alignment
  const endPt = end.constructor.tmp.set(end.x, end.y, current.z);
  let endD2 = smoothSDF(endPt);
  if ( Math.abs(endD2) > surfaceEpsilon2 ) {
    if ( endD2 > 0 ) {
      const dropDist = SDF.raymarch(endPt, downDir, smoothSDF);
      if ( dropDist > stepSize) path.push(endPt.clone());
      endPt.z -= dropDist;
    } else {
      endPt.add(normal, gradientTestPoint);
      SDF.calculateGradient(smoothSDF, gradientTestPoint, samplingOffset, normal);
      endPt.add(normal.multiplyScalar(Math.abs(SDF.fromSquaredDistance(endD)), normal), endPt)
    }
  }

  path.push(endPt);
  return path;
}


/* Test basic 2d shape blending.

rect = new PIXI.Rectangle(100, 100, 200, 300)
rect2 = new PIXI.Rectangle(0, 100 + 300, 500, 200)
Draw.shape(rect)
Draw.shape(rect2)
aabb = AABB2d.fromPoints([PIXI.Point.tmp.set(-100, 0), PIXI.Point.tmp.set(600, 700)])
segment = { a: Point3d.tmp.set(-100, 400, 0), b: Point3d.tmp.set(600, 400, 0)}

sdfRect1 = p => SDF.sdPIXIRectangle(p, rect)
sdfRect2 = p => SDF.sdPIXIRectangle(p, rect2)

smoothK = 5
flatCombined = p => SDF.union(sdfRect1(p), sdfRect2(p))
smoothCombined = p => SDF.smoothUnion([sdfRect1(p), sdfRect2(p)], smoothK);
smoothCombined2 = p => SDF.smoothUnion2([sdfRect1(p), sdfRect2(p)], smoothK, SDF._smoothUnionQuadratic2);

SDF.drawHeatmap(flatCombined, aabb, { step: 2, radius: 2 })
SDF.drawHeatmap(smoothCombined, aabb, { step: 2, radius: 2 })
SDF.drawHeatmap(smoothCombined2, aabb, { step: 2, radius: 2 })

*/




startToken = canvas.tokens.placeables.find(t => t.name === "Randal")
endToken = canvas.tokens.placeables.find(t => t.name === "Riswynn")

start = GridCoordinates3d.fromTokenCenter(startToken)
end = GridCoordinates3d.fromTokenCenter(endToken)

start.elevation = 20
end.elevation = 20


rayOrigin = start;
rayDirection = end.subtract(start).normalize()

// Create SDF object for each placeable
tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];

// Filter to include only those SDFs that could be encountered on the path.
start2d = start.to2d();
end2d = end.to2d();
sceneSDFs = sceneSDFs.filter(sceneSDF => sceneSDF.aabb2d.overlapsSegment(start2d, end2d));

// Define a floor
// Use standard union to preserve strict vertical edges.
floorSDF = new SceneFloorSDF(canvas.scene);
sceneSDFs.push(floorSDF);
sceneSDFObj = new SDFCombined(sceneSDFs)
sceneSmoothSDFObj = new SDFSmoothCombined(sceneSDFs);

a = Point3d.tmp.set(start.x, start.y, -100)
b = Point3d.tmp.set(end.x, end.y, 500);
sceneSDFObj.drawZCutout({ a, b }, { radius: 5, xStep: 50, zStep: 50 })
sceneSDFObj.drawZCutout({ a, b }, { radius: 2, xStep: 2, zStep: 2, maxHeatRatio: .5 })

a.z = -10
b.z = 100
sceneSmoothSDFObj.drawZCutout({ a, b }, { radius: 1, xStep: 1, zStep: 1, maxHeatRatio: .01 })

// Paths
path1 = traceSurfacePath(start, end, sceneSDFObj.sdf3d())
path2 = traceGradientSurfacePath(start, end, sceneSDFs)


Draw.connectPoints(path, { color: Draw.COLORS.white })
path.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.orange }))
path2d = flattenVerticalPathPoints(path, start, end)
Draw.connectPoints(path2d)
path2d.forEach(pt => Draw.point(pt, { radius: 1 } ))


path2dTx = translateFlattenedPoints(path2d, start, end)
Draw.connectPoints(path2dTx)
path2dTx.forEach(pt => Draw.point(pt, { radius: 1 } ))