// js/studio/recorder.js
export class LineRecorder {
  constructor() { this.stream = null; this.recorder = null; this.chunks = []; }

  async init() {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false, // controlamos ganancia en post
        sampleRate: 48000,
      },
    });
    return this.stream;
  }

  start() {
    if (!this.stream) throw new Error('Recorder no inicializado');
    this.chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType }));
      this.recorder.stop();
    });
  }

  get isRecording() { return this.recorder?.state === 'recording'; }
  dispose() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}
