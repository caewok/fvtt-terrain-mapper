[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-terrain-mapper)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-terrain-mapper)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/terrainmapper&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

You can use this [Module JSON link](https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json) to install.

This [Foundry VTT](https://foundryvtt.com) module facilitates the use of Foundry regions to define "Terrains." Terrains are (as of the v14 version of this module) specific behaviors assigned to a region that change how the region is physically treated. Choices include plateaus, ramps, steps, and hills. A region with a defined terrain affects the elevation of a token moving into it.

(As of FoundryVTT v14, the GM can define active effects that apply to a token moving within a region. Thus, that part of this module has been deprecated, and the module focuses more narrowly on the elevation aspects of terrain.)

Terrain mapper also provides some advanced region drawing tools: fill-by-grid (now deprecated as of FoundryVTT v14.370), fill-by-line-of-sight, and fill-by-enclosed-walls.


This module is meant to work with [Alternative Token Visibility](https://github.com/caewok/fvtt-token-visibility) and . Both rely on the same underlying algorithms to determine whether there are obstacles between the viewer and the target.

This module intends to be system-neutral. I will endeavor to make this module compatible with other systems upon request (and to the extent possible).

# Thanks

Special thanks to:
- [dev7355608](https://github.com/dev7355608) for answering yet more random PIXIjs questions.

## Required modules
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib)

# Recommended modules
- [Alternative Token Visibility](https://github.com/caewok/fvtt-token-visibility). Uses terrain shapes defined in this module to estimate token line-of-sight.
- [Alternative Token Cover](https://github.com/caewok/fvtt-token-cover). Uses terrain shapes defined in this module to estimate token cover.


# Known issues
Nothing too serious at the moment. Report [issues](https://github.com/caewok/fvtt-terrain-mapper/issues) here!

# Basic Use

## Terrains

Terrain Mapper lets the GM create one or more physical region "terrains" by selecting a corresponding region behavior (plateau, ramp, steps, hill). (As of v14, these are now behaviors and not region settings.)

When a token walks onto a terrain region, its elevation will change to match that of the terrain at that point. Leaving the terrain region will drop the token back to the background scene elevation (or possibly another adjacent terrain region elevation if present). A flying token will move upwards if necessary to avoid running into the terrain, but will not "fall." A burrowing token may "fall" to the terrain elevation but will not move up.

Each terrain region behavior has a toggle, that if enabled, will pop up a dialog for the user to choose whether to elevate the token and continue the movement when entering a terrain region.

As of v14, the region top and bottom are used to define the terrain elevation.

### Terrain: Plateau.

The plateau / mesa option makes a normal region into a terrain region, with the top equal to that of the region top elevation.

### Terrain: Ramp.

The GM defines a direction of the ramp, and the ramp slopes from the region bottom elevation to the region top elevation in that direction. In other words, when looking at a cutaway of the region along that direction, it will form a triangle.

The "ramp" moves the token in 1-unit elevation steps.

Note that the ramp is *directional*, meaning that if the token moves along the ramp from the side it would be moved to the elevation of the ramp at that point and then not change (unless it changed direction to move up or down).

### Terrain: Steps.

The GM defines both the direction of the steps and the step size (how much to increment elevation along each step of the ramp). Steps are thus basically jagged ramps.


### Terrain: Hill.

A hill defines a curve to mimic a rolling hill or steeper terrain.

To define a hill, the GM first selects the Terrain Mapper Hill icon in the region controls layer. Each region then displays two lines:
- Green Bézier curve line. Defines the shape of the curve. The curve is constrained by the top and bottom region elevation. The very top of the curve will be approximately equal to the top elevation; the very bottom approximately equal to the bottom elevation. You can adjust the shape of the curve by manipulating the start, end, or two control anchors.
- Orange ridge line. Defines the ridge line location and direction for the hill. Drag the end points of the ridge line to orient the hill in different directions relative to the region shape.

The GM then selects the hill region behavior. The GM then can choose between three hill types in that behavior:
- Linear. The hill slopes in a single direction, along the ridge line.
- Ridge. The hill falls off as the token moves perpendicular to the ridge line.
- Symmetrical. The hill is shaped like a circular dome.

### Stairs
The stairs behavior can set a token to a specific elevation ("one-way") or can alternate between two elevations ("two-way"). Two-way stairs move the token up if it is less than halfway between the low/high elevations, and otherwise moves the token down. If the token changes elevation, its movement is stopped because its perspective (and visible walls, obstacles, and enemies) may have changed.

You can optionally have the behavior present a dialog to the user before the token elevation is changed. You can also limit stairs to operate only if the token is at exactly the low or high elevations, which is helpful if you have defined "floors" at which the token is meant to be moving. Finally, you can have the token return to the background scene elevation when leaving the stairs region (although you may want to use a plateau instead).

### Elevator
The elevator behavior allows the user to select between several different floors. By necessity, an elevator always presents a dialog to the user. Otherwise, options here are comparable to stairs. As with stairs, if the token changes elevation, its movement is stopped. You can limit the elevator to trigger only when the token is at one of the defined elevations.  And you can have the token return to the background scene elevation when leaving the elevator region


# User Interface

## Fill tools
Terrain Mapper adds some additional fill tools to the Region controls, to facilitate drawing region shapes.

### Fill by grid
<img width="432" alt="Screenshot 2024-06-21 at 9 07 49 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/0c31f7e9-f735-43f9-8e71-0cbc3a1cbae7">

Fills one or more grid squares with the terrain. Hold and drag to fill a bunch of grid squares in a row. This will combine the grid squares into a single shape at the end, potentially with one or more holes.

### Fill by line-of-sight
<img width="432" alt="Screenshot 2024-06-21 at 9 07 43 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/392ac416-244a-434e-a0a4-517c97f1b6bb">

Fills an area representing the line-of-sight from the point selected on the canvas. This is equivalent to the line-of-sight used in token vision.

### Fill space enclosed by walls
<img width="432" alt="Screenshot 2024-06-21 at 9 07 37 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/01c2ca39-b9d1-4dda-b89c-20761050bb3b">

Based on the current wall configuration for the scene, this tool will fill an enclosed space with the selected terrain from the point selected. If there are "islands" within the enclosed space, those islands will not be filled. To assist you, wall outlines will be displayed while this tool is active.

Unlike the "Create Shape from Controlled Walls" tool provided by Regions, this does not require you to select walls first. But because of this, gaps between walls can cause this tool to "leak" and fill much more area than intended. To undo it, go to the region shapes and delete the last shape in the list.
<img width="1047" alt="Screenshot 2024-06-21 at 9 16 16 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/143d3ebc-787c-4c45-97fa-dc832cbfd78e">

## Region configuration
Within a region, you can set two behaviors: stairs, and elevator.
<img width="482" alt="Screenshot 2024-09-03 at 11 38 56 AM" src="https://github.com/user-attachments/assets/e0cb2d51-50bc-4f64-b049-4650dd61ea49">

### Stairs
<img width="476" alt="Screenshot 2024-09-03 at 11 38 23 AM" src="https://github.com/user-attachments/assets/df5b0f13-6ac7-4a8b-b1aa-8478d305af83">

### Elevator
<img width="476" alt="Screenshot 2024-09-03 at 11 38 06 AM" src="https://github.com/user-attachments/assets/a0daa906-19d3-4044-b852-5f46ae56070f">
