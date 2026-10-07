// Runs on the audio rendering thread. Captures mic input at whatever
// sample rate the browser's AudioContext uses (usually 44.1kHz/48kHz),
// downsamples it to 16kHz, converts to 16-bit PCM, and posts chunks
// back to the main thread for sending to Gemini Live.

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SIZE = 2048; // input samples accumulated before each downsample+post

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputSampleRate = sampleRate; // global in AudioWorkletGlobalScope
    this.buffer = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      const merged = new Float32Array(this.buffer.length + channel.length);
      merged.set(this.buffer, 0);
      merged.set(channel, this.buffer.length);
      this.buffer = merged;

      while (this.buffer.length >= CHUNK_SIZE) {
        const chunk = this.buffer.slice(0, CHUNK_SIZE);
        this.buffer = this.buffer.slice(CHUNK_SIZE);
        const downsampled = downsample(chunk, this.inputSampleRate, TARGET_SAMPLE_RATE);
        const pcm16 = floatTo16BitPCM(downsampled);
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      }
    }
    return true;
  }
}

function downsample(buffer, inputRate, outputRate) {
  if (outputRate === inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

registerProcessor("mic-processor", MicProcessor);
