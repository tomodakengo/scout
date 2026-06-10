/**
 * Screen capture via getDisplayMedia (plan.md §1.3): the share stream is
 * established once at session start; afterwards F9 / the 📷 button grab a
 * still frame without re-prompting.
 */
export class ScreenCapture {
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null

  get active(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((t) => t.readyState === 'live')
  }

  /** Prompt the user to pick a screen/window. Must run in a user gesture. */
  async start(onEnded?: () => void): Promise<void> {
    this.stop()
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5 },
      audio: false,
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stop()
      onEnded?.()
    })
    this.stream = stream
    this.video = video
  }

  /** Grab the current frame as a PNG blob. Throws when no live stream. */
  async grabFrame(): Promise<Blob> {
    if (!this.video || !this.active) throw new Error('screen capture not active')
    const video = this.video
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.drawImage(video, 0, 0)
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    })
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
    }
    if (this.video) {
      this.video.srcObject = null
    }
    this.stream = null
    this.video = null
  }
}
