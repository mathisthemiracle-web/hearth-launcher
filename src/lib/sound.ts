/**
 * A soft campfire crackle made with Web Audio: filtered noise for the low
 * roar plus random short pops. No audio files, almost no CPU, and it stops
 * whenever the game runs or Hearth is hidden.
 */
let context: AudioContext | null = null
let master: GainNode | null = null
let roar: AudioBufferSourceNode | null = null
let popTimer: number | null = null

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i += 1) {
    // Brown-ish noise: warmer than white noise.
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last * 3.2
  }
  return buffer
}

function pop(ctx: AudioContext, out: AudioNode) {
  const length = 0.012 + Math.random() * 0.03
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1200 + Math.random() * 2600
  filter.Q.value = 0.8
  const gain = ctx.createGain()
  gain.gain.value = 0.25 + Math.random() * 0.55
  source.connect(filter).connect(gain).connect(out)
  source.start()
}

function schedulePops() {
  if (!context || !master) return
  const burst = Math.random() < 0.25 ? 3 : 1
  for (let i = 0; i < burst; i += 1) window.setTimeout(() => { if (context && master) pop(context, master) }, i * 40)
  popTimer = window.setTimeout(schedulePops, 90 + Math.random() * 700)
}

export function startCampfireSound(volume = 0.18) {
  if (context) return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  context = new Ctor()
  master = context.createGain()
  master.gain.value = 0
  master.connect(context.destination)
  master.gain.linearRampToValueAtTime(volume, context.currentTime + 1.5)
  roar = context.createBufferSource()
  roar.buffer = noiseBuffer(context, 4)
  roar.loop = true
  const low = context.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 420
  const roarGain = context.createGain()
  roarGain.gain.value = 0.35
  roar.connect(low).connect(roarGain).connect(master)
  roar.start()
  schedulePops()
}

export function stopCampfireSound() {
  if (popTimer !== null) window.clearTimeout(popTimer)
  popTimer = null
  const ctx = context
  context = null
  if (!ctx || !master) return
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4)
  window.setTimeout(() => { roar?.stop(); void ctx.close() }, 450)
  master = null
  roar = null
}
