/* globals
CanvasQuadtree,
ClipperPaths,
CONFIG,
CONST,
foundry,
PIXI,
Token,
Wall
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { groupBy, segmentBounds } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Graph, GraphVertex, GraphEdge } from "./geometry/Graph.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { Settings } from "./settings.js";
import { doSegmentsOverlap, IX_TYPES, segmentCollision } from "./geometry/util.js";
import { MODULE_ID } from "./const.js";

export class ERSceneGraph extends SceneGraph {

  /**
   * Could edges of this token block the moving token?
   * @param {Token} token             Token whose edges will be tested
   * @param {Token} moveToken         Token doing the move
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @param {string} tokenBlockType   What test to use for comparing token dispositions for blocking
   * @returns {boolean}
   */
  static tokenEdgeBlocks(token, moveToken, elevation = 0, tokenBlockType) {
    if ( !SceneGraph.tokenEdgeBlocks(token, moveToken, elevation) ) return false;

    // Don't block dead tokens (HP <= 0).
    const { tokenHPAttribute, pathfindingIgnoreStatuses } = CONFIG[MODULE_ID];
    const tokenHP = Number(foundry.utils.getProperty(token, tokenHPAttribute));
    if ( Number.isFinite(tokenHP) && tokenHP <= 0 ) return false;

    // Don't block tokens with certain status.
    if ( token.actor?.statuses && token.actor.statuses.intersects(pathfindingIgnoreStatuses) ) return false;

    // Don't block tokens that share specific disposition with the moving token.
    tokenBlockType ??= Settings._tokenBlockType();
    const D = CONST.TOKEN_DISPOSITIONS;
    const moveTokenD = moveToken.document.disposition;
    const edgeTokenD = token.document.disposition;
    switch ( tokenBlockType ) {
      case D.NEUTRAL: return false;
      case D.SECRET: return true;

      // Hostile: Block if dispositions are different
      case D.HOSTILE: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD !== moveTokenD );

      // Friendly: Block if dispositions are the same
      case D.FRIENDLY: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD === moveTokenD );

      default: return true;
    }
  }

}





/* WallTracerVertex

Represents the endpoint of a WallTracerEdge.
Like with Walls, these vertices use integer values and keys.

The vertex provides links to connected WallTracerEdges.

*/

/* WallTracerEdge

Represents a portion of a Wall between two collisions:
- endpoint -- endpoint
- endpoint -- intersection
- intersection -- intersection

Properties include:
- wall
- A and B, where each store the t ratio corresponding to a point on the wall
- Array? of WallTracerEdge that share an endpoint, organized from cw --> ccw angle

If the wall overlaps a collinear wall?
- single edge should represent both

Wall type: currently ignored

*/

/* Connected WallTracerEdge identification

A closed polygon formed from WallTracerEdge can only be formed from edges that have
connecting edges at both A and B endpoints.

Store the set of connected WallTracerEdges. For a given set of edges, one can find the
set of connected edges by repeatedly removing edges with zero or 1 connected endpoints,
then updating the remainder and repeating until no more edges are removed.

The connected edges remaining must form 1+ closed polygons. All dangling lines will have
been removed.

*/

/* Wall updating

1. Wall creation
- Locate collision walls (edges) using QuadTree.
- Split wall into edges.
- Split colliding edges.
- Update the set of connected edges.

2. Wall update
- A changed: redo as in wall creation (1)
- B changed: change B endpoint. Possibly drop edges if shrinking (use t values).

3. Wall deletion
- remove from set of edges
- remove from set of connected edges
- remove from shared endpoint edges
- redo set of connected edges

*/

/* Angles
Foundry canvas angles using Ray:
--> e: 0
--> se: π / 4
--> s: π / 2
--> sw: π * 3/4
--> w: π
--> nw: -π * 3/4
--> n: -π / 2
--> ne: -π / 4

So northern hemisphere is negative, southern is positive.
0 --> π moves from east to west clockwise.
0 --> -π moves from east to west counterclockwise.
*/

// NOTE: Testing
/*
api = game.modules.get("elevatedvision").api
SCENE_GRAPH = api.SCENE_GRAPH
WallTracer = api.WallTracer
WallTracerEdge = api.WallTracerEdge
WallTracerVertex = api.WallTracerVertex

origin = _token.center
*/


// Wall Tracer tracks all edges and vertices that make up walls/wall intersections.

/**
 * Represents either a wall endpoint or the intersection between two walls.
 * Collinear walls are considered to "intersect" at each overlapping endpoint.
 * Cached, so that vertices may not repeat. Because of this, the object is used as its own key.
 */
export class WallTracerVertex extends GraphVertex {

  /** @type {PIXI.Point} */
  #vertex = new PIXI.Point(); // Stored separately so vertices can be added, etc.

  /** @type {number} */
  key = -1;

  /** @type {string} */
  keyString = "-1";

  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    const point = new PIXI.Point(x, y);
    point.roundDecimals();
    const key = point.key;
    super(key);
    this.#vertex = point;
    this.key = key;
    this.keyString = key.toString();
  }

  /** @type {*} */
  // get key() { return this; } // TODO: Faster using key or using a cache?

  /** @type {number} */
  get x() { return this.#vertex.x; }

  /** @type {number} */
  get y() { return this.#vertex.y; }

  /** @type {PIXI.Point} */
  get point() { return this.#vertex.clone(); } // Clone to avoid internal modification.

  /**
   * Test for equality against another vertex
   */
  equals(other) {
    return this.#vertex.equals(other);
  }

  /**
   * Test for near equality against another vertex
   */
  almostEqual(other, epsilon = 1e-08) {
    return this.#vertex.almostEqual(other, epsilon);
  }

  /**
   * Convert the vertex to a string. String should be unique such that it can be an id or key.
   * @param {function} [callback]
   * @returns {string}
   */
  toString() { return this.keyString; }

  draw(drawingOptions = {}) {
    Draw.point(this, drawingOptions);
  }
}

/**
 * Represent a segment or edge of a placeable object in the graph.
 * For example, a token border edge or a wall edge.
 * Each edge may be a portion or an entire edge of the object.
 * Edges may represent a portion of multiple objects. For example, where a token border
 * overlaps a wall. Or where two walls overlap, or two token borders overlap.
 */
export class WallTracerEdge extends GraphEdge {
  /**
   * Number of places to round the ratio for segment collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /**
   * Placeable objects represented by this edge.
   * @type {Set<PlaceableObject>}
   */
  objects = new Set();

  /**
   * Filter set for walls.
   */
  get walls() { return this.objects.filter(o => o instanceof Wall); }

  /**
   * Filter set for tokens.
   */
  get tokens() { return this.objects.filter(o => o instanceof Token); }

  /**
   * Filter set for CanvasEdges
   */
  get canvasEdges() { return this.objects.filter(o => o instanceof foundry.canvas.edges.Edge); }

  /**
   * Construct an edge.
   * To be used instead of constructor in most cases.
   * @param {Point} edgeA                 First object edge endpoint
   * @param {Point} edgeB                 Other object edge endpoint
   * @param {PlaceableObject[]} [objects] Object(s) that contains this edge, if any
   * @param {number} [tA=0]               Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]               Where the B endpoint of this edge falls on the object
   * @returns {SegmentTracerEdge}
   */
  static fromObjects(edgeA, edgeB, objects, tA = 0, tB = 1) {
    tA = Math.clamp(tA, 0, 1);
    tB = Math.clamp(tB, 0, 1);
    edgeA = PIXI.Point.fromObject(edgeA);
    edgeB = PIXI.Point.fromObject(edgeB);
    const eA = this.pointAtEdgeRatio(edgeA, edgeB, tA);
    const eB = this.pointAtEdgeRatio(edgeA, edgeB, tB);
    const A = new WallTracerVertex(eA.x, eA.y);
    const B = new WallTracerVertex(eB.x, eB.y);
    const dist = PIXI.Point.distanceSquaredBetween(A.point, B.point);
    const edge = new this(A, B, dist);
    objects.forEach(obj => edge.objects.add(obj));
    return edge;
  }

  /**
   * Construct an edge from a wall.
   * To be used instead of constructor in most cases.
   * @param {Wall} wall       Wall represented by this edge
   * @returns {WallTracerEdge}
   */
  static fromWall(wall) { return this.fromObject(wall.edge.a, wall.edge.b, [wall]); }

  /**
   * Construct an edge from a Canvas Edge
   * Used for boundary walls.
   * @param {Edge} edge       Canvas edge
   * @returns {WallTracerEdge}
   */
  static fromCanvasEdge(edge) { return this.fromObject(edge.a, edge.b, [edge]); }

  /**
   * Construct an array of edges form the constrained token border.
   * To be used instead of constructor in most cases.
   * @param {Point} A                       First edge endpoint
   * @param {Point} b                       Other edge endpoint
   * @param {PlaceableObject} object       Object that contains this edge
   * @param {number} [tA=0]   Where the A endpoint of this edge falls on the object
   * @param {number} [tB=1]   Where the B endpoint of this edge falls on the object
   * @returns {WallTracerEdge[]}
   */
  static fromToken(token) {
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    const edges = [];
    for ( const edge of edgeIter ) edges.push(this.fromObject(edge.A, edge.B, [token]));
    return edges;
  }

  /**
   * Determine the point along the line of an edge given a ratio.
   * @param {PIXI.Point} edgeA      First edge endpoint
   * @param {PIXI.Point} edgeB      Other edge endpoint
   * @param {number} edgeT          The percentage from the edge endpoint A to use.
   * @returns {PIXI.Point} The point along the wall line. Ratio 0: endpoint A; 1: endpoint B.
   */
  static pointAtEdgeRatio(edgeA, edgeB, edgeT) {
    edgeT = CONFIG.GeometryLib.utils.roundDecimals(edgeT, WallTracerEdge.PLACES);
    if ( edgeT.almostEqual(0) ) return edgeA;
    if ( edgeT.almostEqual(1) ) return edgeB;
    return edgeA.projectToward(edgeB, edgeT);
  }

  /**
   * Boundary rectangle that encompasses this edge.
   * @type {PIXI.Rectangle}
   */
  get bounds() { return segmentBounds(this.A, this.B); }

  /**
   * Find the collision, if any, between this edge and another object's edge.
   * @param {PIXI.Point} A              First edge endpoint for the object
   * @param {PIXI.Point} B              Second edge endpoint for the object
   * @returns {SegmentIntersection|null}
   *  Also rounds the t0 and t1 collision percentages to WallTracerEdge.PLACES.
   *  t0 is the collision point for the A, B object edge.
   *  t1 is the collision point for this edge.
   */
  findEdgeCollision(A, B) {
    const C = this.A.point;
    const D = this.B.point;
    return segmentCollision(A, B, C, D);
  }

  /**
   * Split this edge at some t value.
   * @param {number} edgeT  The portion on this *edge* that designates a point.
   * @returns {WallTracerEdge[]|null} Array of two edge tracer edges that share t endpoint.
   */
  splitAtT(edgeT) {
    edgeT = Math.clamp(edgeT, 0, 1);
    if ( edgeT.almostEqual(0) || edgeT.almostEqual(1) ) return null;

    // Construct two new edges, divided at the edgeT location.
    const { A, B } = this;
    const objects = [...this.objects];
    const edge1 = this.constructor.fromObjects(A, B, objects, 0, edgeT);
    const edge2 = this.constructor.fromObjects(A, B, objects, edgeT, 1);
    return [edge1, edge2];
  }

  /**
   * Draw this edge on the canvas.
   * Primarily for debugging.
   */
  draw(drawingOptions = {}) {
    Draw.segment(this, drawingOptions);
    this.A.draw(drawingOptions);
    this.B.draw(drawingOptions);
  }

  /**
   * Compilation of tests based on edge type for whether this wall blocks.
   * @param {Point} origin          Measure wall blocking from perspective of this origin point.
   * @param {Token} [moveToken]     Optional token doing the move if token edges should be checked.
   * @returns {boolean}
   */
  edgeBlocks(origin, moveToken, tokenBlockType, elevation = 0) {
    return this.objects.some(obj =>
        (obj instanceof Wall) ? this.constructor.wallBlocks(obj, origin, elevation)
          : (obj instanceof Token) ? this.constructor.tokenEdgeBlocks(obj, moveToken, tokenBlockType, elevation)
            : false);
  }

  /**
   * Does this edge wall block from an origin somewhere?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Wall} wall         Wall to test
   * @param {Point} origin      Measure wall blocking from perspective of this origin point.
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @returns {boolean}
   */
  static wallBlocks(wall, origin, elevation = 0) {
    if ( !wall.document.move || wall.isOpen ) return false;

    // Ignore one-directional walls which are facing away from the center
    const side = wall.edge.orientPoint(origin);

    /* Unneeded?
    const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
    if ( wall.document.dir
      && (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
    */

    if ( wall.document.dir
      && side === wall.document.dir ) return false;

    // Test for wall height.
    if ( !elevation.between(wall.bottomZ, wall.topZ) ) return false;

    return true;
  }

  /**
   * Could edges of this token block the moving token?
   * @param {Token} token             Token whose edges will be tested
   * @param {Token} moveToken         Token doing the move
   * @param {string} tokenBlockType   What test to use for comparing token dispositions for blocking
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @returns {boolean}
   */
  static tokenEdgeBlocks(token, moveToken, tokenBlockType, elevation = 0) {
    if ( !moveToken || moveToken === token ) return false;
    if ( !elevation.between(token.topZ, token.bottomZ) ) return false;

    // Don't block dead tokens (HP <= 0).
    const { tokenHPAttribute, pathfindingIgnoreStatuses } = CONFIG[MODULE_ID];
    const tokenHP = Number(foundry.utils.getProperty(token, tokenHPAttribute));
    if ( Number.isFinite(tokenHP) && tokenHP <= 0 ) return false;

    // Don't block tokens with certain status.
    if ( token.actor?.statuses && token.actor.statuses.intersects(pathfindingIgnoreStatuses) ) return false;

    // Don't block tokens that share specific disposition with the moving token.
    tokenBlockType ??= Settings._tokenBlockType();
    const D = CONST.TOKEN_DISPOSITIONS;
    const moveTokenD = moveToken.document.disposition;
    const edgeTokenD = token.document.disposition;
    switch ( tokenBlockType ) {
      case D.NEUTRAL: return false;
      case D.SECRET: return true;

      // Hostile: Block if dispositions are different
      case D.HOSTILE: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD !== moveTokenD );

      // Friendly: Block if dispositions are the same
      case D.FRIENDLY: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD === moveTokenD );

      default: return true;
    }
  }
}

export class WallTracer extends Graph {
  /**
   * Number of places to round the ratio for wall collisions, in order to treat
   * close collisions as equal.
   * @type {number}
   */
  static PLACES = 8;

  /**
   * Helper function used to group collisions into the collision map.
   * @param {WallTracerCollision} c   Collision to group
   * @returns {number} The t0 property, rounded.
   */
  static _keyGetter(c) { return CONFIG.GeometryLib.utils.roundDecimals(c.t0, WallTracer.PLACES); }

  /**
   * Map of a set of edges, keyed to the placeable's id.
   * Must be id because deleted placeables may still need to be accessed here.
   * @type {Map<string, Set<WallTracerEdge>>}
   */
  objectEdges = new Map();

  /**
   * Set of canvas edge ids represented in this graph.
   * @type {Set<string>}
   */
  canvasEdgeIds = new Set();

  /**
   * @type {object}
   * @property {PIXI.Polygons} least
   * @property {PIXI.Polygons} most
   * @property {PIXI.Polygons} combined
   */
  cyclePolygonsQuadtree = new CanvasQuadtree();

  /**
   * Set of wall ids represented in this graph.
   * @type {Set<string>}
   */
  wallIds = new Set();

  /**
   * Set of token ids represented in this graph.
   * @type {Set<string>}
   */
  tokenIds = new Set();

  /** @type {CanvasQuadtree} */
  edgesQuadtree = new CanvasQuadtree();

  /**
   * Clear all cached edges, etc. used in the graph.
   */
  clear() {
    this.edgesQuadtree.clear();
    this.cyclePolygonsQuadtree.clear();
    this.objectEdges.clear();
    this.wallIds.clear();
    this.tokenIds.clear();
    this.canvasEdgeIds.clear();
    super.clear();
  }

  /**
   * When adding an edge, make sure to add to quadtree.
   * @param {GraphEdge} edge
   * @returns {GraphEdge}
   * @inherited
   */
  addEdge(edge) {
    if ( this.edges.has(edge.key) ) return this.edges.get(edge.key);

    edge = super.addEdge(edge);
    this.edgesQuadtree.insert({ r: edge.bounds, t: edge });

    // Track the edge objects.
    edge.objects.forEach(obj => this._addEdgeToObjectSet(obj.id, edge));
    return edge;
  }

  /**
   * When deleting an edge, make sure to remove from quadtree.
   * @param {GraphEdge} edge
   */
  deleteEdge(edge) {
    this.edgesQuadtree.remove(edge);

    // Track the edge objects.
    edge.objects.forEach(obj => this._removeEdgeFromObjectSet(obj.id, edge));
    super.deleteEdge(edge);
  }

  /**
   * Add an edge to the object's edge set.
   * @param {string} id             Id of the object
   * @param {WallTracerEdge} edge   Edge to add
   */
  _addEdgeToObjectSet(id, edge) {
    if ( !this.objectEdges.get(id) ) this.objectEdges.set(id, new Set());
    const edgeSet = this.objectEdges.get(id);
    edgeSet.add(edge);
  }

  /**
   * Remove an edge from the object's set.
   * @param {string} id               Id of the object
   * @param {WallTracerEdge} edge     Edge to remove
   */
  _removeEdgeFromObjectSet(id, edge) {
    const edgeSet = this.objectEdges.get(id);
    // Debug: if ( edgeSet ) edgeSet.delete(edge);
    if ( !edgeSet ) {
      console.warn("_removeEdgeFromObjectSet|edgeSet undefined");
      return;
    }
    edgeSet.delete(edge);
  }

  /**
   * Add an edge for an object, splitting based on edges already present in the graph.
   * If the edge already exists and is exactly the same, simply add the object
   * to the object set for the edge.
   * @param {PIXI.Point} edgeA                  First edge endpoint
   * @param {PIXI.Point} edgeB                  Other edge endpoint
   * @param {PlaceableObject} object            Object to convert to edge(s)
   * @param {Set<SegmentTracerEdge>} [edgeSet]  Existing edge set to use
   * @param {class} [cl]                        Class to use for the object.
   */
  addObjectEdge(edgeA, edgeB, object) {
    // Locate collision points for any edges that collide with this edge object.
    // If no collisions, then a single edge can represent this edge object.
    const collisions = this.findEdgeCollisions(edgeA, edgeB);
    if ( !collisions.size ) {
      const objects = object ? [object] : [];
      const edge = WallTracerEdge.fromObjects(edgeA, edgeB, objects);
      this.addEdge(edge);
      return;
    }
    this.#processCollisions(collisions, edgeA, edgeB, object);
  }

  /**
   * Process collisions and split edges at collision points.
   * @param {SegmentIntersection[]} collisions
   * @param {PIXI.Point} edgeA                  First edge endpoint
   * @param {PIXI.Point} edgeB                  Other edge endpoint
   * @param {Wall|Token|Edge} object
   */
  #processCollisions(collisions, edgeA, edgeB, object) {
    // Sort the keys so we can progress from A --> B along the edge.
    const tArr = [...collisions.keys()];
    tArr.sort((a, b) => a - b);

    // For each collision, ordered along the wall from A --> B
    // - construct a new edge for this wall portion
    // - split the colliding edge if not at that edge's endpoint
    // - update the collision links for the colliding edge and this new edge

    // Overlapping edges:
    // If overlap found, can ignore other collisions in-between.
    // Split this edge at the start/end of the overlap.
    // Split the overlapping edge at the start and end of the overlap.
    // Add this object to the overlapping edge's objects.
    // By definition, should only be a single overlap at a time.
    // Possible for there to be collisions in between, b/c collisions checked by edgeA --> edgeB. Ignore.
    if ( !collisions.has(1) ) tArr.push(1);
    let priorT = 0;
    const OVERLAP = IX_TYPES.OVERLAP;

    const numT = tArr.length;
    for ( let i = 0; i < numT; i += 1 ) {
      // Note: it is possible for more than one collision to occur at a given t location.
      // (multiple T-endpoint collisions)
      const t = tArr[i];
      const cObjs = collisions.get(t) ?? [];

      // Build edge for portion of wall between priorT and t, skipping when t === 0.
      // Exception: If this portion overlaps another edge, use that edge instead.
      if ( t > priorT ) {
        const edge = WallTracerEdge.fromObjects(edgeA, edgeB, [object], priorT, t);
        this.addEdge(edge);
      }

      // Prioritize overlaps.
      // Only one overlap should start at a given t.
      const overlapC = cObjs.findSplice(obj => obj.type === OVERLAP);
      if ( overlapC ) {
        // Beginning overlap.
        let overlappingEdge = overlapC.edge;
        let splitEdges = overlappingEdge.splitAtT(overlapC.t1);
        if ( splitEdges ) {
          this.deleteEdge(overlappingEdge);
          const overlapIdx = overlapC.t1 > overlapC.endT1 ? 0 : 1;
          overlappingEdge = splitEdges[overlapIdx];
          splitEdges.forEach(e => this.addEdge(e));
        }

        // Add this object to the overlapping portion.
        overlappingEdge.objects.add(object);
        this._addEdgeToObjectSet(object.id, overlappingEdge);

        // Ending overlap.
        const splitT = prorateTSplit(overlapC.t1, overlapC.endT1);
        splitEdges = overlappingEdge.splitAtT(splitT);
        if ( splitEdges ) {
          this.deleteEdge(overlappingEdge);
          const overlapIdx = overlapC.t1 > overlapC.endT1 ? 0 : 1;
          splitEdges[overlapIdx].objects.delete(object); // Remove object from non-overlapping portion.
          splitEdges.forEach(e => this.addEdge(e));
        }

        // Jump to new t position in the array.
        const idx = tArr.findIndex(t => t >= overlapC.endT0);
        if ( ~idx ) i = idx - 1; // Will be increased by the for loop. Avoid getting into infinite loop.
        priorT = overlapC.endT0;
        continue;

      }
      // For normal intersections, split the other edge. If the other edge forms a T-intersection,
      // it will not get split (splits at t1 = 0 or t1 = 1).
      for ( const cObj of cObjs ) {
        const splitEdges = cObj.edge.splitAtT(cObj.t1); // If the split is at the endpoint, will be null.
        if ( splitEdges ) {
          // Remove the existing edge and add the new edges.
          // With overlaps, it is possible the edge was already removed.
          // if ( this.edges.has(cObj.edge.key) ) this.deleteEdge(cObj.edge);
          this.deleteEdge(cObj.edge);
          splitEdges.forEach(e => this.addEdge(e));
        }
      }

      // Cycle to next.
      priorT = t;
    }
  }

  /**
   * Split the token edges by edges already in this graph.
   * @param {Token} token   Token to convert to edge(s)
   */
  addToken(token) {
    const tokenId = token.id;
    if ( this.edges.has(tokenId) ) return;

    // Construct a new token edge set.
    const edgeIter = token.constrainedTokenBorder.iterateEdges();
    for ( const edge of edgeIter ) this.addObjectEdge(edge.A, edge.B, token);
    this.tokenIds.add(tokenId);
  }

  /**
   * Split the wall by edges already in this graph.
   * @param {Wall} wall   Wall to convert to edge(s)
   */
  addWall(wall) {
    const wallId = wall.id;
    if ( this.edges.has(wallId) ) return;

    // Construct a new wall edge set.
    this.addObjectEdge(PIXI.Point.fromObject(wall.edge.a), PIXI.Point.fromObject(wall.edge.b), wall);
    this.wallIds.add(wallId);
  }

  /**
   * Split the canvas edge by edges already in this graph.
   * @param {Edge} edge   Canvas edge to convert to edge(s)
   */
  addCanvasEdge(edge) {
    const id = edge.id;
    if ( this.edges.has(id) ) return;

    // Construct a new canvas edge set
    this.addObjectEdge(PIXI.Point.fromObject(edge.a), PIXI.Point.fromObject(edge.b), edge);
    this.canvasEdgeIds.add(id);
  }

  /**
   * Remove all associated edges with this edge set and object id.
   * @param {string} id             Id of the edge object to remove
   * @param {Map<string, Set<TokenTracerEdge>>} Map of edges to remove from
   */
  removeObject(id, _recurse = true) {
    const edges = this.objectEdges.get(id);
    if ( !edges || !edges.size ) return;

    // Shallow copy the edges b/c they will be removed from the set with destroy.
    const edgesArr = [...edges];
    for ( const edge of edgesArr ) {
      // Remove any object with this id; if no objects left for the edge, remove the edge.
      edge.objects
        .filter(obj => obj.id === id)
        .forEach(obj => {
          edge.objects.delete(obj);
          this._removeEdgeFromObjectSet(id, edge);
        });
      // Works but not clear why edges sometimes exist but are not in the edge set.
      // Removing the test for if the edge is in the edges set results in occasional warnings.
      if ( !edge.objects.size && this.edges.has(edge.key) ) this.deleteEdge(edge);
    }
    this.objectEdges.delete(id);

    // For each remaining object in the object set, remove it temporarily and re-add it.
    // This will remove unnecessary vertices and recombine edges.
    if ( _recurse ) {
      const remainingObjects = edgesArr.reduce((acc, curr) => acc = acc.union(curr.objects), new Set());
      remainingObjects.forEach(obj => obj instanceof Wall
        ? this.removeWall(obj.id, false) : this.removeToken(obj.id, false));
      remainingObjects.forEach(obj => obj instanceof Wall
        ? this.addWall(obj) : this.addToken(obj));
    }
  }

  /**
   * Remove all associated edges with this wall.
   * @param {string|Wall} wallId    Id of the wall to remove, or the wall itself.
   */
  removeWall(wallId, _recurse = true) {
    if ( wallId instanceof Wall ) wallId = wallId.id;
    this.wallIds.delete(wallId);
    return this.removeObject(wallId, _recurse);
  }

  /**
   * Remove all associated edges with this token.
   * @param {string|Token} tokenId    Id of the token to remove, or the token itself.
   */
  removeToken(tokenId, _recurse = true) {
    if ( tokenId instanceof Token ) tokenId = tokenId.id;
    this.tokenIds.delete(tokenId);
    return this.removeObject(tokenId, _recurse);
  }

  /**
   * Remove all associated edges with this canvas edge.
   * @param {string|Edge} edgeId
   */
  removeCanvasEdge(edgeId, _recurse = true) {
    if ( edgeId instanceof foundry.canvas.edges.Edge ) edgeId = edgeId.id;
    this.canvasEdgeIds.delete(edgeId);
    return this.removeObject(edgeId, _recurse);
  }

  /**
   * Locate collision points for any edges that collide with this edge.
   * Skips edges that simply share a single endpoint.
   * @param {PIXI.Point} edgeA                      Edge endpoint
   * @param {PIXI.Point} edgeB                      Other edge endpoint
   * @returns {Map<number, EdgeTracerCollision[]>}  Map of locations of the collisions along A|B
   */
  findEdgeCollisions(edgeA, edgeB) {
    const edgeCollisions = [];
    const bounds = segmentBounds(edgeA, edgeB);
    const collisionTest = (o, _rect) => doSegmentsOverlap(edgeA, edgeB, o.t.A, o.t.B);
    const collidingEdges = this.edgesQuadtree.getObjects(bounds, { collisionTest });
    const ENDPOINT = IX_TYPES.ENDPOINT;
    for ( const edge of collidingEdges ) {
      const collision = edge.findEdgeCollision(edgeA, edgeB);
      if ( !collision || collision.type === ENDPOINT ) continue;
      collision.edge = edge;
      edgeCollisions.push(collision);
    }
    return groupBy(edgeCollisions, this.constructor._keyGetter);
  }

  /**
   * For debugging.
   * Draw edges in the graph.
   */
  drawEdges() {
    for ( const edge of this.edges.values() ) {
      const color = (edge.tokens.size && edge.walls.size) ? Draw.COLORS.white
        : edge.tokens.size ? Draw.COLORS.orange
          : edge.walls.size ? Draw.COLORS.red
            : Draw.COLORS.blue;
      edge.draw({ color });
    }
  }

  // ----- Polygon handling ---- //

  /**
   * @type {PIXI.Polygon} GraphCyclePolygon
   * @type {object} _wallTracerData   Object to store tracer data
   * @property {Set<Wall>} _wallTracerData.wallSet    Walls that make up the polygon
   * @property {object} _wallTracerData.restrictionTypes  CONST.WALL_RESTRICTION_TYPES
   * @property {number} _wallTracerData.restrictionTypes.light
   * @property {number} _wallTracerData.restrictionTypes.sight
   * @property {number} _wallTracerData.restrictionTypes.sound
   * @property {number} _wallTracerData.restrictionTypes.move
   * @property {object} _wallTracerData.height
   * @property {number} _wallTracerData.height.min
   * @property {number} _wallTracerData.height.max
   * @property {number} _wallTracerData.hasOneWay
   */

  /**
   * Convert a single cycle (array of vertices) to a polygon.
   * Capture the wall set for edges in the polygon.
   * Determine the minimum limit for each restriction type of all the walls.
   * @param {WallTracerVertex[]} cycle    Array of vertices that make up the cycle, in order.
   * @returns {GraphCyclePolygon|null} Polygon, with additional tracer data added.
   */
  static cycleToPolygon(cycle) {
    const nVertices = cycle.length;
    if ( nVertices < 3 ) return null;
    const points = Array(nVertices * 2);
    const wallSet = new Set();
    const restrictionTypes = {
      light: CONST.WALL_SENSE_TYPES.NORMAL,
      sight: CONST.WALL_SENSE_TYPES.NORMAL,
      sound: CONST.WALL_SENSE_TYPES.NORMAL,
      move: CONST.WALL_SENSE_TYPES.NORMAL
    };
    const height = {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY
    };
    let hasOneWay = false;

    let vertex = cycle[nVertices - 1];
    for ( let i = 0; i < nVertices; i += 1 ) {
      const nextVertex = cycle[i];
      const j = i * 2;
      points[j] = vertex.x;
      points[j + 1] = vertex.y;

      const edge = vertex.edges.find(e => e.otherVertex(vertex).key === nextVertex.key);
      for ( const wall of edge.walls ) {
        wallSet.add(wall);
        const doc = wall.document;
        restrictionTypes.light = Math.min(restrictionTypes.light, doc.light);
        restrictionTypes.sight = Math.min(restrictionTypes.sight, doc.sight);
        restrictionTypes.sound = Math.min(restrictionTypes.sound, doc.sound);
        restrictionTypes.move = Math.min(restrictionTypes.move, doc.move);

        height.min = Math.min(height.min, wall.bottomZ)
        height.max = Math.max(height.max, wall.topZ)

        hasOneWay ||= doc.dir;
      }
      vertex = nextVertex;
    }

    const poly = new PIXI.Polygon(points);
    poly.clean();
    poly._wallTracerData = { wallSet, restrictionTypes, height, hasOneWay };
    return poly;
  }

  /**
   * Update the quadtree of cycle polygons
   */
  updateCyclePolygons() {
    // Least, most, none are perform similarly. Most might be a bit faster
    // (The sort can sometimes mean none is faster, but not always)
    // Weighting by distance hurts performance.
    this.cyclePolygonsQuadtree.clear();
    const cycles = this.getAllCycles({ sortType: Graph.VERTEX_SORT.LEAST, weighted: true });
    cycles.forEach(cycle => {
      const poly = WallTracer.cycleToPolygon(cycle);
      this.cyclePolygonsQuadtree.insert({ r: poly.getBounds(), t: poly });
    });
  }

  /**
   * For a given origin point, find all polygons that encompass it.
   * Then narrow to the one that has the smallest area.
   * @param {Point} origin
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {PIXI.Polygon|null}
   */
  encompassingPolygon(origin, type) {
    const encompassingPolygons = this.encompassingPolygons(origin, type);
    return this.smallestPolygon(encompassingPolygons);
  }

  encompassingPolygons(origin, type) {
    origin.z ??= 0;

    // Find those polygons that actually contain the origin.
    // Start by using the bounds, then test containment.
    const bounds = new PIXI.Rectangle(origin.x - 1, origin.y -1, 2, 2);
    const collisionTest = (o, _rect) => o.t.contains(origin.x, origin.y);
    let encompassingPolygons = this.cyclePolygonsQuadtree.getObjects(bounds, { collisionTest });

    if ( type ) encompassingPolygons = encompassingPolygons.filter(poly => {
      const wallData = poly._wallTracerData;

      if ( wallData.restrictionTypes[type] !== CONST.WALL_SENSE_TYPES.NORMAL
        || wallData.height.max < origin.z
        || wallData.height.min > origin.z ) return false;

      if ( !wallData.hasOneWay ) return true;

      // Confirm that each wall is blocking from the origin
      for ( const wall of wallData.wallSet ) {
        if ( !wallData.dir ) continue;
        const side = wall.orientPoint(this.origin);
        if ( side === wall.document.dir ) return false;

      }
      return true;
    });

    return encompassingPolygons;
  }

  smallestPolygon(polygons) {
    const res = polygons.reduce((acc, curr) => {
      const area = curr.area;
      if ( area < acc.area ) {
        acc.area = area;
        acc.poly = curr;
      }
      return acc;
    }, { area: Number.POSITIVE_INFINITY, poly: null})

    return res.poly;
  }

  /**
   * For a given polygon, find all polygons that could be holes within it.
   * @param {PIXI.Polygon} encompassingPolygon
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {encompassingPolygon: {PIXI.Polygon}, holes: {Set<PIXI.Polygon>}}
   */
  _encompassingPolygonsWithHoles(origin, type) {
    const encompassingPolygons = this.encompassingPolygons(origin, type);
    const encompassingPolygon = this.smallestPolygon(encompassingPolygons);
    if ( !encompassingPolygon ) return { encompassingPolygon, holes: [] };

    // Looking for all polygons that are not encompassing but do intersect with or are contained by
    // the encompassing polygon.
    const collisionTest = (o, _rect) => {
      const poly = o.t;
      if ( encompassingPolygons.some(ep => ep.equals(poly)) ) return false;
      return poly.overlaps(encompassingPolygon);
    };

    const holes = this.cyclePolygonsQuadtree.getObjects(encompassingPolygon.getBounds(), { collisionTest });
    return { encompassingPolygon, holes };
  }

  /**
   * Build the representation of a polygon that encompasses the origin point,
   * along with any holes for that encompassing polygon.
   * @param {Point} origin
   * @param {CONST.WALL_RESTRICTION_TYPES} [type]   Limit to polygons that are CONST.WALL_SENSE_TYPES.NORMAL
   *                                                for the given type
   * @returns {PIXI.Polygon[]}
   */
  encompassingPolygonWithHoles(origin, type) {
    const { encompassingPolygon, holes } = this._encompassingPolygonsWithHoles(origin, type);
    if ( !encompassingPolygon ) return [];
    if ( !holes.size ) return [encompassingPolygon];

    // Union the holes
    const paths = ClipperPaths.fromPolygons(holes);
    const combined = paths.combine();

    // Diff the encompassing polygon against the holes
    const diffPath = combined.diffPolygon(encompassingPolygon);
    return diffPath.toPolygons();
  }
}


// Must declare this variable after defining WallTracer.
export const SCENE_GRAPH = new WallTracer();


/**
 * Class that can be extended to handle special edge tests while still using the underlying scene graph.
 */
export SceneGraph extends WallTracer {
  /** @type {WallTracer} */
  SCENE_GRAPH = SCENE_GRAPH;

  constructor() {

  }



}



/* Debugging
api = game.modules.get("elevationruler").api
Draw = CONFIG.GeometryLib.Draw
let { Graph, GraphVertex, GraphEdge } = CONFIG.GeometryLib.Graph

SCENE_GRAPH = api.pathfinding.SCENE_GRAPH

// Do we have all the tokens?
canvas.tokens.placeables.filter(t => !SCENE_GRAPH.tokenIds.has(t.id))

// do we have all the walls?
canvas.walls.placeables.filter(w => !SCENE_GRAPH.wallIds.has(w.id))

// Every object edge id should be in one of the three sets and vice versa.
objectEdgeKeys = new Set(SCENE_GRAPH.objectEdges.keys())
SCENE_GRAPH.canvasEdgeIds.difference(objectEdgeKeys).size
SCENE_GRAPH.tokenIds.difference(objectEdgeKeys).size
SCENE_GRAPH.wallIds.difference(objectEdgeKeys).size
objectEdgeKeys.equals(SCENE_GRAPH.canvasEdgeIds.union(SCENE_GRAPH.tokenIds).union(SCENE_GRAPH.wallIds))





// Draw all edges
SCENE_GRAPH.drawEdges()


// Construct a test graph and add all tokens
wt = new api.WallTracer()

canvas.walls.placeables.forEach(w => wt.addWall(w))
canvas.tokens.placeables.forEach(t => wt.addToken(t))
wt.tokenEdges.forEach(s => s.forEach(e => e.draw({color: Draw.COLORS.orange})))

*/

// NOTE: Helper functions

/**
 * Prorate a t value based on some preexisting split.
 * Example: Split a segment length 10 at .2 and .8.
 *  - Split at .2: Segments length 2 and length 8.
 *  - Split second segment: (.8 - .2) / .8 = .75. Split length 8 segment at .7 to get length 6.
 *  - Segments 2, 6, 2
 * Handles when the segment is split moving from 1 --> 0, indicated by secondT < firstT.
 */
function prorateTSplit(firstT, secondT) {
  if ( secondT.almostEqual(0) ) return 1;
  if ( firstT.almostEqual(secondT) ) return 0;
  if ( secondT < firstT ) return secondT / firstT;
  return (secondT - firstT) / (1 - firstT);
}

/**
 * Test if at least one of a polygon is contained within another polygon
 * @param {PIXI.Polygon} encompassingPolygon
 * @param {PIXI.Polygon} other
 * @return {boolean}
 */
// function polygonPartiallyContained(encompassingPolygon, other) {
//   const pts = other.iteratePoints({close: false});
//   for ( const pt of pts ) {
//     if ( encompassingPolygon.contains(pt) ) return true;
//   }
//   return false;
// }

/**
 * Do two segments overlap?
 * Overlap means they intersect or they are collinear and overlap
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {boolean}
 */
// function segmentsOverlap(a, b, c, d) {
//   if ( foundry.utils.lineSegmentIntersects(a, b, c, d) ) return true;
//
//   // If collinear, B is within A|B or D is within A|B
//   const pts = findOverlappingPoints(a, b, c, d);
//   return pts.length;
// }

/**
 * Find the points of overlap between two segments A|B and C|D.
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {PIXI.Point[]} Array with 0, 1, or 2 points.
 *   The points returned will be a, b, c, and/or d, whichever are contained by the others.
 *   No points are returned if A|B and C|D are not collinear, or if they do not overlap.
 *   A single point is returned if a single endpoint is shared.
 */
function findOverlappingPoints(a, b, c, d) {
  if ( !foundry.utils.orient2dFast(a, b, c).almostEqual(0)
    || !foundry.utils.orient2dFast(a, b, d).almostEqual(0) ) return [];

  // B is within A|B or D is within A|B
  const abx = Math.minMax(a.x, b.x);
  const aby = Math.minMax(a.y, b.y);
  const cdx = Math.minMax(c.x, d.x);
  const cdy = Math.minMax(c.y, d.y);

  const p0 = new PIXI.Point(
    Math.max(abx.min, cdx.min),
    Math.max(aby.min, cdy.min)
  );

  const p1 = new PIXI.Point(
    Math.min(abx.max, cdx.max),
    Math.min(aby.max, cdy.max)
  );

  const xEqual = p0.x.almostEqual(p1.x);
  const yEqual = p1.y.almostEqual(p1.y);
  if ( xEqual && yEqual ) return [p0];
  if ( xEqual ^ yEqual
  || (p0.x < p1.x && p0.y < p1.y)) return [p0, p1];

  return [];
}

