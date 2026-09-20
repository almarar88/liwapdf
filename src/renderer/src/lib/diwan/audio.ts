/**
 * Recording a recitation.
 *
 * The browser's own recorder is enough: Chromium in Electron and the Android
 * WebView both encode Opus in a WebM container, which both also play back.
 * Nothing is uploaded and no native code is involved; on Android the WebView
 * asks for the microphone through Capacitor, which forwards the permission
 * request to the system the first time.
 */

export interface Recorder {
  /** Stops and resolves the finished audio; empty when nothing was captured. */
  stop: () => Promise<Blob>
  /** Aborts without producing a file. */
  cancel: () => void
  readonly mimeType: string
}

export type RecordError = 'unsupported' | 'denied' | 'busy' | 'unknown'

export class RecordingError extends Error {
  constructor(public readonly reason: RecordError) {
    super(reason)
  }
}

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}

export async function startRecording(): Promise<Recorder> {
  if (!recordingSupported()) throw new RecordingError('unsupported')

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    })
  } catch (error) {
    const name = (error as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new RecordingError('denied')
    if (name === 'NotReadableError' || name === 'AbortError') throw new RecordingError('busy')
    if (name === 'NotFoundError') throw new RecordingError('unsupported')
    throw new RecordingError('unknown')
  }

  const mimeType = PREFERRED.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }
  const release = (): void => stream.getTracks().forEach((track) => track.stop())

  recorder.start(1000)

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop: () =>
      new Promise<Blob>((resolve) => {
        const finish = (): void => {
          release()
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }))
        }
        if (recorder.state === 'inactive') {
          finish()
          return
        }
        recorder.onstop = finish
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    }
  }
}

/** The extension the share sheet and the file system should give a recording. */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  return 'webm'
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
