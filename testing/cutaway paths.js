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
bench = CONFIG.GeometryLib.lib.bench
CutawayPolygon = CONFIG.GeometryLib.lib.CutawayPolygon
HillDrawingManager = game.modules.get('terrainmapper').api.HillDrawingManager

// For an array of polygons (cutaways), find the first one that a ray hits.
// If the ray hits multiple polygons at the same point, find the one with the steepest edge.
// By steepest, we mean moving from right --> left (clockwise for cutaways), which one has the smallest y delta.
function findSurface(rayOrigin, rayDirection, cutaways, skipZero = false) {
  let minT = Number.POSITIVE_INFINITY;
  const out = {
    cutaway: undefined,
    edge: undefined,
    ix: { t0: minT },
  };
  using tmp = PIXI.Point.tmp;
  const a = rayOrigin;
  using b = rayOrigin.add(rayDirection);
  using c = rayOrigin.add(rayDirection.multiplyScalar(1e06, tmp));

  for ( const cutaway of cutaways ) {
    for ( const edge of cutaway.iterateEdges() ) {
      if ( cutaway.isHole && edge.a.x.almostEqual(edge.b.x) ) continue; // Holes don't have tops/bottoms.
      if ( !foundry.utils.lineSegmentIntersects(a, c, edge.a, edge.b) ) continue;
      const ix = foundry.utils.lineLineIntersection(a, b, edge.a, edge.b);
      if ( !ix ) continue; // Should not happen.
      if ( ix.t0 < 0 || ix.t0 > minT ) continue;
      if ( skipZero && ix.t0.almostEqual(0) ) continue;

      // Test whether this is the steepest surface.
      if ( out.edge && ix.t0.almostEqual(minT)
        && (edge.b.y - edge.a.y) > (out.edge.b.y - out.edge.a.y) ) continue;

      minT = ix.t0;
      out.ix = ix;
      out.edge = edge;
      out.cutaway = cutaway;
    }
  }
  return out;
}

// Iterate starting from the current edge. Do one full loop.
function *iterateFromEdge(cutaway, targetEdge) {
  // Note that Javascript breaks the iterator when breaking a for/of loop.
  const iter = cutaway.iterateEdges();
  let edge;
  while ( (edge = iter.next().value) ) {
    if ( edge.a.equals(targetEdge.a) ) {
      yield edge;
      break;
    }
  }

  // Cycle through the remaining edges.
  for ( edge of iter ) yield edge;

  for ( edge of cutaway.iterateEdges() ) {
    // Yield until we get back to the target edge.
    if ( edge.a.equals(targetEdge.a) ) break;
    yield edge;
  }
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

function traceCutoutPath(start, end, startToken) {

  // Versus using polygon shapes with proper intersections
  const cutaways = [canvas.scene, ...canvas.regions.placeables, ...canvas.tiles.placeables].flatMap(obj => obj.terrainmapper._cutaway(start, end, startToken));
  // cutaways.forEach(cutaway => cutaway.reverseOrientation())
  const floor = cutaways[0];
  const cutawaysSet = new Set(cutaways);

  // Temporary points.
  using down = PIXI.Point.tmp.set(0, -1);
  using start2d = floor._to2d(start);
  using end2d = floor._to2d(end);
  using currPosition = start2d.clone();
  using currDirection = down.clone();

  const checkpoints = [];
  let currSurface = undefined

  // Get bounds of each cutaway so they can be trimmed as we go.
  const cutawayBoundsQueue = new PriorityQueue("low");
  cutawaysSet.forEach(cutaway => {
    const bounds = cutaway.getBounds();
    cutawayBoundsQueue.enqueue(cutaway, bounds.right);
  });

  // Helper to run at each step to trim obstacles that are behind us.
  let currT = 0;
  const maxT = Point3d.distanceBetween(start2d, end2d);
  const cleanupObstacles = () => {
    while ( cutawaysSet.size ) {
      if ( cutawayBoundsQueue.currentPriority < (currT * maxT) ) {
        const cutaway = cutawayBoundsQueue.dequeue();
        cutawaysSet.delete(cutaway);
      } else break;
    }
  };

  let iter = 0;
  const maxIter = 1000;
  whileLoop: while ( currT < 1 && iter++ < maxIter ) {
    checkpoints.push(currPosition.clone())

    // Locate a surface.
    if ( !currSurface ) {
      currDirection.copyFrom(down);
      currSurface = findSurface(currPosition, currDirection, cutawaysSet, false);
      if ( !currSurface.edge ) {
        console.error(`traceCutoutPath|Surface not found at ${currPosition} with direction ${currDirection}`);
        break whileLoop; // Should not happen b/c we should always hit the floor.
      }

      // Move down to the surface.
      cutawaysSet.delete(currSurface.cutaway);
      currPosition.copyFrom(currSurface.ix);
      checkpoints.push(currPosition.clone())
      currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
      // currDirection.normalize(); // Can skip normalization here.
    }

    // Move along the surface until:
    // 1. We hit something.
    // 2. We are moving straight down
    // 3. We are moving to the left (back toward start.)
    // 4. We pass the currT.

    const surfaceIter = iterateFromEdge(currSurface.cutaway, currSurface.edge);
    forLoop: for ( const edge of surfaceIter ) {
      // currT = percentToTarget(currPosition, start2d, end2d);
      // if ( currT > 1 ) break whileLoop;
      edge.b.subtract(edge.a, currDirection);


      // If x is 0, we are moving straight up or straight down.
      const movingDown = currDirection.y < 0;
      const isLeft = currDirection.x < 0;
      const isCliff = currDirection.x.almostEqual(0) && currDirection.y < 0
        || (isLeft && movingDown); // "Underhang"

      if ( isCliff ) {
        // Check if moving again will hit something.
        const newSurface = findSurface(currPosition, currDirection, cutawaysSet, true);

        // Move 1 pixel across unless we are going to hit something.
        if ( newSurface.ix.t0 > 1 ) {
          cutawaysSet.add(currSurface.cutaway)
          currSurface = undefined;
          currPosition.add(currDirection, currPosition);
          break; // Go back to beginning to free fall until we find a surface.

        } else {
          // An obstacle immediately to the right becomes our new surface.
          cutawaysSet.add(currSurface.cutaway)
          cutawaysSet.delete(newSurface.cutaway);
          currSurface = newSurface;
          currPosition.copyFrom(currSurface.ix);
          currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
          break;

        }
      } else if ( isLeft && !movingDown ) {
         // Overhang. Keep moving up through the surface. Find the next surface edge in this direction.
         currPosition.add(currDirection.normalize(), currPosition);
         currSurface = findSurface(currPosition, currDirection, [currSurface.cutaway], true);
         currPosition.copyFrom(currSurface.ix);
         currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
         break;

      } else {
        // Look for an obstacle.
        const nextObstacle = findSurface(currPosition, currDirection, cutawaysSet, true);
        if ( nextObstacle.ix.t0 < 1 ) {
          // We hit an obstacle before the end of this edge.
          cutawaysSet.add(currSurface.cutaway)
          cutawaysSet.delete(nextObstacle.cutaway);
          currSurface = nextObstacle;
          currPosition.copyFrom(currSurface.ix);
          currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
          break;

        } else currPosition.copyFrom(edge.b); // Move through the edge.
      }

      checkpoints.push(currPosition.clone())

      // Are we done?
      currT = percentToTarget(currPosition, start2d, end2d);
      cleanupObstacles();
    }

    // Are we done?
    currT = percentToTarget(currPosition, start2d, end2d);
    cleanupObstacles();
  }

  return checkpoints.map(checkpoint => cutawayUtil.from2d(checkpoint, start, end));
}

/*



startToken = canvas.tokens.placeables.find(t => t.name === "Randal")
endToken = canvas.tokens.placeables.find(t => t.name === "Riswynn")

start = GridCoordinates3d.fromTokenCenter(startToken)
end = GridCoordinates3d.fromTokenCenter(endToken)

start.elevation = 0
end.elevation = 0

// Filter to include only those SDFs that could be encountered on the path.
start2d = start.to2d();
end2d = end.to2d();
sceneSDFs = sceneSDFs.filter(sceneSDF => sceneSDF.aabb2d.overlapsSegment(start2d, end2d));


tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];

floorSDF = new SceneFloorSDF(canvas.scene);
sceneSDFs.push(floorSDF);
sceneSDFObj = new SDFCombined(sceneSDFs)

function _centerWaypoint(waypoint, token) {
  const ctr = token.getCenterPoint(waypoint);
  return GridCoordinates3d.fromLocationWithElevation(ctr, waypoint.elevation);
}

*/

/*
duplicateCurve = curve => {
  return {
    start: curve.start.clone(),
    end: curve.end.clone(),
    cp1: curve.cp1.clone(),
    cp2: curve.cp2.clone()
  }
}


region = canvas.regions.controlled[0]
regionTM = region.terrainmapper
regionPoly = region.document.polygons[0]
opts = regionTM.#cutawayOptionFunctions()
cutawayPoly = regionPoly.cutaway(start, end, opts)[0]
cutaway = regionTM._cutaway(start, end)[0]


curveUnadj = HillDrawingManager._unadjustedHillDataForRegion(region)
HillDrawingManager.curveHeight(curveUnadj)
curve = HillDrawingManager.scaleCurve(duplicateCurve(curveUnadj), 400)
curveOrigin = HillDrawingManager.translateCurveToOrigin(duplicateCurve(curve))
Draw.shape(HillDrawingManager.generateHillPolygon(curve))
Draw.shape(HillDrawingManager.generateHillPolygon(curveOrigin))

Draw.shape(HillDrawingManager.generateHillPolygonAdaptive(curve, 0.5), { color: Draw.COLORS.yellow })
Draw.shape(HillDrawingManager.generateHillPolygonAdaptive(curve, 1), { color: Draw.COLORS.orange })
Draw.shape(HillDrawingManager.generateHillPolygonAdaptive(curve, 2), { color: Draw.COLORS.red })

Draw.shape(HillDrawingManager.generateHillPolygonAdaptive(curveOrigin))

*/


traceCutoutPath(start, end, startToken)

tm = startToken.terrainmapper;



walkingPath = tm.constructWalkingPath(start, end)
flyingPath = tm.constructFlyingPath(start, end)
burrowingPath = tm.constructBurrowingPath(start, end)


N = 1000
tmp = await bench.QBenchmarkLoop(N, startToken.terrainmapper, "constructWalkingPath", start, end)
tmp = await bench.QBenchmarkLoopFn(N, traceCutoutPath, "traceCutoutPath", start, end, startToken)
// tmp = await bench.QBenchmarkLoopFn(N, traceSurfacePath, "traceSurfacePath", start, end, sceneSDFObj.sdf3d())
// tmp = await bench.QBenchmarkLoopFn(N, traceSDFPath, "traceSDFPath", start, end, sceneSDFs)
