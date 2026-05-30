/* Terrain path forcing using SDFs.

From 3d point a --> 3d point b, find a path considering elevated terrain.

1. Walking path.

For each SDF object, first need its 2d intersection points along the path a|b, identified as t values.
This tells us:
1. What SDFs to use in the scene at a given location
2. How far to the edge of the current surface SDF(s).

2. Flying path.
Identify each SDF object hit via straight path. Attempt to fly to top along each
(convex hull). If the hull path hits an object, that object must be floating; go below it.

3. Burrowing path.
Like walking but move through objects using -distance.

*/


AABB2d = CONFIG.GeometryLib.lib.AABB2d
AABB3d = CONFIG.GeometryLib.lib.threeD.AABB3d
Draw = CONFIG.GeometryLib.lib.Draw
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
cutawayUtil = CONFIG.GeometryLib.lib.utils.cutaway


class SceneFloorSDF extends SDFPlaceable {
  plane = new Plane();

  constructor(placeable) {
    super(placeable);
    this.plane.point.z = this.elevationZ;
  }

  sdf3d() { return p => SDF.sdPlane(p, this.plane); }

  get elevationZ() { return this.placeable.flags.terrainmapper.backgroundElevation; }

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

class SmoothCombinedSDF extends SDFPlaceable {
  /**
   * Smooth union radius transition.
   * @type {number}
   */
  k = 1;

  constructor(sdfObjects) {
    super(sdfObjects);
  }

  get aabb3d() { return AABB3d.union(this.placeable.map(sdfObj => sdfObj.aabb3d)); }

  sdf3d() {
    return p => SDF.smoothUnion(this.placeable[0].sdf3d()(p), this.placeable[1].sdf3d()(p), this.k);
  }
}




// Identify the first intersection point for each placeable.
// For single shapes, identify the end point.
// For multiple shapes, identify the end points.

/**
 * Round to the nearest decimal.
 * @param {number} n			Number to round
 * @param {number}[decimals=2]		Number of decimals to round to
 * @returns {number}
 */
function roundToDecimal(n, decimals = 2) {
  const c = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * c) / c;
}

/**
 * Identify the t-value on segment A|B closest to C.
 * Picture the line segment as forming an infinite-width cylinder with a defined height
 * equal to the length of the segment.
 * 0: Point is below the cylinder.
 * 1: Point is above.
 * 0-1: If the point is within the cylinder, the function returns the percentage height
 *      of the point relative to the cylinder base.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment A|B
 * @param {Point} b     Point B on segment A|B
 * @returns {number}    T-value, where 0 is a and 1 is b. Negative numbers are before a; >1 is after b.
 * @see {@link https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line#Line_defined_by_two_points}
 */
function percentToTarget(c, a, b) {
  // Scalar projection of the vector start --> c onto the vector a|b, normalized.
  using v = b.subtract(a);
  using w = c.subtract(a);
  return v.dot(w) / v.magnitudeSquared();
}


// Create SDF object for each placeable
/*
tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];


startToken = canvas.tokens.placeables.find(t => t.name === "Randal")
endToken = canvas.tokens.placeables.find(t => t.name === "Riswynn")

start = GridCoordinates3d.fromTokenCenter(startToken)
end = GridCoordinates3d.fromTokenCenter(endToken)

start.elevation = 20
end.elevation = 20


rayOrigin = start;
rayDirection = end.subtract(start).normalize()

// Lookup table linking SDF objects to their sdf3d function.
sceneSDFMap = new Map();
sceneSDFs.forEach(placeableSDF => sceneSDFMap.set(placeableSDF, placeableSDF.sdf3d()));

obstacleSDFs = new Set();
surfaceSDFs = new Set();

// Queue SDFs by known bounds so they can be dropped.
maxT = Point3d.distanceBetween(start, end);
sdfBoundsQueue = new PriorityQueue("low");
sceneSDFs.forEach(placeableSDF => {
  const ts = placeableSDF.aabb3d.rayIntersectionsT(rayOrigin, rayDirection);
  const t = Math.minMax(...ts); // If ts === [], will return {min: Infinity, max: -Infinity}.
  if ( t.min > maxT ) return;
  sdfBoundsQueue.enqueue(placeableSDF, t.max);
  obstacleSDFs.add(placeableSDF)
});

// Debug: check the t intersections
Draw.clearDrawings();
Draw.star(start)
Draw.segment({ a: start, b: end });
sdfBoundsQueue.data.forEach(node => Draw.point(rayOrigin.add(rayDirection.multiplyScalar(node.priority))));



// Temp values used below.
rayDirection3d = end.subtract(start).normalize()
up = Point3d.tmp.set(0, 0, 1);
down = Point3d.tmp.set(0, 0, -1);
gradient = up.clone();
currDirection = down.clone();
currPosition = start.clone();
currT = 0;
tmp = Point3d.tmp;
tmp2 = Point3d.tmp;
p = Point3d.tmp;

// Used in the movement algorithm.


// Define a floor
floorSDFObj = new SceneFloorSDF(canvas.scene);
obstacleSDFs.add(floorSDFObj);
sceneSDFMap.set(floorSDFObj, floorSDFObj.sdf3d());

// Helper functions
onSurface = d => d.almostEqual(0, 1e-02);
sdfObstacles = p => SDF.union(...[...obstacleSDFs].map(sdfObj => sdfObj.sdf3d()(p)))
sdfSurfaces = p => SDF.union(...[...surfaceSDFs].map(sdfObj => sdfObj.sdf3d()(p)))

tokenProneHeight = (startToken.topZ - startToken.bottomZ)* CONFIG.GeometryLib.CONFIG.proneMultiplier;
SURFACE_SPACER = 2.3
*/


/* How to deal with cliff and obstacle transitions.

At cliff:
- surfaceCliff (1.3 pixels inside) measures inside to approximately the •
- move along gradient 1 pixel
- get new gradient
- move back along new gradient towards obstacle surface.
------• ~>
       \
        \

- if new surface gradient points down or vertically to the side, free fall instead.
------•~v
     /
    /


- At obstacle:
- Test 1.3 pixels above the surface.
- move along gradient 1 pixel
- get new gradient
- move back along new gradient towards obstacle surface.

       |<
       |<
-------•
      ^
Same for ramps:
         /
       >/
-------•
       ^
- move along gradient 1 pixel
- get new gradient
- move back along new gradient towards obstacle surface.

- if new surface gradient points down, ignore.
     \
      \
-------•


*/

const SURFACE_SPACER = 1.3

function updatePercentFinished(currPosition, start, end, sdfBoundsQueue, obstacleSDFs, maxT, currSurface) {

  // Are we done?
  const currT = percentToTarget(currPosition, start, end);

  // Drop SDFs behind the current position.
  while ( sdfBoundsQueue.length ) {
    if ( sdfBoundsQueue.currentPriority < (currT * maxT) ) {
      const sdfObj = sdfBoundsQueue.dequeue();
      obstacleSDFs.delete(sdfObj);
      if ( currSurface.sdfObj === sdfObj ) currSurface.sdfObj = undefined;
    } else break;
  }

  return currT;
}

function steepestSurface(p, sdfObjs) {
  using grad = Point3d.tmp;
  const gradient = Point3d.tmp;
  const iter = sdfObjs.values();
  let steepest = iter.next().value;
  SDF.calculateGradient(steepest.sdf3d(), p, 1e-03, gradient);

  // Compare every other surface in turn, looking for the steepest from the point.
  for ( const sdfObj of iter ) {
    SDF.calculateGradient(sdfObj.sdf3d(), p, 1e-03, grad);
    if ( grad.z.almostEqual(0) || grad.z > gradient.z && !(gradient.x < 0 && gradient.z < 0) ) {
      gradient.copyFrom(grad);
      steepest = sdfObj;
    }
  }
  return !(gradient.x < 0 && gradient.z < 0) ? { sdfObj: steepest, gradient } : null;
}


function nearestSurfaceObstacle(sdfObj, gradient, startPoint, currDirection) {
  using pAdj = startPoint.clone();
  pAdj.add(gradient, pAdj);

  // Will take a lot of steps because we are likely close to a surface edge.
  const length = sdfObj.aabb3d.length;
  const maxSteps = length.x + length.y + length.z;
  return SDF.raymarch(pAdj, currDirection, sdfObj.sdf3d(), { maxSteps }) || Number.POSITIVE_INFINITY;
}


function nearestSurfaceCliff(sdfObj, gradient, startPoint, currDirection) {
  using pAdj = startPoint.clone();
  pAdj.subtract(gradient, pAdj);
  pAdj.add(currDirection, pAdj); // Move forward a bit to avoid hitting the starting edge (e.g. cube sitting on floor).

  // Will take a lot of steps because we are likely close to a surface edge.
  const length = sdfObj.aabb3d.length;
  const maxSteps = length.x + length.y + length.z;
  return (SDF.raymarchInterior(pAdj, currDirection, sdfObj.sdf3d(), { maxSteps }) || Number.POSITIVE_INFINITY) + 1; // Add 1 b/c we moved forward.

}


function nearestObstacles(currPosition, currDirection, obstacleSDFs, surfaceGradient) {
  if ( !obstacleSDFs.size ) return { t: Number.POSITIVE_INFINITY, hits: new Set() };
  using pAdj = currPosition.clone();
  if ( surfaceGradient ) pAdj.add(surfaceGradient.multiplyScalar(SURFACE_SPACER, tmp), pAdj);

  const objs = [...obstacleSDFs];
  const res = SDF.nearestObstacles(currPosition, currDirection, objs.map(obj => obj.sdf3d()));
  res.hits = new Set(res.hits.map(i => objs[i]));
  return res;
}

function updateSurfaceGradient(currSurface, currPosition, currDirection, rayDirection, calculateGradient = true) {
  if ( calculateGradient ) {
    currSurface.previousGradient.copyFrom(currSurface.gradient);
    SDF.calculateGradient(currSurface.sdfObj.sdf3d(), currPosition, 1e-03, currSurface.gradient);
  }
  SDF.projectDirectionOntoSlope(rayDirection, currSurface.gradient, currDirection);
  if ( currSurface.gradient.x < 0 && currDirection.z < 0 ) currDirection.multiplyScalar(-1, currDirection);
  if ( currDirection.magnitudeSquared().almostEqual(0) ) {
    using up = Point3d.tmp.set(0, 0, 1)
    currDirection.copyFrom(up);
  }
  currSurface.obstacleT = nearestSurfaceObstacle(currSurface.sdfObj, currSurface.gradient, currSurface.startPoint, currDirection);
  currSurface.cliffT = nearestSurfaceCliff(currSurface.sdfObj, currSurface.gradient, currSurface.startPoint, currDirection);
}

function selectSurface(potentialSurfaces, currSurface, currPosition, currDirection, rayDirection) {
  // Select the steepest surface at that point.
  const steepest = steepestSurface(currPosition, potentialSurfaces) || currSurface;
  currSurface.sdfObj = steepest.sdfObj;
  currSurface.previousGradient.copyFrom(currSurface.gradient);
  currSurface.gradient.copyFrom(steepest.gradient);
  currSurface.startPoint.copyFrom(currPosition);

  updateSurfaceGradient(currSurface, currPosition, currDirection, rayDirection, false);
}



function traceSDFPath(start, end, sceneSDFs) {
  if ( !sceneSDFs ) {
    const tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
    const regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
    const sceneSDFs = [...tileSDFs, ...regionSDFs];
  }

  const rayOrigin = start;
  const rayDirection = end.subtract(start).normalize()

  const obstacleSDFs = new Set();
  const maxT = Point3d.distanceBetween(start, end);
  const sdfBoundsQueue = new PriorityQueue("low");
  sceneSDFs.forEach(placeableSDF => {
    const ts = placeableSDF.aabb3d.rayIntersectionsT(rayOrigin, rayDirection);
    const t = Math.minMax(...ts); // If ts === [], will return {min: Infinity, max: -Infinity}.
    if ( t.min > maxT ) return;
    sdfBoundsQueue.enqueue(placeableSDF, t.max);
    obstacleSDFs.add(placeableSDF)
  });

  const floorSDFObj = new SceneFloorSDF(canvas.scene);
  obstacleSDFs.add(floorSDFObj);
  const onSurface = d => d.almostEqual(0, 1e-02);
  const currSurface = {
    sdfObj: undefined,
    obstacleT: Number.POSITIVE_INFINITY,
    cliffT: Number.POSITIVE_INFINITY,
    gradient: Point3d.tmp,
    previousGradient: Point3d.tmp,
    startPoint: Point3d.tmp,
  };
  using currPosition = start.clone()
  using currDirection = rayDirection.clone()
  using up = Point3d.tmp.set(0, 0, 1)
  using down = Point3d.tmp.set(0, 0, -1)
  using testPoint = Point3d.tmp;
  using tmp = Point3d.tmp;

  let currT = 0;
  const checkpoints = [];
  let iter = 0;
  const maxIter = 10000;
  freefallLoop: while ( currT < 1 && iter++ < maxIter ) {
    checkpoints.push(currPosition.clone());

    // If not on surface, fall down.
    if ( !currSurface.sdfObj ) {
      currDirection.copyFrom(down);
      const obstacleCheck = nearestObstacles(currPosition, currDirection, obstacleSDFs)
      currPosition.add(currDirection.multiplyScalar(obstacleCheck.t, tmp), currPosition); // Move to obstacle
      selectSurface(obstacleCheck.hits, currSurface, currPosition, currDirection, rayDirection);
      obstacleSDFs.delete(currSurface.sdfObj);
    }


    surfaceLoop: while ( currSurface.sdfObj && currT < 1 && iter++ < maxIter ) {
      checkpoints.push(currPosition.clone());

      // Check for obstacles.
      const obstacleCheck = nearestObstacles(currPosition, currDirection, obstacleSDFs);

      // Add other surface obstacles.
      if ( currSurface.obstacleT.almostEqual(obstacleCheck.t) ) obstacleCheck.hits.push(currSurface.sdfObj);
      else if ( currSurface.obstacleT < obstacleCheck.t ) {
        obstacleCheck.hits.clear();
        obstacleCheck.hits.add(currSurface.sdfObj);
        obstacleCheck.t = currSurface.obstacleT;
      }

      if ( (currSurface.cliffT + 1) < obstacleCheck.t ) { // Found cliff.
        // Move to the cliff
        currPosition.add(currDirection.multiplyScalar(currSurface.cliffT, tmp), currPosition);
        checkpoints.push(currPosition.clone());

        // Move one step to fall off cliff.
        currPosition.add(currDirection, currPosition);

        // If the move up is vertical, move one step over so we are over the new surface.
        if ( (currDirection.x === 0 && currDirection.y === 0) ) currPosition.subtract(currSurface.gradient, currPosition);

        // Remove the surface; free-fall to nearest surface.
        obstacleSDFs.add(currSurface.sdfObj);
        currSurface.sdfObj = undefined;
        break surfaceLoop;

      } else if ( obstacleCheck.hits.size ) { // Hit obstacle.
        // Move to the obstacle
        currPosition.add(currDirection.multiplyScalar(obstacleCheck.t, tmp), currPosition);
        checkpoints.push(currPosition.clone());

        // Move up away from surface before selecting the surface.
        // Avoids failure to find gradient of the obstacle.
        obstacleSDFs.add(currSurface.sdfObj);
        currPosition.add(currSurface.gradient, currPosition);
        selectSurface(obstacleCheck.hits, currSurface, currPosition, currDirection, rayDirection);
        obstacleSDFs.delete(currSurface.sdfObj);

        // Move back toward the obstacle.
        const d = SDF.fromSquaredDistance(currSurface.sdfObj.sdf3d()(currPosition));
        currPosition.add(currSurface.gradient.multiplyScalar(d, tmp), currPosition);

      } else break freefallLoop; // Move to end.

      // Are we done?
      currT = updatePercentFinished(currPosition, start, end, sdfBoundsQueue, obstacleSDFs, maxT, currSurface);
    }

    // Are we done?
    currT = updatePercentFinished(currPosition, start, end, sdfBoundsQueue, obstacleSDFs, maxT, currSurface);
  }

  if ( !currT.almostEqual(1) ) {
    // Move along current surface to end.
    // Or back up along the last surface.
    const plane = new Plane(end, currDirection);
    const t = plane.rayIntersection(currPosition, currDirection);
    if ( t <= 0 ) checkpoints.pop();
    checkpoints.push(currPosition.add(currDirection.multiplyScalar(t, tmp)))
  }

 return checkpoints;
}
