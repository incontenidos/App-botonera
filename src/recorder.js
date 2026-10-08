// Grabación desde el micrófono con MediaRecorder.

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export function canRecord() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Empieza a grabar. Devuelve { stop(): Promise<Blob>, cancel() }. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        };
        recorder.stop();
      });
    },
    cancel() {
      recorder.onstop = release;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
