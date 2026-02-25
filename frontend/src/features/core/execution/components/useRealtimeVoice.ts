/**
 * useRealtimeVoice - OpenAI Realtime API WebSocket Hook
 *
 * Features:
 * - Real-time voice conversation
 * - User and AI transcript tracking
 * - Tool call callbacks for dynamic updates
 * - Proper conversation turn management
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface RealtimeConfig {
  url: string;
  api_key: string;
  model: string;
  voice: string;
  instructions: string;
  tools: any[];
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  isComplete: boolean;
}

interface UseRealtimeVoiceOptions {
  onToolCall?: (toolName: string, result: any) => void;
  onUserSpeech?: (transcript: string) => void;
  onAssistantSpeech?: (transcript: string, isComplete: boolean) => void;
}

interface UseRealtimeVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isPlaying: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions = {}): UseRealtimeVoiceReturn {
  const { onToolCall, onUserSpeech, onAssistantSpeech } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Track current response transcript
  const currentTranscriptRef = useRef<string>('');
  const currentResponseIdRef = useRef<string | null>(null);

  // Callbacks refs (to avoid stale closures)
  const onToolCallRef = useRef(onToolCall);
  const onUserSpeechRef = useRef(onUserSpeech);
  const onAssistantSpeechRef = useRef(onAssistantSpeech);

  useEffect(() => {
    onToolCallRef.current = onToolCall;
    onUserSpeechRef.current = onUserSpeech;
    onAssistantSpeechRef.current = onAssistantSpeech;
  }, [onToolCall, onUserSpeech, onAssistantSpeech]);

  // Fetch config from backend
  const fetchConfig = useCallback(async (): Promise<RealtimeConfig> => {
    const res = await fetch('/api/orchestrator/realtime/config');
    const data = await res.json();
    if (!data.success) throw new Error('Failed to get config');
    return data.config;
  }, []);

  // Interrupt playback when user starts speaking
  const interruptPlayback = useCallback(() => {
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setIsPlaying(false);
  }, []);

  // Play audio chunk (base64 PCM16)
  const playAudioChunk = useCallback(async (base64Audio: string) => {
    try {
      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
        nextPlayTimeRef.current = 0;
      }
      const ctx = playbackContextRef.current;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Decode base64 to PCM16
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 to Float32
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
      }

      // Create AudioBuffer
      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      // Schedule playback
      const currentTime = ctx.currentTime;
      const startTime = Math.max(currentTime, nextPlayTimeRef.current);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      // Play
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(startTime);

      setIsPlaying(true);
    } catch (err) {
      console.error('[Realtime] Audio playback error:', err);
    }
  }, []);

  // Handle server events
  const handleServerEvent = useCallback((event: any) => {
    switch (event.type) {
      case 'session.created':
        console.log('[Realtime] Session created');
        break;

      case 'session.updated':
        console.log('[Realtime] Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Realtime] User speech started');
        interruptPlayback();
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] User speech stopped');
        break;

      // User's speech transcription
      case 'conversation.item.input_audio_transcription.completed':
        console.log('[Realtime] User transcript:', event.transcript);
        if (event.transcript && onUserSpeechRef.current) {
          onUserSpeechRef.current(event.transcript);
        }
        break;

      case 'response.created':
        console.log('[Realtime] Response created:', event.response?.id);
        // New response, reset transcript
        currentResponseIdRef.current = event.response?.id;
        currentTranscriptRef.current = '';
        break;

      case 'response.audio.delta':
        if (event.delta) {
          playAudioChunk(event.delta);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          currentTranscriptRef.current += event.delta;
          // Notify with incomplete transcript
          if (onAssistantSpeechRef.current) {
            onAssistantSpeechRef.current(currentTranscriptRef.current, false);
          }
        }
        break;

      case 'response.audio_transcript.done':
        console.log('[Realtime] AI transcript done:', event.transcript);
        // Final transcript for this response
        if (onAssistantSpeechRef.current && event.transcript) {
          onAssistantSpeechRef.current(event.transcript, true);
        }
        break;

      case 'response.done':
        console.log('[Realtime] Response done');
        // Mark current response as complete
        currentResponseIdRef.current = null;
        break;

      case 'response.audio.done':
        console.log('[Realtime] Audio stream done');
        break;

      case 'error':
        console.error('[Realtime] Server error:', event.error);
        setError(event.error?.message || 'Server error');
        break;

      case 'response.function_call_arguments.done':
        console.log('[Realtime] Function call:', event.name, event.arguments);
        handleToolCall(event.call_id, event.name, event.arguments);
        break;

      default:
        // Log other events for debugging
        if (!event.type.includes('delta')) {
          console.log('[Realtime] Event:', event.type);
        }
    }
  }, [playAudioChunk, interruptPlayback]);

  // Handle tool calls
  const handleToolCall = useCallback(async (callId: string, toolName: string, argsJson: string) => {
    try {
      const args = JSON.parse(argsJson || '{}');
      console.log('[Realtime] Executing tool:', toolName, args);

      const res = await fetch('/api/orchestrator/realtime/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: toolName, arguments: args })
      });
      const data = await res.json();

      console.log('[Realtime] Tool result:', data);

      // Notify callback for dynamic updates
      if (onToolCallRef.current) {
        onToolCallRef.current(toolName, data.success ? data.result : null);
      }

      // Send tool result back to OpenAI
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(data.success ? data.result : { error: data.error })
          }
        }));

        // Wait for audio to finish before triggering new response
        const ctx = playbackContextRef.current;
        const remainingTime = ctx
          ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000)
          : 0;

        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'response.create'
            }));
          }
        }, remainingTime + 100);
      }
    } catch (err) {
      console.error('[Realtime] Tool call error:', err);
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async (ws: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const uint8 = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      console.log('[Realtime] Recording started');
    } catch (err) {
      console.error('[Realtime] Failed to start recording:', err);
      setError('Microphone access denied');
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
    console.log('[Realtime] Recording stopped');
  }, []);

  // Connect to realtime API
  const connect = useCallback(async () => {
    try {
      setError(null);
      const config = await fetchConfig();

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/orchestrator/realtime/ws`;
      console.log('[Realtime] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = async () => {
        console.log('[Realtime] WebSocket connected');
        setIsConnected(true);

        // Send session config with input audio transcription enabled
        const sessionConfig: any = {
          modalities: ['text', 'audio'],
          instructions: config.instructions,
          voice: config.voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'  // Enable user speech transcription
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.6,
            prefix_padding_ms: 400,
            silence_duration_ms: 800
          }
        };

        if (config.tools?.length > 0) {
          sessionConfig.tools = config.tools;
        }

        ws.send(JSON.stringify({
          type: 'session.update',
          session: sessionConfig
        }));

        // Start recording
        try {
          await startRecording(ws);
        } catch (err) {
          console.error('[Realtime] Auto-start recording failed:', err);
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
      };

      ws.onerror = (event) => {
        console.error('[Realtime] WebSocket error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('[Realtime] WebSocket closed');
        setIsConnected(false);
        stopRecording();
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[Realtime] Connection failed:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [fetchConfig, handleServerEvent, startRecording, stopRecording]);

  // Disconnect
  const disconnect = useCallback(() => {
    stopRecording();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }

    setIsConnected(false);
    setIsPlaying(false);
    setError(null);
    currentTranscriptRef.current = '';
    currentResponseIdRef.current = null;
  }, [stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isRecording,
    isPlaying,
    error,
    connect,
    disconnect
  };
}
