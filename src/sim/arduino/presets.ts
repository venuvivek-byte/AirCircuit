// Ready-made sketches per board, with wiring notes. The first one (Blink) is what every board runs
// until something else is uploaded.

import type { BoardKind } from '../../components/boards';

export interface Preset {
  id: string;
  title: string;
  code: string;
}

interface Pins {
  vcc: string;
  led: string;
  ledPwm: string;
  ir: number;
  trig: number;
  echo: number;
  soundAo: string;
  soundDo: number;
  gasAo: string;
  pwm: number;
  baud: number;
  label: (n: number | string) => string;
}

const PINS: Record<BoardKind, Pins> = {
  'arduino-uno': {
    vcc: '5V', led: 'D13', ledPwm: 'D9', ir: 7, trig: 9, echo: 10, soundAo: 'A0', soundDo: 6, gasAo: 'A1', pwm: 9, baud: 9600,
    label: (n) => (typeof n === 'number' ? `D${n}` : n),
  },
  esp32: {
    vcc: '3V3', led: 'GPIO2', ledPwm: 'GPIO5', ir: 4, trig: 5, echo: 18, soundAo: '34', soundDo: 19, gasAo: '35', pwm: 5, baud: 115200,
    label: (n) => `GPIO${n}`,
  },
};

export function presets(kind: BoardKind): Preset[] {
  const p = PINS[kind];
  const L = p.label;
  return [
    {
      id: 'blink',
      title: 'Blink',
      code: `// Blink: the on-board LED (and an LED on ${p.led}) turns on and off every half second.
// Wiring (optional): ${p.led} -> 220Ω resistor -> LED anode (+), LED cathode (-) -> GND

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`,
    },
    {
      id: 'fade',
      title: 'Fade (PWM)',
      code: `// Fade: an LED on ${p.ledPwm} slowly brightens and dims with analogWrite (PWM).
// Wiring: ${p.ledPwm} -> 220Ω resistor -> LED anode (+), LED cathode (-) -> GND

const int ledPin = ${p.pwm};
int brightness = 0;
int step = 5;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  analogWrite(ledPin, brightness);
  brightness = brightness + step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}
`,
    },
    {
      id: 'ir',
      title: 'IR obstacle',
      code: `// IR obstacle sensor: put your hand in front of the sensor; the LED turns on.
// Wiring: IR VCC -> ${p.vcc}, IR GND -> GND, IR OUT -> ${L(p.ir)}
// The module's OUT goes LOW when it sees an obstacle.

const int irPin = ${p.ir};

void setup() {
  Serial.begin(${p.baud});
  pinMode(irPin, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  if (digitalRead(irPin) == LOW) {
    digitalWrite(LED_BUILTIN, HIGH);
    Serial.println("Obstacle!");
  } else {
    digitalWrite(LED_BUILTIN, LOW);
  }
  delay(100);
}
`,
    },
    {
      id: 'ultrasonic',
      title: 'Ultrasonic distance',
      code: `// HC-SR04: prints the distance to your hand; the LED turns on closer than 15 cm.
// Wiring: VCC -> ${p.vcc}, GND -> GND, TRIG -> ${L(p.trig)}, ECHO -> ${L(p.echo)}

const int trigPin = ${p.trig};
const int echoPin = ${p.echo};

void setup() {
  Serial.begin(${p.baud});
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  // 10 µs trigger pulse
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  float distance = duration * 0.034 / 2;   // cm

  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");

  digitalWrite(LED_BUILTIN, distance < 15 ? HIGH : LOW);
  delay(200);
}
`,
    },
    {
      id: 'sound',
      title: 'Sound / clap',
      code: `// KY-038 sound sensor: clap (microphone) or hold V; the LED toggles on each loud sound.
// Wiring: VCC -> ${p.vcc}, GND -> GND, AO -> ${kind === 'esp32' ? 'GPIO' : ''}${p.soundAo}, DO -> ${L(p.soundDo)}

const int soundAnalog = ${p.soundAo};
const int soundDigital = ${p.soundDo};
bool ledOn = false;

void setup() {
  Serial.begin(${p.baud});
  pinMode(soundDigital, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  int level = analogRead(soundAnalog);
  Serial.print("Sound level: ");
  Serial.println(level);

  if (digitalRead(soundDigital) == HIGH) {
    ledOn = !ledOn;
    digitalWrite(LED_BUILTIN, ledOn ? HIGH : LOW);
    Serial.println("Clap!");
    delay(300);   // ignore the echo of the same clap
  }
  delay(50);
}
`,
    },
    {
      id: 'gas',
      title: 'Gas alarm',
      code: `// MQ-2 gas sensor: hold G to leak gas; above the limit the LED flashes an alarm.
// Wiring: VCC -> ${p.vcc}, GND -> GND, AO -> ${kind === 'esp32' ? 'GPIO' : ''}${p.gasAo}

const int gasPin = ${p.gasAo};
const int limit = ${kind === 'esp32' ? 1800 : 450};

void setup() {
  Serial.begin(${p.baud});
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  int gas = analogRead(gasPin);
  Serial.print("Gas: ");
  Serial.println(gas);

  if (gas > limit) {
    Serial.println("ALARM: gas detected!");
    for (int i = 0; i < 3; i++) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(100);
      digitalWrite(LED_BUILTIN, LOW);
      delay(100);
    }
  } else {
    delay(400);
  }
}
`,
    },
  ];
}
