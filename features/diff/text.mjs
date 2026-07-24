const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export function containsBidiControl(value) {
  return /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(String(value ?? ""));
}

export function exposeBidiControls(value) {
  return String(value ?? "").replace(bidiControls, (character) => (
    `\\u${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`
  ));
}
