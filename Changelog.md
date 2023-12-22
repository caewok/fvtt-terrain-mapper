## 0.0.7
Popout the terrain effect configuration when a new terrain is created. See issue #15.
Update terrain color when the configuration setting is updated. Closes issue #10.
Fix hexagon fill. Closes issue #14. Note that the hexagon fills are slightly blocky, reflecting the lower resolution of the terrain fill (for speed).
Refactor settings and patching classes.


## 0.0.6
Move the terrain import/replace/export buttons to the Terrain List.
Add add/remove terrain buttons to the Terrain List.

## 0.0.5
Add a `Terrain.percentMovementForTokenAlongPath` that can be used by modules like Drag Ruler to estimate token movement across terrains. Fixes to token movement estimation.

## 0.0.4
Fixes for editing terrains in the advanced terrain listing. Closes issue #4.

## 0.0.3
Add checks for when the terrain item is not yet defined. Closes issue #3.
Fix for the terrain item getting initialized too late.
Fix hook that ensure terrain item is invisible.
Add check to determine if terrain data file exists, to avoid 404 error message.

## 0.0.2
Correct import issue where "Settings" filename was incorrectly capitalized. Closes issue #2.

## 0.0.1
Initial release

- Configure terrains.
- Add terrains by layer.
- Automatically add terrain effects on token movement.
- Notify GM and interrupt token movement when encountering terrain.
