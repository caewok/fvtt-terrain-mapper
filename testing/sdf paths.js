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
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
Plane = CONFIG.GeometryLib.lib.threeD.Plane
PriorityQueue = CONFIG.GeometryLib.lib.PriorityQueue;
almostLessThan = CONFIG.GeometryLib.lib.utils.almostLessThan


// Create SDF object for each placeable
tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];

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

startToken = canvas.tokens.placeables.find(t => t.name === "Randal")
endToken = canvas.tokens.placeables.find(t => t.name === "Riswynn")

start = GridCoordinates3d.fromTokenCenter(startToken)
end = GridCoordinates3d.fromTokenCenter(endToken)

start.elevation = 20
end.elevation = 20




// Lookup table linking SDF objects to their sdf3d function.
sceneSDFMap = new Map();
sceneSDFs.forEach(placeableSDF => sceneSDFMap.set(placeableSDF, placeableSDF.sdf3d()));

// Lookup table linking SDF objects to their associated t boundary values
rayOrigin = start;
rayDirection = end.subtract(start).normalize()
sceneSDFTMap = new Map();
sceneSDFs.forEach(placeableSDF => {
  const ts = placeableSDF.cutawayTsForRay(rayOrigin, rayDirection);
  ts.sort((a, b) => b - a); // Reverse sort.
  sceneSDFTMap.set(placeableSDF, ts.map(t => t ** 2));
});

// Debug: check the t intersections
Draw.clearDrawings();
Draw.segment({ a: start, b: end });
sceneSDFTMap.forEach(ts =>
  ts.forEach(t => Draw.point(rayOrigin.add(rayDirection.multiplyScalar(Math.sqrt(t))))));



// Temp values used below.
rayDirection3d = end.subtract(start).normalize()
gradient = Point3d.tmp;
up = Point3d.tmp.set(0, 0, 1);
down = Point3d.tmp.set(0, 0, -1);
currDirection = down.clone();
currPosition = start.clone();
currT = 0;
tmp = Point3d.tmp;
tmp2 = Point3d.tmp;
p = Point3d.tmp;

// Used in the movement algorithm.
obstacleSDFs = new Set(sceneSDFs);
surfaceSDFs = new Set();

// Define a floor
floorPlane = new Plane()	; // Defaults to scene 0. Set the point if the floor is above 0. (E.g., levels)
floorSDF = p => SDF.sdPlane(p, floorPlane);
obstacleSDFs.add("floor");
sceneSDFMap.set("floor", floorSDF);
sceneSDFTMap.set("floor", [Number.POSITIVE_INFINITY])

// Helper functions
onSurface = d => d.almostEqual(0, 1e-02);
fullSceneSDF = p => SDF.union(
  ...obstacleSDFs.values().map(sdf => sceneSDFMap.get(sdf)(p)),
  ...surfaceSDFs.values().map(sdf => sceneSDFMap.get(sdf)(p))
);
obstacleSDF = p => SDF.union(...obstacleSDFs.values().map(sdf => sceneSDFMap.get(sdf)(p)))
surfaceSDF = p =>  SDF.union(...surfaceSDFs.values().map(sdf => sceneSDFMap.get(sdf)(p)))
nextSurfaceT = () => {
  let minT = Number.POSITIVE_INFINITY;
  for ( const sdfObj of surfaceSDFs ) {
    const ts = sceneSDFTMap.get(sdfObj);
    minT = ts.find(t => t < minT && t > currT) || minT;
  }
  return minT;
}

nextSurfaceElevT = () => {
  let minT = Number.POSITIVE_INFINITY;
  for ( const sdfObj of surfaceSDFs ) {
    const elevs = sdfObj.cutawayElevations(currPosition);
    minT = Math.min(minT, ...elevs.map(elev => (elev - currPosition.z) ** 2))
  }
  return minT;
}

/*
Track surface movement by testing point below and point above.
So if at elevation 0, use a point at 2.3 and point at -2.3.
(Chosen to be larger than epsilon and prime. Needs to be smaller than the width/depth/height of the object.)

Determine obstacles by testing a top and bottom ray origin.
Bottom is at the token base.
Top is at the token height when prone (crawling).

Move bottom up from token base (0) to hurdle.
Move bottom up slightly from token base to better identify slopes
*/

tokenProneHeight = (startToken.topZ - startToken.bottomZ)* CONFIG.GeometryLib.CONFIG.proneMultiplier;
SURFACE_SPACER = 2.3

// Walk 3d path.
surfaceQueue = new PriorityQueue("low");
surfaceRayOrigin = Point3d.tmp;

checkpoints = [start.clone()]
let iter = 0;
maxIter = 10000;
while ( currT < 1 && iter < maxIter ) {
  iter += 1;

  /* Position options:
  1. Floating. surfaceSDF > 0, obstaclesSDF > 0
    --> Need to locate the nearest surface and fall toward it.
  2. On surface. surfaceSDF ~ 0, obstaclesSDF > 0
    --> Move along surface until next obstacle
  3. Floating. On obstacle wall or ramp but not on surface: surfaceSDF > 0, obstaclesSDF ~ 0
    --> Obstacle should become surface. Move on that new surface.
  4. On surface, which may be floor or obstacle, but also at a separate obstacle: surfaceSDF ~ 0, obstaclesSDF ~ 0
    --> Move all obstacles to surface. Move on that new surface.

  Otherwise, could be burrowing...
  TODO: Handle burrowing. Ignore any SDF that is within/burrowing?

  Start:
  1. Floating. If not floating, go to 2.
    --> Distance to obstacles from bottom point.
    --> Fall to floor. Direction {0, 0, -1}
    --> Move floor obstacle(s) to surface(s).

  2. At surface.
    --> Determine next surface point by testing above/below surface. Save.
    --> Direction based on surface gradient.

  3. Move to next obstacle, surface "bump" or surface "pit"
    --> Obstacle test using top/bottom token.

  3a. If obstacle found:
    --> Currently only climbing obstacles.
    --> Determine slope and direction using the above surface point.

  3b. If surface checkpoint reached.
    --> Move 1 pixel.
    --> Test for surfaces.
    --> If none, back to 1.
    --> If surface, back to 2.
  */

  // 1. Floating.
  if ( !surfaceSDFs.size ) {
    currDirection.copyFrom(down);

    // Locate the surface(s). Separate rest of scene from the surfaces.
    obstacleSDFs.clear();
    surfaceSDFs.clear();
    for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
      const dObstacle = sceneSDFMap.get(sdf)(currPosition);
      if ( onSurface(dObstacle) ) surfaceSDFs.add(sdf);
      else obstacleSDFs.add(sdf);
    }

    if ( !surfaceSDFs.size ) {
      // Fall some more.
      currPosition.add(currDirection.multiplyScalar(SDF.fromSquaredDistance(minObstacleD), tmp), currPosition);
      continue;
    }

    surfaceRayOrigin.set(currPosition);

    // Choose surface gradient with the steepest incline.
    using grad = Point3d.tmp;
    const iter = surfaceQueue.data[Symbol.iterator]();
    steepestSurface = iter.next().value.value;
    SDF.calculateGradient(steepestSurface, currPosition, 1e-03, gradient);
    for ( const node of iter ) {
      SDF.calculateGradient(node.value, currPosition, 1e-03, grad);
      if ( grad.z > gradient.z ) {
        gradient.copyFrom(grad);
        steepestSurface = node.value;
      }
    }

    // Modify the current movement direction.
    SDF.projectDirectionOntoSlope(rayDirection3d, gradient, currDirection);

    // Determine next surface checkpoints.
    for ( const sdfObj of surfaceSDFs ) {
      p.copyFrom(currPosition);
      p.z += SURFACE_SPACER;
      const tTop = sdfObj.ray3dIntersectionT(p, currDirection);
      if ( tTop ) surfaceQueue.enqueue(sdfObj, tTop);

      p.z -= (SURFACE_SPACER * 2)
      const tBottom = sdfObj.ray3dIntersectionT(p, currDirection);
      if ( tBottom ) surfaceQueue.enqueue(sdfObj, tBottom);
    }
  }


  // 2. On a surface.
  // Can avoid confirming surface until we reach a surface checkpoint.

  // Find the next obstacle along the current path.
  // Test top and bottom of the token.
  const surfaceObstacles = [];
  const surfaceObstacleSpacers = [];

  let minObstacleD = Number.POSITIVE_INFINITY;
  for ( const sdfObj of obstacleSDFs ) {
    p.copyFrom(currPosition);
    p.z += tokenProneHeight;
    const tBottom = sdfObj.ray3dIntersectionT(currPosition, currDirection);
    const tTop = sdfObj.ray3dIntersectionT(p, currDirection);
    minObstacleD = Math.min(minObstacleD, tBottom, tTop);
    if ( onSurface(tBottom) ) {
      surfaceObstacles.push(sdfObj);
      surfaceObstacleSpacers.push(0);
    } else if ( onSurface(tTop) ) {
      surfaceObstacles.push(sdfObj);
      surfaceObstacleSpacers.push(tokenProneHeight);
    }
  }


  // Process obstacle surfaces.
  if ( surfaceObstacles.length ) {


    // Choose surface gradient with the steepest incline.
    p.copyFrom(currPosition);
    p.z += surfaceObstacleSpacers[0];
    using grad = Point3d.tmp;
    steepestSurface = surfaceObstacles[0];




    const iter = surfaceQueue.data[Symbol.iterator]();
    steepestSurface = iter.next().value.value;
    SDF.calculateGradient(steepestSurface, currPosition, 1e-03, gradient);
    for ( const node of iter ) {
      SDF.calculateGradient(node.value, currPosition, 1e-03, grad);
      if ( grad.z > gradient.z ) {
        gradient.copyFrom(grad);
        steepestSurface = node.value;
      }
    }


  } else {
    // Determine if we are at a surface checkpoint.
    const currSurfaceT = Point3d.distanceBetween(surfaceRayOrigin, currPosition);
    while ( surfaceQueue.length ) {
      const priority = surfaceQueue.peekPriority;
      if ( almostLessThan(currSurfaceT, priority) ) {
        const sdfObj = surfaceQueue.dequeue();

        // Get the next checkpoint for this surface.
        p.copyFrom(currPosition);
        p.z += SURFACE_SPACER;
        const tTop = sdfObj.ray3dIntersectionT(p, currDirection);

        p.z -= (SURFACE_SPACER * 2)
        const tBottom = sdfObj.ray3dIntersectionT(p, currDirection);

        if ( onSurface(tBottom) ) {
          // Surface is an obstacle

        } else if ( onSurface(tTop) ) {
          // Surface is an obstacle

        } else if ( tBottom === null && tTop === null ) {
          surfaceSDFs.delete(sdfObj);
          obstacleSDFs.add(sdfObj);
        } else {
          surfaceQueue.queue(sdfObj, Math.min(tBottom, tTop));
        }


      }


    }

    const currSurfaceD =

  }








  // TODO: Is it possible to avoid the surface SDF test and assume dSurface of 0?
  const dSurface = surfaceSDFs.size ? surfaceSDF(currPosition) : Number.POSITIVE_INFINITY;
  const dObstacle = obstacleSDFs.size ? obstacleSDF(currPosition) : Number.POSITIVE_INFINITY;
  const floating = !onSurface(dSurface);
  const foundObstacle = onSurface(dObstacle);
  let d;

  if ( floating ) { // Either no surfaces or not on a surface.
    if ( foundObstacle ) {
      // Locate the surface(s). Separate rest of scene from the surfaces.
      obstacleSDFs.clear();
      surfaceSDFs.clear();
      for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
        const dObstacle = sceneSDFMap.get(sdf)(currPosition);
        if ( onSurface(dObstacle) ) surfaceSDFs.add(sdf);
        else obstacleSDFs.add(sdf);
      }

      if ( surfaceSDFs.size ) {
        // Determine the surface gradient
        SDF.calculateGradient(surfaceSDF, currPosition, 1e-03, gradient);

        // Modify the current movement direction.
        if ( gradient.z.almostEqual(0) ) currDirection =

        } else SDF.projectDirectionOntoSlope(rayDirection3d, gradient, currDirection);

      } else currDirection.copyFrom(down); // Falling.



    } else {
      currDirection.copyFrom(down); // Falling.
      d = Math.abs(obstacleSDF(currPosition));


    }

  } else {
    // On surface.
    if ( foundObstacle ) {
      let obstacles = [];

      for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
        if ( obstacleSDFs.has(sdf) ) {
          const dObstacle = sceneSDFMap.get(sdf)(currPosition);
          if ( onSurface(dObstacle) ) {
            obstacleSDFs.delete(sdf);
            surfaceSDFs.add(sdf);
            obstacles.push(sdf)
          }
        }
      }

      // Ramp or vertical wall?
      SDF.calculateGradient(p => SDF.union(...obstacles.map(elem => sceneSDFMap.get(sdf)(p))), currPosition, 1e-03, gradient)
      const isVertical = gradient.z.almostEqual(0);
      if ( isVertical ) currDirection.copyFrom(up);
      else SDF.projectDirectionOntoSlope(rayDirection3d, gradient, currDirection);

    } else {
      // Keep current direction, walking along the surface.
      d = Math.abs(obstacleSDF(currPosition));
    }
  }





  /*

  // Locate the surface(s) for the current position and the nearest obstacle.
  let d = Number.POSITIVE_INFINITY;
  obstacleSDFs.clear();
  surfaceSDFs.clear();
  for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
    const dObstacle = sdfFn(currPosition);
    if ( onSurface(dObstacle) ) surfaceSDFs.add(sdf);
    else {
      obstacleSDFs.add(sdf);
      d = Math.min(d, dObstacle);
    }
  }

  if ( surfaceSDFs.size ) {

  }





  let d;
  if ( surfaceSDFs.size ) d = Math.abs(surfaceSDF(currPosition));
  if ( !(surfaceSDFs.size && onSurface(d)) ) {
    // Locate the surface(s). Separate rest of scene from the surfaces.
    obstacleSDFs.clear();
    surfaceSDFs.clear();
    for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
      const dObstacle = sceneSDFMap.get(sdf)(currPosition);
      if ( onSurface(dObstacle) ) surfaceSDFs.add(sdf);
      else obstacleSDFs.add(sdf);
    }

    if ( surfaceSDFs.size ) {
      // Determine the surface gradient
      SDF.calculateGradient(surfaceSDF, currPosition, 1e-03, gradient);

      // Modify the current movement direction.
      SDF.projectDirectionOntoSlope(rayDirection3d, gradient, currDirection);

    } else currDirection.copyFrom(down); // Falling.

    // Update distance value.
    d = Math.abs(obstaclesSDF(currPosition));
  } else {
    d = Math.abs(obstaclesSDF(currPosition));

    // If we reached an obstacle, change direction.
    // Could go around using gradient but here we will just move vertically up.
    SDF.calculateGradient(surfaceSDF, currPosition, 1e-03, gradient);



    if ( gradient.z.almostEqual(0) ) {
      currDirection.copyFrom(up);

    } else {
      SDF.projectDirectionOntoSlope(rayDirection3d, gradient, currDirection);
    }

  }
  */



  // Next checkpoint for this surface.
  const surfaceT = Math.sqrt(nextSurfaceT());
  if ( isFinite(surfaceT) && !onSurface(d) ) {
    // Project the surface point along the current path and determine distance to it.
    const surfacePoint = start.add(rayDirection3d.multiplyScalar(surfaceT, tmp), tmp);
    const currEnd = start.add(currDirection.multiplyScalar(Math.sqrt(d), tmp2), tmp2);
    const lineT = closestPointToSegmentTSquared(surfacePoint, start, currEnd);
    const checkpoint = start.add(currDirection.multiplyScalar(Math.sqrt(lineT), tmp), tmp);
    d = Math.min(d, Point3d.distanceSquaredBetween(start, checkpoint));
  }

  if ( surfaceSDFs.size && !(currDirection.z.almostEqual(0)) ) {
    // Get the surface elevation cutoffs from this position.
    const elevs = [];
    surfaceSDFs.forEach(sdf => {
      if ( sdf === "floor" ) return;
      elevs.push(...sdf.cutawayElevations(currPosition))
    });



  }

  d = Math.max(d, 1); // Always move forward.

  // Move along the surface to either:
	// 1. Safe distance before next potential obstacle.
	// 2. Surface checkpoint.
	// 3. Single pixel.

  // Move.
  currPosition.add(currDirection.multiplyScalar(SDF.fromSquaredDistance(d), tmp), currPosition);
  checkpoints.push(currPosition.clone())

  // Drop SDFs behind this t.
  currT = percentToTarget(currPosition, start, end);
  for ( const [sdfObj, ts] of sceneSDFTMap.entries() ) {
    while ( ts.length ) {
      const t = ts.at(-1);
      if ( t < currT ) {
        surfaceSDFs.delete(sdfObj);
        obstacleSDFs.delete(sdfObj);
        ts.pop();
      } else break;
    }
    if ( !ts.length ) sceneSDFTMap.delete(sdfObj);
  }
}

checkpoints.forEach(ck => Draw.point(ck, { color: Draw.COLORS.green }))


// Versus using polygon shapes with proper intersections
scenePlaceables = [...canvas.tiles.placeables, ...canvas.regions.placeables];
tOpts = { minT: Number.NEGATIVE_INFINITY, maxT: Number.POSITIVE_INFINITY };
for ( const placeable of scenePlaceables ) {
  const geom = placeable.GeometryLib.geometry;
  const ts = [];
  geom.iterateFaces(face => {
    const t = geom.constructor.rayIntersectionForFace(face, rayOrigin, rayDirection, tOpts);
    if ( t !== null ) ts.push(t);
  });
}



