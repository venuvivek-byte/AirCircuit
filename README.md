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

**Quickest:** show **3 fingers** (or press **L**) and pick a working template, e.g. *Blink LED* or *IR proximity light*, then press **▶ Run**.

To build it yourself:

1. Show **4 fingers** (or press **P**) to open the **Parts catalog** and add a **board** (Arduino Uno or ESP32), a **Breadboard**, a **Resistor** and an **LED**.
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
| **Parts catalog** | Show **4 fingers** with the thumb folded across the palm, hold ~0.7 s | Opens every board, part and sensor; hold the fingertip on a card to add it |
| **Saved circuits** | Show **3 fingers** (index, middle, ring) with the thumb folded, hold ~0.7 s | Opens the working templates and your saved circuits |
| **Press a button** | Hold your index fingertip on any on-screen button or card (it fills up and counts down) | Press it |
| **Grab** | Put your palm (orange ring) over a part and make a **fist** | Grab the part |
| **Move** | Keep the fist and move your hand | Carry the grabbed part |
| **Rotate** | Keep the fist and roll your wrist (tilt the palm to pitch). Or grip with **both** hands and twist | Rotate the part |
| **Release** | Open your hand | Drop the part. Parts dropped near the breadboard snap into its holes |
| **Wire** | **Pinch** (thumb + index) on a pin, drag until the yellow ring sits on another pin, release | Create a jumper wire |
| **Loose end** | Release a wire away from any pin; pinch its round tip later to carry on | The end stays in the air |
| **Unplug** | Pinch a wire and hold still for **2 s** | Its nearest end comes off into your hand |
| **Cut** | Make a ✌ V sign, aim the red cross-hair at a wire (it turns red), spread then close the two fingers | Delete that wire |
| **Enlarge** | While holding a part with a fist, push toward / pull back from the camera | That part grows / shrinks to inspect it (normal size again when dropped) |
| **Zoom** | Press **Z** or hold the fingertip on 🔍 | Zoom the whole view in / out |
| **Press** | Point your index fingertip at a 3D button and push it toward the screen, or pinch on it | Run / Stop / Reset |
| **Delete** | Drop a part (fist) or a wire (pinch it) on the red **trash** box (bottom-left) | Remove it |

The thumb has to be folded for the menu poses, so a relaxed open hand never opens a menu. Showing the same pose again (or the ✕) closes it; the scene is paused while a menu is open.

**Focus mode:** the 🌓 **Focus** button in the dock (or **B**) swaps the camera image for a black backdrop, so only the parts, wires and your hand skeleton are visible. Tracking keeps running; press it again to get the camera view back. The choice is remembered.

Other tips:
- Move the breadboard by pinching its **"grab here"** tab, since its holes start wires. Parts plugged into the breadboard move with it.
- Your hand is drawn as a skeleton: joints turn **green** while you pinch and **orange** while you make a fist. The orange ring is the palm point a fist grabs with; the white dot between thumb and index is the pinch point used for wiring.
- The bottom bar always shows a hint for what you can do next.
- Tracking works best with your hand about 50 cm from the camera, in even light, against a plain background.

## Programming the boards

Press **C** (or the **</> Code** toolbar button) to open the code panel.

1. Pick the board (each Arduino Uno / ESP32 in the scene has its own sketch).
2. Write Arduino code, or load an example: Blink, Fade (PWM), IR obstacle, Ultrasonic distance, Sound / clap, Gas alarm. Each example starts with its wiring as a comment.
3. Press **⬆ Upload** (or Ctrl+Enter). The sketch is compiled; errors show with their line number (click one to jump there). Then the board is "flashed" and reboots running it.
4. `Serial.print` output appears in the **Serial Monitor**.

Every board runs Blink until you upload something. Run powers the boards (as if on USB) and Stop powers them off.

Supported: `setup` / `loop`, `int long float double bool char byte String` and `unsigned` variants, arrays (1D / 2D), functions, `if for while do switch`, `#define` constants, casts, `static` locals; `pinMode digitalWrite digitalRead analogRead analogWrite delay delayMicroseconds millis micros pulseIn map constrain min max abs pow sqrt random` and the rest of the Arduino maths functions; `Serial.begin print println printf`; ESP32 `ledcSetup / ledcAttachPin / ledcAttach / ledcWrite` and `analogReadResolution`; the **NewPing** library. Integer division truncates like C.

Not supported (the compiler says so): pointers, references, classes / structs, char arrays (use `String`), function-like macros, and other libraries (Wi-Fi / Bluetooth are not simulated). Runtime mistakes such as an array index out of range or a division by zero stop the board with a message in the Serial Monitor.

| Board | Logic | `analogRead` | PWM | `LED_BUILTIN` |
|---|---|---|---|---|
| Arduino Uno | 5 V | A0-A5, 0-1023 | 3 5 6 9 10 11 | 13 |
| ESP32 DevKit | 3.3 V | GPIO 34 / 35 (and others), 0-4095 | any output pin | 2 |

## Sensors

Each module plugs into the breadboard or wires straight to a board. It needs **VCC** to 5V / 3V3 and **GND** to GND (its red LED shows power; the green LED shows detection). The **Sensors** panel shows live readings.

| Sensor | Pins | Senses | Read with |
|---|---|---|---|
| IR obstacle (FC-51) | VCC GND OUT | Your hand close in front of it (OUT goes LOW) | `digitalRead` |
| Ultrasonic (HC-SR04) | VCC TRIG ECHO GND | Distance to your hand in front of it | `pulseIn(echo, HIGH)` (cm = µs / 58) or NewPing |
| Sound (KY-038) | AO GND VCC DO | Your microphone (🎤 button), the slider, or hold **V** | `analogRead(AO)`, `digitalRead(DO)` |
| Gas (MQ-2) | VCC GND DO AO | The slider, or hold **G** to leak gas | `analogRead(AO)`, `digitalRead(DO)` (LOW = gas) |

Sensors face you: bring your hand (or the mouse in mouse mode) toward the front of the module.

## Mouse mode (no camera needed)

Press **M** to switch between hands and mouse. The app also switches to mouse mode by itself if the camera is unavailable.

| Input | Action |
|---|---|
| Left-drag a part | Move it (drops snap into the breadboard) |
| Left-drag from a pin to a pin | Create a wire |
| Wheel / **R** (Shift+R reverses) | Rotate the hovered or held part |
| **Delete** / Backspace | Delete the hovered wire or part |
| Click a 3D button, or **Enter** / **Space** / **N** | Run / Stop / Reset |
| **P** / **L** / **S** | Parts catalog / Saved circuits / Save as… (**Esc** closes a menu) |
| **C** / **Z** / **B** | Code panel / zoom / focus mode |

Hover any pin to see its name.

## Saved circuits and templates

**Saved circuits** (3 fingers or **L**) has six working templates, all on an Arduino Uno with the parts already plugged into the breadboard and the matching sketch loaded:

| Template | Try it |
|---|---|
| Blink LED | Run: the LED blinks |
| Fading LED (PWM) | Run: the LED on D9 breathes |
| IR proximity light | Run, then bring your hand in front of the IR sensor |
| Parking sensor | Run, move your hand toward the HC-SR04; closer than 15 cm lights the LED (distance in the Serial Monitor) |
| Clap switch | Run, then clap (enable the mic) or hold **V** |
| Gas leak alarm | Run, then hold **G** |

**Saving:** the 💾 Save button (or **S**) asks for a file name. **Reset** and opening another circuit ask *"Save before…?"* first if the circuit changed, with **Save** / **Don't save** / **Cancel**; the name is pre-filled, so in hand mode you can just dwell on Save. Saves keep the parts, their positions, the wires (loose ends too) and each board's uploaded sketch, and are stored in the browser's localStorage. A browser can't show a page's own dialog while the tab closes, so closing the tab autosaves to **"Last session (autosave)"** instead.

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
  components/              generic board (driven by boards.ts data), breadboard, LED, resistor, wire, sensor modules
  components/boards.ts     Arduino Uno + ESP32 pin maps, logic levels, blink pins
  components/sensors.ts    sensor module pins and behaviour (pure data)
  sim/netlist.ts           union-find netlist (pure)
  sim/arduino/compiler.ts  Arduino-C subset -> JS generator compiler (pure)
  sim/arduino/runtime.ts   runs a sketch on a virtual board: Arduino API, virtual time, Serial (pure)
  sim/electrical.ts        pin / net voltages, LED brightness, sensor outputs (pure)
  sim/machine.ts           runs every board's program against the circuit (pure)
  sim/validator.ts         rule-based circuit checker (pure)
  scene/sensing.ts         hand / mouse / microphone -> what each sensor senses
  scene/circuits.ts        save / load circuits (localStorage) + the working templates
  ui/                      dock, status / messages / sensors panels, code panel, hints, 3D controls
  ui/menus.ts              parts catalog, saved circuits, save dialog
tests/                     Vitest suites for the pure modules
```

To add a new board, add an entry to `components/boards.ts`; no new logic is needed.

## Architecture

```
webcam → MediaPipe HandLandmarker → smoothing → gestures (pinch / rotate / press)
                                                     ↓
                     Three.js scene (raycast picking, transforms, snapping, wires)
                                                     ↓
                netlist → machine (compiled sketches + electrical model) → LEDs, sensors, Serial
                        └→ validator (messages)
```

## Out of scope (MVP)

Not included: Raspberry Pi, WebXR, uploading to real hardware, Wi-Fi/Bluetooth, full analog (current / voltage-divider) simulation, battery / USB power modelling, physical board recognition, saving, multiplayer or mobile. Phase 2 plans a trained gesture MLP behind `GestureClassifier`, Raspberry Pi as a third board, and an "ask the assistant" explainer.
