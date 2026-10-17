// assign — microphone capture worklet.
// Served same-origin from /capture-worklet.js so the production Content-Security-Policy
// (script-src 'self') allows it. (Blob URLs are blocked by that policy.)
// Resamples the input to 16 kHz mono PCM chunks for the Gemini Live API.
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.out = new Int16Array(640); this.n = 0; this.sum = 0; this.cnt = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { this.sum += ch[i] * ch[i]; this.cnt++; }
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer.slice(0), level: Math.sqrt(this.sum / Math.max(1, this.cnt)) });
        this.n = 0; this.sum = 0; this.cnt = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('assign-capture', Capture);
