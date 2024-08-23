/* globals
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/**
 * Array that eliminates duplicate points pushed to the array.
 *
 */
class NoDupePointsArray extends Array {
  push(...args) {
    const newArgs = [];
    let prev = this.at(-1);
    if ( !(prev && this.constructor.isDuplicate(args[0], prev) ) ) newArgs.push(args[0]);
    prev = args[0];
    for ( let i = 1, n = args.length; i < n; i += 1 ) {
      const elem = args[i];
      if ( this.constructor.isDuplicate(elem, prev) ) continue;
      newArgs.push(elem);
      prev = elem;
    }
    super.push(...newArgs);
  }
  static isDuplicate(a, b) {
    let dupe = true;
    dupe &&= a.x.almostEqual(b.x);
    dupe &&= a.y.almostEqual(b.y);
    if ( Object.hasOwn(a, "elevation") ) dupe &&= a.elevation.almostEqual(b.elevation);
    if ( Object.hasOwn(a, "z") ) dupe &&= a.z.almostEqual(b.z);
    return dupe;
  }

  /**
   * Build a points array from an array of region segments
   * @param {RegionMovementSegment[]} segments
   * @param {object} [opts]
   * @param {RegionMovementWaypoint} [opts.start]
   * @param {RegionMovementWaypoint} [opts.end]
   * @returns {RegionMovementWaypoint[]}
   */
  static fromSegments(segments, { start, end } = {}) {
    const { ENTER, MOVE, EXIT } = CONFIG.Region.objectClass.MOVEMENT_SEGMENT_TYPES;
    const path = new this();
    if ( start ) path.push(start);
    for ( const segment of segments ) {
      switch ( segment.type ) {
        case ENTER: path.push(segment.to); break;
        case MOVE: path.push(segment.from, segment.to); break;
        case EXIT: path.push(segment.to); break;
      }
    }
    if ( end ) path.push(end);
    return path;
  }
}

/**
 * Array representing a set of waypoints that are a straight-line path.
 * Waypoints can change elevation but in 2d overhead represent straight line.
 */
export class StraightLinePath extends NoDupePointsArray {

  /** @param {PIXI.Point|Point} */
  get start() { return this[0]; }

  /** @param {PIXI.Point|Point} */
  get end() { return this.at(-1); }

  /**
   * Utility to add one or more points to the path.
   * @param {PIXI.Point[]|RegionPathWaypoint[]} points
   */
  addToPath(points = []) { this.push(...points); }

  /**
   * Clear all distance measurements stored in points.
   * Used if the start changes or the points are converted.
   */
  clearDistanceCache() { this.forEach(pt => delete pt._dist2); }

  /**
   * What property to use for elevation along the path?
   * @type {string}
   */
  #elevationProperty;

  get elevationProperty() {
    if ( !this.#elevationProperty ) {
      const pt0 = this[0];
      if ( !pt0 ) return undefined;
      this.#elevationProperty = Object.hasOwn(pt0, "elevation") ? "elevation"
        : Object.hasOwn(pt0, "z") ? "z"
          : Object.hasOwn(pt0, "y") ? "y"
            : undefined;
    }
    return this.#elevationProperty;
  }

  set elevationProperty(value) { this.#elevationProperty = value; }

  /**
   * Determine the elevation of a position along the path.
   * @param {Point} loc
   * @returns {number} Elevation at that location.
   */
  elevationAt(loc) {
    // Quickly find the correct segment by using distance from start.
    const E = this.elevationProperty;
    if ( this.start.x.almostEqual(loc.x) && this.start.y.almostEqual(loc.y) ) return this.start[E];
    if ( this.end.x.almostEqual(loc.x) && this.end.y.almostEqual(loc.y) ) return this.end[E];
    const c =  (this.start.x === this.start.y && this.end.x === this.end.y)
      ? this.start :  foundry.utils.closestPointToSegment(loc, this.start, this.end);

    const locDist2 = PIXI.Point.distanceSquaredBetween(this.start, c);
    let i;
    const n = this.length;
    for ( i = 0; i < n; i += 1 ) {
      const pt = this[i];
      pt._dist2 ??= PIXI.Point.distanceSquaredBetween(this.start, pt);
      if ( pt._dist2.almostEqual(locDist2) ) break;
      if ( pt._dist2 < locDist2 ) continue;
      break;
    }
    // The i index is the point immediately after location.
    // Return the average of the elevation between the two points, weighted for distance.
    const a = this[i-1];
    const b = this[i];
    if ( !a ) return b[E];
    if ( !b ) return a[E];
    if ( b._dist2.almostEqual(locDist2) ) {
      const nextB = this[i+1]
      if ( nextB ) {
        nextB._dist2 ??= PIXI.Point.distanceSquaredBetween(this.start, nextB);
        if ( nextB._dist2.almostEqual(locDist2) ) return Math.max(nextB[E], b[E]);
      }
      return b[E];
    }
    if ( a[E] === b[E] ) return a[E];
    const fullDist = PIXI.Point.distanceBetween(a, b);
    const locDist = PIXI.Point.distanceBetween(a, c);
    const t0 = locDist / fullDist;
    return a[E] + ((b[E] - a[E]) * t0);
  }
}
