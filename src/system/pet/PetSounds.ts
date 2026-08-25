/**
 * Synthesized pet-training sounds via WebAudio: a mechanical clicker and a
 * collar-bell jingle. No audio assets - everything is generated, quiet
 * (matching ambient game volume), and every call is best-effort: a blocked
 * or unavailable AudioContext just means silence.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
    try {
        context ??= new AudioContext();
        if (context.state === "suspended") {
            // Resumes after the first user gesture; harmless to call again
            void context.resume();
        }
        return context;
    } catch {
        return null;
    }
}

/** One mechanical clicker tick: a bright snap with a lower body. */
function scheduleClick(ac: AudioContext, at: number): void {
    for (const [frequency, gain, duration] of [[3200, 0.22, 0.018], [1100, 0.14, 0.03]] as const) {
        const osc = ac.createOscillator();
        const env = ac.createGain();
        osc.type = "square";
        osc.frequency.value = frequency;
        env.gain.setValueAtTime(gain, at);
        env.gain.exponentialRampToValueAtTime(0.001, at + duration);
        osc.connect(env).connect(ac.destination);
        osc.start(at);
        osc.stop(at + duration + 0.01);
    }
}

/** Plays 1-3 clicker ticks in quick succession. */
export function playClicks(count: number): void {
    const ac = audioContext();
    if (!ac || !Number.isFinite(count) || count <= 0) {
        return;
    }
    const ticks = Math.min(3, Math.floor(count));
    for (let i = 0; i < ticks; i++) {
        scheduleClick(ac, ac.currentTime + 0.02 + i * 0.16);
    }
}

/** One bell "ting": two detuned partials with a fast shimmer decay. */
function scheduleTing(ac: AudioContext, at: number): void {
    const base = 2200 + Math.random() * 600;
    for (const [ratio, gain] of [[1, 0.09], [1.71, 0.05]] as const) {
        const osc = ac.createOscillator();
        const env = ac.createGain();
        osc.type = "sine";
        osc.frequency.value = base * ratio;
        env.gain.setValueAtTime(gain, at);
        env.gain.exponentialRampToValueAtTime(0.001, at + 0.28);
        osc.connect(env).connect(ac.destination);
        osc.start(at);
        osc.stop(at + 0.3);
    }
}

/** Plays a small bell jingle; more worn bells make a busier cluster. */
export function playJingle(bells = 1): void {
    const ac = audioContext();
    if (!ac) {
        return;
    }
    const tings = Math.min(6, 2 + Math.max(0, Math.floor(bells)));
    let at = ac.currentTime + 0.02;
    for (let i = 0; i < tings; i++) {
        scheduleTing(ac, at);
        at += 0.05 + Math.random() * 0.09;
    }
}
