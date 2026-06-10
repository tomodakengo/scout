/**
 * AnnotationModal — screenshot annotation modal used right after capture.
 * Tools: rectangle outline, arrow, mosaic/pixelate, text label.
 * Undo, color picker, keyboard shortcuts (Escape/Ctrl+Z/Enter).
 * Exports annotated image as PNG via canvas.toBlob.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnotationModalProps {
  /** captured screenshot */
  image: Blob
  /** user clicked save: blob is the annotated PNG */
  onSave: (annotated: Blob) => void
  /** user skipped annotation / closed */
  onCancel: () => void
  lang: 'ja' | 'en'
}

type Tool = 'rect' | 'arrow' | 'mosaic' | 'text'
type Color = string // hex

interface Point {
  x: number // image-space coordinates
  y: number
}

interface ShapeRect {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  color: Color
  lineWidth: number
}

interface ShapeArrow {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: Color
  lineWidth: number
}

interface ShapeMosaic {
  kind: 'mosaic'
  x: number
  y: number
  w: number
  h: number
}

interface ShapeText {
  kind: 'text'
  x: number
  y: number
  text: string
  color: Color
  fontSize: number
}

type Shape = ShapeRect | ShapeArrow | ShapeMosaic | ShapeText

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const DICT = {
  ja: {
    toolRect: '矩形',
    toolArrow: '矢印',
    toolMosaic: 'モザイク',
    toolText: 'テキスト',
    colorLabel: '色',
    save: '保存',
    cancel: 'キャンセル',
    undo: '元に戻す',
    textPlaceholder: 'テキストを入力…',
  },
  en: {
    toolRect: 'Rect',
    toolArrow: 'Arrow',
    toolMosaic: 'Mosaic',
    toolText: 'Text',
    colorLabel: 'Color',
    save: 'Save',
    cancel: 'Cancel',
    undo: 'Undo',
    textPlaceholder: 'Type text…',
  },
} as const

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

const MOSAIC_CELL = 12 // px — coarseness for pixelation

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color,
  lineWidth: number,
): void {
  const headLen = Math.max(lineWidth * 4, 14)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  // arrowhead
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawMosaic(
  ctx: CanvasRenderingContext2D,
  baseImg: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (w === 0 || h === 0) return
  // Normalize to positive width/height
  const rx = w < 0 ? x + w : x
  const ry = h < 0 ? y + h : y
  const rw = Math.abs(w)
  const rh = Math.abs(h)
  if (rw < 1 || rh < 1) return

  // Offscreen canvas to sample the base image
  const offscreen = document.createElement('canvas')
  offscreen.width = baseImg.naturalWidth
  offscreen.height = baseImg.naturalHeight
  const offCtx = offscreen.getContext('2d')!
  offCtx.drawImage(baseImg, 0, 0)

  // Sample at cell centers, fill averaged-color cells
  for (let cy = ry; cy < ry + rh; cy += MOSAIC_CELL) {
    for (let cx = rx; cx < rx + rw; cx += MOSAIC_CELL) {
      const cellW = Math.min(MOSAIC_CELL, rx + rw - cx)
      const cellH = Math.min(MOSAIC_CELL, ry + rh - cy)
      const sampleX = Math.round(cx + cellW / 2)
      const sampleY = Math.round(cy + cellH / 2)
      const px = offCtx.getImageData(sampleX, sampleY, 1, 1).data
      ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`
      ctx.fillRect(cx, cy, cellW, cellH)
    }
  }
}

function renderAllShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  baseImg: HTMLImageElement,
): void {
  for (const s of shapes) {
    switch (s.kind) {
      case 'rect':
        ctx.save()
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.lineWidth
        ctx.strokeRect(s.x, s.y, s.w, s.h)
        ctx.restore()
        break
      case 'arrow':
        drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.color, s.lineWidth)
        break
      case 'mosaic':
        drawMosaic(ctx, baseImg, s.x, s.y, s.w, s.h)
        break
      case 'text':
        ctx.save()
        ctx.fillStyle = s.color
        ctx.font = `${s.fontSize}px sans-serif`
        ctx.fillText(s.text, s.x, s.y)
        ctx.restore()
        break
    }
  }
}

// ---------------------------------------------------------------------------
// Inline text editor state
// ---------------------------------------------------------------------------

interface PendingText {
  x: number // display-space for placement
  y: number
  imgX: number // image-space for shape storage
  imgY: number
  value: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PALETTE: Color[] = ['#e5484d', '#f5c800', '#0091ff']
const LINE_WIDTH = 3
const TEXT_FONT_SIZE = 18

export function AnnotationModal({
  image,
  onSave,
  onCancel,
  lang,
}: AnnotationModalProps): JSX.Element {
  const t = DICT[lang]

  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState<Color>(PALETTE[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [pendingText, setPendingText] = useState<PendingText | null>(null)

  // Preview of shape being drawn (before mouse-up commits it)
  const [previewShape, setPreviewShape] = useState<Shape | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null) // for preview only
  const baseImgRef = useRef<HTMLImageElement | null>(null)
  const imgUrlRef = useRef<string>('')

  // Natural image size
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  // Display size (scaled to fit viewport)
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null)

  // Drag state
  const dragStartRef = useRef<Point | null>(null)
  const isDraggingRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Load image
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const url = URL.createObjectURL(image)
    imgUrlRef.current = url
    const img = new Image()
    img.onload = () => {
      baseImgRef.current = img
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = url
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [image])

  // ---------------------------------------------------------------------------
  // Compute display size
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!imgSize) return
    const maxW = Math.round(window.innerWidth * 0.8)
    const maxH = Math.round(window.innerHeight * 0.7)
    const scale = Math.min(1, maxW / imgSize.w, maxH / imgSize.h)
    setDisplaySize({
      w: Math.round(imgSize.w * scale),
      h: Math.round(imgSize.h * scale),
    })
  }, [imgSize])

  // ---------------------------------------------------------------------------
  // Redraw base canvas when shapes change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    const baseImg = baseImgRef.current
    if (!canvas || !baseImg || !imgSize) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, imgSize.w, imgSize.h)
    ctx.drawImage(baseImg, 0, 0)
    renderAllShapes(ctx, shapes, baseImg)
  }, [shapes, imgSize])

  // ---------------------------------------------------------------------------
  // Redraw overlay (preview) canvas when previewShape changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = overlayCanvasRef.current
    const baseImg = baseImgRef.current
    if (!canvas || !imgSize) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, imgSize.w, imgSize.h)
    if (previewShape && baseImg) {
      renderAllShapes(ctx, [previewShape], baseImg)
    }
  }, [previewShape, imgSize])

  // ---------------------------------------------------------------------------
  // Coordinate mapping (display → image space)
  // ---------------------------------------------------------------------------

  const toImgCoords = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = overlayCanvasRef.current
      if (!canvas || !imgSize || !displaySize) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const relX = clientX - rect.left
      const relY = clientY - rect.top
      const scaleX = imgSize.w / displaySize.w
      const scaleY = imgSize.h / displaySize.h
      return {
        x: Math.round(relX * scaleX),
        y: Math.round(relY * scaleY),
      }
    },
    [imgSize, displaySize],
  )

  // ---------------------------------------------------------------------------
  // Mouse events
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === 'text') {
        // Text tool: place inline input
        const imgPt = toImgCoords(e.clientX, e.clientY)
        const canvas = overlayCanvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        setPendingText({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          imgX: imgPt.x,
          imgY: imgPt.y,
          value: '',
        })
        return
      }
      isDraggingRef.current = true
      dragStartRef.current = toImgCoords(e.clientX, e.clientY)
    },
    [tool, toImgCoords],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDraggingRef.current || !dragStartRef.current) return
      if (tool === 'text') return
      const start = dragStartRef.current
      const cur = toImgCoords(e.clientX, e.clientY)
      const dx = cur.x - start.x
      const dy = cur.y - start.y

      let preview: Shape | null = null
      if (tool === 'rect') {
        preview = {
          kind: 'rect',
          x: start.x,
          y: start.y,
          w: dx,
          h: dy,
          color,
          lineWidth: LINE_WIDTH,
        }
      } else if (tool === 'arrow') {
        preview = {
          kind: 'arrow',
          x1: start.x,
          y1: start.y,
          x2: cur.x,
          y2: cur.y,
          color,
          lineWidth: LINE_WIDTH,
        }
      } else if (tool === 'mosaic') {
        preview = {
          kind: 'mosaic',
          x: start.x,
          y: start.y,
          w: dx,
          h: dy,
        }
      }
      setPreviewShape(preview)
    },
    [tool, color, toImgCoords],
  )

  const commitDrag = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDraggingRef.current || !dragStartRef.current) return
      isDraggingRef.current = false
      const start = dragStartRef.current
      dragStartRef.current = null
      const cur = toImgCoords(e.clientX, e.clientY)
      const dx = cur.x - start.x
      const dy = cur.y - start.y
      setPreviewShape(null)

      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return // ignore tiny drags

      let shape: Shape | null = null
      if (tool === 'rect') {
        shape = {
          kind: 'rect',
          x: start.x,
          y: start.y,
          w: dx,
          h: dy,
          color,
          lineWidth: LINE_WIDTH,
        }
      } else if (tool === 'arrow') {
        shape = {
          kind: 'arrow',
          x1: start.x,
          y1: start.y,
          x2: cur.x,
          y2: cur.y,
          color,
          lineWidth: LINE_WIDTH,
        }
      } else if (tool === 'mosaic') {
        shape = {
          kind: 'mosaic',
          x: start.x,
          y: start.y,
          w: dx,
          h: dy,
        }
      }
      if (shape) setShapes((prev) => [...prev, shape as Shape])
    },
    [tool, color, toImgCoords],
  )

  // ---------------------------------------------------------------------------
  // Text commit
  // ---------------------------------------------------------------------------

  const commitText = useCallback(() => {
    if (!pendingText || pendingText.value.trim() === '') {
      setPendingText(null)
      return
    }
    const shape: ShapeText = {
      kind: 'text',
      x: pendingText.imgX,
      y: pendingText.imgY + TEXT_FONT_SIZE, // baseline offset
      text: pendingText.value,
      color,
      fontSize: TEXT_FONT_SIZE,
    }
    setShapes((prev) => [...prev, shape])
    setPendingText(null)
  }, [pendingText, color])

  // ---------------------------------------------------------------------------
  // Save / Export
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(
      (blob) => {
        if (blob) onSave(blob)
      },
      'image/png',
    )
  }, [onSave])

  // ---------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1))
  }, [])

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingText !== null) {
        // When inline text input is active, only handle Escape to cancel
        if (e.key === 'Escape') {
          e.preventDefault()
          setPendingText(null)
        }
        // All other keys handled by the text <input> element
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, handleSave, handleUndo, pendingText])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!imgSize || !displaySize) {
    return (
      <div style={styles.backdrop}>
        <div style={styles.loadingBox} />
      </div>
    )
  }

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: displaySize.w,
    height: displaySize.h,
  }

  return (
    <div style={styles.backdrop}>
      <style>{componentCSS}</style>
      <div style={styles.modal}>
        {/* Toolbar */}
        <div style={styles.toolbar}>
          {/* Tool buttons */}
          <div style={styles.toolGroup}>
            {(
              [
                ['rect', t.toolRect],
                ['arrow', t.toolArrow],
                ['mosaic', t.toolMosaic],
                ['text', t.toolText],
              ] as [Tool, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTool(id)}
                style={{
                  ...styles.toolBtn,
                  ...(tool === id ? styles.toolBtnActive : {}),
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Color picker */}
          <div style={styles.toolGroup}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  ...styles.colorDot,
                  backgroundColor: c,
                  outline: color === c ? `2px solid #fff` : '2px solid transparent',
                }}
                aria-label={c}
              />
            ))}
          </div>

          <div style={styles.spacer} />

          {/* Undo */}
          <button onClick={handleUndo} style={styles.actionBtn} disabled={shapes.length === 0}>
            {t.undo}
          </button>

          {/* Cancel / Save */}
          <button onClick={onCancel} style={styles.actionBtn}>
            {t.cancel}
          </button>
          <button onClick={handleSave} style={{ ...styles.actionBtn, ...styles.saveBtn }}>
            {t.save}
          </button>
        </div>

        {/* Canvas area */}
        <div
          style={{
            position: 'relative',
            width: displaySize.w,
            height: displaySize.h,
            flexShrink: 0,
          }}
        >
          {/* Base canvas: holds image + committed shapes at natural resolution, CSS-scaled */}
          <canvas
            ref={canvasRef}
            width={imgSize.w}
            height={imgSize.h}
            style={{ ...canvasStyle, imageRendering: 'auto' }}
          />
          {/* Overlay canvas: interactive layer + preview, also at natural resolution */}
          <canvas
            ref={overlayCanvasRef}
            width={imgSize.w}
            height={imgSize.h}
            style={{ ...canvasStyle, cursor: tool === 'text' ? 'text' : 'crosshair' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={commitDrag}
            onMouseLeave={commitDrag}
          />

          {/* Inline text input */}
          {pendingText !== null && (
            <input
              autoFocus
              value={pendingText.value}
              placeholder={t.textPlaceholder}
              onChange={(e) =>
                setPendingText((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitText()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setPendingText(null)
                }
              }}
              style={{
                position: 'absolute',
                left: pendingText.x,
                top: pendingText.y,
                background: 'rgba(0,0,0,0.75)',
                color,
                border: `1px solid ${color}`,
                outline: 'none',
                fontSize: 14,
                padding: '2px 6px',
                borderRadius: 3,
                minWidth: 120,
                zIndex: 10,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1c1c1e',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxShadow: '0 8px 40px rgba(0,0,0,.8)',
    maxWidth: '90vw',
    maxHeight: '95vh',
    overflow: 'auto',
  },
  toolbar: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  toolGroup: {
    display: 'flex',
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  toolBtn: {
    padding: '4px 10px',
    background: '#2c2c2e',
    color: '#ebebf5cc',
    border: '1px solid #3a3a3c',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 13,
  },
  toolBtnActive: {
    background: '#0a84ff',
    color: '#fff',
    border: '1px solid #0a84ff',
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  spacer: {
    flex: 1,
  },
  actionBtn: {
    padding: '4px 12px',
    background: '#2c2c2e',
    color: '#ebebf5cc',
    border: '1px solid #3a3a3c',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 13,
  },
  saveBtn: {
    background: '#30d158',
    color: '#000',
    border: '1px solid #30d158',
    fontWeight: 600,
  },
  loadingBox: {
    width: 200,
    height: 120,
    background: '#1c1c1e',
    borderRadius: 10,
  },
}

const componentCSS = `
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
`
