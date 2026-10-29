# AirCircuit: Gesture-Driven AR Electronics Simulator

A browser app that tracks your hand through the webcam and lets you pick up, rotate, place and wire virtual electronics (**Arduino Uno, ESP32**, breadboard, LED, 220 Ω resistor, jumper wires) in 3D over the live video. A logic-level simulator blinks the LED when the circuit is right. A rule-based checker explains what's wrong when it isn't.

Built with Vite + TypeScript, Three.js (CG), MediaPipe HandLandmarker (CV) and a rule-based validator and gesture classifier (AI-lite). Everything runs client-side.

## Setup

Requirements: Node.js 18+ (LTS), Chrome desktop, a webcam.

```bash
npm install
npm run dev        # open the printed URL (http://localhost:5173) in Chrome, allow camera access
npm test           # unit tests: gestures, smoothing, netlist, simulator, validator
npm run build      # production build into dist/
```

The MediaPipe WASM runtime and hand model are bundled in `public/mediapipe/`, so the app works offline.

> **Windows / MSYS2 (UCRT64) shells:** if `npm` is "command not found", run it from PowerShell, or add Node to the path first: `export PATH="/c/Program Files/nodejs:$PATH"`.

## Demo: the golden path

1. Spawn a **board** (Arduino Uno or ESP32), a **Breadboard**, a **Resistor** and an **LED** from the left toolbar.
2. Plug the resistor and the LED into the breadboard. Each leg snaps into a hole. Holes in the same column (a–e or f–j) are connected, and the `+` / `−` rails each run the full length.
3. Wire it:
   - Arduino: `D13 → resistor → LED anode (+, longer leg)`, then `LED cathode → GND`
   - ESP32: `GPIO2 → resistor → LED anode`, then `LED cathode → GND`
4. Press **▶ Run**. The LED blinks every 500 ms, and the right-hand panel shows **Circuit OK.**

If something is wrong, the panel says why:

| Wiring mistake | Message |
|---|---|
| LED with no series resistor | LED may burn out; add a resistor. |
| LED backwards | LED is reversed (anode/cathode). |
| Cathode not reaching GND | Circuit is open: cathode not connected to GND. |
| `5V` / `3V3` / `VIN` wired to `GND` | Short circuit. |
| `5V` or `VIN` into an ESP32 GPIO | ESP32 GPIO is 3.3V only; 5V can damage it. |
| Arduino digital pin into an ESP32 GPIO | Level mismatch: use a level shifter or voltage divider. |

## Hand gestures

| Gesture | How | Does |
|---|---|---|
| **Spawn** | Hold your index fingertip on a toolbar button for **5 s** (the button fills up and counts down) | Spawn that part |
| **Grab** | Put your palm (orange ring) over a part and make a **fist** | Grab the part |
| **Move** | Keep the fist and move your hand | Carry the grabbed part |
| **Rotate** | Keep the fist and roll your wrist (tilt the palm to pitch). Or grip with **both** hands and twist | Rotate the part |
| **Release** | Open your hand | Drop the part. Parts dropped near the breadboard snap into its holes |
| **Wire** | **Pinch** (thumb + index) on a pin, drag to another pin, release | Create a jumper wire |
| **Press** | Point your index fingertip at a 3D button and push it toward the screen, or pinch on it | Run / Stop / Reset |
| **Delete** | Drop a part (fist) or a wire (pinch it) on the red **trash** box (bottom-left) | Remove it |

Other tips:
- Move the breadboard by pinching its **"grab here"** tab, since its holes start wires. Parts plugged into the breadboard move with it.
- Your hand is drawn as a skeleton: joints turn **green** while you pinch and **orange** while you make a fist. The orange ring is the palm point a fist grabs with; the white dot between thumb and index is the pinch point used for wiring.
- The bottom bar always shows a hint for what you can do next.
- Tracking works best with your hand about 50 cm from the camera, in even light, against a plain background.

## Mouse mode (no camera needed)

Press **M** to switch between hands and mouse. The app also switches to mouse mode by itself if the camera is unavailable.

| Input | Action |
|---|---|
| Left-drag a part | Move it (drops snap into the breadboard) |
| Left-drag from a pin to a pin | Create a wire |
| Wheel / **R** (Shift+R reverses) | Rotate the hovered or held part |
| **Delete** / Backspace | Delete the hovered wire or part |
| Click a 3D button, or **Enter** / **Space** / **N** | Run / Stop / Reset |

Hover any pin to see its name.

## Performance

The target is ≥ 24 FPS on a laptop with integrated graphics (developed on Intel Iris Xe). The status panel shows the FPS and the current tracking mode. If FPS stays below 24 for about 2 s, hand tracking switches to every 2nd frame and interpolates landmarks on the skipped frames, while rendering continues every frame. All thresholds (pinch hysteresis, smoothing, depth mapping, snapping, press depth and so on) are in `src/config.ts`.

## Project structure

```
src/
  main.ts                  bootstrap + frame loop
  config.ts                every tunable threshold / constant
  camera/webcam.ts         getUserMedia
  tracking/handTracker.ts  MediaPipe wrapper (mirrored landmarks)
  tracking/smoothing.ts    EMA smoothing, interpolation, low-FPS fallback (pure)
  tracking/gestures.ts     pinch / rotate / twist / press + GestureClassifier (pure)
  scene/                   renderer, workspace, picking, interaction, hand control
  components/              generic board (driven by boards.ts data), breadboard, LED, resistor, wire
  components/boards.ts     Arduino Uno + ESP32 pin maps, logic levels, blink pins
  sim/netlist.ts           union-find netlist (pure)
  sim/simulator.ts         preset blink + LED state (pure)
  sim/validator.ts         rule-based circuit checker (pure)
  ui/                      toolbar, status / messages panel, hints, 3D controls
tests/                     Vitest suites for the pure modules
```

To add a new board, add an entry to `components/boards.ts`; no new logic is needed.

## Architecture

```
webcam → MediaPipe HandLandmarker → smoothing → gestures (pinch / rotate / press)
                                                     ↓
                     Three.js scene (raycast picking, transforms, snapping, wires)
                                                     ↓
                          netlist → simulator (LED state) + validator (messages)
```

## Out of scope (MVP)

The MVP does not include Raspberry Pi, WebXR, sketch upload, Wi-Fi/Bluetooth, analog simulation, physical board recognition, saving, multiplayer or mobile. Phase 2 plans a trained gesture MLP behind `GestureClassifier`, Raspberry Pi as a third board, and an "ask the assistant" explainer.
