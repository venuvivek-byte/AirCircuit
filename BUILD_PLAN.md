# Build Plan: Gesture-Driven AR Electronics Simulator

Companion to `MVP_SPEC.md`. Follow in order. Do not start a step until the previous step's "Check" passes.

## 0. Prerequisites (30 min)

1. Install Node.js LTS and Git. Verify: `node -v`, `git --version`.
2. Install Chrome (hardware acceleration on).
3. Test your webcam works in Chrome (e.g. open any camera test page).
4. Create the project folder and put `MVP_SPEC.md` inside it.
5. `git init` and make a first commit.
6. Open the folder in Claude Code.

**First prompt to Claude Code:**
> Read MVP_SPEC.md fully. Summarize the goal, stack, and milestones in 10 lines so I can confirm you understood. Do not write code yet.

## 1. Setup + Camera + Overlay (Day 1)

**Tasks:** Vite + TypeScript project, `config.ts`, mirrored webcam background, transparent Three.js canvas, FPS counter, rotating test cube.

**Prompt:**
> Build milestone 1 from MVP_SPEC.md only. Create the project structure from section 5. Show webcam fullscreen (mirrored), overlay a transparent Three.js canvas with a test cube, and an FPS counter. Run it and tell me how to start it. Stop after this.

**Check:** `npm run dev` opens, camera feed shows, cube renders over video, FPS visible.
**Commit:** `milestone 1: webcam + three overlay`

## 2. Hand Tracking (Day 1-2)

**Tasks:** MediaPipe HandLandmarker (lite model), smoothing, fingertip cursor sphere, hand count in status, `trackingEveryNFrames` fallback.

**Prompt:**
> Build milestone 2. Integrate MediaPipe HandLandmarker, smooth landmarks with EMA, draw a 3D cursor sphere at the index fingertip, show hand count and tracking mode in a status panel. Implement the performance fallback from section 3.1.

**Check:** cursor follows your fingertip smoothly with low jitter; works with 1 and 2 hands; FPS >= 24.
**Commit:** `milestone 2: hand tracking`

## 3. Components + Mouse Mode (Day 2-3)

**Tasks:** `boards.ts` data (Arduino Uno, ESP32), generic `board.ts`, breadboard with hole grid and rails, LED, resistor, labeled pins, spawn buttons, mouse drag fallback (key `M`).

**Prompt:**
> Build milestone 3. Define Arduino Uno and ESP32 in boards.ts (pin names, logic level, blinkPin, ground/power pins). Create one generic Board class driven by that data. Add breadboard, LED, resistor, all from Three.js primitives with pin positions. Add a toolbar to spawn each, and a mouse mode (press M) to drag objects. Show pin labels on hover.

**Check:** all five components spawn, pins are visible and labeled, mouse mode can move them.
**Commit:** `milestone 3: components`

## 4. Gestures: Grab, Move, Rotate (Day 3-5)

**Tasks:** pure functions in `tracking/gestures.ts` (pinch with hysteresis, hand-size normalization, wrist roll), raycast picking from fingertip, move and rotate grabbed object.

**Prompt:**
> Build milestone 4. Implement pinch detection with hysteresis (thresholds in config.ts), grab the object under the fingertip via raycast, move it with the hand, rotate it using wrist roll and palm tilt. Keep gesture logic pure and add Vitest tests with fake landmark arrays.

**Check:** pick up, move, rotate, and drop any component by hand. No flicker when holding a pinch.
**Commit:** `milestone 4: gestures`

**Expect to spend the most time here.** Tune thresholds and smoothing in `config.ts` before changing logic.

## 5. Snapping + Wire Tool (Day 5-6)

**Tasks:** snap components to breadboard holes on release, pin-to-pin wire creation (pinch pin A, drag, release on pin B), wire rendering as tube, delete wire.

**Prompt:**
> Build milestone 5. On release near the breadboard, snap component legs to the nearest holes. Add the wire tool: pinch on a pin, drag, release on another pin to create a tube-shaped wire. Add a way to delete a wire (pinch on it and drop it outside the scene, or press Delete in mouse mode).

**Check:** LED and resistor snap into the breadboard; wires connect any two pins.
**Commit:** `milestone 5: snapping + wires`

## 6. Netlist + Simulation (Day 6-7)

**Tasks:** `sim/netlist.ts` (merge breadboard column groups and wire connections), `sim/simulator.ts` (blink on `blinkPin`, LED on/off with polarity), LED glow, unit tests for both boards.

**Prompt:**
> Build milestone 6. Implement netlist building (union-find over connected pins, breadboard columns of 5 merged, wires merge nodes) and a simulator that toggles the board's blinkPin every 500 ms while running. LED is ON only if blinkPin HIGH, path through resistor to anode, cathode to the same board's GND, correct polarity. Add LED glow. Write Vitest tests for Arduino and ESP32 circuits, including reversed LED and missing GND.

**Check:** `npm test` passes; wiring the golden path makes the LED blink.
**Commit:** `milestone 6: simulation`

## 7. Validator + Run Controls (Day 7-8)

**Tasks:** `sim/validator.ts` with all rules from section 3.6 (including ESP32 voltage rules), messages panel, Run / Stop / Reset virtual buttons pressed by fingertip.

**Prompt:**
> Build milestone 7. Implement every validator rule in section 3.6, show messages in the right panel, update live when wiring changes. Add 3D Run/Stop/Reset buttons that trigger on a fingertip press (z-threshold), plus keyboard shortcuts for mouse mode. Add Vitest tests for each rule.

**Check:** each wrong-wiring case from the Definition of Done shows the right message.
**Commit:** `milestone 7: validator + controls`

## 8. Polish + README (Day 8-9)

**Tasks:** onboarding hint text (how to pinch, rotate, wire), tune config, handle camera permission denied and no-hand states, README, record a demo.

**Prompt:**
> Build milestone 8. Add onboarding hints, graceful states for camera denied / no hand detected, tune config defaults, and write a README with setup and gesture guide. Then run through the Definition of Done checklist in section 8 and report each item as pass/fail.

**Check:** every box in section 8 ticked.
**Commit:** `milestone 8: polish`

## 9. Testing Checklist (before submission)

- Golden path with Arduino, then with ESP32, using hands only.
- Each error case: reversed LED, no resistor, no GND, 5V to GND, 5V to ESP32 GPIO.
- Test in different lighting and with a plain background.
- Test on battery and plugged in; check FPS.
- Test mouse fallback (in case the camera fails during the demo).

## 10. Demo + Report Plan

1. Record a 2-minute screen capture of the golden path on both boards plus one error case.
2. Screenshot the architecture (CV pipeline -> gesture layer -> scene -> simulator -> validator).
3. Report sections: problem, related work, architecture, CV method (landmarks, pinch, smoothing), CG method (scene graph, raycasting, transforms, rendering), AI method (validator now, classifier in Phase 2), results (FPS, gesture accuracy), limitations, future work (Raspberry Pi, trained gesture model, assistant box).

## 11. Phase 2 (only after MVP is done)

1. Collect labeled landmark data (pinch, point, fist, open palm) and train a small MLP; swap in behind `GestureClassifier`.
2. Add Raspberry Pi as a third board (data in `boards.ts`).
3. Add an "ask the assistant" box that explains validator messages.

## Working Rules with Claude Code

- One milestone per session; commit before starting the next.
- If something breaks, paste the exact error and ask for the root cause before any fix.
- If gestures feel bad, change `config.ts` values first.
- Never let it add Out of Scope features.
- After each milestone ask: "Run the tests and the app, then list what is still not working."
