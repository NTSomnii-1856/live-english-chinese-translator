// Audio stays in memory. The only destination is this application's authenticated PC.
export function createAudioUtterances({ onAudio, previewSeconds = 0.9, updateSeconds = 0.8, silenceSeconds = 0.55, maxSeconds = 5.8, threshold = 0.006 }) {
  let active = null, lead = [], serial = 0;
  function send(final) {
    if (!active) return;
    const samples = new Float32Array(Math.max(3200, active.length)); let offset = 0;
    for (const frame of active.frames) { samples.set(frame, offset); offset += frame.length; }
    onAudio({ id: String(active.id), samples, final });
    active.sentAt = active.length;
    if (final) active = null;
  }
  return {
    push(samples) {
      if (!samples.length) return;
      let energy = 0; for (const value of samples) energy += value * value;
      const voiced = Math.sqrt(energy / samples.length) >= threshold;
      if (!active) {
        lead.push(samples); while (lead.length > 3) lead.shift();
        if (!voiced) return;
        active = { id: ++serial, frames: lead, length: lead.reduce((n, x) => n + x.length, 0), silence: 0, sentAt: 0 };
        lead = [];
      } else { active.frames.push(samples); active.length += samples.length; }
      active.silence = voiced ? 0 : active.silence + samples.length;
      if (active.silence >= silenceSeconds * 16000 || active.length >= maxSeconds * 16000) { send(true); return; }
      if (active.length >= previewSeconds * 16000 && active.length - active.sentAt >= updateSeconds * 16000) send(false);
    },
    flush() { send(true); lead = []; },
    clear() { active = null; lead = []; },
  };
}

function encodePCM(samples) {
  const bytes = new ArrayBuffer(samples.length * 2), view = new DataView(bytes);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return bytes;
}

export async function startLocalSpeech({ headers, onTranscript, onPolished = () => {}, onError, onActivity = () => {} }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  let context, source, node, gain, stopTimer, stopped = false, disposed = false, sending = false, controller = null, flushing = false, released = false;
  const pending = new Map();
  const refinements = new Map(), corrected = new Set();
  const polishes = new Map(), confirmed = new Map();
  let polishing = false, polishController = null, polishTimer = null, refinementTimer = null;
  async function polish() {
    if (polishing || disposed || !polishes.size) return;
    polishing = true;
    const [id, text] = polishes.entries().next().value; polishes.delete(id);
    const activeController = polishController = new AbortController();
    const timer = polishTimer = setTimeout(() => activeController.abort(), 20000);
    try {
      const context = [...confirmed].filter(([key]) => Number(key) < Number(id)).slice(-2).map(([,value]) => value).join(' ');
      const response = await fetch('/polish', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context }), signal: activeController.signal });
      if (!response.ok) return;
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', chinese = '';
      const accept = line => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'error') throw Error('Translation check unavailable.');
        if (event.type === 'done' && typeof event.text === 'string') chinese = event.text.trim();
      };
      while (true) {
        const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done });
        let at; while ((at = buffer.indexOf('\n')) !== -1) { accept(buffer.slice(0,at)); buffer = buffer.slice(at+1); }
        if (part.done) break;
      }
      if (buffer) accept(buffer);
      if (!disposed && chinese) onPolished(id, text, chinese);
    } catch { /* Keep the acoustic correction and quick translation if the check is unavailable. */ }
    finally { clearTimeout(timer); polishTimer = null; polishing = false; polishController = null; polish(); }
  }
  let refining = false, refinementController = null;
  async function refine() {
    if (refining || disposed || !refinements.size) return;
    refining = true;
    const [id, samples] = refinements.entries().next().value; refinements.delete(id);
    const activeController = refinementController = new AbortController();
    const timer = refinementTimer = setTimeout(() => activeController.abort(), 20000);
    try {
      const response = await fetch('/refine', { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/pcm;rate=16000' }, body: encodePCM(samples), signal: activeController.signal });
      if (!response.ok) return;
      const result = await response.json();
      if (!disposed && typeof result.text === 'string' && result.text.trim()) {
        corrected.add(id); onTranscript(id, result.text, true, { quality: 'accurate' });
        confirmed.set(id, result.text); while (confirmed.size > 4) confirmed.delete(confirmed.keys().next().value);
        polishes.set(id, result.text); while (polishes.size > 2) polishes.delete(polishes.keys().next().value);
        polish();
      }
    } catch { /* Corrections are best effort; the live microphone keeps running. */ }
    finally { clearTimeout(timer); refinementTimer = null; refining = false; refinementController = null; refine(); }
  }
  async function pump() {
    if (sending || disposed || !pending.size) return;
    sending = true;
    const [id, request] = pending.entries().next().value; pending.delete(id);
    controller = new AbortController();
    try {
      const body = encodePCM(request.samples);
      let res;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (disposed) return;
        res = await fetch('/recognize', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'audio/pcm;rate=16000' }, body, signal: controller.signal,
        });
        if (res.status !== 409 || attempt === 3) break;
        await res.arrayBuffer();
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
      const data = await res.json();
      if (!res.ok) throw Error(data.error || 'Speech recognition failed.');
      if (!disposed && !corrected.has(id)) onTranscript(id, data.text, request.final, { quality: 'fast' });
      if (!disposed && request.final) {
        refinements.set(id, request.samples);
        // Retain only recent pending corrections, without accumulating recordings.
        while (refinements.size > 2) refinements.delete(refinements.keys().next().value);
        refine();
      }
    } catch (error) { if (!disposed && error.name !== 'AbortError') { cancel(); onError(error); } }
    finally { sending = false; controller = null; pump(); }
  }
  const utterances = createAudioUtterances({ onAudio(request) {
    if (disposed) return;
    // Replace older pending audio for this utterance; never queue every interim snapshot.
    pending.set(request.id, request);
    if (pending.size > 6) { cancel(); onError(Error('The PC cannot keep up with speech. Try fewer simultaneous devices.')); return; }
    pump();
  } });
  function releaseMicrophone() {
    if (released) return; released = true;
    stream.getTracks().forEach(track => track.stop());
    source?.disconnect(); node?.disconnect(); gain?.disconnect();
    context?.close().catch(() => {});
  }
  function cancel() { disposed = true; stopped = true; flushing = false; clearTimeout(stopTimer); clearTimeout(refinementTimer); clearTimeout(polishTimer); pending.clear(); refinements.clear(); polishes.clear(); confirmed.clear(); corrected.clear(); utterances.clear(); controller?.abort(); refinementController?.abort(); polishController?.abort(); releaseMicrophone(); }
  function finishStop() { if (!flushing) return; flushing = false; clearTimeout(stopTimer); utterances.flush(); releaseMicrophone(); }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try { context = new AudioContextClass({ sampleRate: 16000 }); }
    catch { context = new AudioContextClass(); }
    await context.resume();
    await context.audioWorklet.addModule('/audio-capture.worklet.js');
    if (stopped) return { stop() {}, cancel };
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'caption-audio-capture');
    gain = context.createGain(); gain.gain.value = 0;
    // A connected, muted output keeps the worklet processing without playing the microphone.
    source.connect(node); node.connect(gain); gain.connect(context.destination);
    node.port.onmessage = event => {
      if (event.data?.type === 'flushed') { finishStop(); return; }
      if (!stopped || flushing) { utterances.push(event.data); onActivity(); }
    };
  } catch (error) { cancel(); throw error; }
  return {
    stop() {
      if (stopped) return; stopped = true; flushing = true;
      node.port.postMessage({ type: 'flush' });
      stopTimer = setTimeout(finishStop, 150);
    },
    cancel,
  };
}
