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

function traceCutoutPath(start, end) {

  // Versus using polygon shapes with proper intersections
  cutaways = [canvas.scene, ...canvas.regions.placeables, ...canvas.tiles.placeables].flatMap(obj => obj.terrainmapper._cutaway(start, end, startToken));
  // cutaways.forEach(cutaway => cutaway.reverseOrientation())
  floor = cutaways[0];
  cutaways = new Set(cutaways);

  right = PIXI.Point.tmp.set(1, 0);
  down = PIXI.Point.tmp.set(0, -1);
  start2d = floor._to2d(start);
  end2d = floor._to2d(end)
  currPosition = start2d.clone();
  currDirection = down.clone()
  currT = 0;
  iter = 0;
  checkpoints = [];
  surfaces = new Set();
  currSurface = undefined
  tmp = PIXI.Point.tmp;
  maxIter = 1000;
  maxT = Point3d.distanceBetween(start2d, end2d);

  cutawayBoundsQueue = new PriorityQueue("low");
  cutaways.forEach(cutaway => {
    const bounds = cutaway.getBounds();
    cutawayBoundsQueue.enqueue(cutaway, bounds.right);
  });

  whileLoop: while ( currT < 1 && iter++ < maxIter ) {
    checkpoints.push(currPosition.clone())

    // Locate a surface.
    if ( !currSurface ) {
      currDirection.copyFrom(down);
      currSurface = findSurface(currPosition, currDirection, cutaways, false);
      // if ( !currSurface.edge ) break whileLoop; // Should not happen.

      // Move down to the surface.
      cutaways.delete(currSurface.cutaway);
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
        const newSurface = findSurface(currPosition, currDirection, cutaways, true);

        // Move 1 pixel across unless we are going to hit something.
        if ( newSurface.ix.t0 > 1 ) {
          cutaways.add(currSurface.cutaway)
          currSurface = undefined;
          currPosition.add(currDirection, currPosition);
          break; // Go back to beginning to free fall until we find a surface.

        } else {
          // An obstacle immediately to the right becomes our new surface.
          cutaways.add(currSurface.cutaway)
          cutaways.delete(newSurface.cutaway);
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
        const nextObstacle = findSurface(currPosition, currDirection, cutaways, true);
        if ( nextObstacle.ix.t0 < 1 ) {
          // We hit an obstacle before the end of this edge.
          cutaways.add(currSurface.cutaway)
          cutaways.delete(nextObstacle.cutaway);
          currSurface = nextObstacle;
          currPosition.copyFrom(currSurface.ix);
          currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
          break;

        } else currPosition.copyFrom(edge.b); // Move through the edge.
      }

      checkpoints.push(currPosition.clone())

      // Are we done?
      currT = percentToTarget(currPosition, start2d, end2d);

      // Drop obstacles behind the current position.
      while ( cutaways.size ) {
        if ( cutawayBoundsQueue.currentPriority < (currT * maxT) ) {
          const cutaway = cutawayBoundsQueue.dequeue();
          cutaways.delete(cutaway);
        } else break;
      }
    }

    // Are we done?
    currT = percentToTarget(currPosition, start2d, end2d);

    // Drop obstacles behind the current position.
    while ( cutaways.size ) {
      if ( cutawayBoundsQueue.currentPriority < (currT * maxT) ) {
        const cutaway = cutawayBoundsQueue.dequeue();
        cutaways.delete(cutaway);
      } else break;
    }
  }

  return checkpoints.map(checkpoint => cutawayUtil.from2d(checkpoint, start, end));
}

/*
bench = CONFIG.GeometryLib.lib.bench

tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];



startToken = canvas.tokens.placeables.find(t => t.name === "Randal")
endToken = canvas.tokens.placeables.find(t => t.name === "Riswynn")

start = GridCoordinates3d.fromTokenCenter(startToken)
end = GridCoordinates3d.fromTokenCenter(endToken)

start.elevation = 20
end.elevation = 20

// Filter to include only those SDFs that could be encountered on the path.
start2d = start.to2d();
end2d = end.to2d();
sceneSDFs = sceneSDFs.filter(sceneSDF => sceneSDF.aabb2d.overlapsSegment(start2d, end2d));

floorSDF = new SceneFloorSDF(canvas.scene);
sceneSDFs.push(floorSDF);
sceneSDFObj = new SDFCombined(sceneSDFs)
*/

N = 1000
tmp = await bench.QBenchmarkLoopFn(N, traceCutoutPath, "traceCutoutPath", start, end)
tmp = await bench.QBenchmarkLoopFn(N, traceSurfacePath, "traceSurfacePath", start, end, sceneSDFObj.sdf3d())
tmp = await bench.QBenchmarkLoopFn(N, traceSDFPath, "traceSDFPath", start, end, sceneSDFs)
