# MVP Spec: Gesture-Driven AR Electronics Simulator

> Hand this file to Claude Code as the project brief. Build exactly what is in "MVP Scope". Anything under "Out of Scope" must NOT be built until the MVP passes the Definition of Done.

## 1. Goal

A browser app that opens the webcam, tracks the user's hand, and lets them pick up, rotate, place, and wire virtual electronic components (breadboard, **Arduino Uno, ESP32**, LED, resistor, jumper wires) in 3D over the live video. A simple simulation makes the LED light up when the circuit is correct.

**Demo scenario the MVP must support (the "golden path"):**
Pick up a board (Arduino or ESP32), a breadboard, a resistor, and an LED -> place them -> wire `output pin -> resistor -> LED -> GND` with pinch gestures -> press the virtual "Run" button -> LED blinks. If wired wrong, a clear message explains why.

- Arduino path: `D13 -> resistor -> LED -> GND`
- ESP32 path: `GPIO2 -> resistor -> LED -> GND`

## 2. Tech Stack (fixed, do not substitute)

| Layer | Choice | Reason |
|---|---|---|
| App | Vite + vanilla TypeScript | No backend, fast setup |
| Rendering (CG) | Three.js | Scene graph, raycasting, transforms |
| Hand tracking (CV) | MediaPipe Hands (`@mediapipe/tasks-vision`, HandLandmarker) | 21 landmarks per hand, runs in browser |
| Simulation | Custom TypeScript module | Simple graph logic, no SPICE |
| AI (MVP-lite) | Rule-based circuit validator + gesture classifier interface | See section 6 |
| Tests | Vitest for simulation and gesture logic | Pure logic must be testable |

Runs fully client-side. Target: Chrome desktop, 720p webcam, >= 24 FPS.

## 3. MVP Scope

### 3.1 Camera + Hand Tracking
- Show mirrored webcam feed as full-screen background.
- Run HandLandmarker on each frame; support 1 or 2 hands.
- Draw a small cursor sphere (3D) at the index fingertip so the user can see tracking.
- Smooth landmarks with an exponential moving average (alpha ~0.5) to reduce jitter.
- **Performance fallback (target dev machine: laptop with integrated Intel Iris Xe GPU, 16 GB RAM):**
  - Use the MediaPipe *lite* hand model and a 640x480 or 720p webcam stream.
  - Add `config.trackingEveryNFrames` (default 1). If FPS stays below 24 for ~2 seconds, automatically switch to 2: run hand tracking every second frame and linearly interpolate landmarks on the skipped frames, while rendering continues every frame.
  - Show the current tracking mode and FPS in the status panel.

### 3.2 3D Scene
- Transparent Three.js canvas on top of the video, perspective camera.
- Map hand 2D position + estimated depth to scene coordinates (depth from hand size in image: larger = closer).
- Simple lighting, soft shadows not required.

### 3.3 Components (simple low-poly models built from Three.js primitives, no external assets)
1. **Breadboard**: grid of holes; rows grouped in columns of 5 connected holes; two power rails (+ and -).
2. **Arduino Uno**: board body + labeled pin header: `D2..D13`, `GND`, `5V`. Logic level 5V.
3. **ESP32 DevKit**: board body with two labeled pin rows: `GPIO2, GPIO4, GPIO5, GPIO18, GPIO19, GPIO21, GPIO23`, `3V3`, `VIN` (5V in), `GND`. Logic level 3.3V. Distinct color/shape from the Arduino so they are easy to tell apart.
4. **LED**: two legs (anode, cathode). Glows when powered.
5. **Resistor**: two legs. Fixed value 220 ohm.
6. **Jumper wire**: created by connecting two pins (rendered as a tube/curve).

Each component has: `id`, `type`, `mesh`, `pins[]` (with local 3D positions), world transform.
Each board also has: `logicLevel` (5 or 3.3), `blinkPin` (`D13` for Arduino, `GPIO2` for ESP32), `groundPins[]`, `powerPins[]`. Define boards in a data file (`boards.ts`) so adding a new board later means adding data, not new logic.

### 3.4 Gestures (rule-based, from landmarks)
| Gesture | Detection | Action |
|---|---|---|
| **Pinch** | thumb tip to index tip distance < threshold (normalized by hand size) | Grab component under fingertip raycast / hold |
| **Move** | pinch held + hand moves | Translate grabbed component |
| **Rotate** | pinch held + wrist roll / two-hand twist | Rotate grabbed component around Y (and X with palm tilt) |
| **Release** | pinch opens | Drop component (snap to breadboard holes if close enough) |
| **Wire** | pinch on pin A, drag, release on pin B | Create wire between pins |
| **Press** | index fingertip pushes into a virtual button (z-threshold) | Run / Stop simulation, Reset |

Use hysteresis on pinch (e.g. close < 0.04, open > 0.06) to avoid flicker. Put all thresholds in `config.ts`.

### 3.5 Simulation (logic level, not analog)
- Build a **netlist graph**: nodes = connected pins (breadboard column groups merged, wires merge nodes).
- Board program for MVP is a **preset blink**: the board's `blinkPin` toggles HIGH/LOW every 500 ms while running.
- If both an Arduino and an ESP32 are in the scene, only the board whose pin is wired into the LED circuit drives it; the other is ignored.
- LED is "ON" when ALL are true:
  1. A path exists from the board's `blinkPin` -> (resistor) -> LED anode.
  2. LED cathode connects to a GND pin (of the same board).
  3. `blinkPin` is currently HIGH.
- LED polarity matters: reversed LED never lights.
- Show the LED glow (emissive material + point light) when ON.

### 3.6 Circuit Validator ("AI-lite", rule-based)
On Run (and when wiring changes), produce a list of messages shown in a side panel:
- LED without series resistor -> warning "LED may burn out; add a resistor."
- LED reversed -> "LED is reversed (anode/cathode)."
- No path to GND -> "Circuit is open: cathode not connected to GND."
- Power pin directly to GND (`5V`/`3V3`/`VIN` to `GND`) -> error "Short circuit."
- **ESP32 only:** `5V` or `VIN` connected to any ESP32 GPIO pin -> error "ESP32 GPIO is 3.3V only; 5V can damage it."
- **ESP32 only:** ESP32 GPIO connected to an Arduino 5V output pin -> warning "Level mismatch: use a level shifter or voltage divider."
- Correct circuit -> "Circuit OK."

### 3.7 UI
- Left toolbar (hand-selectable buttons): spawn Arduino, ESP32, Breadboard, LED, Resistor.
- Right panel: validator messages + status (tracking OK, hand count, FPS).
- Fallback: mouse mode (click-drag with mouse) toggled by key `M`, so the app is testable without a camera.

## 4. Out of Scope (do NOT build in MVP)
- **Raspberry Pi** (planned for Phase 2), VR headset/WebXR, other boards or sensors
- Real code editor or uploading Arduino/ESP32 sketches
- WiFi/Bluetooth simulation for the ESP32 (it is treated only as a GPIO board)
- Analog simulation (voltage/current calculations)
- Recognizing real physical boards via camera (object detection)
- Multiplayer, saving/loading, accounts, mobile support

## 5. Suggested Project Structure

```
/src
  main.ts                 // bootstrap, game loop
  config.ts               // all thresholds and constants
  camera/webcam.ts        // getUserMedia + video element
  tracking/handTracker.ts // MediaPipe wrapper, smoothing
  tracking/gestures.ts    // pinch/move/rotate/press detection (pure functions)
  scene/sceneManager.ts   // renderer, camera, lights, raycasting
  components/             // breadboard.ts, board.ts (generic), led.ts, resistor.ts, wire.ts
  components/boards.ts    // data: Arduino Uno + ESP32 pin maps, logic levels, blinkPin
  sim/netlist.ts          // graph building (pure)
  sim/simulator.ts        // blink + LED state (pure)
  sim/validator.ts        // rule-based messages (pure)
  ui/panel.ts             // toolbar + messages panel
/tests
  gestures.test.ts, netlist.test.ts, simulator.test.ts, validator.test.ts
```

Keep `tracking/gestures.ts` and `sim/*` free of Three.js and DOM so they are unit-testable. Use ONE generic `board.ts` class driven by `boards.ts` data rather than separate Arduino/ESP32 classes.

## 6. AI Component Plan (course requirement: CV + CG + AI)
- **MVP:** rule-based validator (3.6) plus hand-landmark gesture logic behind a `GestureClassifier` interface.
- **Phase 2 (after MVP):** replace rule-based gesture logic with a small MLP/classifier trained on collected landmark data (pinch, point, fist, open palm), add an "ask the assistant" box that explains wiring errors, and add Raspberry Pi as a third board.

## 7. Build Order (milestones, commit after each)
1. Project setup, webcam background, Three.js overlay, FPS counter.
2. MediaPipe hand tracking + fingertip cursor with smoothing.
3. Components rendered (breadboard, Arduino, ESP32, LED, resistor) with labeled pins; mouse mode for testing.
4. Pinch grab / move / release, then rotation.
5. Breadboard snapping + wire tool (pin to pin).
6. Netlist + simulator + LED glow, with unit tests (cover both boards).
7. Validator panel (including ESP32 voltage rules) + Run/Stop/Reset buttons via gesture press.
8. Polish: onboarding hint text, config tuning, README with demo instructions.

## 8. Definition of Done (MVP)
- [ ] Golden path demo works end-to-end with hand gestures only, on BOTH Arduino and ESP32
- [ ] Wrong wiring (reversed LED, no resistor, missing GND, power-to-GND short, 5V into ESP32 GPIO) each gives the correct message
- [ ] >= 24 FPS on a normal laptop webcam
- [ ] Mouse fallback works
- [ ] Unit tests pass for gestures, netlist, simulator, validator
- [ ] README explains setup (`npm install`, `npm run dev`) and gestures

## 9. Instructions for Claude Code
- Follow the stack and structure above; ask before changing either.
- Work milestone by milestone; run the app and tests after each; keep commits small.
- Keep all magic numbers in `config.ts` and all board definitions in `boards.ts`.
- Do not add features from "Out of Scope".
- When a gesture feels unreliable, tune thresholds and smoothing before adding complexity.
