"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base64ToBlob, encodeWav, rms } from "@/lib/audioUtils";
import { StreamingPlayer } from "@/lib/streamPlayer";
import type { AppointmentSnapshot, CallStatus, TranscriptLine } from "@/types";

const END_OF_SPEECH_MS = 700;
const MIN_SPEECH_MS = 300;
const MAX_UTTERANCE_MS = 30_000;
const PREROLL_MS = 300;
const SILENCE_PROMPT_MS = 12_000;
const MAX_SILENCE_PROMPTS = 2;

type ServerEvent =
  | { type: "transcript"; text: string }
  | { type: "reply"; text: string; saved: { id: number } | null; state: AppointmentSnapshot }
  | { type: "audio_chunk"; audio: string; mime: string }
  | { type: "audio_end" }
  | { type: "error"; message: string }
  | { type: "done" };

export function useVoiceCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentSnapshot | null>(null);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);

  const statusRef = useRef<CallStatus>("idle");
  const sessionRef = useRef<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<StreamingPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silencePrompts = useRef(0);
  const lineId = useRef(0);
  const vad = useRef({
    inSpeech: false,
    voicedMs: 0,
    silenceMs: 0,
    totalMs: 0,
    noise: 0.005,
    chunks: [] as Float32Array[],
    preroll: [] as Float32Array[],
    prerollMs: 0,
  });

  const updateStatus = useCallback((s: CallStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const addLine = useCallback((role: TranscriptLine["role"], text: string) => {
    setTranscript((t) => [...t, { id: ++lineId.current, role, text }]);
  }, []);

  const clearSilenceTimer = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
  }, []);

  const requestTurn = useCallback(
    async (body: FormData) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      body.append("sessionId", sessionId);
      updateStatus("thinking");
      clearSilenceTimer();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let playing = false;
      try {
        const res = await fetch("/api/voice/turn", { method: "POST", body, signal: ctrl.signal });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "request failed");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const handle = async (ev: ServerEvent) => {
          if (ev.type === "transcript") addLine("patient", ev.text);
          else if (ev.type === "reply") {
            addLine("receptionist", ev.text);
            setAppointment(ev.state);
            if (ev.saved) setSavedRequestId(ev.saved.id);
          } else if (ev.type === "error") {
            setError(ev.message);
          } else if (ev.type === "audio_chunk") {
            playing = true;
            if (!playerRef.current) {
              const p: StreamingPlayer = new StreamingPlayer(
                ev.mime,
                () => {
                  if (playerRef.current === p) playerRef.current = null;
                  if (statusRef.current === "speaking") {
                    updateStatus("listening");
                    armSilenceTimer();
                  }
                },
                () => updateStatus("speaking"),
              );
              playerRef.current = p;
            }
            playerRef.current.push(ev.audio);
          } else if (ev.type === "audio_end") {
            playerRef.current?.end();
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) await handle(JSON.parse(line) as ServerEvent);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("I'm having trouble connecting. Please try again.");
      } finally {
        playerRef.current?.end(); // no-op if already ended
        if (!playing && statusRef.current === "thinking") {
          updateStatus("listening");
          armSilenceTimer();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const play = useCallback(
    (blob: Blob) =>
      new Promise<void>((resolve) => {
        stopPlayback();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const finish = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          if (statusRef.current === "speaking") {
            updateStatus("listening");
            armSilenceTimer();
          }
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        updateStatus("speaking");
        audio.play().catch(finish);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPlayback, updateStatus],
  );

  function armSilenceTimer() {
    clearSilenceTimer();
    if (silencePrompts.current >= MAX_SILENCE_PROMPTS) return;
    silenceTimer.current = setTimeout(() => {
      if (statusRef.current !== "listening") return;
      silencePrompts.current += 1;
      const fd = new FormData();
      fd.append("event", "silence");
      void requestTurn(fd);
    }, SILENCE_PROMPT_MS);
  }

  const finishUtterance = useCallback(
    (sampleRate: number) => {
      const v = vad.current;
      const voicedMs = v.totalMs - v.silenceMs;
      const chunks = v.chunks;
      v.inSpeech = false;
      v.chunks = [];
      v.silenceMs = 0;
      v.totalMs = 0;
      v.voicedMs = 0;
      if (voicedMs < MIN_SPEECH_MS) {
        if (statusRef.current === "hearing") {
          updateStatus("listening");
          armSilenceTimer();
        }
        return;
      }
      const fd = new FormData();
      fd.append("audio", encodeWav(chunks, sampleRate), "speech.wav");
      void requestTurn(fd);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestTurn, updateStatus],
  );

  const onChunk = useCallback(
    (chunk: Float32Array, sampleRate: number) => {
      const s = statusRef.current;
      if (s === "thinking" || s === "connecting" || s === "idle" || s === "ended" || s === "error") return;
      const v = vad.current;
      const ms = (chunk.length / sampleRate) * 1000;
      const level = rms(chunk);
      const aiTalking = s === "speaking";
      const threshold = aiTalking ? Math.max(0.05, v.noise * 4) : Math.max(0.015, v.noise * 2.5);
      const voiced = level > threshold;
      if (!voiced && !v.inSpeech) v.noise = v.noise * 0.95 + level * 0.05;

      if (!v.inSpeech) {
        v.preroll.push(chunk);
        v.prerollMs += ms;
        while (v.prerollMs > PREROLL_MS && v.preroll.length > 1) {
          v.prerollMs -= (v.preroll.shift()!.length / sampleRate) * 1000;
        }
        v.voicedMs = voiced ? v.voicedMs + ms : 0;
        if (v.voicedMs >= (aiTalking ? 250 : 80)) {
          if (aiTalking) stopPlayback(); // barge-in: patient interrupted
          clearSilenceTimer();
          silencePrompts.current = 0;
          v.inSpeech = true;
          v.chunks = [...v.preroll];
          v.totalMs = v.prerollMs;
          v.silenceMs = 0;
          v.preroll = [];
          v.prerollMs = 0;
          updateStatus("hearing");
        }
        return;
      }

      v.chunks.push(chunk);
      v.totalMs += ms;
      v.silenceMs = voiced ? 0 : v.silenceMs + ms;
      if (v.silenceMs >= END_OF_SPEECH_MS || v.totalMs >= MAX_UTTERANCE_MS) finishUtterance(sampleRate);
    },
    [finishUtterance, stopPlayback, updateStatus],
  );

  const cleanup = useCallback(() => {
    clearSilenceTimer();
    abortRef.current?.abort();
    stopPlayback();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, [stopPlayback]);

  const startCall = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setAppointment(null);
    setSavedRequestId(null);
    silencePrompts.current = 0;
    vad.current = { ...vad.current, inSpeech: false, chunks: [], preroll: [], prerollMs: 0, voicedMs: 0, silenceMs: 0, totalMs: 0 };
    updateStatus("connecting");

    // Create the AudioContext inside the click gesture so playback is allowed.
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      cleanup();
      setError("Please allow microphone access to start.");
      updateStatus("error");
      return;
    }

    try {
      const res = await fetch("/api/voice/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "start failed");
      sessionRef.current = data.sessionId;

      await ctx.audioWorklet.addModule("/pcm-worklet.js");
      const src = ctx.createMediaStreamSource(streamRef.current);
      const node = new AudioWorkletNode(ctx, "pcm-forwarder");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data, ctx.sampleRate);
      src.connect(node);

      addLine("receptionist", data.greeting);
      await ctx.resume();
      await play(base64ToBlob(data.audio, data.mime));
    } catch (e) {
      cleanup();
      setError(e instanceof Error && e.message ? e.message : "I'm having trouble connecting. Please try again.");
      updateStatus("error");
    }
  }, [addLine, cleanup, onChunk, play, updateStatus]);

  const endCall = useCallback(() => {
    const id = sessionRef.current;
    sessionRef.current = null;
    cleanup();
    if (id) {
      void fetch("/api/voice/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      }).catch(() => undefined);
    }
    updateStatus("ended");
  }, [cleanup, updateStatus]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, transcript, error, appointment, savedRequestId, startCall, endCall };
}
